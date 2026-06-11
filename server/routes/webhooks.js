const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const prisma = require('../models/prisma');
const FacturanteMapper = require('../utils/facturanteMapper');
const FacturanteService = require('../services/facturante');
const logger = require('../utils/logger');
const { setInvoiceMetafields } = require('../utils/shopifyMetafields');

function verifyHmac(rawBody, signature) {
  var secret = process.env.SHOPIFY_API_SECRET;
  var hash = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try { return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature || '')); } catch (e) { return false; }
}

router.post('/shopify/order-paid', async (req, res) => {
  try {
    var hmac = req.headers['x-shopify-hmac-sha256'];
    if (!verifyHmac(req.body, hmac)) return res.status(401).send('Unauthorized');
    var shopDomain = req.headers['x-shopify-shop-domain'];
    var orderData = JSON.parse(req.body.toString());
    res.status(200).send('OK');
    var shop = await prisma.shop.findUnique({ where: { shopDomain: shopDomain } });
    if (!shop) return;
    var existing = await prisma.invoice.findUnique({ where: { shopifyOrderId: orderData.id.toString() } });
    if (existing) return;
    // Normalize REST line items: compute discounted_unit_price from discount_allocations
    // (REST payload has original price + discount_allocations, mapper uses discounted_unit_price)
    orderData.line_items = (orderData.line_items || []).map(function (item) {
      var qty = parseInt(item.quantity, 10) || 1;
      var pricePerUnit = parseFloat(item.price) || 0;

      // Calcular descuento total del line item
      var totalDiscount = (item.discount_allocations || []).reduce(function (sum, d) {
        return sum + parseFloat(d.amount || 0);
      }, 0);

      // Descuento unitario = descuento total / cantidad
      var discountPerUnit = qty > 0 ? (totalDiscount / qty) : 0;

      // Precio unitario con descuento
      var discountedUnitPrice = Math.max(0, pricePerUnit - discountPerUnit); // min 0

      // Loguear para debugging
      logger.debug('Item normalization: sku=' + (item.sku || 'N/A') +
        ' qty=' + qty +
        ' price=' + pricePerUnit.toFixed(2) +
        ' totalDiscount=' + totalDiscount.toFixed(2) +
        ' discountPerUnit=' + discountPerUnit.toFixed(2) +
        ' final=' + discountedUnitPrice.toFixed(2));

      item.discounted_unit_price = discountedUnitPrice.toFixed(3); // 3 decimales como Facturante espera

      return item;
    });

    logger.info('Normalized ' + orderData.line_items.length + ' line items for order ' + orderData.name);
    var facturaData = FacturanteMapper.mapShopifyToFacturante(orderData);

    // Siempre guardar datos del webhook: el REST payload tiene nombre/email completos
    // aunque no esté aprobado el acceso a datos protegidos en Partner Dashboard
    await prisma.invoice.create({ data: { shopId: shop.id, shopifyOrderId: orderData.id.toString(), shopifyOrderNumber: (orderData.order_number || orderData.name).toString(), customerName: facturaData.cliente.nombre, customerEmail: facturaData.cliente.email, totalAmount: parseFloat(facturaData.importe_total), status: 'pending', invoiceData: facturaData } });
    logger.info('Order ' + orderData.name + ' saved as pending');

    if (shop.autoInvoice && shop.hash && shop.empresa) {
      var autoStatus = 'pending', facturanteId = null, errorMsg = null, caeInline = null, numeroInline = null;
      try {
        var facturante = new FacturanteService({ empresa: shop.empresa, usuario: shop.usuario, hash: shop.hash, puntoVenta: shop.puntoVenta });
        var webhookUrl = process.env.SHOPIFY_APP_URL ? process.env.SHOPIFY_APP_URL.replace(/\/$/, '') + '/webhooks/facturante' : null;
        var resultado = await facturante.crearComprobante(facturaData, webhookUrl);
        facturanteId = resultado.idComprobante ? resultado.idComprobante.toString() : null;
        if (resultado.autorizado && resultado.cae) {
          autoStatus = 'completed'; caeInline = resultado.cae.toString(); numeroInline = resultado.numero ? resultado.numero.toString() : null;
        } else {
          autoStatus = 'processing';
        }
      } catch (e) { autoStatus = 'failed'; errorMsg = e.message; }

      await prisma.invoice.update({ where: { shopifyOrderId: orderData.id.toString() }, data: { status: autoStatus, facturanteInvoiceId: facturanteId, cae: caeInline, facturanteInvoiceNumber: numeroInline, processedAt: autoStatus === 'completed' ? new Date() : null, errorMessage: errorMsg } });
      logger.info('Order ' + orderData.name + ' autoInvoice processed (' + autoStatus + ')');

      // Si ya está completado inline, escribir metafields a Shopify
      if (autoStatus === 'completed' && caeInline) {
        var sessionRec = await prisma.session.findFirst({ where: { shop: shopDomain, isOnline: false }, orderBy: { expires: 'desc' } });
        var tokForMeta = (sessionRec && sessionRec.accessToken) ? sessionRec.accessToken : shop.accessToken;
        if (tokForMeta) {
          await setInvoiceMetafields({ shop: shopDomain, accessToken: tokForMeta }, orderData.id.toString(), { status: 'completed', cae: caeInline, invoiceNumber: numeroInline });
        }
      }
    }
  } catch (error) { logger.error('Webhook order-paid error: ' + error.message); }
});

