require('dotenv').config();

// Capturar errores silenciosos sin matar el proceso
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION (server continues):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message, err.stack);
});

// Verificar variables requeridas antes de iniciar
const required = ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_APP_URL', 'DATABASE_URL'];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error('FATAL: Missing required environment variables:', missing.join(', '));
  process.exit(1);
}
console.log('ENV CHECK OK - DATABASE_URL starts with:', process.env.DATABASE_URL.substring(0, 30));
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
var { startCron } = require('./services/cronSync');

var app = express();
app.set('trust proxy', 1);
var PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.shopify.com"], styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.shopify.com"], imgSrc: ["'self'", "data:", "https:", "http:"], connectSrc: ["'self'", "https://*.myshopify.com", "https://*.shopify.com"], frameSrc: ["'self'", "https://*.myshopify.com", "https://admin.shopify.com"], frameAncestors: ["https://admin.shopify.com", "https://*.myshopify.com"] } }, crossOriginEmbedderPolicy: false }));
app.use(compression());
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));
app.use(cors({ origin: true, credentials: true }));

// Raw body only for Shopify webhooks (HMAC verification needs raw bytes)
// Facturante webhook uses express.json() inline — do NOT apply raw here
app.use('/webhooks/shopify', express.raw({ type: 'application/json' }));
app.use('/webhooks', webhookRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/', rateLimiter);

app.get('/api/auth', async function (req, res) {
  var shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');
  if (!shop.includes('.myshopify.com')) shop = shop + '.myshopify.com';
  await shopify.auth.begin({ shop: shop, callbackPath: '/api/auth/callback', isOnline: false, rawRequest: req, rawResponse: res });
});

app.get('/api/auth/callback', async function (req, res) {
  try {
    var callback = await shopify.auth.callback({ rawRequest: req, rawResponse: res });
    var session = callback.session;
    logger.info('OAuth callback: shop=' + session.shop + ' token=' + (session.accessToken ? session.accessToken.substring(0, 12) : 'EMPTY') + ' scope=' + session.scope);
    var prisma = require('./models/prisma');
    await prisma.shop.upsert({
      where: { shopDomain: session.shop },
      update: { accessToken: session.accessToken, status: 'active', lastAccessAt: new Date() },
      create: { shopDomain: session.shop, accessToken: session.accessToken, status: 'active' },
    });
    logger.info('OAuth callback: Shop upserted in DB for ' + session.shop);
    try { await shopify.webhooks.register({ session: session }); } catch (e) { logger.warn('Webhook reg error: ' + e.message); }

    // Billing: verificar si el merchant tiene un plan activo
    try {
      const isTest = process.env.NODE_ENV !== 'production';
      const billingCheck = await shopify.billing.check({
        session: session,
        plans: ['SaaS Plan'],
        isTest: isTest,
      });
      if (!billingCheck.hasActivePayment) {
        logger.info('Billing: merchant ' + session.shop + ' sin plan activo, redirigiendo a checkout...');
        const billingResponse = await shopify.billing.request({
          session: session,
          plan: 'SaaS Plan',
          isTest: isTest,
        });
        return res.redirect(billingResponse.confirmationUrl);
      }
      logger.info('Billing: merchant ' + session.shop + ' tiene plan activo.');
    } catch (billingErr) {
      // Si falla el check de billing, dejar pasar (no bloquear al merchant)
      logger.warn('Billing check error (no bloqueante): ' + billingErr.message);
    }

    res.redirect('/?shop=' + session.shop + '&host=' + req.query.host);
  } catch (error) { logger.error('OAuth error: ' + error.message); res.status(500).send('Auth error: ' + error.message); }
});

app.use('/api/settings', authMw.verifyToken, settingsRoutes);
app.use('/api/invoices', authMw.verifyToken, invoiceRoutes);
app.use('/api/print', printRoutes);

var distPath = path.join(__dirname, '../client/dist');
app.use(express.static(distPath, { index: false }));

app.get('/*', function (req, res) {
  var indexPath = path.join(distPath, 'index.html');
  var fs = require('fs');
  if (fs.existsSync(indexPath)) {
    var html = fs.readFileSync(indexPath, 'utf8');
    html = html.replace('__SHOPIFY_API_KEY__', process.env.SHOPIFY_API_KEY || '');
    res.type('html').send(html);
  } else { res.send('<h1>Run npm run build to compile frontend</h1>'); }
});

app.use(errorHandler);
console.log('Attempting to start server on port', PORT);
app.listen(PORT, function () {
  console.log('SERVER STARTED - Shopifac running on port ' + PORT);
  logger.info('Shopifac running on port ' + PORT);
  startCron();
});
module.exports = app;
