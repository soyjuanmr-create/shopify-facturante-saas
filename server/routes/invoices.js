const express = require('express');
const router = express.Router();
const prisma = require('../models/prisma');
const axios = require('axios');
const FacturanteMapper = require('../utils/facturanteMapper');
const FacturanteService = require('../services/facturante');
const logger = require('../utils/logger');
const { setInvoiceMetafields } = require('../utils/shopifyMetafields');
const { getValidAccessToken } = require('../utils/tokenUtils');

async function shopifyGraphql(shopDomain, accessToken, query, variables) {
  const url = 'https://' + shopDomain + '/admin/api/2025-04/graphql.json';
  const body = variables ? { query, variables } : { query };
  try {
    const resp = await axios.post(url, body, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (resp.data.errors) throw new Error(resp.data.errors.map(function (e) { return e.message; }).join(', '));
    return resp.data;
  } catch (err) {
    if (err.response) {
      const detail = JSON.stringify(err.response.data);
      const e = new Error('Shopify ' + err.response.status + ' for ' + shopDomain + ' tok=' + (accessToken || '').substring(0, 12) + ': ' + detail);
      if (err.response.status === 401) e.authRequired = true;
      throw e;
    }
    throw err;
  }
}

router.get('/orders', async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop || shop.status !== 'active') return res.status(403).json({ error: 'Tienda no activa', authRequired: true });

    const accessToken = await getValidAccessToken(req.shopDomain, shop);

    if (!accessToken) {
      return res.status(403).json({
        error: 'Token de acceso no disponible. Se requiere autorizacion (OAuth).',
        authRequired: true
      });
    }

    const cursor = req.query.cursor || null;
    const afterClause = cursor ? ', after: "' + cursor + '"' : '';
    const gqlQuery = '{ orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "financial_status:paid"' + afterClause + ') { pageInfo { hasNextPage endCursor } edges { node { id name createdAt displayFinancialStatus totalPriceSet { presentmentMoney { amount } } } } } }';
    const data = await shopifyGraphql(req.shopDomain, accessToken, gqlQuery);
    const graphqlOrders = data.data.orders.edges.map(function (e) { return e.node; });
    const orderIds = graphqlOrders.map(function (o) { return o.id.split('/').pop(); });
    const localInvoices = await prisma.invoice.findMany({ where: { shopifyOrderId: { in: orderIds } }, select: { shopifyOrderId: true, status: true, cae: true, errorMessage: true, customerName: true } });
    const orders = graphqlOrders.map(function (order) {
      var shortId = order.id.split('/').pop();
      var inv = localInvoices.find(function (i) { return i.shopifyOrderId === shortId; });
      return { id: shortId, order_number: order.name, total: order.totalPriceSet.presentmentMoney.amount, created_at: order.createdAt, customer: (inv && inv.customerName) ? { first_name: inv.customerName, last_name: '' } : null, facturacion_status: inv ? inv.status : 'pending', cae: inv ? inv.cae : null, error_message: inv ? inv.errorMessage : null };
    });
    res.json({ orders: orders, pageInfo: data.data.orders.pageInfo });
  } catch (error) {
    logger.error('Error loading orders: ' + error.message);
    if (error.authRequired || error.message.includes('401')) {
      return res.status(403).json({ error: 'Token de acceso expirado. Re-autorizando...', authRequired: true });
    }
    res.status(500).json({ error: error.message });
  }
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
    const accessToken2 = await getValidAccessToken(shop.shopDomain, shop);
    if (!accessToken2) {
      return res.status(403).json({
        error: 'Token de acceso no disponible. Se requiere autorizacion (OAuth).',
        authRequired: true
      });
    }
    const session = { shop: shop.shopDomain, accessToken: accessToken2 };
    const gqlQuery2 = 'query($id: ID!) { order(id: $id) { id name taxesIncluded totalPriceSet { presentmentMoney { amount } } billingAddress { firstName lastName address1 address2 city province zip company } customAttributes { key value } shippingLine { title originalPriceSet { presentmentMoney { amount } } taxLines { rate } } lineItems(first: 50) { edges { node { title sku quantity originalUnitPriceSet { presentmentMoney { amount } } totalDiscountSet { presentmentMoney { amount } } discountAllocations { allocatedAmountSet { presentmentMoney { amount } } } taxLines { rate } } } } } }';
    let orderData;
    orderData = await shopifyGraphql(shop.shopDomain, accessToken2, gqlQuery2, { id: 'gid://shopify/Order/' + orderId });
    const gqlOrder = orderData.data ? orderData.data.order : null;
    if (!gqlOrder) return res.status(404).json({ error: 'Orden no encontrada' });
    const ba = gqlOrder.billingAddress || {};
    const orderForMapper = {
      id: orderId, name: gqlOrder.name, order_number: gqlOrder.name,
      total_price: gqlOrder.totalPriceSet.presentmentMoney.amount, taxes_included: gqlOrder.taxesIncluded,
      billing_address: { first_name: ba.firstName || '', last_name: ba.lastName || '', address1: ba.address1, city: ba.city, province: ba.province, zip: ba.zip, company: ba.company },
      note_attributes: (gqlOrder.customAttributes || []).map(function (a) { return { name: a.key, value: a.value }; }),
      line_items: gqlOrder.lineItems.edges.map(function (e) { var n = e.node; return { name: n.title, title: n.title, sku: n.sku, quantity: n.quantity, price: (n.originalUnitPriceSet && n.originalUnitPriceSet.presentmentMoney) ? n.originalUnitPriceSet.presentmentMoney.amount : "0", total_discount: (n.totalDiscountSet && n.totalDiscountSet.presentmentMoney) ? n.totalDiscountSet.presentmentMoney.amount : "0", discount_allocations: (n.discountAllocations || []).map(function (d) { return { amount: d.allocatedAmountSet.presentmentMoney.amount }; }), tax_lines: n.taxLines }; }),
      shipping_lines: gqlOrder.shippingLine ? [{ title: gqlOrder.shippingLine.title, price: gqlOrder.shippingLine.originalPriceSet.presentmentMoney.amount, tax_lines: gqlOrder.shippingLine.taxLines }] : [],
    };
    // Fallback: si GraphQL no devolvió nombre (campo protegido aún no aprobado), usar datos del webhook guardados
    if (!orderForMapper.billing_address.first_name && !orderForMapper.billing_address.last_name) {
      const existingInv = await prisma.invoice.findUnique({ where: { shopifyOrderId: orderId.toString() } });
      if (existingInv && existingInv.invoiceData) {
        const savedData = typeof existingInv.invoiceData === 'string' ? JSON.parse(existingInv.invoiceData) : existingInv.invoiceData;
        if (savedData.cliente && savedData.cliente.nombre && savedData.cliente.nombre !== 'Consumidor Final') {
          logger.info('Generate: usando nombre del webhook: ' + savedData.cliente.nombre);
          var parts = savedData.cliente.nombre.split(' ');
          orderForMapper.billing_address.first_name = parts[0] || '';
          orderForMapper.billing_address.last_name = parts.slice(1).join(' ') || '';
        }
        if (!orderForMapper.email && savedData.cliente && savedData.cliente.email) {
          orderForMapper.email = savedData.cliente.email;
        }
      }
    }

    logger.info('LineItems prices: ' + JSON.stringify(orderForMapper.line_items.map(function (i) { return { title: i.name, price: i.price, discounted: i.discounted_unit_price }; })));
    const facturaData = FacturanteMapper.mapShopifyToFacturante(orderForMapper);
    logger.info('FacturaData items: ' + JSON.stringify(facturaData.items.map(function (i) { return { desc: i.descripcion, pu: i.precio_unitario, bon: i.bonificacion, qty: i.cantidad }; })));
    const facturante = new FacturanteService({ empresa: shop.empresa, usuario: shop.usuario, hash: shop.hash, puntoVenta: shop.puntoVenta });
    const webhookUrl = process.env.SHOPIFY_APP_URL ? process.env.SHOPIFY_APP_URL.replace(/\/$/, '') + '/webhooks/facturante' : null;
    let resultado2;
    try { resultado2 = await facturante.crearComprobante(facturaData, webhookUrl); }
    catch (fe) {
      await prisma.invoice.upsert({ where: { shopifyOrderId: orderId.toString() }, update: { status: 'failed', errorMessage: fe.message }, create: { shopId: shop.id, shopifyOrderId: orderId.toString(), shopifyOrderNumber: gqlOrder.name, customerName: facturaData.cliente.nombre, customerEmail: facturaData.cliente.email, totalAmount: parseFloat(facturaData.importe_total), status: 'failed', errorMessage: fe.message, invoiceData: facturaData } });
      logger.error('Generate invoice error: ' + fe.message);
      return res.status(500).json({ error: fe.message });
    }
    var invoiceStatus = 'processing';
    var invoiceCae = null;
    var invoiceNumero = null;
    if (resultado2.autorizado && resultado2.cae) {
      invoiceStatus = 'completed';
      invoiceCae = resultado2.cae.toString();
      invoiceNumero = resultado2.numero ? resultado2.numero.toString() : null;
    }
    await prisma.invoice.upsert({
      where: { shopifyOrderId: orderId.toString() },
      update: { status: invoiceStatus, facturanteInvoiceId: resultado2.idComprobante ? resultado2.idComprobante.toString() : null, cae: invoiceCae, facturanteInvoiceNumber: invoiceNumero, processedAt: invoiceStatus === 'completed' ? new Date() : null },
      create: { shopId: shop.id, shopifyOrderId: orderId.toString(), shopifyOrderNumber: gqlOrder.name, customerName: facturaData.cliente.nombre, customerEmail: facturaData.cliente.email, totalAmount: parseFloat(facturaData.importe_total), status: invoiceStatus, facturanteInvoiceId: resultado2.idComprobante ? resultado2.idComprobante.toString() : null, cae: invoiceCae, facturanteInvoiceNumber: invoiceNumero, processedAt: invoiceStatus === 'completed' ? new Date() : null, invoiceData: facturaData },
    });
    await setInvoiceMetafields(session, orderId, invoiceStatus === 'completed'
      ? { status: 'completed', cae: invoiceCae, invoiceNumber: invoiceNumero }
      : { status: 'processing' });
    var msg2 = invoiceStatus === 'completed'
      ? 'Factura emitida. CAE: ' + invoiceCae
      : 'Comprobante enviado a Facturante (ID: ' + resultado2.idComprobante + '). Esperando autorizacion...';
    res.json({ success: true, message: msg2, status: invoiceStatus });
  } catch (error) {
    logger.error('Generate invoice error: ' + error.message);
    if (error.authRequired) {
      return res.status(403).json({ error: 'Token de acceso expirado. Reabrí la app desde el admin de Shopify.', authRequired: true });
    }
    res.status(500).json({ error: error.message });
  }
});

