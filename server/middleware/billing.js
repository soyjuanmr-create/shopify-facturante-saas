const shopify = require('../services/shopify');
const prisma = require('../models/prisma');
const logger = require('../utils/logger');
const { getValidAccessToken } = require('../utils/tokenUtils');

const PLAN = 'Plan Shopifac';
// 'SaaS Plan' fue el nombre del plan anterior: se sigue aceptando para no re-cobrar
// a merchants que lo hubieran aprobado.
const PLANES_VALIDOS = [PLAN, 'SaaS Plan'];
// El resultado del check se cachea en Shop.billingActive/billingCheckedAt para no
// consultar la API de Shopify en cada request.
const CACHE_MS = 6 * 60 * 60 * 1000;
// Cache negativo en memoria: una pagina dispara varios requests en paralelo y sin esto
// cada uno correria billing.check + billing.request (creando suscripciones pendientes).
const NEG_CACHE_MS = 60 * 1000;
var negCache = new Map(); // shopDomain -> { ts, confirmationUrl }

function billingRequired() { return process.env.BILLING_REQUIRED === 'true'; }
function isTestBilling() { return process.env.BILLING_TEST === 'true' || process.env.NODE_ENV !== 'production'; }
function isExempt(shopDomain) {
  return (process.env.BILLING_EXEMPT_SHOPS || '')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    .indexOf(shopDomain) > -1;
}

// Consulta Shopify y actualiza el cache. Devuelve { active, confirmationUrl }.
// Si el merchant no tiene suscripcion, genera la URL de confirmacion del plan
// (incluye los 14 dias de trial) para que el frontend redirija.
async function checkAndCache(shopDomain, shop) {
  var accessToken = await getValidAccessToken(shopDomain, shop);
  if (!accessToken) return { active: false, confirmationUrl: null, noToken: true };
  var session = { shop: shopDomain, accessToken: accessToken };
  var check = await shopify.billing.check({ session: session, plans: PLANES_VALIDOS, isTest: isTestBilling() });
  await prisma.shop.update({ where: { id: shop.id }, data: { billingActive: !!check.hasActivePayment, billingCheckedAt: new Date() } });
  if (check.hasActivePayment) { negCache.delete(shopDomain); return { active: true }; }
  var confirmationUrl = null;
  try {
    var billingResp = await shopify.billing.request({
      session: session,
      plan: PLAN,
      isTest: isTestBilling(),
      returnUrl: (process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '') + '/?shop=' + encodeURIComponent(shopDomain),
    });
    confirmationUrl = billingResp.confirmationUrl;
  } catch (e) {
    logger.error('billing.request error para ' + shopDomain + ': ' + e.message);
  }
  negCache.set(shopDomain, { ts: Date.now(), confirmationUrl: confirmationUrl });
  return { active: false, confirmationUrl: confirmationUrl };
}

// Middleware para las rutas /api (despues de verifyToken, requiere req.shopDomain).
// Responde 402 con confirmationUrl si el merchant no tiene suscripcion activa.
async function requireBilling(req, res, next) {
  try {
    if (!billingRequired()) return next();
    var shopDomain = req.shopDomain;
    if (!shopDomain || isExempt(shopDomain)) return next();
    var shop = await prisma.shop.findUnique({ where: { shopDomain: shopDomain } });
    if (!shop) return res.status(403).json({ error: 'Tienda no registrada.', authRequired: true });
    if (shop.billingActive && shop.billingCheckedAt && (Date.now() - shop.billingCheckedAt.getTime()) < CACHE_MS) return next();
    var neg = negCache.get(shopDomain);
    if (neg && (Date.now() - neg.ts) < NEG_CACHE_MS) {
      return res.status(402).json({ error: 'Se requiere una suscripcion activa para usar Shopifac.', billingRequired: true, confirmationUrl: neg.confirmationUrl });
    }
    var result = await checkAndCache(shopDomain, shop);
    if (result.active) return next();
    if (result.noToken) return res.status(403).json({ error: 'Token de acceso no disponible.', authRequired: true });
    logger.info('Billing: ' + shopDomain + ' sin suscripcion activa, respondiendo 402');
    return res.status(402).json({
      error: 'Se requiere una suscripcion activa para usar Shopifac.',
      billingRequired: true,
      confirmationUrl: result.confirmationUrl,
    });
  } catch (e) {
    // Fail-open: un error transitorio de la API de billing no debe dejar la app
    // inutilizable para merchants que si pagan.
    logger.error('requireBilling error (dejando pasar): ' + e.message);
    return next();
  }
}

module.exports = { requireBilling, checkAndCache, billingRequired, isTestBilling, isExempt, PLAN, PLANES_VALIDOS };
