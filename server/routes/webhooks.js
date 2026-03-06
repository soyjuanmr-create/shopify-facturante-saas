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
      var totalDiscount = (item.discount_allocations || []).reduce(function (sum, d) { return sum + parseFloat(d.amount || 0); }, 0);
      var qty = parseInt(item.quantity, 10) || 1;
      item.discounted_unit_price = (parseFloat(item.price) - totalDiscount / qty).toString();
      return item;
    });
    var facturaData = FacturanteMapper.mapShopifyToFacturante(orderData);
    var status = 'pending', facturanteId = null, errorMsg = null, caeInline = null, numeroInline = null;
    if (shop.autoInvoice && shop.hash && shop.empresa) {
      try {
        var facturante = new FacturanteService({ empresa: shop.empresa, usuario: shop.usuario, hash: shop.hash, puntoVenta: shop.puntoVenta });
        var webhookUrl = process.env.SHOPIFY_APP_URL ? process.env.SHOPIFY_APP_URL.replace(/\/$/, '') + '/webhooks/facturante' : null;
        var resultado = await facturante.crearComprobante(facturaData, webhookUrl);
        facturanteId = resultado.idComprobante ? resultado.idComprobante.toString() : null;
        if (resultado.autorizado && resultado.cae) {
          // Facturante autorizó sincrónicamente — no necesitamos esperar el webhook
          status = 'completed'; caeInline = resultado.cae.toString(); numeroInline = resultado.numero ? resultado.numero.toString() : null;
        } else {
          status = 'processing';
        }
      } catch (e) { status = 'failed'; errorMsg = e.message; }
    }
    await prisma.invoice.create({ data: { shopId: shop.id, shopifyOrderId: orderData.id.toString(), shopifyOrderNumber: (orderData.order_number || orderData.name).toString(), customerName: facturaData.cliente.nombre, customerEmail: facturaData.cliente.email, totalAmount: parseFloat(facturaData.importe_total), status: status, facturanteInvoiceId: facturanteId, cae: caeInline, facturanteInvoiceNumber: numeroInline, processedAt: status === 'completed' ? new Date() : null, errorMessage: errorMsg, invoiceData: facturaData } });
    logger.info('Order ' + orderData.name + ' processed (' + status + ')');
    // Si ya está completado inline, escribir metafields a Shopify
    if (status === 'completed' && caeInline) {
      var sessionRec = await prisma.session.findFirst({ where: { shop: shopDomain, isOnline: false }, orderBy: { expires: 'desc' } });
      var tokForMeta = (sessionRec && sessionRec.accessToken) ? sessionRec.accessToken : shop.accessToken;
      if (tokForMeta) {
        var sessionObj = { shop: shopDomain, accessToken: tokForMeta };
        await setInvoiceMetafields(sessionObj, orderData.id.toString(), { status: 'completed', cae: caeInline, invoiceNumber: numeroInline });
      }
    }
  } catch (error) { logger.error('Webhook order-paid error: ' + error.message); }
});

router.post('/shopify/app-uninstalled', async (req, res) => {
  try {
    var hmac = req.headers['x-shopify-hmac-sha256'];
    if (!verifyHmac(req.body, hmac)) return res.status(401).send('Unauthorized');
    var shopDomain = req.headers['x-shopify-shop-domain'];
    res.status(200).send('OK');
    await prisma.shop.update({ where: { shopDomain: shopDomain }, data: { status: 'uninstalled' } });
  } catch (error) { logger.error('Uninstall error: ' + error.message); if (!res.headersSent) res.status(200).send('OK'); }
});

