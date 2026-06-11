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

// Flag de proceso: si la app no tiene aprobado el acceso a datos protegidos del cliente,
// se desactiva tras el primer rechazo para no reintentar con esos campos en cada request.
var customerFieldsAllowed = true;

function buildOrdersQuery(queryFilter, afterClause, withCustomer) {
  var customerFields = withCustomer ? ' customer { firstName lastName displayName }' : '';
  return '{ orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "' + queryFilter + '"' + afterClause + ') { pageInfo { hasNextPage endCursor } edges { node { id name createdAt displayFinancialStatus totalPriceSet { presentmentMoney { amount } }' + customerFields + ' } } } }';
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
    // Se incluye customer (protected customer data, declarado en shopify.app.toml) para
    // mostrar el nombre tambien en ordenes aun no facturadas. Si la app todavia no tiene
    // aprobado el acceso, se reintenta sin esos campos y se cae al nombre de la factura local.
    var data;
    if (customerFieldsAllowed) {
      try {
        data = await shopifyGraphql(req.shopDomain, accessToken, buildOrdersQuery(queryFilter, afterClause, true));
      } catch (e) {
        if (!e.authRequired && /not approved|protected|access the Customer|ACCESS_DENIED/i.test(e.message)) {
          logger.warn('Campos de customer no disponibles (protected data); usando fallback al nombre de la factura. ' + e.message);
          customerFieldsAllowed = false;
        } else {
          throw e;
        }
      }
    }
    if (!data) data = await shopifyGraphql(req.shopDomain, accessToken, buildOrdersQuery(queryFilter, afterClause, false));
    const graphqlOrders = data.data.orders.edges.map(function (e) { return e.node; });
    const orderIds = graphqlOrders.map(function (o) { return o.id.split('/').pop(); });
    const localInvoices = await prisma.invoice.findMany({ where: { shopifyOrderId: { in: orderIds } }, select: { shopifyOrderId: true, status: true, cae: true, errorMessage: true, customerName: true } });
    const orders = graphqlOrders.map(function (order) {
      var shortId = order.id.split('/').pop();
      var inv = localInvoices.find(function (i) { return i.shopifyOrderId === shortId; });
      var sc = order.customer;
      var shopifyName = sc ? (sc.displayName || ((sc.firstName || '') + ' ' + (sc.lastName || '')).trim()) : '';
      var customerName = shopifyName || (inv && inv.customerName) || '';
      return { id: shortId, order_number: order.name, total: order.totalPriceSet.presentmentMoney.amount, created_at: order.createdAt, customer: customerName ? { first_name: customerName, last_name: '' } : null, facturacion_status: inv ? inv.status : 'pending', cae: inv ? inv.cae : null, error_message: inv ? inv.errorMessage : null };
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
    // Override manual del tipo de comprobante (A/B); si no viene, se autodetecta por CUIT
    const tipoOverride = ['FA', 'FB'].indexOf((req.body.tipoComprobante || '').toUpperCase()) > -1
      ? req.body.tipoComprobante.toUpperCase() : null;
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
      // Ruta 2: No hay datos del webhook — consultar GraphQL.
      // Se piden los campos protegidos declarados en shopify.app.toml (name + email).
      // Si la app aun no tiene aprobado el acceso, se reintenta sin ellos (fallback a
      // 'Consumidor Final'); la orden igual se factura, pero sin razon social.
      function buildOrderQuery(withCustomer) {
        var customerBlock = withCustomer
          ? ' email billingAddress { firstName lastName company address1 address2 city province zip } shippingAddress { firstName lastName company address1 address2 city province zip } customer { firstName lastName email }'
          : '';
        return 'query($id: ID!) { order(id: $id) { id name taxesIncluded totalPriceSet { presentmentMoney { amount } }' + customerBlock + ' customAttributes { key value } shippingLine { title originalPriceSet { presentmentMoney { amount } } taxLines { rate } } lineItems(first: 50) { edges { node { title sku quantity originalUnitPriceSet { presentmentMoney { amount } } totalDiscountSet { presentmentMoney { amount } } discountAllocations { allocatedAmountSet { presentmentMoney { amount } } } taxLines { rate } } } } } }';
      }
      var orderData;
      if (customerFieldsAllowed) {
        try {
          orderData = await shopifyGraphql(shop.shopDomain, accessToken2, buildOrderQuery(true), { id: 'gid://shopify/Order/' + orderId });
        } catch (e) {
          if (!e.authRequired && /not approved|protected|access the Customer|ACCESS_DENIED/i.test(e.message)) {
            logger.warn('Generate: campos de customer no aprobados, facturando sin razon social. ' + e.message);
            customerFieldsAllowed = false;
          } else { throw e; }
        }
      }
      if (!orderData) orderData = await shopifyGraphql(shop.shopDomain, accessToken2, buildOrderQuery(false), { id: 'gid://shopify/Order/' + orderId });
      const gqlOrder = orderData.data ? orderData.data.order : null;
      if (!gqlOrder) return res.status(404).json({ error: 'Orden no encontrada' });
      orderName = gqlOrder.name;
      // Construir billing_address a partir de lo que Shopify devolvio. Si los sub-campos
      // de address no estan en el scope aprobado, vienen null y el mapper cae a default.
      var ba = gqlOrder.billingAddress || gqlOrder.shippingAddress || {};
      var cust = gqlOrder.customer || {};
      var billingForMapper = {
        first_name: ba.firstName || cust.firstName || '',
        last_name: ba.lastName || cust.lastName || '',
        company: ba.company || '',
        address1: ba.address1 || '',
        address2: ba.address2 || '',
        city: ba.city || '',
        province: ba.province || '',
        zip: ba.zip || '',
      };
      const orderForMapper = {
        id: orderId, name: gqlOrder.name, order_number: gqlOrder.name,
        total_price: gqlOrder.totalPriceSet.presentmentMoney.amount, taxes_included: gqlOrder.taxesIncluded,
        billing_address: billingForMapper,
        email: gqlOrder.email || cust.email || '',
        note_attributes: (gqlOrder.customAttributes || []).map(function (a) { return { name: a.key, value: a.value }; }),
        line_items: gqlOrder.lineItems.edges.map(function (e) { var n = e.node; return { name: n.title, title: n.title, sku: n.sku, quantity: n.quantity, price: (n.originalUnitPriceSet && n.originalUnitPriceSet.presentmentMoney) ? n.originalUnitPriceSet.presentmentMoney.amount : "0", total_discount: (n.totalDiscountSet && n.totalDiscountSet.presentmentMoney) ? n.totalDiscountSet.presentmentMoney.amount : "0", discount_allocations: (n.discountAllocations || []).map(function (d) { return { amount: d.allocatedAmountSet.presentmentMoney.amount }; }), tax_lines: n.taxLines }; }),
        shipping_lines: gqlOrder.shippingLine ? [{ title: gqlOrder.shippingLine.title, price: gqlOrder.shippingLine.originalPriceSet.presentmentMoney.amount, tax_lines: gqlOrder.shippingLine.taxLines }] : [],
      };
      logger.info('LineItems prices: ' + JSON.stringify(orderForMapper.line_items.map(function (i) { return { title: i.name, price: i.price, discounted: i.discounted_unit_price }; })));
      facturaData = FacturanteMapper.mapShopifyToFacturante(orderForMapper);
    }

    if (tipoOverride) {
      facturaData.tipo_comprobante = tipoOverride;
      logger.info('Generate: tipo de comprobante forzado a ' + tipoOverride + ' por el merchant');
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
    // Mismo criterio de normalización que crearComprobante: cualquier tipo con 'A' → FA
    var tipoFinal = (facturaData.tipo_comprobante || 'FB').toUpperCase().indexOf('A') > -1 ? 'FA' : 'FB';
    await prisma.invoice.upsert({
      where: { shopifyOrderId: orderId.toString() },
      update: { status: invoiceStatus, facturanteInvoiceId: resultado2.idComprobante ? resultado2.idComprobante.toString() : null, cae: invoiceCae, facturanteInvoiceNumber: invoiceNumero, tipoComprobante: tipoFinal, processedAt: invoiceStatus === 'completed' ? new Date() : null, invoiceData: facturaData },
      create: { shopId: shop.id, shopifyOrderId: orderId.toString(), shopifyOrderNumber: orderName, customerName: facturaData.cliente.nombre, customerEmail: facturaData.cliente.email, totalAmount: parseFloat(facturaData.importe_total), status: invoiceStatus, facturanteInvoiceId: resultado2.idComprobante ? resultado2.idComprobante.toString() : null, cae: invoiceCae, facturanteInvoiceNumber: invoiceNumero, tipoComprobante: tipoFinal, processedAt: invoiceStatus === 'completed' ? new Date() : null, invoiceData: facturaData },
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

// Genera una Nota de Credito sobre una factura ya autorizada.
// - mode 'total' (default): CrearAnulacionFull anula la factura completa (Facturante asocia la NC por Id).
// - mode 'partial': CrearComprobanteFull con TipoComprobante NCA/NCB + bloque Asociados (exigido por AFIP),
//   ya sea por items seleccionados o por un monto fijo.
router.post('/credit-note', async (req, res) => {
  try {
    const orderId = req.body.orderId;
    const mode = req.body.mode === 'partial' ? 'partial' : 'total';
    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop || shop.status !== 'active') return res.status(403).json({ error: 'Tienda no activa' });
    if (!shop.empresa || !shop.hash) return res.status(400).json({ error: 'Configura tus credenciales de Facturante primero.' });

    const invoice = await prisma.invoice.findUnique({ where: { shopifyOrderId: orderId.toString() } });
    if (!invoice) return res.status(404).json({ error: 'No existe una factura registrada para esta orden.' });
    if (invoice.status === 'cancelled') return res.json({ success: true, message: 'Esta factura ya tiene una nota de credito total emitida.' });
    if (invoice.status !== 'completed') return res.status(400).json({ error: 'Solo se puede acreditar una factura autorizada (con CAE). Estado actual: ' + invoice.status });
    if (!invoice.facturanteInvoiceId) return res.status(400).json({ error: 'La factura no tiene ID de Facturante; no se puede procesar automaticamente.' });

    const prevData = invoice.invoiceData
      ? (typeof invoice.invoiceData === 'string' ? JSON.parse(invoice.invoiceData) : invoice.invoiceData)
      : {};

    const facturante = new FacturanteService({ empresa: shop.empresa, usuario: shop.usuario, hash: shop.hash, puntoVenta: shop.puntoVenta });
    let result;
    if (mode === 'total') {
      try {
        result = await facturante.anularComprobante(invoice.facturanteInvoiceId, 'Nota de credito orden ' + invoice.shopifyOrderNumber);
      } catch (fe) {
        logger.error('Credit-note (total) error para orderId=' + orderId + ': ' + fe.message);
        return res.status(500).json({ error: fe.message });
      }
    } else {
      // --- NC parcial ---
      if (!invoice.facturanteInvoiceNumber) return res.status(400).json({ error: 'La factura no tiene numero de comprobante registrado; sincroniza su estado primero ("Verificar estado").' });
      if (!prevData.items || !prevData.cliente) return res.status(400).json({ error: 'No hay datos de la factura original para armar la NC parcial. Emite la NC total desde Facturante.' });

      var ncItems = [];
      var reqItems = Array.isArray(req.body.items) ? req.body.items : [];
      var amount = parseFloat(req.body.amount);
      if (reqItems.length > 0) {
        for (var k = 0; k < reqItems.length; k++) {
          var sel = reqItems[k];
          var orig = prevData.items[sel.index];
          if (!orig) return res.status(400).json({ error: 'Item invalido en la seleccion (indice ' + sel.index + ').' });
          var cant = parseFloat(sel.cantidad);
          if (!(cant > 0) || cant > (parseFloat(orig.cantidad) || 1)) return res.status(400).json({ error: 'Cantidad invalida para "' + orig.descripcion + '" (max ' + orig.cantidad + ').' });
          ncItems.push({ codigo: orig.codigo, descripcion: orig.descripcion, cantidad: cant, precio_unitario: orig.precio_unitario, alicuota_iva: orig.alicuota_iva, bonificacion: orig.bonificacion });
        }
      } else if (amount > 0) {
        // NC por monto: una sola linea. El monto ingresado es final (IVA incluido); se usa la
        // alicuota del primer item de la factura original para descontar el IVA.
        var alic = parseFloat(prevData.items[0].alicuota_iva);
        if (isNaN(alic)) alic = 21;
        var neto = alic > 0 ? amount / (1 + alic / 100) : amount;
        ncItems.push({ codigo: 'NC-PARCIAL', descripcion: (req.body.amountDescription || 'Devolucion parcial orden ' + invoice.shopifyOrderNumber).substring(0, 250), cantidad: 1, precio_unitario: neto.toFixed(3), alicuota_iva: alic, bonificacion: '0.000' });
      } else {
        return res.status(400).json({ error: 'Indica los items a acreditar o un monto valido.' });
      }

      var tipoOriginal = invoice.tipoComprobante || ((prevData.tipo_comprobante || 'FB').toUpperCase().indexOf('A') > -1 ? 'FA' : 'FB');
      // Numero AFIP del comprobante asociado: ultimo grupo numerico (puede venir "0003-00012345")
      var numMatch = String(invoice.facturanteInvoiceNumber).match(/(\d+)\s*$/);
      if (!numMatch) return res.status(400).json({ error: 'Numero de comprobante original invalido: ' + invoice.facturanteInvoiceNumber });
      var asociado = {
        fecha: invoice.processedAt || invoice.createdAt,
        numero: parseInt(numMatch[1], 10),
        puntoVenta: parseInt(shop.puntoVenta || '1', 10),
        tipo: tipoOriginal,
      };
      var ncData = {
        tipo_comprobante: tipoOriginal === 'FA' ? 'NCA' : 'NCB',
        cliente: prevData.cliente,
        items: ncItems,
        observaciones: 'Nota de credito parcial sobre orden ' + invoice.shopifyOrderNumber,
      };
      try {
        result = await facturante.crearNotaCredito(ncData, asociado);
      } catch (fe) {
        logger.error('Credit-note (parcial) error para orderId=' + orderId + ': ' + fe.message);
        return res.status(500).json({ error: fe.message });
      }
    }

    var ncRecord = { tipo: mode, cae: result.cae || null, numero: result.numero || null, idComprobante: result.idComprobante || null, fecha: new Date().toISOString(), mensaje: result.mensaje || null };
    if (!Array.isArray(prevData.creditNotes)) prevData.creditNotes = [];
    prevData.creditNotes.push(ncRecord);
    if (mode === 'total') prevData.creditNote = ncRecord; // compat con registros anteriores
    await prisma.invoice.update({
      where: { id: invoice.id },
      // La NC parcial no anula la factura: el estado sigue 'completed'
      data: { status: mode === 'total' ? 'cancelled' : 'completed', invoiceData: prevData },
    });

    if (mode === 'total') {
      const accessToken = await getValidAccessToken(shop.shopDomain, shop);
      if (accessToken) {
        await setInvoiceMetafields({ shop: shop.shopDomain, accessToken }, orderId, {
          status: 'cancelled',
          cae: result.cae || undefined,
          invoiceNumber: result.numero || undefined,
        });
      }
    }

    const msg = result.cae
      ? 'Nota de credito ' + (mode === 'partial' ? 'parcial ' : '') + 'emitida. CAE: ' + result.cae
      : 'Nota de credito ' + (mode === 'partial' ? 'parcial ' : '') + 'generada' + (result.mensaje ? ' (' + result.mensaje + ')' : '') + '.';
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
        data: { status: 'completed', cae: caeStr, facturanteInvoiceNumber: numStr, pdfUrl: result.pdfUrl || invoice.pdfUrl, processedAt: new Date() },
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

// Devuelve la URL del PDF legal (con QR de AFIP) generado por Facturante.
// Se cachea en la BD; si no esta, se consulta DetalleComprobante y se guarda.
// ?doc=credit_note devuelve el PDF de la NC (total o ultima emitida) en lugar de la factura.
router.get('/pdf/:orderId', async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop || shop.status !== 'active') return res.status(403).json({ error: 'Tienda no activa' });
    if (!shop.empresa || !shop.hash) return res.status(400).json({ error: 'Credenciales de Facturante no configuradas.' });
    const invoice = await prisma.invoice.findUnique({ where: { shopifyOrderId: req.params.orderId.toString() } });
    if (!invoice) return res.status(404).json({ error: 'No existe un comprobante para esta orden.' });

    const data = invoice.invoiceData ? (typeof invoice.invoiceData === 'string' ? JSON.parse(invoice.invoiceData) : invoice.invoiceData) : {};
    const wantsNc = req.query.doc === 'credit_note';

    var idComprobante;
    if (wantsNc) {
      var ncs = Array.isArray(data.creditNotes) ? data.creditNotes : (data.creditNote ? [data.creditNote] : []);
      var lastNc = ncs.length ? ncs[ncs.length - 1] : null;
      if (!lastNc || !lastNc.idComprobante) return res.status(404).json({ error: 'No hay nota de credito con ID de Facturante para esta orden.' });
      if (lastNc.pdfUrl) return res.json({ url: lastNc.pdfUrl });
      idComprobante = lastNc.idComprobante;
    } else {
      if (invoice.pdfUrl) return res.json({ url: invoice.pdfUrl });
      if (!invoice.facturanteInvoiceId) return res.status(400).json({ error: 'La factura no tiene ID de Facturante.' });
      idComprobante = invoice.facturanteInvoiceId;
    }

    const facturante = new FacturanteService({ empresa: shop.empresa, usuario: shop.usuario, hash: shop.hash, puntoVenta: shop.puntoVenta });
    const detalle = await facturante.consultarComprobante(idComprobante);
    if (!detalle.pdfUrl) return res.status(404).json({ error: 'Facturante todavia no genero el PDF de este comprobante. Intenta en unos minutos.' });

    if (wantsNc) {
      var ncs2 = Array.isArray(data.creditNotes) ? data.creditNotes : (data.creditNote ? [data.creditNote] : []);
      ncs2[ncs2.length - 1].pdfUrl = detalle.pdfUrl;
      data.creditNotes = ncs2;
      await prisma.invoice.update({ where: { id: invoice.id }, data: { invoiceData: data } });
    } else {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { pdfUrl: detalle.pdfUrl } });
    }
    res.json({ url: detalle.pdfUrl });
  } catch (error) {
    logger.error('pdf endpoint error: ' + error.message);
    res.status(500).json({ error: error.message });
  }
});

// Reenvia el comprobante por email via Facturante (operacion ReenviarComprobante).
// Sin "emails": reenvia al mail de facturacion del cliente. Con "emails" (coma-separado):
// solo a esas direcciones.
router.post('/resend-email', async (req, res) => {
  try {
    const orderId = req.body.orderId;
    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop || shop.status !== 'active') return res.status(403).json({ error: 'Tienda no activa' });
    if (!shop.empresa || !shop.hash) return res.status(400).json({ error: 'Credenciales de Facturante no configuradas.' });
    const invoice = await prisma.invoice.findUnique({ where: { shopifyOrderId: orderId.toString() } });
    if (!invoice || !invoice.facturanteInvoiceId) return res.status(404).json({ error: 'No existe un comprobante emitido para esta orden.' });

    var emails = (req.body.emails || '').split(',').map(function (e) { return e.trim(); }).filter(Boolean);
    for (var i = 0; i < emails.length; i++) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emails[i])) return res.status(400).json({ error: 'Email invalido: ' + emails[i] });
    }
    if (emails.length === 0 && !invoice.customerEmail) {
      return res.status(400).json({ error: 'La factura no tiene email del cliente registrado. Indica una direccion de envio.' });
    }

    const facturante = new FacturanteService({ empresa: shop.empresa, usuario: shop.usuario, hash: shop.hash, puntoVenta: shop.puntoVenta });
    const result = await facturante.reenviarComprobante(invoice.facturanteInvoiceId, emails.join(',') || null);
    const destino = emails.length ? emails.join(', ') : (invoice.customerEmail || 'el cliente');
    res.json({ success: true, message: 'Comprobante reenviado a ' + destino + (result.mensaje ? ' (' + result.mensaje + ')' : '') });
  } catch (error) {
    logger.error('resend-email error: ' + error.message);
    res.status(500).json({ error: error.message });
  }
});

