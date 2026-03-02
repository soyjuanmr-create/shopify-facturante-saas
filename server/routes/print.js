const express = require('express');
const router = express.Router();
const prisma = require('../models/prisma');
const shopify = require('../services/shopify');

router.get('/', async (req, res) => {
  try {
    var printType = req.query.printType;
    var orderId = req.query.orderId;
    if (!orderId || !printType) return res.status(400).send('<h1>Missing params</h1>');
    var shortId = orderId.indexOf('/') > -1 ? orderId.split('/').pop() : orderId;
    var invoice = await prisma.invoice.findUnique({ where: { shopifyOrderId: shortId }, include: { shop: true } });
    var order = null;
    if (invoice && invoice.shop) {
      try {
        var session = { shop: invoice.shop.shopDomain, accessToken: invoice.shop.accessToken };
        var client = new shopify.clients.Graphql({ session: session });
        var r = await client.request('query($id:ID!){order(id:$id){name createdAt email totalPriceSet{shopMoney{amount currencyCode}} subtotalPriceSet{shopMoney{amount}} totalTaxSet{shopMoney{amount}} billingAddress{firstName lastName company address1 city province zip} shippingAddress{firstName lastName company address1 city province zip country} lineItems(first:50){edges{node{title sku quantity originalUnitPriceSet{shopMoney{amount}}}}}}}', { variables: { id: 'gid://shopify/Order/' + shortId } });
        order = r.data ? r.data.order : null;
      } catch (e) { /* continue */ }
    }
    var types = printType.split(',');
    var pages = [];
    if (types.indexOf('invoice') > -1) pages.push(invoicePage(order, invoice));
    if (types.indexOf('packing_slip') > -1) pages.push(packingSlipPage(order));
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.type('html').send(wrapHTML(pages, order ? order.name : 'Orden ' + shortId));
  } catch (e) { res.status(500).send('<h1>Error</h1>'); }
});

function invoicePage(order, invoice) {
  var b = (order && order.billingAddress) || {};
  var name = [b.firstName, b.lastName].filter(Boolean).join(' ') || 'Consumidor Final';
  var items = '';
  if (order && order.lineItems && order.lineItems.edges) {
    items = order.lineItems.edges.map(function(e) {
      var i = e.node; var p = parseFloat(i.originalUnitPriceSet.shopMoney.amount);
      return '<tr><td>' + i.title + '</td><td>' + (i.sku||'-') + '</td><td class="c">' + i.quantity + '</td><td class="r">$' + p.toFixed(2) + '</td><td class="r">$' + (p*i.quantity).toFixed(2) + '</td></tr>';
    }).join('');
  }
  var caeHtml = (invoice && invoice.cae) ? '<div class="cae"><b>CAE:</b> ' + invoice.cae + ' | <b>Nro:</b> ' + (invoice.facturanteInvoiceNumber||'-') + '</div>' : '<div class="cae"><em>Pendiente de autorizacion AFIP</em></div>';
  var sub = order && order.subtotalPriceSet ? parseFloat(order.subtotalPriceSet.shopMoney.amount).toFixed(2) : '0.00';
  var tax = order && order.totalTaxSet ? parseFloat(order.totalTaxSet.shopMoney.amount).toFixed(2) : '0.00';
  var tot = order && order.totalPriceSet ? parseFloat(order.totalPriceSet.shopMoney.amount).toFixed(2) : '0.00';
  var fecha = order && order.createdAt ? new Date(order.createdAt).toLocaleDateString('es-AR') : '-';
  return '<div class="page"><div class="hdr"><h1>Factura Electronica</h1><div class="ri"><b>' + (order?order.name:'Orden') + '</b><br>' + fecha + '</div></div><div class="info"><h3>Cliente</h3><p>' + name + '</p>' + (b.company?'<p>CUIT: '+b.company+'</p>':'') + '<p>' + [b.address1,b.city,b.province,b.zip].filter(Boolean).join(', ') + '</p></div>' + caeHtml + '<table><thead><tr><th>Producto</th><th>SKU</th><th class="c">Cant</th><th class="r">P.Unit</th><th class="r">Subtotal</th></tr></thead><tbody>' + (items||'<tr><td colspan=5>Sin items</td></tr>') + '</tbody></table><div class="totals"><div class="tr"><span>Subtotal</span><span>$' + sub + '</span></div><div class="tr"><span>IVA</span><span>$' + tax + '</span></div><div class="tr tot"><span>Total</span><span>$' + tot + '</span></div></div><div class="ft">Generado por Shopifac</div></div>';
}

function packingSlipPage(order) {
  var s = (order && order.shippingAddress) || {};
  var name = [s.firstName, s.lastName].filter(Boolean).join(' ') || '-';
  var items = '';
  if (order && order.lineItems && order.lineItems.edges) {
    items = order.lineItems.edges.map(function(e) {
      var i = e.node;
      return '<tr><td>' + i.title + '</td><td>' + (i.sku||'-') + '</td><td class="c">' + i.quantity + '</td></tr>';
    }).join('');
  }
  return '<div class="page"><div class="hdr"><h1>Remito</h1><div class="ri"><b>' + (order?order.name:'') + '</b></div></div><div class="info"><h3>Enviar a</h3><p>' + name + '</p><p>' + [s.address1,s.city,s.province,s.zip,s.country].filter(Boolean).join(', ') + '</p></div><table><thead><tr><th>Producto</th><th>SKU</th><th class="c">Cant</th></tr></thead><tbody>' + items + '</tbody></table><div class="ft">Generado por Shopifac</div></div>';
}

function wrapHTML(pages, title) {
  return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>' + title + '</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font:12px sans-serif;color:#1a1a1a}.page{padding:40px;max-width:800px;margin:0 auto}.hdr{display:flex;justify-content:space-between;border-bottom:2px solid #333;padding-bottom:16px;margin-bottom:24px}.hdr h1{font-size:22px}.ri{text-align:right;font-size:13px}.info{margin-bottom:20px;padding:12px 16px;background:#f9f9f9;border-radius:4px}.info h3{font-size:11px;text-transform:uppercase;color:#666;margin-bottom:6px}.cae{margin-bottom:20px;padding:12px 16px;background:#e8f5e9;border-left:4px solid #4caf50;border-radius:4px}table{width:100%;border-collapse:collapse;margin-bottom:24px}th{background:#f5f5f5;padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;border-bottom:2px solid #ddd}td{padding:8px 12px;border-bottom:1px solid #eee}.c{text-align:center}.r{text-align:right}.totals{margin-left:auto;width:250px}.tr{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}.tot{border-top:2px solid #333;margin-top:4px;padding-top:8px;font-weight:700;font-size:15px}.ft{margin-top:40px;text-align:center;color:#999;font-size:10px}@media print{.page+.page{page-break-before:always}}</style></head><body>' + pages.join('') + '</body></html>';
}

module.exports = router;
