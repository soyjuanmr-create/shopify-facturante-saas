const express = require('express');
const router = express.Router();
const prisma = require('../models/prisma');
const axios = require('axios');
const FacturanteService = require('../services/facturante');
const logger = require('../utils/logger');
const { getValidAccessToken } = require('../utils/tokenUtils');

router.get('/', async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop) return res.status(403).json({ error: 'Shop not found', authRequired: true });

    // Obtener ID del tema publicado para construir la URL del editor de idiomas
    // (GraphQL: las apps publicas nuevas no pueden usar la REST Admin API)
    let themeId = null;
    try {
      const accessToken = await getValidAccessToken(shop.shopDomain, shop);
      const themeResp = await axios.post(
        `https://${shop.shopDomain}/admin/api/2025-04/graphql.json`,
        { query: '{ themes(first: 1, roles: [MAIN]) { nodes { id } } }' },
        { headers: { 'X-Shopify-Access-Token': accessToken || shop.accessToken, 'Content-Type': 'application/json' } }
      );
      const gid = themeResp.data?.data?.themes?.nodes?.[0]?.id;
      themeId = gid ? gid.split('/').pop() : null;
    } catch (e) { /* no crítico */ }

    res.json({
      success: true,
      settings: { empresa: shop.empresa || '', usuario: shop.usuario || '', hash: shop.hash ? String.fromCharCode(8226).repeat(6) : '', puntoVenta: shop.puntoVenta || '1' },
      autoInvoice: shop.autoInvoice,
      hasCredentials: !!(shop.empresa && shop.hash),
      isPlus: shop.isPlus,
      shopDomain: shop.shopDomain,
      themeId,
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { empresa, usuario, hash, puntoVenta, autoInvoice } = req.body;
    const updateData = { autoInvoice: !!autoInvoice };
    if (empresa !== undefined) updateData.empresa = empresa;
    if (usuario !== undefined) updateData.usuario = usuario;
    if (hash !== undefined && hash !== String.fromCharCode(8226).repeat(6)) updateData.hash = hash;
    if (puntoVenta !== undefined) updateData.puntoVenta = puntoVenta;
    const existingShop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!existingShop) return res.status(403).json({ error: 'La tienda no esta instalada correctamente. Por favor vuelve a instalar la app.', authRequired: true });

    // Validar las credenciales contra Facturante ANTES de guardarlas, para que un hash
    // mal copiado no se descubra recien cuando falla la primera factura. Se usa
    // ListadoPuntosVenta: valida autenticacion y de paso chequea el punto de venta.
    var empresaFinal = updateData.empresa !== undefined ? updateData.empresa : existingShop.empresa;
    var usuarioFinal = updateData.usuario !== undefined ? updateData.usuario : existingShop.usuario;
    var hashFinal = updateData.hash !== undefined ? updateData.hash : existingShop.hash;
    var pvFinal = updateData.puntoVenta !== undefined ? updateData.puntoVenta : existingShop.puntoVenta;
    var credsChanged = updateData.empresa !== undefined || updateData.usuario !== undefined || updateData.hash !== undefined || updateData.puntoVenta !== undefined;
    var verified = false;
    // Si se estan borrando (desconectar), no hay nada que validar
    if (credsChanged && empresaFinal && usuarioFinal && hashFinal) {
      try {
        var facturante = new FacturanteService({ empresa: empresaFinal, usuario: usuarioFinal, hash: hashFinal, puntoVenta: pvFinal });
        var pvs = await facturante.listarPuntosVenta();
        verified = true;
        var pvNum = parseInt(pvFinal || '1', 10);
        var habilitado = pvs.prefijos.some(function (p) { return parseInt(p, 10) === pvNum; });
        if (pvs.prefijos.length > 0 && !habilitado) {
          return res.status(400).json({
            error: 'Credenciales validas, pero el punto de venta ' + pvNum + ' no esta habilitado en tu cuenta de Facturante. Disponibles: ' + pvs.prefijos.join(', ') + '.',
          });
        }
      } catch (e) {
        logger.warn('Validacion de credenciales Facturante fallo para ' + req.shopDomain + ': ' + e.message);
        return res.status(400).json({
          error: 'No pudimos validar tus credenciales con Facturante: ' + e.message + ' — Verifica el nro de empresa, usuario y API hash.',
        });
      }
    }

    await prisma.shop.update({
      where: { shopDomain: req.shopDomain },
      data: updateData,
    });
    res.json({ success: true, verified: verified });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