router.post('/shopify/uninstall', async (req, res) => {
  try {
    var hmac = req.headers['x-shopify-hmac-sha256'];
    if (!verifyHmac(req.body, hmac)) return res.status(401).send('Unauthorized');
    var shopDomain = req.headers['x-shopify-shop-domain'];
    res.status(200).send('OK');
    // Limpiar credenciales sensibles y sesiones al desinstalar
    await prisma.shop.update({
      where: { shopDomain: shopDomain },
      data: {
        status: 'inactive',
        empresa: null,
        usuario: null,
        hash: null,
        puntoVenta: '1',
        autoInvoice: false,
      },
    });
    await prisma.session.deleteMany({ where: { shop: shopDomain } });
    logger.info('Uninstall: shop=' + shopDomain + ' datos sensibles limpiados y sesiones borradas.');
  } catch (error) { logger.error('Uninstall error: ' + error.message); if (!res.headersSent) res.status(200).send('OK'); }
});

router.post('/shopify/gdpr', async (req, res) => {
  var hmac = req.headers['x-shopify-hmac-sha256'];
  if (!verifyHmac(req.body, hmac)) return res.status(401).send('Unauthorized');

  var topic = req.headers['x-shopify-topic'];
  var shopDomain = req.headers['x-shopify-shop-domain'];

  // Respond immediately — Shopify requires < 5s response
  res.status(200).json({ received: true });

  var payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch (e) {
    logger.warn('GDPR webhook: invalid JSON body (' + topic + '): ' + e.message);
    return;
  }

  try {
    if (topic === 'customers/redact') {
      // Anonymize customer PII from invoices for specific orders
      // invoiceData tambien contiene PII (nombre, email, CUIT) — se elimina junto con los otros campos
      var ordersToRedact = (payload.orders_to_redact || []).map(String);
      if (ordersToRedact.length > 0) {
        await prisma.invoice.updateMany({
          where: { shopifyOrderId: { in: ordersToRedact } },
          data: { customerName: '[REDACTED]', customerEmail: null, invoiceData: null, errorMessage: null }
        });
      } else if (payload.customer && payload.customer.email) {
        await prisma.invoice.updateMany({
          where: { customerEmail: payload.customer.email },
          data: { customerName: '[REDACTED]', customerEmail: null, invoiceData: null, errorMessage: null }
        });
      }
      logger.info('customers/redact processed for ' + shopDomain);

    } else if (topic === 'shop/redact') {
      // Delete all shop data 48h after uninstall — only if shop is still inactive (not reinstalled)
      var shop = await prisma.shop.findUnique({ where: { shopDomain: shopDomain } });
      if (shop && shop.status === 'inactive') {
        await prisma.invoice.deleteMany({ where: { shopId: shop.id } });
        await prisma.session.deleteMany({ where: { shop: shopDomain } });
        await prisma.shop.delete({ where: { shopDomain: shopDomain } });
        logger.info('shop/redact processed for ' + shopDomain);
      } else if (shop && shop.status === 'active') {
        logger.info('shop/redact ignored for ' + shopDomain + ' — shop was reinstalled');
      } else {
        logger.info('shop/redact processed for ' + shopDomain + ' — shop not found, nothing to delete');
      }

    } else if (topic === 'customers/data_request') {
      // This app stores: customerName, customerEmail on Invoice records
      // No external transmission required — acknowledge receipt only
      logger.info('customers/data_request received for ' + shopDomain);
    }
  } catch (error) {
    logger.error('GDPR webhook error (' + topic + '): ' + error.message);
  }
});