// Endpoint de polling manual: consulta el estado real a Facturante y actualiza la BD
// Util cuando el webhook de Facturante no llego y la orden quedo en "procesando"
router.post('/sync-status/:orderId', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop || shop.status !== 'active') return res.status(403).json({ error: 'Tienda no activa' });
    if (!shop.empresa || !shop.hash) return res.status(400).json({ error: 'Credenciales de Facturante no configuradas.' });

    const invoice = await prisma.invoice.findUnique({ where: { shopifyOrderId: orderId.toString() } });
    if (!invoice) {
      // No hay registro local — la orden aun no fue enviada a Facturante
      return res.status(404).json({ error: 'No existe un comprobante registrado para esta orden. Usa "Facturar" primero.' });
    }
    if (invoice.status === 'completed') {
      return res.json({ status: 'completed', cae: invoice.cae, message: 'Factura ya autorizada. CAE: ' + invoice.cae });
    }
    if (!invoice.facturanteInvoiceId) {
      // Comprobante pendiente sin ID de Facturante — estado 'processing' pero sin ID para consultar
      logger.warn('sync-status: orderId=' + orderId + ' status=' + invoice.status + ' pero facturanteInvoiceId es null');
      return res.status(400).json({
        error: 'El comprobante fue enviado pero Facturante no retorno un ID. Puede que aun este procesando. Intenta nuevamente en unos minutos o revisa el panel de Facturante.',
        status: invoice.status,
        localStatus: invoice.status,
      });
    }

    logger.info('sync-status: consultando Facturante para orderId=' + orderId + ' idComprobante=' + invoice.facturanteInvoiceId);
    const facturante = new FacturanteService({ empresa: shop.empresa, usuario: shop.usuario, hash: shop.hash, puntoVenta: shop.puntoVenta });

    let result;
    try {
      result = await facturante.consultarComprobante(invoice.facturanteInvoiceId);
    } catch (facErr) {
      logger.error('sync-status: consultarComprobante fallo para idComprobante=' + invoice.facturanteInvoiceId + ': ' + facErr.message);
      return res.status(502).json({
        error: 'Error al consultar Facturante: ' + facErr.message,
        tip: 'Verifica que el comprobante exista en tu panel de Facturante (ID: ' + invoice.facturanteInvoiceId + ')',
      });
    }

    logger.info('sync-status orderId=' + orderId + ' estado=' + result.estado + ' cae=' + result.cae + ' raw=' + (result.raw || '').substring(0, 300));

    const sessionRecord = await prisma.session.findFirst({
      where: { shop: req.shopDomain, isOnline: false },
      orderBy: { expires: 'desc' },
    });
    const accessToken = (sessionRecord && sessionRecord.accessToken) ? sessionRecord.accessToken : shop.accessToken;
    const session = { shop: req.shopDomain, accessToken };

    // Facturante puede retornar 'autorizado' (con CAE) o simplemente 'ok' (también autorizado)
    const estadoOk = result.estado === 'autorizado' || result.estado === 'ok';

    if (estadoOk) {
      // Usar el CAE de la respuesta, o el que ya teníamos en la BD como fallback
      const caeStr = result.cae ? result.cae.toString() : (invoice.cae || null);
      const numStr = result.numero ? result.numero.toString() : (invoice.facturanteInvoiceNumber || null);

      logger.info('sync-status: marcando completed para orderId=' + orderId + ' estado=' + result.estado + ' cae=' + caeStr);

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'completed', cae: caeStr, facturanteInvoiceNumber: numStr, processedAt: new Date() },
      });
      await setInvoiceMetafields(session, orderId, { status: 'completed', cae: caeStr, invoiceNumber: numStr });
      return res.json({ status: 'completed', cae: caeStr, invoiceNumber: numStr, message: 'Factura autorizada. CAE: ' + caeStr });
    } else if (result.estado && result.estado !== 'procesando' && result.estado !== 'processing') {
      // Estado desconocido y distinto de «procesando» => fallo
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'failed', errorMessage: result.mensaje || result.estado } });
      await setInvoiceMetafields(session, orderId, { status: 'failed', error: result.mensaje || result.estado });
      return res.json({ status: 'failed', message: result.mensaje || result.estado, raw: result.raw });
    }

    // Estado es 'procesando' / 'processing' o vacío => todavía en cola
    res.json({ status: invoice.status, message: 'Aun en procesamiento en Facturante', facturanteEstado: result.estado || '(sin estado)', raw: result.raw });
  } catch (error) {
    logger.error('sync-status error inesperado: ' + error.message + ' stack: ' + (error.stack || '').substring(0, 500));
    res.status(500).json({ error: 'Error interno: ' + error.message });
  }
});

router.get('/status/:orderId', async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { shopifyOrderId: req.params.orderId.toString() } });
    if (!invoice) return res.json({ exists: false });
    res.json({ exists: true, status: invoice.status, cae: invoice.cae, invoiceNumber: invoice.facturanteInvoiceNumber });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
