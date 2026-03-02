const express = require('express');
const router = express.Router();
const prisma = require('../models/prisma');

router.get('/', async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    res.json({
      success: true,
      settings: { empresa: shop.empresa || '', usuario: shop.usuario || '', hash: shop.hash ? String.fromCharCode(8226).repeat(6) : '', puntoVenta: shop.puntoVenta || '1' },
      autoInvoice: shop.autoInvoice,
      hasCredentials: !!(shop.empresa && shop.hash),
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
    await prisma.shop.update({ where: { shopDomain: req.shopDomain }, data: updateData });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
