class FacturanteMapper {
  static mapShopifyToFacturante(shopifyOrder) {
    if (!shopifyOrder || typeof shopifyOrder !== 'object') throw new Error('Orden de Shopify invalida');
    var taxesIncluded = shopifyOrder.taxes_included || false;
    var tipoComprobante = this.determinarTipoComprobante(shopifyOrder);
    var cliente = this.mapearCliente(shopifyOrder);
    var items = (shopifyOrder.line_items || []).map(function (item, idx) {
      var alicuota = FacturanteMapper._obtenerAlicuota(item, shopifyOrder);
      var qty = parseInt(item.quantity, 10) || 1;
      var originalPrice = parseFloat(item.price);
      var totalDiscountAmount = parseFloat(item.total_discount || 0);
      if (totalDiscountAmount === 0 && item.discount_allocations && item.discount_allocations.length > 0) {
        totalDiscountAmount = item.discount_allocations.reduce(function (sum, d) { return sum + parseFloat(d.amount || 0); }, 0);
      }
      var totalOriginalLinePrice = originalPrice * qty;
      var discountPct = totalOriginalLinePrice > 0 ? (totalDiscountAmount / totalOriginalLinePrice) * 100 : 0;
      var precioUnitario = originalPrice;
      if (taxesIncluded && alicuota > 0) {
        precioUnitario = precioUnitario / (1 + alicuota / 100);
      }
      return {
        codigo: item.sku || item.variant_id || 'PROD-' + idx,
        descripcion: item.name || item.title,
        cantidad: qty,
        precio_unitario: precioUnitario.toFixed(3),
        alicuota_iva: alicuota,
        bonificacion: discountPct.toFixed(3)
      };
    });
    (shopifyOrder.shipping_lines || []).forEach(function (sl) {
      var shippingPrice = parseFloat(sl.price) || 0;
      if (shippingPrice <= 0) return;
      var shippingAlicuota = (sl.tax_lines && sl.tax_lines.length > 0) ? parseFloat(sl.tax_lines[0].rate) * 100 : 21.0;
      var shippingPrecio = shippingPrice;
      if (taxesIncluded && shippingAlicuota > 0) shippingPrecio = shippingPrecio / (1 + shippingAlicuota / 100);
      items.push({ codigo: 'ENVIO', descripcion: (sl.title || 'Costo de envio').substring(0, 250), cantidad: 1, precio_unitario: shippingPrecio.toFixed(3), alicuota_iva: shippingAlicuota, bonificacion: '0.000' });
    });
    return { tipo_comprobante: tipoComprobante, shopify_order_number: shopifyOrder.order_number || shopifyOrder.name, importe_total: parseFloat(shopifyOrder.total_price).toFixed(2), cliente: cliente, items: items, observaciones: 'Orden Shopify #' + shopifyOrder.name };
  }

  static determinarTipoComprobante(order) {
    // Si el checkout guardó el tipo explícitamente: CUIL/DNI → siempre FB
    var tipoDocAttr = (this._extraerAtributo(order, ['tipo_documento']) || '').toUpperCase();
    if (tipoDocAttr === 'CUIL' || tipoDocAttr === 'DNI') return 'FB';
    var cuit = this._extraerAtributo(order, ['CUIT', 'Documento', 'DNI', 'documento_identidad']);
    if (!cuit) { var company = ((order.billing_address || {}).company || '').trim(); if (company.match(/^[0-9-]{10,13}$/)) cuit = company; }
    if (cuit) { var cleanCuit = cuit.replace(/\D/g, ''); if (cleanCuit.length === 11 && this.validarCUIT(cleanCuit)) return 'FA'; }
    return 'FB';
  }

  static mapearCliente(order) {
    var billing = order.billing_address || order.shipping_address || {};
    var docValue = this._extraerAtributo(order, ['CUIT', 'Documento', 'DNI', 'documento_identidad', 'documento_numero']) || '';
    if (!docValue && billing.company) { var company = billing.company.trim(); if (company.match(/^[0-9-]{7,13}$/)) docValue = company; }
    var nroDoc = docValue.replace(/\D/g, '');
    var tipoDocAttr = (this._extraerAtributo(order, ['tipo_documento']) || '').toUpperCase();
    var tipoDoc = tipoDocAttr || (nroDoc.length === 11 ? 'CUIT' : (nroDoc.length >= 7 ? 'DNI' : 'CF'));
    return {
      nombre: ((billing.first_name || '') + ' ' + (billing.last_name || '')).trim() || 'Consumidor Final',
      email: order.email || order.contact_email || '',
      tipo_documento: tipoDoc,
      nro_documento: nroDoc,
      direccion: ((billing.address1 || '') + ' ' + (billing.address2 || '')).trim(),
      ciudad: billing.city || 'CABA',
      provincia: this.normalizarProvincia(billing.province),
      codigo_postal: billing.zip || ''
    };
  }

  static normalizarProvincia(prov) {
    var p = (prov || '').toUpperCase();
    if (p.indexOf('CAPITAL') > -1 || p.indexOf('CABA') > -1 || p.indexOf('AUTONOMA') > -1) return 'Ciudad Autonoma de Buenos Aires';
    if (p.indexOf('BUENOS AIRES') > -1 || p === 'BS AS' || p === 'BS.AS.') return 'Buenos Aires';
    return prov || 'Buenos Aires';
  }

  static _extraerAtributo(order, keys) {
    if (!order.note_attributes) return null;
    for (var k = 0; k < keys.length; k++) {
      var attr = order.note_attributes.find(function (a) { return a.name.toUpperCase() === keys[k].toUpperCase(); });
      if (attr && attr.value) return attr.value;
    }
    return null;
  }

  static _obtenerAlicuota(item, order) {
    if (item.tax_lines && item.tax_lines.length > 0) return parseFloat(item.tax_lines[0].rate) * 100;
    return 21.0;
  }

  static validarCUIT(cuit) {
    var c = cuit.replace(/\D/g, '');
    if (c.length !== 11) return false;
    var factors = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    var sum = 0;
    for (var i = 0; i < 10; i++) sum += parseInt(c[i]) * factors[i];
    var check = (11 - (sum % 11)) % 11;
    return check === parseInt(c[10]);
  }
}

module.exports = FacturanteMapper;
