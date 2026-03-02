require('dotenv').config();
require('@shopify/shopify-api/adapters/node');
const { shopifyApi, ApiVersion, BillingInterval } = require('@shopify/shopify-api');
const { PrismaSessionStorage } = require('@shopify/shopify-app-session-storage-prisma');
const prisma = require('../models/prisma');

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: (process.env.SCOPES || 'read_orders,write_orders,read_all_orders').split(','),
  hostName: (process.env.SHOPIFY_APP_URL || 'localhost:3000').replace(/https?:\/\//, ''),
  hostScheme: 'https',
  apiVersion: ApiVersion.January25,
  isEmbeddedApp: true,
  sessionStorage: new PrismaSessionStorage(prisma),
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
