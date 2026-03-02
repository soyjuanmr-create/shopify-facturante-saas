const express = require('express');
const router = express.Router();
const prisma = require('../models/prisma');
const shopify = require('../services/shopify');
const FacturanteMapper = require('../utils/facturanteMapper');
const FacturanteService = require('../services/facturante');
const logger = require('../utils/logger');

router.get('/orders', async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop || shop.status !== 'active') return res.status(403).json({ error: 'Tienda no activa' });
    const session = { shop: shop.shopDomain, accessToken: shop.accessToken };
    const client = new shopify.clients.Graphql({ session });
    const response = await client.request('{ orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "financial_status:paid") { edges { node { id name createdAt financialStatus totalPriceSet { presentmentMoney { amount } } customer { firstName lastName email } } } } }');
    const graphqlOrders = response.data.orders.edges.map(function(e) { return e.node; });
    const orderIds = graphqlOrders.map(function(o) { return o.id.split('/').pop(); });
    const localInvoices = await prisma.invoice.findMany({ where: { shopifyOrderId: { in: orderIds } } });
    const orders = graphqlOrders.map(function(order) {
      var shortId = order.id.split('/').pop();
      var inv = localInvoices.find(function(i) { return i.shopifyOrderId === shortId; });
      return { id: shortId, order_number: order.name, total: order.totalPriceSet.presentmentMoney.amount, created_at: order.createdAt, customer: order.customer ? { first_name: order.customer.firstName, last_name: order.customer.lastName } : null, facturacion_status: inv ? inv.status : 'pending', cae: inv ? inv.cae : null };
    });
    res.json({ orders: orders });
  } catch (error) { logger.error('Error loading orders: ' + error.message); res.status(500).json({ error: 'Error cargando pedidos' }); }
});

router.get('/stats', async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop) return res.json({ total: 0, invoiced: 0, pending: 0, errors: 0 });
    const [total, invoiced, pending, errors] = await Promise.all([
      prisma.invoice.count({ where: { shopId: shop.id } }),
      prisma.invoice.count({ where: { shopId: shop.id, status: 'completed' } }),
      prisma.invoice.count({ where: { shopId: shop.id, status: 'pending' } }),
      prisma.invoice.count({ where: { shopId: shop.id, status: 'failed' } }),
    ]);
    res.json({ total: total, invoiced: invoiced, pending: pending, errors: errors });
  } catch (error) { res.json({ total: 0, invoiced: 0, pending: 0, errors: 0 }); }
});

router.post('/generate', async (req, res) => {
  try {
    const orderId = req.body.orderId;
    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop || shop.status !== 'active') return res.status(403).json({ error: 'Tienda no activa' });
    if (!shop.empresa || !shop.hash) return res.status(400).json({ error: 'Configura tus credenciales de Facturante primero.' });
    const existing = await prisma.invoice.findUnique({ where: { shopifyOrderId: orderId.toString() } });
    if (existing && existing.status === 'completed') return res.json({ success: true, message: 'Factura ya emitida. CAE: ' + existing.cae });
    const session = { shop: shop.shopDomain, accessToken: shop.accessToken };
    const client = new shopify.clients.Graphql({ session });
    const response = await client.request('query($id: ID!) { order(id: $id) { id name email taxesIncluded totalPriceSet { presentmentMoney { amount } } billingAddress { firstName lastName address1 address2 city province zip company } noteAttributes { name value } lineItems(first: 50) { edges { node { title sku quantity originalUnitPriceSet { presentmentMoney { amount } } totalDiscountSet { presentmentMoney { amount } } taxLines { rate } } } } } }', { variables: { id: 'gid://shopify/Order/' + orderId } });
    const gqlOrder = response.data ? response.data.order : null;
    if (!gqlOrder) return res.status(404).json({ error: 'Orden no encontrada' });
    const ba = gqlOrder.billingAddress || {};
    const orderForMapper = {
      id: orderId, name: gqlOrder.name, order_number: gqlOrder.name, email: gqlOrder.email,
      total_price: gqlOrder.totalPriceSet.presentmentMoney.amount, taxes_included: gqlOrder.taxesIncluded,
      billing_address: { first_name: ba.firstName, last_name: ba.lastName, address1: ba.address1, city: ba.city, province: ba.province, zip: ba.zip, company: ba.company },
      note_attributes: gqlOrder.noteAttributes,
      line_items: gqlOrder.lineItems.edges.map(function(e) { var n = e.node; return { name: n.title, title: n.title, sku: n.sku, quantity: n.quantity, price: n.originalUnitPriceSet.presentmentMoney.amount, total_discount: n.totalDiscountSet.presentmentMoney.amount, tax_lines: n.taxLines }; }),
    };
    const facturaData = FacturanteMapper.mapShopifyToFacturante(orderForMapper);
    const facturante = new FacturanteService({ empresa: shop.empresa, usuario: shop.usuario, hash: shop.hash, puntoVenta: shop.puntoVenta });
    const webhookUrl = process.env.SHOPIFY_APP_URL ? process.env.SHOPIFY_APP_URL.replace(/\/$/, '') + '/webhooks/facturante' : null;
    const resultado = await facturante.crearComprobante(facturaData, webhookUrl);
    await prisma.invoice.upsert({
      where: { shopifyOrderId: orderId.toString() },
      update: { status: 'processing', facturanteInvoiceId: resultado.idComprobante ? resultado.idComprobante.toString() : null },
      create: { shopId: shop.id, shopifyOrderId: orderId.toString(), shopifyOrderNumber: gqlOrder.name, customerName: facturaData.cliente.nombre, customerEmail: facturaData.cliente.email, totalAmount: parseFloat(facturaData.importe_total), status: 'processing', facturanteInvoiceId: resultado.idComprobante ? resultado.idComprobante.toString() : null, invoiceData: facturaData },
    });
    res.json({ success: true, message: 'Comprobante enviado a AFIP (ID: ' + resultado.idComprobante + ')' });
  } catch (error) { logger.error('Generate invoice error: ' + error.message); res.status(500).json({ error: error.message }); }
});

router.get('/status/:orderId', async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { shopifyOrderId: req.params.orderId.toString() } });
    if (!invoice) return res.json({ exists: false });
    res.json({ exists: true, status: invoice.status, cae: invoice.cae, invoiceNumber: invoice.facturanteInvoiceNumber });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
