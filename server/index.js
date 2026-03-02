require('dotenv').config();
var express = require('express');
var path = require('path');
var helmet = require('helmet');
var compression = require('compression');
var morgan = require('morgan');
var cors = require('cors');
var shopify = require('./services/shopify');
var logger = require('./utils/logger');
var errorHandler = require('./middleware/errorHandler');
var rateLimiter = require('./middleware/rateLimiter');
var authMw = require('./middleware/auth');
var settingsRoutes = require('./routes/settings');
var invoiceRoutes = require('./routes/invoices');
var printRoutes = require('./routes/print');
var webhookRoutes = require('./routes/webhooks');

var app = express();
var PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.shopify.com"], styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.shopify.com"], imgSrc: ["'self'", "data:", "https:", "http:"], connectSrc: ["'self'", "https://*.myshopify.com", "https://*.shopify.com"], frameSrc: ["'self'", "https://*.myshopify.com", "https://admin.shopify.com"], frameAncestors: ["https://admin.shopify.com", "https://*.myshopify.com"] } }, crossOriginEmbedderPolicy: false }));
app.use(compression());
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));
app.use(cors({ origin: true, credentials: true }));

app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use('/webhooks', webhookRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/', rateLimiter);

app.get('/api/auth', async function(req, res) {
  var shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');
  await shopify.auth.begin({ shop: shop, callbackPath: '/api/auth/callback', isOnline: false, rawRequest: req, rawResponse: res });
});

app.get('/api/auth/callback', async function(req, res) {
  try {
    var callback = await shopify.auth.callback({ rawRequest: req, rawResponse: res });
    var session = callback.session;
    var prisma = require('./models/prisma');
    await prisma.shop.upsert({
      where: { shopDomain: session.shop },
      update: { accessToken: session.accessToken, status: 'active', lastAccessAt: new Date() },
      create: { shopDomain: session.shop, accessToken: session.accessToken, status: 'active' },
    });
    try { await shopify.webhooks.register({ session: session }); } catch (e) { logger.warn('Webhook reg error: ' + e.message); }
    var billingCheck = await shopify.billing.check({ session: session, plans: ['SaaS Plan'], isTest: process.env.NODE_ENV !== 'production' });
    if (!billingCheck.hasActivePayment) {
      var billingUrl = await shopify.billing.request({ session: session, plan: 'SaaS Plan', isTest: process.env.NODE_ENV !== 'production' });
      return res.redirect(billingUrl.confirmationUrl);
    }
    res.redirect('/?shop=' + session.shop + '&host=' + req.query.host);
  } catch (error) { logger.error('OAuth error: ' + error.message); res.status(500).send('Auth error'); }
});

app.use('/api/settings', authMw.verifyToken, settingsRoutes);
app.use('/api/invoices', authMw.verifyToken, invoiceRoutes);
app.use('/api/print', printRoutes);

var distPath = path.join(__dirname, '../client/dist');
app.use(express.static(distPath, { index: false }));

app.get('/*', function(req, res) {
  var indexPath = path.join(distPath, 'index.html');
  var fs = require('fs');
  if (fs.existsSync(indexPath)) {
    var html = fs.readFileSync(indexPath, 'utf8');
    html = html.replace('__SHOPIFY_API_KEY__', process.env.SHOPIFY_API_KEY || '');
    res.type('html').send(html);
  } else { res.send('<h1>Run npm run build to compile frontend</h1>'); }
});

app.use(errorHandler);
app.listen(PORT, function() { logger.info('Shopifac running on port ' + PORT); });
module.exports = app;
