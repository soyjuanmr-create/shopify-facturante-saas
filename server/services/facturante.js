const axios = require('axios');
const logger = require('../utils/logger');

const ENDPOINT = 'https://www.facturante.com/api/Comprobantes.svc';
const BASE_ACTION = 'http://www.facturante.com.API/IComprobantes';

class FacturanteService {
  constructor(config) {
    this.empresa = config.empresa;
    this.usuario = config.usuario;
    this.hash = config.hash;
    this.puntoVenta = (config.puntoVenta || '1').toString();
  }

  async connect() { return true; }
  async authenticate() { return true; }

  _esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  _auth() {
    return '<fac1:Autenticacion><fac2:Empresa>' + this.empresa + '</fac2:Empresa><fac2:Hash>' + this._esc(this.hash) + '</fac2:Hash><fac2:Usuario>' + this._esc(this.usuario) + '</fac2:Usuario></fac1:Autenticacion>';
  }

  _envelope(action, body) {
    return '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing" xmlns:fac="http://www.facturante.com.API" xmlns:fac1="http://schemas.datacontract.org/2004/07/FacturanteMVC.API" xmlns:fac2="http://schemas.datacontract.org/2004/07/FacturanteMVC.API.DTOs" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><s:Header><a:Action s:mustUnderstand="1">' + BASE_ACTION + '/' + action + '</a:Action><a:To s:mustUnderstand="1">' + ENDPOINT + '</a:To></s:Header><s:Body>' + body + '</s:Body></s:Envelope>';
  }

  async _post(action, xml, retries) {
    retries = retries || 3;
    var fullAction = BASE_ACTION + '/' + action;
    for (var i = 0; i < retries; i++) {
      try {
        return await axios.post(ENDPOINT, xml, { headers: { 'Content-Type': 'application/soap+xml; charset=utf-8; action="' + fullAction + '"', 'Accept': 'application/soap+xml' } });
      } catch (error) {
        if (i === retries - 1) throw error;
        logger.warn('Intento ' + (i+1) + ' fallido para ' + fullAction + '. Reintentando...');
        await new Promise(function(r) { setTimeout(r, 2000); });
      }
    }
  }

  _extractTag(xml, tag) { var match = xml.match(new RegExp('<[^>]*:?' + tag + '[^>]*>([^<]*)<')); return match ? match[1].trim() : null; }

  mapearTipoDocumento(tipo) {
    var t = (tipo || '').toUpperCase();
    if (t === 'CUIT') return 6; if (t === 'CUIL') return 13; if (t === 'DNI') return 96; return 1;
  }

  mapearTratamientoImpositivo(tipoComp, tipoDoc) {
    if (tipoComp === 'FA') return 2; if ((tipoDoc || '').toUpperCase() === 'CUIT') return 1; return 3;
  }

  formatearItems(items) {
    return items.map(function(item, idx) {
      var pu = Number(item.precio_unitario) || 0;
      var cant = Number(item.cantidad) || 1;
      var alic = Number(item.alicuota_iva) || 21;
      var total = Math.round(pu * cant * (1 + alic / 100) * 1000) / 1000;
      return { Codigo: (item.codigo || 'PROD' + (idx+1)).substring(0, 20), Detalle: (item.descripcion || 'Producto').substring(0, 250), Cantidad: cant, PrecioUnitario: pu.toFixed(3), Bonificacion: '0', IVA: alic.toFixed(3), Gravado: true, Total: total.toFixed(3) };
    });
  }