function extractXmlTag(xml, tag) {
  var match = xml.match(new RegExp('<[^>]*:?' + tag + '[^>]*>([^<]*)<'));
  return match ? match[1].trim() : null;
}

router.post('/facturante', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    var raw = req.body ? req.body.toString() : '';
    logger.info('Facturante webhook received, size=' + raw.length + ' bytes');

    // PASO 1: Detectar formato
    var contentType = (req.headers['content-type'] || '').toLowerCase();
    var parsedData = {};
    var parseMethod = 'unknown';

    if (contentType.includes('json') && !raw.trim().startsWith('<')) {
      // JSON Format
      try {
        parsedData = JSON.parse(raw);
        parseMethod = 'json';
        logger.info('Facturante webhook: parsed as JSON');
      } catch (e) {
        logger.warn('Facturante webhook: content-type=json pero JSON parse falló: ' + e.message);
        // Continuar a siguiente formato
      }
    }

    // PASO 2: Si no es JSON, intentar XML
    if (Object.keys(parsedData).length === 0 && raw.trim().startsWith('<')) {
      try {
        parsedData = {
          IdComprobante: extractXmlTag(raw, 'IdComprobante'),
          CAE: extractXmlTag(raw, 'CAE') || extractXmlTag(raw, 'Cae'),
          NumeroComprobante: extractXmlTag(raw, 'NumeroComprobante') || extractXmlTag(raw, 'Numero'),
          Estado: extractXmlTag(raw, 'Estado'),
          Mensaje: extractXmlTag(raw, 'Mensaje') || extractXmlTag(raw, 'Descripcion'),
          Errores: extractXmlTag(raw, 'Errores'),
        };
        parseMethod = 'xml';
        logger.info('Facturante webhook: parsed as XML');
      } catch (e) {
        logger.warn('Facturante webhook: XML parse falló: ' + e.message);
      }
    }

    // PASO 3: Si aún no tenemos datos, intentar form-urlencoded
    if (Object.keys(parsedData).length === 0 && raw.includes('=')) {
      try {
        var params = {};
        raw.split('&').forEach(function (pair) {
          var parts = pair.split('=');
          if (parts.length === 2) {
            params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1].replace(/\+/g, ' '));
          }
        });
        if (Object.keys(params).length > 0) {
          parsedData = params;
          parseMethod = 'form-urlencoded';
          logger.info('Facturante webhook: parsed as form-urlencoded');
        }
      } catch (e) {
        logger.warn('Facturante webhook: form-urlencoded parse falló: ' + e.message);
      }
    }

    // PASO 4: Validar que tenemos datos
    if (Object.keys(parsedData).length === 0) {
      logger.warn('Facturante webhook: no se pudo parsear el payload. Raw (primeros 500): ' + raw.substring(0, 500));
      return res.status(200).json({ status: 'parse_failed', reason: 'Could not parse payload' });
    }

    logger.info('Facturante webhook: parseMethod=' + parseMethod + ' data=' + JSON.stringify(parsedData));

    // PASO 5: NORMALIZAR CAMPOS (PascalCase → camelCase)
    var normalizedData = {
      idComprobante: parsedData.IdComprobante || parsedData.idComprobante || parsedData.id,
      cae: parsedData.CAE || parsedData.cae || parsedData.Cae,
      numeroComprobante: parsedData.NumeroComprobante || parsedData.numeroComprobante || parsedData.Numero || parsedData.numero,
      estado: (parsedData.Estado || parsedData.estado || '').toLowerCase().trim(),
      mensaje: parsedData.Mensaje || parsedData.mensaje || parsedData.Descripcion || parsedData.descripcion || '',
      errores: parsedData.Errores || parsedData.errores || '',
      pdfUrl: parsedData.URLPDF || parsedData.UrlPdf || parsedData.urlPdf || parsedData.PdfUrl || null,
    };

    logger.info('Facturante webhook normalized: id=' + normalizedData.idComprobante +
      ' cae=' + normalizedData.cae +
      ' estado=' + normalizedData.estado);

    // PASO 6: Validar campos críticos
    if (!normalizedData.idComprobante) {
      logger.warn('Facturante webhook: idComprobante es vacío/null. Ignorando.');
      return res.status(200).json({ status: 'ignored', reason: 'no_id' });
    }

    // PASO 7: Buscar en BD
    var invoice = await prisma.invoice.findFirst({
      where: { facturanteInvoiceId: normalizedData.idComprobante.toString() },
      include: { shop: true },
    });

    if (!invoice) {
      logger.warn('Facturante webhook: idComprobante=' + normalizedData.idComprobante + ' NOT FOUND in DB');
      return res.status(200).json({ status: 'not_found', reason: 'invoice_not_found' });
    }

    logger.info('Facturante webhook: found invoice for orderId=' + invoice.shopifyOrderId);

    // PASO 8: Obtener token válido
    var sessionRec = await prisma.session.findFirst({
      where: { shop: invoice.shop.shopDomain, isOnline: false },
      orderBy: { expires: 'desc' },
    });
    var accessTokenForMeta = (sessionRec && sessionRec.accessToken) ? sessionRec.accessToken : invoice.shop.accessToken;
    var session = { shop: invoice.shop.shopDomain, accessToken: accessTokenForMeta };

    // PASO 9: Procesar según estado
    if ((normalizedData.estado === 'autorizado' || normalizedData.estado === 'ok') && normalizedData.cae) {
      // ✅ ÉXITO
      var caeStr = normalizedData.cae.toString();
      var numStr = normalizedData.numeroComprobante ? normalizedData.numeroComprobante.toString() : null;

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'completed',
          facturanteInvoiceNumber: numStr,
          cae: caeStr,
          pdfUrl: normalizedData.pdfUrl || undefined,
          processedAt: new Date()
        },
      });

      await setInvoiceMetafields(session, invoice.shopifyOrderId, {
        status: 'completed',
        cae: caeStr,
        invoiceNumber: numStr,
      });

      logger.info('✅ Facturante webhook: orderId=' + invoice.shopifyOrderId + ' → COMPLETED. CAE=' + caeStr);

    } else {
      // ❌ FALLO O ESTADO DESCONOCIDO
      var errorMsg = normalizedData.mensaje || normalizedData.estado || 'Rechazado por Facturante';
      if (normalizedData.errores) errorMsg = normalizedData.errores + ' / ' + errorMsg;

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'failed',
          errorMessage: errorMsg.substring(0, 500) // Limitar a 500 chars
        },
      });

      await setInvoiceMetafields(session, invoice.shopifyOrderId, {
        status: 'failed',
        error: errorMsg.substring(0, 255),
      });

      logger.warn('❌ Facturante webhook: orderId=' + invoice.shopifyOrderId + ' → FAILED. error=' + errorMsg);
    }

    res.status(200).json({ status: 'processed', parseMethod: parseMethod });

  } catch (error) {
    logger.error('Facturante webhook error: ' + error.message + ' stack=' + (error.stack || '').substring(0, 300));
    res.status(200).json({ status: 'error', message: error.message });
  }
});

module.exports = router;
