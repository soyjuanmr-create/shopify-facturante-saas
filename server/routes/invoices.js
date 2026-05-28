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
    // Busqueda server-side: el termino se pasa al query de Shopify para encontrar ordenes
    // mas alla de las primeras 50 (por nro de orden, email, etc.). Se sanitiza para no
    // romper el string literal de GraphQL (se eliminan comillas, backslash, #, saltos).
    const search = (req.query.search || '').replace(/[^\w@.\-\s]/g, ' ').trim();
    var queryFilter = 'financial_status:paid';
    if (search) queryFilter += ' AND ' + search;
    const gqlQuery = '{ orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "' + queryFilter + '"' + afterClause + ') { pageInfo { hasNextPage endCursor } edges { node { id name createdAt displayFinancialStatus totalPriceSet { presentmentMoney { amount } } } } } }';
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

    let facturaData;
    let orderName;

    // Ruta 1: Si el webhook ya guardó invoiceData completa, usarla directamente
    // El REST webhook recibe TODOS los datos del cliente sin necesitar campos protegidos
    if (existing && existing.invoiceData) {
      facturaData = typeof existing.invoiceData === 'string' ? JSON.parse(existing.invoiceData) : existing.invoiceData;
      orderName = existing.shopifyOrderNumber || orderId;
      logger.info('Generate: usando invoiceData del webhook para orden ' + orderId);
    } else {
      // Ruta 2: No hay datos del webhook — consultar GraphQL
      // billingAddress omitido: todos sus sub-campos son protegidos en apps públicas
      const gqlQuery2 = 'query($id: ID!) { order(id: $id) { id name taxesIncluded totalPriceSet { presentmentMoney { amount } } customAttributes { key value } shippingLine { title originalPriceSet { presentmentMoney { amount } } taxLines { rate } } lineItems(first: 50) { edges { node { title sku quantity originalUnitPriceSet { presentmentMoney { amount } } totalDiscountSet { presentmentMoney { amount } } discountAllocations { allocatedAmountSet { presentmentMoney { amount } } } taxLines { rate } } } } } }';
      const orderData = await shopifyGraphql(shop.shopDomain, accessToken2, gqlQuery2, { id: 'gid://shopify/Order/' + orderId });
      const gqlOrder = orderData.data ? orderData.data.order : null;
      if (!gqlOrder) return res.status(404).json({ error: 'Orden no encontrada' });
      orderName = gqlOrder.name;
      const orderForMapper = {
        id: orderId, name: gqlOrder.name, order_number: gqlOrder.name,
        total_price: gqlOrder.totalPriceSet.presentmentMoney.amount, taxes_included: gqlOrder.taxesIncluded,
        billing_address: {},
        note_attributes: (gqlOrder.customAttributes || []).map(function (a) { return { name: a.key, value: a.value }; }),
        line_items: gqlOrder.lineItems.edges.map(function (e) { var n = e.node; return { name: n.title, title: n.title, sku: n.sku, quantity: n.quantity, price: (n.originalUnitPriceSet && n.originalUnitPriceSet.presentmentMoney) ? n.originalUnitPriceSet.presentmentMoney.amount : "0", total_discount: (n.totalDiscountSet && n.totalDiscountSet.presentmentMoney) ? n.totalDiscountSet.presentmentMoney.amount : "0", discount_allocations: (n.discountAllocations || []).map(function (d) { return { amount: d.allocatedAmountSet.presentmentMoney.amount }; }), tax_lines: n.taxLines }; }),
        shipping_lines: gqlOrder.shippingLine ? [{ title: gqlOrder.shippingLine.title, price: gqlOrder.shippingLine.originalPriceSet.presentmentMoney.amount, tax_lines: gqlOrder.shippingLine.taxLines }] : [],
      };
      logger.info('LineItems prices: ' + JSON.stringify(orderForMapper.line_items.map(function (i) { return { title: i.name, price: i.price, discounted: i.discounted_unit_price }; })));
      facturaData = FacturanteMapper.mapShopifyToFacturante(orderForMapper);
    }

    logger.info('FacturaData: cliente=' + facturaData.cliente.nombre + ' items=' + facturaData.items.length);
    const facturante = new FacturanteService({ empresa: shop.empresa, usuario: shop.usuario, hash: shop.hash, puntoVenta: shop.puntoVenta });
    const webhookUrl = process.env.SHOPIFY_APP_URL ? process.env.SHOPIFY_APP_URL.replace(/\/$/, '') + '/webhooks/facturante' : null;
    let resultado2;
    try { resultado2 = await facturante.crearComprobante(facturaData, webhookUrl); }
    catch (fe) {
      await prisma.invoice.upsert({ where: { shopifyOrderId: orderId.toString() }, update: { status: 'failed', errorMessage: fe.message }, create: { shopId: shop.id, shopifyOrderId: orderId.toString(), shopifyOrderNumber: orderName, customerName: facturaData.cliente.nombre, customerEmail: facturaData.cliente.email, totalAmount: parseFloat(facturaData.importe_total), status: 'failed', errorMessage: fe.message, invoiceData: facturaData } });
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
      update: { status: invoiceStatus, facturanteInvoiceId: resultado2.idComprobante ? resultado2.idComprobante.toString() : null, cae: invoiceCae, facturanteInvoiceNumber: invoiceNumero, processedAt: invoiceStatus === 'completed' ? new Date() : null, invoiceData: facturaData },
      create: { shopId: shop.id, shopifyOrderId: orderId.toString(), shopifyOrderNumber: orderName, customerName: facturaData.cliente.nombre, customerEmail: facturaData.cliente.email, totalAmount: parseFloat(facturaData.importe_total), status: invoiceStatus, facturanteInvoiceId: resultado2.idComprobante ? resultado2.idComprobante.toString() : null, cae: invoiceCae, facturanteInvoiceNumber: invoiceNumero, processedAt: invoiceStatus === 'completed' ? new Date() : null, invoiceData: facturaData },
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

// Genera la Nota de Credito (anulacion total) de una factura ya autorizada.
// Usa CrearAnulacionFull de Facturante, que asocia la NC al comprobante original por su Id.
router.post('/credit-note', async (req, res) => {
  try {
    const orderId = req.body.orderId;
    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop || shop.status !== 'active') return res.status(403).json({ error: 'Tienda no activa' });
    if (!shop.empresa || !shop.hash) return res.status(400).json({ error: 'Configura tus credenciales de Facturante primero.' });

    const invoice = await prisma.invoice.findUnique({ where: { shopifyOrderId: orderId.toString() } });
    if (!invoice) return res.status(404).json({ error: 'No existe una factura registrada para esta orden.' });
    if (invoice.status === 'cancelled') return res.json({ success: true, message: 'Esta factura ya tiene una nota de credito emitida.' });
    if (invoice.status !== 'completed') return res.status(400).json({ error: 'Solo se puede anular una factura autorizada (con CAE). Estado actual: ' + invoice.status });
    if (!invoice.facturanteInvoiceId) return res.status(400).json({ error: 'La factura no tiene ID de Facturante; no se puede anular automaticamente.' });

    const facturante = new FacturanteService({ empresa: shop.empresa, usuario: shop.usuario, hash: shop.hash, puntoVenta: shop.puntoVenta });
    let result;
    try {
      result = await facturante.anularComprobante(invoice.facturanteInvoiceId, 'Nota de credito orden ' + invoice.shopifyOrderNumber);
    } catch (fe) {
      logger.error('Credit-note error para orderId=' + orderId + ': ' + fe.message);
      return res.status(500).json({ error: fe.message });
    }

    const prevData = invoice.invoiceData
      ? (typeof invoice.invoiceData === 'string' ? JSON.parse(invoice.invoiceData) : invoice.invoiceData)
      : {};
    prevData.creditNote = { cae: result.cae || null, numero: result.numero || null, idComprobante: result.idComprobante || null, fecha: new Date().toISOString(), mensaje: result.mensaje || null };
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'cancelled', invoiceData: prevData } });

    const accessToken = await getValidAccessToken(shop.shopDomain, shop);
    if (accessToken) {
      await setInvoiceMetafields({ shop: shop.shopDomain, accessToken }, orderId, {
        status: 'cancelled',
        cae: result.cae || undefined,
        invoiceNumber: result.numero || undefined,
      });
    }

    const msg = result.cae
      ? 'Nota de credito emitida. CAE: ' + result.cae
      : 'Nota de credito generada' + (result.mensaje ? ' (' + result.mensaje + ')' : '') + '.';
    res.json({ success: true, message: msg });
  } catch (error) {
    logger.error('Credit-note error inesperado: ' + error.message);
    if (error.authRequired) return res.status(403).json({ error: 'Token de acceso expirado. Reabri la app desde el admin de Shopify.', authRequired: true });
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
