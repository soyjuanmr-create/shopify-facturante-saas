require('dotenv').config();
require('@shopify/shopify-api/adapters/node');
const { shopifyApi, ApiVersion, BillingInterval, Session } = require('@shopify/shopify-api');
const prisma = require('../models/prisma');

// Custom session storage usando Prisma directamente (sin el polling que crashea el servidor)
const customSessionStorage = {
  async storeSession(session) {
    try {
      await prisma.session.upsert({
        where: { id: session.id },
        update: {
          shop: session.shop,
          state: session.state || '',
          isOnline: session.isOnline || false,
          scope: session.scope,
          expires: session.expires,
          accessToken: session.accessToken,
          userId: session.onlineAccessInfo ? BigInt(session.onlineAccessInfo.associated_user.id) : null,
        },
        create: {
          id: session.id,
          shop: session.shop,
          state: session.state || '',
          isOnline: session.isOnline || false,
          scope: session.scope,
          expires: session.expires,
          accessToken: session.accessToken,
          userId: session.onlineAccessInfo ? BigInt(session.onlineAccessInfo.associated_user.id) : null,
        },
      });
      return true;
    } catch (e) {
      console.error('storeSession error:', e.message);
      return false;
    }
  },
  async loadSession(id) {
    try {
      const record = await prisma.session.findUnique({ where: { id } });
      if (!record) return undefined;
      const session = new Session({ id: record.id, shop: record.shop, state: record.state, isOnline: record.isOnline });
      if (record.scope) session.scope = record.scope;
      if (record.expires) session.expires = record.expires;
      if (record.accessToken) session.accessToken = record.accessToken;
      return session;
    } catch (e) {
      console.error('loadSession error:', e.message);
      return undefined;
    }
  },
  async deleteSession(id) {
    try {
      await prisma.session.delete({ where: { id } });
      return true;
    } catch (e) {
      return false;
    }
  },
  async deleteSessions(ids) {
    try {
      await prisma.session.deleteMany({ where: { id: { in: ids } } });
      return true;
    } catch (e) {
      return false;
    }
  },
  async findSessionsByShop(shop) {
    try {
      const records = await prisma.session.findMany({ where: { shop } });
      return records.map(record => {
        const session = new Session({ id: record.id, shop: record.shop, state: record.state, isOnline: record.isOnline });
        if (record.scope) session.scope = record.scope;
        if (record.expires) session.expires = record.expires;
        if (record.accessToken) session.accessToken = record.accessToken;
        return session;
      });
    } catch (e) {
      return [];
    }
  },
};

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: (process.env.SCOPES || 'read_orders,write_orders').split(','),
  hostName: (process.env.SHOPIFY_APP_URL || 'localhost:3000').replace(/https?:\/\//, ''),
  hostScheme: 'https',
  apiVersion: ApiVersion.April25,
  isEmbeddedApp: true,
  sessionStorage: customSessionStorage,
  billing: {
    'SaaS Plan': {
      amount: 35.00,
      currencyCode: 'USD',
      interval: BillingInterval.Every30Days,
      trialDays: 7,
    }
  }
});

module.exports = shopify;