// Items de la factura original, para armar la NC parcial desde el cliente.
router.get('/credit-note-info/:orderId', async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { shopifyOrderId: req.params.orderId.toString() } });
    if (!invoice) return res.status(404).json({ error: 'No existe una factura para esta orden.' });
    const data = invoice.invoiceData ? (typeof invoice.invoiceData === 'string' ? JSON.parse(invoice.invoiceData) : invoice.invoiceData) : {};
    res.json({
      orderNumber: invoice.shopifyOrderNumber,
      total: invoice.totalAmount,
      tipoComprobante: invoice.tipoComprobante,
      numero: invoice.facturanteInvoiceNumber,
      partialAvailable: !!(invoice.facturanteInvoiceNumber && data.items && data.cliente),
      items: (data.items || []).map(function (it, idx) {
        return { index: idx, descripcion: it.descripcion, cantidad: Number(it.cantidad) || 1, precio_unitario: it.precio_unitario, alicuota_iva: it.alicuota_iva };
      }),
      creditNotes: Array.isArray(data.creditNotes) ? data.creditNotes : (data.creditNote ? [data.creditNote] : []),
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Historial de comprobantes emitidos por la app (facturas y NC), con filtros y export CSV.
// Filtros: ?status=, ?from=YYYY-MM-DD, ?to=YYYY-MM-DD, ?q= (cliente/orden/CAE), ?page=, ?format=csv
router.get('/list', async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop) return res.json({ invoices: [], total: 0, page: 1, pages: 0 });

    var where = { shopId: shop.id };
    if (req.query.status && ['pending', 'processing', 'completed', 'cancelled', 'failed'].indexOf(req.query.status) > -1) {
      where.status = req.query.status;
    }
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) { var f = new Date(req.query.from); if (!isNaN(f)) where.createdAt.gte = f; }
      if (req.query.to) { var t = new Date(req.query.to); if (!isNaN(t)) { t.setHours(23, 59, 59, 999); where.createdAt.lte = t; } }
    }
    var q = (req.query.q || '').trim();
    if (q) {
      where.OR = [
        { customerName: { contains: q, mode: 'insensitive' } },
        { customerEmail: { contains: q, mode: 'insensitive' } },
        { shopifyOrderNumber: { contains: q, mode: 'insensitive' } },
        { cae: { contains: q } },
        { facturanteInvoiceNumber: { contains: q } },
      ];
    }

    const isCsv = req.query.format === 'csv';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 50;
    const select = { shopifyOrderId: true, shopifyOrderNumber: true, customerName: true, customerEmail: true, totalAmount: true, status: true, tipoComprobante: true, facturanteInvoiceNumber: true, cae: true, errorMessage: true, processedAt: true, createdAt: true };
    const [total, rows] = await Promise.all([
      prisma.invoice.count({ where: where }),
      prisma.invoice.findMany({ where: where, select: select, orderBy: { createdAt: 'desc' }, skip: isCsv ? 0 : (page - 1) * pageSize, take: isCsv ? 5000 : pageSize }),
    ]);

    if (isCsv) {
      var esc = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var header = 'Orden,Cliente,Email,Tipo,Numero,CAE,Total,Estado,Fecha emision,Fecha orden';
      var lines = rows.map(function (r) {
        return [r.shopifyOrderNumber, r.customerName, r.customerEmail, r.tipoComprobante, r.facturanteInvoiceNumber, r.cae, r.totalAmount, r.status, r.processedAt ? r.processedAt.toISOString().slice(0, 10) : '', r.createdAt.toISOString().slice(0, 10)].map(esc).join(',');
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="comprobantes.csv"');
      // BOM para que Excel abra el CSV como UTF-8
      return res.send('﻿' + header + '\n' + lines.join('\n'));
    }

    res.json({ invoices: rows, total: total, page: page, pages: Math.ceil(total / pageSize) });
  } catch (error) {
    logger.error('list invoices error: ' + error.message);
    res.status(500).json({ error: error.message });
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
