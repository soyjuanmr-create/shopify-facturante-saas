// server/utils/tokenUtils.js

const logger = require('./logger');
const prisma = require('../models/prisma');

/**
 * Obtener access token válido (no expirado) para una tienda
 *
 * Búsqueda en orden:
 * 1. Session table (más reciente, token offline)
 * 2. Shop table (fallback, token offline)
 *
 * @param {string} shopDomain - ej: "myshop.myshopify.com"
 * @param {object} shopRecord - registro de Shop table
 * @returns {string|null} - access token o null si no disponible
 */
async function getValidAccessToken(shopDomain, shopRecord) {
  try {
    // Paso 1: Buscar en Session table
    const sessionRecord = await prisma.session.findFirst({
      where: { shop: shopDomain, isOnline: false },
      orderBy: { expires: 'desc' },
    });

    // Paso 2: Validar que Session existe y no está expirado
    if (sessionRecord && sessionRecord.accessToken) {
      const now = new Date();
      const expiresAt = sessionRecord.expires;

      // Si tiene fecha de expiración Y aún no expiró
      if (expiresAt && expiresAt > now) {
        logger.info(
          'Token de Session válido para ' + shopDomain +
          ' (expira: ' + expiresAt.toISOString() + ')'
        );
        return sessionRecord.accessToken;
      } else if (expiresAt) {
        logger.warn(
          'Session token expirado para ' + shopDomain +
          ' (expiró: ' + expiresAt.toISOString() + '), usando Shop table'
        );
      }
    }

    // Paso 3: Fallback a Shop table
    if (shopRecord && shopRecord.accessToken) {
      logger.info('Token de Shop table para ' + shopDomain + ' (fallback)');
      return shopRecord.accessToken;
    }

    // Paso 4: No hay token disponible
    logger.error('❌ NO HAY TOKEN VÁLIDO DISPONIBLE para ' + shopDomain);
    return null;

  } catch (err) {
    logger.error('Error en getValidAccessToken: ' + err.message);
    return null;
  }
}

module.exports = { getValidAccessToken };
