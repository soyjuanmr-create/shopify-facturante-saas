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
    retries = retries || 2;
    var fullAction = BASE_ACTION + '/' + action;
    for (var i = 0; i < retries; i++) {
      try {
        // validateStatus: aceptar 200 y 500 (SOAP faults vienen como HTTP 500)
        return await axios.post(ENDPOINT, xml, {
          headers: { 'Content-Type': 'application/soap+xml; charset=utf-8; action="' + fullAction + '"', 'Accept': 'application/soap+xml' },
          validateStatus: function (s) { return s === 200 || s === 500; },
        });
      } catch (error) {
        if (i === retries - 1) throw error;
        logger.warn('Intento ' + (i + 1) + ' fallido para ' + fullAction + '. Reintentando...');
        await new Promise(function (r) { setTimeout(r, 1000); });
      }
    }
  }

  _extractTag(xml, tag) {
    // Intenta sin namespace y después con cualquier namespace (fac2:Tag, etc.)
    var m = xml.match(new RegExp('<(?:[^>]*:)?' + tag + '[^>]*>([^<]*)<'));
    return m ? m[1].trim() : null;
  }

  mapearTipoDocumento(tipo) {
    var t = (tipo || '').toUpperCase();
    if (t === 'CUIT') return 6; if (t === 'CUIL') return 7; if (t === 'DNI') return 1; return 13;
  }

  mapearTratamientoImpositivo(tipoComp) {
    if (tipoComp === 'FA') return 2; return 3;
  }

  formatearItems(items) {
    return items.map(function (item, idx) {
      var pu = Number(item.precio_unitario) || 0;
      var bon = Number(item.bonificacion) || 0;
      var cant = Number(item.cantidad) || 1;
      var alic = Number(item.alicuota_iva) || 21;
      return { Codigo: (item.codigo || 'PROD' + (idx + 1)).substring(0, 20), Detalle: (item.descripcion || 'Producto').substring(0, 250), Cantidad: cant, PrecioUnitario: pu.toFixed(3), Bonificacion: bon.toFixed(3), IVA: alic.toFixed(3), Gravado: true };
    });
  }

  async crearComprobante(facturaData, webhookUrl) {
    var tipoComp = (facturaData.tipo_comprobante || 'FB').toUpperCase().indexOf('A') > -1 ? 'FA' : 'FB';
    var cliente = facturaData.cliente || {};
    var items = this.formatearItems(facturaData.items || []);
    var self = this;
    var itemsXml = items.map(function (i) {
      return '<fac2:ComprobanteItem><fac2:Bonificacion>' + i.Bonificacion + '</fac2:Bonificacion><fac2:Cantidad>' + i.Cantidad + '</fac2:Cantidad><fac2:Codigo>' + self._esc(i.Codigo) + '</fac2:Codigo><fac2:Detalle>' + self._esc(i.Detalle) + '</fac2:Detalle><fac2:Gravado>' + i.Gravado + '</fac2:Gravado><fac2:IVA>' + i.IVA + '</fac2:IVA><fac2:PrecioUnitario>' + i.PrecioUnitario + '</fac2:PrecioUnitario><fac2:Total>0</fac2:Total></fac2:ComprobanteItem>';
    }).join('');
    // Construir nodo WebHook con headers:
    // 1) facturante-content-type: application/json → recibir webhook en JSON (más fácil de parsear)
    var webhookXml = '';
    if (webhookUrl) {
      var headersXml =
        '<fac2:Header><fac2:Nombre>facturante-content-type</fac2:Nombre><fac2:Valor>application/json</fac2:Valor></fac2:Header>';
      webhookXml = '<fac1:WebHook><fac2:Url>' + this._esc(webhookUrl) + '</fac2:Url><fac2:Headers>' + headersXml + '</fac2:Headers></fac1:WebHook>';
    }
    var nroDoc = (cliente.nro_documento || '').toString().replace(/\D/g, '');
    // TipoDocumento=13 (Sin identificar/CF): Facturante exige NroDocumento=0
    if (this.mapearTipoDocumento(cliente.tipo_documento) === 13) nroDoc = '0';
    var prefijoDoc = (this.puntoVenta || '1').toString().padStart(4, '0');
    logger.info('Facturante envio: tipoComp=' + tipoComp + ' tipoDoc=' + cliente.tipo_documento + ' codigoDoc=' + this.mapearTipoDocumento(cliente.tipo_documento) + ' nroDoc=' + nroDoc + ' empresa=' + cliente.nombre);
    var body = '<fac:CrearComprobante><fac:request>' + this._auth() + '<fac1:Cliente><fac2:CodigoPostal>' + this._esc(cliente.codigo_postal || '-') + '</fac2:CodigoPostal><fac2:CondicionPago>1</fac2:CondicionPago><fac2:Contacto>-</fac2:Contacto><fac2:DireccionFiscal>' + this._esc((cliente.direccion || '-').substring(0, 100)) + '</fac2:DireccionFiscal><fac2:EnviarComprobante>true</fac2:EnviarComprobante><fac2:Localidad>' + this._esc(cliente.ciudad || '-') + '</fac2:Localidad><fac2:MailContacto>-</fac2:MailContacto><fac2:MailFacturacion>' + this._esc(cliente.email || '-') + '</fac2:MailFacturacion><fac2:NroDocumento>' + this._esc(nroDoc) + '</fac2:NroDocumento><fac2:PercibeIIBB>false</fac2:PercibeIIBB><fac2:PercibeIVA>false</fac2:PercibeIVA><fac2:Provincia>' + this._esc(cliente.provincia || '-') + '</fac2:Provincia><fac2:RazonSocial>' + this._esc((cliente.nombre || 'Consumidor Final').substring(0, 100)) + '</fac2:RazonSocial><fac2:Telefono>-</fac2:Telefono><fac2:TipoDocumento>' + this.mapearTipoDocumento(cliente.tipo_documento) + '</fac2:TipoDocumento><fac2:TratamientoImpositivo>' + this.mapearTratamientoImpositivo(tipoComp, cliente.tipo_documento) + '</fac2:TratamientoImpositivo></fac1:Cliente><fac1:Encabezado><fac2:Bienes>1</fac2:Bienes><fac2:CodigoPagoElectronico i:nil="true"/><fac2:CondicionVenta>1</fac2:CondicionVenta><fac2:EnviarComprobante>true</fac2:EnviarComprobante><fac2:FechaHora>' + new Date().toISOString().split('.')[0] + '</fac2:FechaHora><fac2:FechaServDesde i:nil="true"/><fac2:FechaServHasta i:nil="true"/><fac2:FechaVtoPago>' + new Date().toISOString().split('.')[0] + '</fac2:FechaVtoPago><fac2:ImporteImpuestosInternos>0</fac2:ImporteImpuestosInternos><fac2:ImportePercepcionesMunic>0</fac2:ImportePercepcionesMunic><fac2:Moneda>2</fac2:Moneda><fac2:Observaciones i:nil="true"/><fac2:OrdenCompra i:nil="true"/><fac2:PercepcionIIBB>0</fac2:PercepcionIIBB><fac2:PercepcionIVA>0</fac2:PercepcionIVA><fac2:PorcentajeIIBB>0</fac2:PorcentajeIIBB><fac2:Prefijo>' + prefijoDoc + '</fac2:Prefijo><fac2:Remito i:nil="true"/><fac2:SubTotal>0</fac2:SubTotal><fac2:SubTotalExcento>0</fac2:SubTotalExcento><fac2:SubTotalNoAlcanzado>0</fac2:SubTotalNoAlcanzado><fac2:TipoComprobante>' + tipoComp + '</fac2:TipoComprobante><fac2:TipoDeCambio>1</fac2:TipoDeCambio><fac2:Total>0</fac2:Total><fac2:TotalConDescuento>0</fac2:TotalConDescuento><fac2:TotalNeto>0</fac2:TotalNeto></fac1:Encabezado><fac1:Items>' + itemsXml + '</fac1:Items>' + webhookXml + '</fac:request></fac:CrearComprobante>';
    var xml = this._envelope('CrearComprobante', body);
    logger.info('=== ENVIANDO A FACTURANTE ===');
    try {
      var res = await this._post('CrearComprobante', xml);
      var data = res.data || '';
      var rawStr = String(data);

      if (rawStr.includes('Fault') || rawStr.includes('fault')) {
        var faultString = this._extractTag(rawStr, 'faultstring') || this._extractTag(rawStr, 'Text') || 'SOAP Fault desconocido';
        logger.error('CrearComprobante SOAP Fault: ' + faultString);
        throw new Error('Facturante SOAP Fault: ' + faultString);
      }

      var estado = this._extractTag(rawStr, 'Estado');
      var msg = this._extractTag(rawStr, 'Mensaje');
      var idComp = this._extractTag(rawStr, 'IdComprobante');
      var caeInline = this._extractTag(rawStr, 'CAE');
      var numeroInline = this._extractTag(rawStr, 'NumeroComprobante') || this._extractTag(rawStr, 'Numero');
      var estadoFinal = (this._extractTag(rawStr, 'Estado') || '').toLowerCase();

      logger.info('CrearComprobante raw (primeros 1000): ' + rawStr.substring(0, 1000));
      if (estado !== 'OK') throw new Error(msg || 'Estado inesperado: ' + estado);
      return {
        idComprobante: idComp,
        estado: 'OK',
        mensaje: msg,
        // Si Facturante devuelve el CAE sincrónicamente (algunos planes):
        cae: caeInline || null,
        numero: numeroInline || null,
        autorizado: estadoFinal === 'autorizado' && !!caeInline,
      };
    } catch (err) {
      if (err.response) {
        logger.error('CrearComprobante HTTP error status=' + err.response.status + ' body=' + JSON.stringify(err.response.data || '').substring(0, 500));
        throw new Error('Facturante HTTP ' + err.response.status + ': ' + (JSON.stringify(err.response.data || '')).substring(0, 200));
      }
      logger.error('=== ERROR CrearComprobante === ' + err.message);
      throw err;
    }
  }

  /**
   * Anula un comprobante emitido generando su Nota de Crédito (Comprobante Inverso).
   * Facturante deduce el tipo de NC según el comprobante original (FB→NCB, FA→NCA, etc.).
   * @param {string|number} idComprobante - IdComprobante de Facturante de la factura original.
   * @param {string} [observaciones] - Texto opcional al pie de la NC.
   */
  async anularComprobante(idComprobante, observaciones) {
    var idNum = (idComprobante || '').toString().replace(/\D/g, '');
    if (!idNum) throw new Error('IdComprobante invalido para anular');
    var prefijo = (this.puntoVenta || '1').toString().padStart(4, '0');
    var obsXml = observaciones
      ? '<fac1:Observaciones>' + this._esc(observaciones) + '</fac1:Observaciones>'
      : '<fac1:Observaciones i:nil="true"/>';
    // Orden de hijos según el DataContract (alfabético): Autenticacion, ComprobantesAAnular,
    // FechaEmision, Observaciones, PuntoVenta, ReplicarOrdenCompra. ComprobantesAAnular es
    // ArrayOfint del namespace de Microsoft Serialization (items <int>).
    var body = '<fac:CrearAnulacionFull><fac:request>' +
      this._auth() +
      '<fac1:ComprobantesAAnular xmlns:arr="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><arr:int>' + idNum + '</arr:int></fac1:ComprobantesAAnular>' +
      '<fac1:FechaEmision>' + new Date().toISOString().split('.')[0] + '</fac1:FechaEmision>' +
      obsXml +
      '<fac1:PuntoVenta>' + prefijo + '</fac1:PuntoVenta>' +
      '<fac1:ReplicarOrdenCompra>false</fac1:ReplicarOrdenCompra>' +
      '</fac:request></fac:CrearAnulacionFull>';
    var xml = this._envelope('CrearAnulacionFull', body);
    logger.info('CrearAnulacionFull: anulando idComprobante=' + idNum + ' prefijo=' + prefijo);
    try {
      var res = await this._post('CrearAnulacionFull', xml);
      var rawStr = String(res.data || '');
      logger.info('CrearAnulacionFull HTTP status=' + res.status + ' raw (primeros 1200): ' + rawStr.substring(0, 1200));

      if (rawStr.includes('Fault') || rawStr.includes('fault')) {
        var faultString = this._extractTag(rawStr, 'faultstring') || this._extractTag(rawStr, 'Text') || 'SOAP Fault desconocido';
        logger.error('CrearAnulacionFull SOAP Fault: ' + faultString);
        throw new Error('Facturante SOAP Fault: ' + faultString);
      }

      var estado = this._extractTag(rawStr, 'Estado');
      var mensaje = this._extractTag(rawStr, 'Mensaje');
      var codigo = this._extractTag(rawStr, 'Codigo');
      // Datos de la NC generada (pueden venir dentro de ComprobantesAnulados):
      var cae = this._extractTag(rawStr, 'CAE') || this._extractTag(rawStr, 'Cae') || this._extractTag(rawStr, 'cae');
      var numero = this._extractTag(rawStr, 'NumeroComprobante') || this._extractTag(rawStr, 'NroComprobante') || this._extractTag(rawStr, 'Numero');
      var idNc = this._extractTag(rawStr, 'IdComprobante');

      if (estado && estado.toUpperCase() !== 'OK') {
        throw new Error(mensaje || ('Estado inesperado: ' + estado + (codigo ? ' (codigo ' + codigo + ')' : '')));
      }
      return { estado: 'OK', mensaje: mensaje, codigo: codigo, cae: cae || null, numero: numero || null, idComprobante: idNc || null, raw: rawStr.substring(0, 2000) };
    } catch (err) {
      if (err.response) {
        logger.error('CrearAnulacionFull HTTP error status=' + err.response.status + ' body=' + JSON.stringify(err.response.data || '').substring(0, 500));
        throw new Error('Facturante HTTP ' + err.response.status + ': ' + (JSON.stringify(err.response.data || '')).substring(0, 200));
      }
      logger.error('CrearAnulacionFull error: ' + err.message);
      throw err;
    }
  }

  /**
   * Consulta el estado de un comprobante ya emitido por su IdComprobante.
   * Útil para hacer polling cuando el webhook de Facturante no llega.
   */
  async consultarComprobante(idComprobante) {
    var body = '<fac:DetalleComprobante><fac:request>' + this._auth() +
      '<fac1:IdComprobante>' + this._esc(idComprobante.toString()) + '</fac1:IdComprobante>' +
      '</fac:request></fac:DetalleComprobante>';
    var xml = this._envelope('DetalleComprobante', body);
    logger.info('DetalleComprobante: enviando para idComprobante=' + idComprobante);
    try {
      var res = await this._post('DetalleComprobante', xml);
      var data = res.data || '';
      var rawStr = String(data);
      logger.info('DetalleComprobante HTTP status=' + res.status + ' raw (primeros 1500): ' + rawStr.substring(0, 1500));

      // Detectar Fault SOAP (error del servidor de Facturante)
      if (rawStr.includes('Fault') || rawStr.includes('fault')) {
        var faultString = this._extractTag(rawStr, 'faultstring') || this._extractTag(rawStr, 'Text') || 'SOAP Fault desconocido';
        logger.error('DetalleComprobante SOAP Fault: ' + faultString);
        throw new Error('Facturante SOAP Fault: ' + faultString);
      }

      var estado = (this._extractTag(rawStr, 'Estado') || '').toLowerCase();
      // CAE puede venir como <CAE>, <Cae>, <cae>, <fac2:CAE>, etc.
      var cae = this._extractTag(rawStr, 'CAE') || this._extractTag(rawStr, 'Cae') || this._extractTag(rawStr, 'cae');
      var numero = this._extractTag(rawStr, 'NumeroComprobante') || this._extractTag(rawStr, 'NroComprobante') || this._extractTag(rawStr, 'Numero');
      var msg = this._extractTag(rawStr, 'Mensaje') || this._extractTag(rawStr, 'Descripcion');

      logger.info('DetalleComprobante parsed: estado=' + estado + ' cae=' + cae + ' msg=' + msg);
      return { estado, cae, numero, mensaje: msg, raw: rawStr.substring(0, 2000) };
    } catch (err) {
      // Si es error de red (axios) registrar el cuerpo de respuesta si existe
      if (err.response) {
        logger.error('DetalleComprobante HTTP error status=' + err.response.status + ' body=' + JSON.stringify(err.response.data || '').substring(0, 500));
        throw new Error('Facturante HTTP ' + err.response.status + ': ' + (JSON.stringify(err.response.data || '')).substring(0, 200));
      }
      logger.error('DetalleComprobante error: ' + err.message);
      throw err;
    }
  }
}

module.exports = FacturanteService;
