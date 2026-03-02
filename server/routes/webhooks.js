const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const prisma = require('../models/prisma');
const FacturanteMapper = require('../utils/facturanteMapper');
const FacturanteService = require('../services/facturante');
const logger = require('../utils/logger');

function verifyHmac(rawBody, signature) {
  var secret = process.env.SHOPIFY_API_SECRET;
  var hash = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try { return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature || '')); } catch(e) { return false; }
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
    var facturaData = FacturanteMapper.mapShopifyToFacturante(orderData);
    var status = 'pending', facturanteId = null, errorMsg = null;
    if (shop.autoInvoice && shop.hash && shop.empresa) {
      try {
        var facturante = new FacturanteService({ empresa: shop.empresa, usuario: shop.usuario, hash: shop.hash, puntoVenta: shop.puntoVenta });
        var webhookUrl = process.env.SHOPIFY_APP_URL ? process.env.SHOPIFY_APP_URL.replace(/\/$/, '') + '/webhooks/facturante' : null;
        var resultado = await facturante.crearComprobante(facturaData, webhookUrl);
        facturanteId = resultado.idComprobante ? resultado.idComprobante.toString() : null; status = 'processing';
      } catch (e) { status = 'failed'; errorMsg = e.message; }
    }
    await prisma.invoice.create({ data: { shopId: shop.id, shopifyOrderId: orderData.id.toString(), shopifyOrderNumber: (orderData.order_number || orderData.name).toString(), customerName: facturaData.cliente.nombre, customerEmail: facturaData.cliente.email, totalAmount: parseFloat(facturaData.importe_total), status: status, facturanteInvoiceId: facturanteId, errorMessage: errorMsg, invoiceData: facturaData } });
    logger.info('Order ' + orderData.name + ' processed (' + status + ')');
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

router.post('/facturante', express.json(), async (req, res) => {
  try {
    var data = req.body;
    var idComprobante = data.IdComprobante || data.idComprobante || data.id;
    var cae = data.CAE || data.cae;
    var numero = data.NumeroComprobante || data.Numero;
    var estado = (data.Estado || data.estado || '').toLowerCase();
    if (!idComprobante) return res.status(200).json({ status: 'ignored' });
    var invoice = await prisma.invoice.findFirst({ where: { facturanteInvoiceId: idComprobante.toString() } });
    if (!invoice) return res.status(200).json({ status: 'not_found' });
    if (estado === 'autorizado' && cae) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'completed', facturanteInvoiceNumber: numero ? numero.toString() : null, cae: cae.toString(), processedAt: new Date() } });
    } else {
      var errorMsg = (data.Errores || []).join(', ') || data.Mensaje || 'Rechazado';
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'failed', errorMessage: errorMsg } });
    }
    res.status(200).json({ status: 'processed' });
  } catch (error) { logger.error('Facturante webhook error: ' + error.message); res.status(200).json({ status: 'error' }); }
});

module.exports = router;