router.post('/shopify', async (req, res) => {
  var hmac = req.headers['x-shopify-hmac-sha256'];
  if (!verifyHmac(req.body, hmac)) return res.status(401).send('Unauthorized');

  var topic = req.headers['x-shopify-topic'];
  var shopDomain = req.headers['x-shopify-shop-domain'];
  var payload = JSON.parse(req.body.toString());

  // Respond immediately — Shopify requires < 5s response
  res.status(200).json({ received: true });

  try {
    if (topic === 'customers/redact') {
      // Anonymize customer PII from invoices for specific orders
      var ordersToRedact = (payload.orders_to_redact || []).map(String);
      if (ordersToRedact.length > 0) {
        await prisma.invoice.updateMany({
          where: { shopifyOrderId: { in: ordersToRedact } },
          data: { customerName: '[REDACTED]', customerEmail: null, invoiceData: null }
        });
      } else if (payload.customer && payload.customer.email) {
        await prisma.invoice.updateMany({
          where: { customerEmail: payload.customer.email },
          data: { customerName: '[REDACTED]', customerEmail: null, invoiceData: null }
        });
      }
      logger.info('customers/redact processed for ' + shopDomain);

    } else if (topic === 'shop/redact') {
      // Delete all shop data 48h after uninstall
      var shop = await prisma.shop.findUnique({ where: { shopDomain: shopDomain } });
      if (shop) {
        await prisma.invoice.deleteMany({ where: { shopId: shop.id } });
        await prisma.session.deleteMany({ where: { shop: shopDomain } });
        await prisma.shop.delete({ where: { shopDomain: shopDomain } });
      }
      logger.info('shop/redact processed for ' + shopDomain);

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
    logger.info('Facturante webhook raw: ' + raw.substring(0, 500));

    // Intentar parsear como JSON primero, luego como XML
    var data = {};
    try { data = JSON.parse(raw); } catch (e) {
      // Extraer campos del XML
      data = {
        IdComprobante: extractXmlTag(raw, 'IdComprobante'),
        CAE: extractXmlTag(raw, 'CAE'),
        NumeroComprobante: extractXmlTag(raw, 'NumeroComprobante') || extractXmlTag(raw, 'Numero'),
        Estado: extractXmlTag(raw, 'Estado'),
        Mensaje: extractXmlTag(raw, 'Mensaje'),
      };
    }

    var idComprobante = data.IdComprobante || data.idComprobante || data.id;
    var cae = data.CAE || data.cae;
    var numero = data.NumeroComprobante || data.Numero;
    var estado = (data.Estado || data.estado || '').toLowerCase();
    logger.info('Facturante webhook parsed: id=' + idComprobante + ' estado=' + estado + ' cae=' + cae);

    if (!idComprobante) return res.status(200).json({ status: 'ignored' });
    var invoice = await prisma.invoice.findFirst({
      where: { facturanteInvoiceId: idComprobante.toString() },
      include: { shop: true },
    });
    if (!invoice) return res.status(200).json({ status: 'not_found' });

    // Buscar accessToken en Session (igual que el resto del codebase) para no usar un token expirado
    var sessionRec = await prisma.session.findFirst({
      where: { shop: invoice.shop.shopDomain, isOnline: false },
      orderBy: { expires: 'desc' },
    });
    var accessTokenForMeta = (sessionRec && sessionRec.accessToken) ? sessionRec.accessToken : invoice.shop.accessToken;
    var session = { shop: invoice.shop.shopDomain, accessToken: accessTokenForMeta };

    if (estado === 'autorizado' && cae) {
      var caeStr = cae.toString();
      var numStr = numero ? numero.toString() : null;
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'completed', facturanteInvoiceNumber: numStr, cae: caeStr, processedAt: new Date() },
      });
      await setInvoiceMetafields(session, invoice.shopifyOrderId, {
        status: 'completed', cae: caeStr, invoiceNumber: numStr,
      });
    } else {
      var errores = Array.isArray(data.Errores) ? data.Errores.join(', ') : (extractXmlTag(raw, 'Errores') || '');
      var errorMsg = errores || data.Mensaje || extractXmlTag(raw, 'Mensaje') || 'Rechazado';
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'failed', errorMessage: errorMsg } });
      await setInvoiceMetafields(session, invoice.shopifyOrderId, {
        status: 'failed', error: errorMsg,
      });
    }
    res.status(200).json({ status: 'processed' });
  } catch (error) { logger.error('Facturante webhook error: ' + error.message); res.status(200).json({ status: 'error' }); }
});

module.exports = router;