  async crearComprobante(facturaData, webhookUrl) {
    var tipoComp = (facturaData.tipo_comprobante || 'FB').toUpperCase().indexOf('A') > -1 ? 'FA' : 'FB';
    var cliente = facturaData.cliente || {};
    var items = this.formatearItems(facturaData.items || []);
    var totalFinal = items.reduce(function(a, i) { return a + Number(i.Total); }, 0);
    var netoFinal = items.reduce(function(a, i) { return a + Number(i.PrecioUnitario) * Number(i.Cantidad); }, 0);
    var self = this;
    var itemsXml = items.map(function(i) {
      return '<fac2:ComprobanteItem><fac2:Bonificacion>' + i.Bonificacion + '</fac2:Bonificacion><fac2:Cantidad>' + i.Cantidad + '</fac2:Cantidad><fac2:Codigo>' + self._esc(i.Codigo) + '</fac2:Codigo><fac2:Detalle>' + self._esc(i.Detalle) + '</fac2:Detalle><fac2:Gravado>' + i.Gravado + '</fac2:Gravado><fac2:IVA>' + i.IVA + '</fac2:IVA><fac2:PrecioUnitario>' + i.PrecioUnitario + '</fac2:PrecioUnitario><fac2:Total>' + i.Total + '</fac2:Total></fac2:ComprobanteItem>';
    }).join('');
    var webhookXml = webhookUrl ? '<fac1:WebHook><fac2:Url>' + this._esc(webhookUrl) + '</fac2:Url></fac1:WebHook>' : '';
    var nroDoc = (cliente.nro_documento || '1').toString().replace(/\D/g, '');
    var body = '<fac:CrearComprobante><fac:request>' + this._auth() + '<fac1:Cliente><fac2:CodigoPostal>' + this._esc(cliente.codigo_postal || '-') + '</fac2:CodigoPostal><fac2:CondicionPago>2</fac2:CondicionPago><fac2:Contacto>-</fac2:Contacto><fac2:DireccionFiscal>' + this._esc((cliente.direccion || '-').substring(0, 100)) + '</fac2:DireccionFiscal><fac2:EnviarComprobante>true</fac2:EnviarComprobante><fac2:Localidad>' + this._esc(cliente.ciudad || '-') + '</fac2:Localidad><fac2:MailContacto>-</fac2:MailContacto><fac2:MailFacturacion>' + this._esc(cliente.email || '-') + '</fac2:MailFacturacion><fac2:NroDocumento>' + this._esc(nroDoc) + '</fac2:NroDocumento><fac2:PercibeIIBB>false</fac2:PercibeIIBB><fac2:PercibeIVA>false</fac2:PercibeIVA><fac2:Provincia>' + this._esc(cliente.provincia || '-') + '</fac2:Provincia><fac2:RazonSocial>' + this._esc((cliente.nombre || 'Consumidor Final').substring(0, 100)) + '</fac2:RazonSocial><fac2:Telefono>-</fac2:Telefono><fac2:TipoDocumento>' + this.mapearTipoDocumento(cliente.tipo_documento) + '</fac2:TipoDocumento><fac2:TratamientoImpositivo>' + this.mapearTratamientoImpositivo(tipoComp, cliente.tipo_documento) + '</fac2:TratamientoImpositivo></fac1:Cliente><fac1:Encabezado><fac2:Bienes>1</fac2:Bienes><fac2:CodigoPagoElectronico i:nil="true"/><fac2:CondicionVenta>1</fac2:CondicionVenta><fac2:EnviarComprobante>true</fac2:EnviarComprobante><fac2:FechaHora>' + new Date().toISOString().split('.')[0] + '</fac2:FechaHora><fac2:FechaServDesde i:nil="true"/><fac2:FechaServHasta i:nil="true"/><fac2:FechaVtoPago i:nil="true"/><fac2:ImporteImpuestosInternos>0</fac2:ImporteImpuestosInternos><fac2:ImportePercepcionesMunic>0</fac2:ImportePercepcionesMunic><fac2:Moneda>2</fac2:Moneda><fac2:Observaciones i:nil="true"/><fac2:OrdenCompra i:nil="true"/><fac2:PercepcionIIBB>0</fac2:PercepcionIIBB><fac2:PercepcionIVA>0</fac2:PercepcionIVA><fac2:PorcentajeIIBB>0</fac2:PorcentajeIIBB><fac2:Prefijo>' + this.puntoVenta + '</fac2:Prefijo><fac2:Remito i:nil="true"/><fac2:SubTotal>' + netoFinal.toFixed(4) + '</fac2:SubTotal><fac2:SubTotalExcento>0</fac2:SubTotalExcento><fac2:SubTotalNoAlcanzado>0</fac2:SubTotalNoAlcanzado><fac2:TipoComprobante>' + tipoComp + '</fac2:TipoComprobante><fac2:TipoDeCambio>1</fac2:TipoDeCambio><fac2:Total>' + totalFinal.toFixed(3) + '</fac2:Total><fac2:TotalConDescuento>0</fac2:TotalConDescuento><fac2:TotalNeto>' + netoFinal.toFixed(3) + '</fac2:TotalNeto></fac1:Encabezado><fac1:Items>' + itemsXml + '</fac1:Items>' + webhookXml + '</fac:request></fac:CrearComprobante>';
    var xml = this._envelope('CrearComprobante', body);
    logger.info('=== ENVIANDO A FACTURANTE ===');
    try {
      var res = await this._post('CrearComprobante', xml);
      var data = res.data || '';
      var estado = this._extractTag(data, 'Estado');
      var msg = this._extractTag(data, 'Mensaje');
      var idComp = this._extractTag(data, 'IdComprobante');
      if (estado !== 'OK') throw new Error(msg || 'Estado inesperado: ' + estado);
      return { idComprobante: idComp, estado: 'OK', mensaje: msg };
    } catch (err) {
      logger.error('=== ERROR === ' + (err.response ? err.response.status : ''));
      throw err;
    }
  }
}

module.exports = FacturanteService;
