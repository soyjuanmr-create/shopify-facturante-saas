# SHOPIFAC — Skill de Desarrollo para Claude Code

> **Objetivo dual:** (1) Lograr la certificación **Built for Shopify (BFS)** y (2) Implementar campo **DNI/CUIT en el checkout** para merchants Shopify Plus con facturación electrónica argentina.

---

## 1. CONTEXTO DEL PROYECTO

### 1.1 ¿Qué es Shopifac?

App de Shopify para **facturación electrónica argentina** (AFIP) integrada con **Facturante.com**. Categoría en App Store: **Invoices and Receipts**.

Shopifac es un **puente** entre Shopify y Facturante. Facturante se encarga de generar el PDF del comprobante, enviarlo por email al cliente, y comunicarse con AFIP. Shopifac solo recopila los datos de la orden, los mapea al formato de Facturante, y los envía via SOAP API.

### 1.2 Tech Stack

| Capa | Tecnología |
|---|---|
| Backend | Express.js, `@shopify/shopify-api` v12, Prisma, PostgreSQL |
| Frontend (admin) | React 18, Polaris 13, App Bridge v4 |
| Extensions (checkout) | **Preact + Polaris Web Components** (API 2026-01) |
| Extensions (admin) | Admin Print Action + Order Action (Preact) |
| Invoicing | Facturante.com SOAP API |
| Hosting | Railway (PostgreSQL + app) |

### 1.3 Client ID y URLs

- `client_id`: `ddb03a81b1ffb2422828a5e3e5d8f177`
- `application_url`: `https://shopify-facturante-saas-production-d49a.up.railway.app`
- Webhooks API version: `2025-10`
- Extensions API version: `2026-01`

---

## 2. ESTRUCTURA DEL PROYECTO

```
shopifac/
├── package.json                    # Root — Express + Prisma deps
├── package-lock.json
├── shopify.toml                    # Shopify CLI config
├── shopify_app.toml                # App config (client_id, scopes, webhooks)
├── nixpacks.toml                   # Railway build config
├── railway.json                    # Railway deploy config
├── .env                            # Variables de entorno (NO commitear)
├── .env.example                    # Template de variables
├── .gitignore
│
├── prisma/
│   └── schema.prisma               # Modelos: Session, Shop, Invoice
│
├── server/
│   ├── index.js                    # Entry point Express (OAuth, SPA routing)
│   ├── models/
│   │   └── prisma.js               # PrismaClient singleton
│   ├── middleware/
│   │   ├── auth.js                 # JWT session token verification
│   │   ├── rateLimiter.js          # express-rate-limit
│   │   └── errorHandler.js         # Error handler global
│   ├── routes/
│   │   ├── settings.js             # GET/POST /api/settings (config Facturante)
│   │   ├── invoices.js             # POST /api/invoices/generate, GET /status/:id
│   │   ├── print.js                # GET /api/invoices/print (HTML para print action)
│   │   └── webhooks.js             # POST /webhooks/shopify/order-paid, /facturante
│   ├── services/
│   │   ├── shopify.js              # shopifyApi() config + PrismaSessionStorage
│   │   └── facturante.js           # FacturanteService — SOAP XML builder + HTTP
│   └── utils/
│       ├── logger.js               # Winston logger
│       └── facturanteMapper.js     # mapShopifyToFacturante(), mapearTipoDocumento()
│
├── client/                         # React 18 + Vite + Polaris 13
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── main.jsx
│   └── src/
│       ├── App.jsx                 # Router + AppProvider + AppBridge
│       ├── components/             # Shared components
│       ├── pages/
│       │   ├── HomePage.jsx        # Dashboard con métricas
│       │   ├── OrdersPage.jsx      # Lista de órdenes/facturas
│       │   └── SettingsPage.jsx    # Config Facturante (empresa, hash, etc.)
│       ├── hooks/
│       │   └── useAuthFetch.js     # fetch wrapper con session token
│       └── utils/
│
├── extensions/                     # Shopify Extensions (Preact + Web Components)
│   ├── admin-print/                # BFS 5.9.1 — Print invoice from order detail
│   │   ├── shopify.extension.toml
│   │   ├── package.json
│   │   ├── src/
│   │   │   └── PrintActionExtension.jsx
│   │   └── locales/
│   │       ├── es.default.json
│   │       └── en.json
│   ├── facturante-action/          # Generate invoice action from order detail
│   │   ├── shopify.extension.toml
│   │   ├── package.json
│   │   ├── src/
│   │   │   └── ActionExtension.jsx
│   │   └── locales/
│   │       ├── es.default.json
│   │       └── en.json
│   └── checkout-dni/               # NUEVO — Campo DNI/CUIT en checkout (Plus only)
│       ├── shopify.extension.toml
│       ├── package.json
│       ├── src/
│       │   └── CheckoutDNI.jsx
│       └── locales/
│           ├── es.default.json
│           └── en.json
│
├── SHOPIFAC_SKILL.md               # ESTE ARCHIVO
├── CHECKOUT_DNI_GUIDE.md           # Guía legacy de workarounds DNI
├── facturante_crearcomprobante_spec.md  # Spec completa de la API Facturante
└── logs/                           # Winston logs (gitignored)
```

---

## 3. PRISMA SCHEMA

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Session {
  id            String    @id
  shop          String
  state         String
  isOnline      Boolean   @default(false)
  scope         String?
  expires       DateTime?
  accessToken   String?
  userId        BigInt?
  firstName     String?
  lastName      String?
  email         String?
  accountOwner  Boolean   @default(false)
  locale        String?
  collaborator  Boolean?  @default(false)
  emailVerified Boolean?  @default(false)
}

model Shop {
  id            String    @id @default(cuid())
  shopDomain    String    @unique
  accessToken   String
  status        String    @default("active")    // active | uninstalled
  empresa       String?                          // Facturante empresa ID
  usuario       String?                          // Facturante user
  hash          String?                          // Facturante API hash/password
  puntoVenta    String?   @default("1")          // Punto de venta AFIP
  autoInvoice   Boolean   @default(false)        // Auto-generate on order/paid
  lastAccessAt  DateTime  @default(now())
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  invoices      Invoice[]
}

model Invoice {
  id                      String    @id @default(cuid())
  shopId                  String
  shop                    Shop      @relation(fields: [shopId], references: [id])
  shopifyOrderId          String    @unique      // Shopify order numeric ID
  shopifyOrderNumber      String                 // Human-readable (#1001)
  customerName            String?
  customerEmail           String?
  totalAmount             Float
  status                  String    @default("pending")  // pending|processing|completed|failed
  facturanteInvoiceId     String?                // ID returned by Facturante API
  facturanteInvoiceNumber String?                // Comprobante number
  cae                     String?                // CAE from AFIP
  errorMessage            String?
  invoiceData             Json?                  // Full request payload sent to Facturante
  processedAt             DateTime?
  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt
}
```

---

## 4. FLUJO DE AUTENTICACION

### 4.1 OAuth Install Flow

```
Merchant clicks "Install" in App Store
  -> Shopify redirects to /api/auth?shop=xxx.myshopify.com
  -> server/index.js calls shopify.auth.begin()
  -> Shopify shows permission screen
  -> Shopify redirects to /api/auth/callback
  -> server/index.js calls shopify.auth.callback()
  -> PrismaSessionStorage saves session (Session table)
  -> Server creates/updates Shop record with accessToken
  -> Redirect to app home (embedded in admin)
```

### 4.2 Session Token Auth (embedded app requests)

```
Client (React in iframe) sends request to /api/settings
  -> App Bridge auto-injects session token in Authorization header
  -> server/middleware/auth.js:
      1. Extracts Bearer token from Authorization header
      2. jwt.verify(token, SHOPIFY_API_SECRET)
      3. Extracts shop domain from payload.dest
      4. Sets req.shopDomain = hostname
      5. next()
  -> Route handler uses req.shopDomain to query Shop table
```

### 4.3 Extension Auth (admin extensions)

```
Extension calls app backend:
  -> const token = await shopify.auth.getSessionToken();
  -> fetch('app:admin/api/invoices/print', {
       headers: { Authorization: `Bearer ${token}` }
     })
  -> Backend verifies JWT same as 4.2
```

### 4.4 Webhook Verification

```
Shopify sends POST to /webhooks/shopify/order-paid
  -> Raw body (NOT parsed JSON) via express.raw()
  -> HMAC-SHA256 verification:
      hash = createHmac('sha256', SHOPIFY_API_SECRET)
             .update(rawBody).digest('base64')
      timingSafeEqual(hash, x-shopify-hmac-sha256 header)
  -> Shop identified from x-shopify-shop-domain header
```

### 4.5 Auth Middleware Code

```javascript
// server/middleware/auth.js
const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.SHOPIFY_API_SECRET);
    const shopUrl = new URL(payload.dest);
    req.shopDomain = shopUrl.hostname;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = { verifyToken };
```

---

## 5. FACTURANTE — ROL Y FLUJO DE PDFs

### 5.1 Shopifac es un PUENTE

Shopifac NO genera PDFs. Shopifac NO envia emails de facturas. El flujo es:

```
Shopify (orden) -> Shopifac (mapeo datos) -> Facturante (genera PDF + envia email + AFIP)
```

### 5.2 Flujo Completo de Facturacion

```
1. Orden pagada en Shopify
2. Webhook orders/paid llega a /webhooks/shopify/order-paid
3. Server verifica HMAC, busca Shop, verifica autoInvoice=true
4. FacturanteMapper.mapShopifyToFacturante(orderData) mapea:
   - Datos del cliente (nombre, email, direccion, DNI/CUIT)
   - Items (descripcion, cantidad, precio, IVA)
   - Encabezado (tipo comprobante, punto de venta, fecha)
5. FacturanteService.crearComprobante() arma SOAP XML y envia a Facturante
6. Facturante responde con IdComprobante (async, se procesa en background)
7. Server guarda Invoice con status='processing', facturanteInvoiceId=ID
8. Facturante procesa contra AFIP, genera PDF, envia email al cliente
9. Facturante llama al webhook /webhooks/facturante con resultado:
   - Si autorizado: CAE, numero de comprobante
   - Si rechazado: errores
10. Server actualiza Invoice.status a 'completed' o 'failed'
```

### 5.3 Print Action — Que mostrar si NO hay PDF local

Para el admin print action (BFS 5.9.1), dado que Facturante genera los PDFs:

**Solucion: Generar HTML server-side** con los datos del Invoice record en la DB. El endpoint `/api/invoices/print?orderId=xxx` genera una pagina HTML formateada como factura. El `<s-admin-print-action src="...">` apunta a ese HTML. El merchant ve un preview e imprime desde el browser.

### 5.4 Endpoint Print (server/routes/print.js)

```javascript
const express = require('express');
const router = express.Router();
const prisma = require('../models/prisma');

router.get('/', async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) return res.status(400).send('<h1>Falta orderId</h1>');

    const numericId = orderId.includes('/') ? orderId.split('/').pop() : orderId;

    const invoice = await prisma.invoice.findUnique({
      where: { shopifyOrderId: numericId },
      include: { shop: true },
    });

    if (!invoice) {
      return res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>No hay factura generada</h2>
        <p>Genera la factura desde "Mas acciones" > "Generar Factura".</p>
      </body></html>`);
    }

    const data = invoice.invoiceData || {};
    const cliente = data.cliente || {};
    const items = data.items || [];

    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Factura ${invoice.facturanteInvoiceNumber || 'Pendiente'}</title>
      <style>
        body{font-family:-apple-system,sans-serif;padding:20px;color:#333}
        .header{display:flex;justify-content:space-between;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:20px}
        table{width:100%;border-collapse:collapse;margin:20px 0}
        th{background:#f5f5f5;text-align:left;padding:8px;border:1px solid #ddd}
        td{padding:8px;border:1px solid #ddd}
        .total{text-align:right;font-size:1.2em;font-weight:bold;margin-top:20px}
        .cae{margin-top:20px;padding:10px;background:#f5f5f5;font-size:0.9em}
        @media print{body{padding:0}}
      </style></head><body>
      <div class="header"><div>
        <h1>Factura Electronica</h1>
        <p><strong>Cliente:</strong> ${cliente.nombre || invoice.customerName || 'N/A'}</p>
        <p><strong>${cliente.tipo_documento || 'Doc'}:</strong> ${cliente.nro_documento || 'N/A'}</p>
        <p><strong>Email:</strong> ${invoice.customerEmail || 'N/A'}</p>
      </div><div style="text-align:right">
        <p><strong>Comprobante:</strong> ${invoice.facturanteInvoiceNumber || 'Pendiente'}</p>
        <p><strong>Orden:</strong> ${invoice.shopifyOrderNumber}</p>
        <p><strong>Estado:</strong> ${invoice.status}</p>
        <p><strong>Fecha:</strong> ${invoice.processedAt ? new Date(invoice.processedAt).toLocaleDateString('es-AR') : 'Pendiente'}</p>
      </div></div>
      <table><thead><tr><th>Descripcion</th><th>Cant.</th><th>P.Unit.</th><th>IVA</th><th>Total</th></tr></thead>
      <tbody>${items.map(i => `<tr><td>${i.descripcion||i.Detalle||''}</td><td>${i.cantidad||i.Cantidad||1}</td><td>$${Number(i.precio_unitario||i.PrecioUnitario||0).toFixed(2)}</td><td>${i.alicuota_iva||i.IVA||21}%</td><td>$${Number(i.Total||0).toFixed(2)}</td></tr>`).join('')}</tbody></table>
      <div class="total">Total: $${invoice.totalAmount.toFixed(2)}</div>
      ${invoice.cae ? `<div class="cae"><strong>CAE:</strong> ${invoice.cae}<br><small>Comprobante autorizado por AFIP</small></div>` : ''}
    </body></html>`);
  } catch (error) {
    res.status(500).send('<h1>Error</h1><p>' + error.message + '</p>');
  }
});

module.exports = router;
```

---

## 6. BUILT FOR SHOPIFY — REQUISITOS COMPLETOS

### 6.1 Prerrequisitos

- [ ] App listada en Shopify App Store
- [ ] Cumplir requisitos App Store
- [ ] Min 50 instalaciones netas de shops activos en planes pagos
- [ ] Min 5 reviews
- [ ] Rating minimo reciente aceptable
- [ ] Partner standing sin infracciones

### 6.2 Performance

- **LCP** <= 2.5s (p75, ultimos 28 dias, min 100 calls)
- **CLS** <= 0.1
- **INP** <= 200ms
- Storefront: no reducir Lighthouse > 10 puntos (Shopifac no inyecta scripts -> OK)

### 6.3 Integration

- App embebida con App Bridge latest
- Workflows primarios dentro de Shopify admin
- Sign-up seamless (session tokens, sin login adicional)
- Homepage con metricas y estado
- Settings de Facturante dentro de la app embebida
- Clean uninstallation (NO Asset API)

### 6.4 Design — Familiar

- Polaris components, colores y spacing consistentes con admin
- `<s-app-nav>` para nav integrada
- Contextual Save Bar en formularios
- Modals con `<s-modal>` (heading + action slots)
- Mobile responsive
- App name conciso (no trunca en nav)
- Sub-paginas con boton back

### 6.5 Design — Helpful

- Onboarding guiado, conciso, dismissible
- Error messages: rojos, contextuales, NO auto-dismiss, NO antes de interaccion
- Homepage con metricas (no solo contenido estatico)
- Logical actions: primary = accion mas logica

### 6.6 Design — User-friendly

- NO false claims, NO pressure, NO distractions
- Ads/upgrades dismissibles (no reaparecen)
- Premium features: disabled visualmente + label plan requerido
- Plus features: ocultas para non-Plus
- NO impersonate Shopify

### 6.7 Requisitos Especificos — Invoices and Receipts (BFS 5.9) CRITICO

Tu app DEBE usar admin print action extensions:

1. `admin.order-details.print-action.render` -> Print desde detalle de orden
2. `admin.order-index.selection-print-action.render` -> Print desde lista (bulk)

**Ambos targets obligatorios. 1 target por extension -> 2 extensions separadas.**

---

## 7. CHECKOUT UI EXTENSION — Campo DNI/CUIT

### 7.1 Restriccion: Solo Shopify Plus

`purchase.checkout.block.render` requiere Plus + checkout editor.

| Plan | Solucion DNI/CUIT |
|---|---|
| **Plus** | Checkout UI Extension con campo nativo |
| **No-Plus** | Campo "Empresa" renombrado (instruccion en onboarding) |

### 7.2 Framework y Limites

- API: `2026-01`, Framework: **Preact** (NO React)
- Components: Polaris Web Components (s-tags)
- Global: `shopify` object
- Bundle limit: **64 KB**

### 7.3 Extension Config

```toml
# extensions/checkout-dni/shopify.extension.toml
api_version = "2026-01"

[[extensions]]
name = "t:name"
handle = "shopifac-checkout-dni"
type = "ui_extension"

[[extensions.targeting]]
target = "purchase.checkout.block.render"
module = "./src/CheckoutDNI.jsx"

[extensions.capabilities]
api_access = true

[extensions.metafields]
  [[extensions.metafields.entries]]
  namespace = "$app:dni-cuit"
  key = "value"
  [[extensions.metafields.entries]]
  namespace = "$app:dni-cuit"
  key = "type"
```

### 7.4 CheckoutDNI.jsx

```jsx
import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';

const NS = '$app:dni-cuit';

export default function extension() {
  render(<CheckoutDNI />, document.body);
}

function CheckoutDNI() {
  const [docType, setDocType] = useState('DNI');
  const [docValue, setDocValue] = useState('');
  const [error, setError] = useState('');
  const [needsInvoice, setNeedsInvoice] = useState(false);

  useEffect(() => {
    const mfs = shopify.metafields.value;
    if (mfs) {
      const existing = mfs.find(m => m.namespace === NS && m.key === 'value');
      if (existing?.value) { setDocValue(existing.value); setNeedsInvoice(true); }
    }
  }, []);

  const validate = (type, value) => {
    const c = value.replace(/[-\s.]/g, '');
    if (!c) return '';
    if (type === 'DNI') return /^\d{7,8}$/.test(c) ? '' : 'El DNI debe tener 7 u 8 digitos';
    return /^\d{10,11}$/.test(c) ? '' : `El ${type} debe tener 10 u 11 digitos`;
  };

  const save = async (key, value) => {
    await shopify.applyMetafieldChange({ type: 'updateMetafield', namespace: NS, key, valueType: 'string', value });
  };

  const remove = async (key) => {
    await shopify.applyMetafieldChange({ type: 'removeMetafield', namespace: NS, key });
  };

  const handleDoc = async (value) => {
    setDocValue(value);
    const err = validate(docType, value);
    setError(err);
    if (!err && value) {
      await save('value', value.replace(/[-\s.]/g, ''));
      await save('type', docType);
    }
  };

  const handleToggle = async (checked) => {
    setNeedsInvoice(checked);
    if (!checked) { await remove('value'); await remove('type'); setDocValue(''); setError(''); }
  };

  return (
    <s-section>
      <s-checkbox checked={needsInvoice} onChange={(e) => handleToggle(e.target.checked)}>
        {shopify.i18n.translate('needsInvoice')}
      </s-checkbox>
      {needsInvoice && (
        <s-stack direction="block" gap="base">
          <s-select label={shopify.i18n.translate('docType')} value={docType}
            onChange={(e) => { setDocType(e.target.value); if (docValue) setError(validate(e.target.value, docValue)); }}>
            <option value="DNI">DNI</option>
            <option value="CUIL">CUIL</option>
            <option value="CUIT">CUIT</option>
          </s-select>
          <s-text-field label={`${shopify.i18n.translate('docNumber')} (${docType})`} value={docValue}
            onInput={(e) => handleDoc(e.target.value)} error={error || undefined} type="text" autocomplete="off" />
        </s-stack>
      )}
    </s-section>
  );
}
```

### 7.5 Lectura del Metafield en Backend

```javascript
// En webhook orders/paid — leer metafield via GraphQL
async function getDniCuitFromOrder(session, orderId) {
  const client = new shopify.clients.Graphql({ session });
  const res = await client.request(`
    query($id: ID!) {
      order(id: $id) {
        metafield(namespace: "$app:dni-cuit", key: "value") { value }
        docType: metafield(namespace: "$app:dni-cuit", key: "type") { value }
      }
    }
  `, { variables: { id: `gid://shopify/Order/${orderId}` } });
  return {
    dniCuit: res.data?.order?.metafield?.value || '',
    docType: res.data?.order?.docType?.value || '',
  };
}

// Fallback non-Plus: campo company
function getDniCuitFallback(order) {
  return order.billing_address?.company || order.shipping_address?.company || '';
}
```

### 7.6 Mapeo TipoDocumento -> Facturante

```javascript
// CUIDADO: codigos Facturante != codigos AFIP
function mapearTipoDocumento(docType, dniCuit) {
  if (!dniCuit || !dniCuit.trim()) return 13; // Sin identificar
  const c = dniCuit.replace(/[-\s.]/g, '');
  switch (docType?.toUpperCase()) {
    case 'CUIT': return 1;
    case 'CUIL': return 7;
    case 'DNI':  return 4;
    default:
      if (c.length === 11) return 1;
      if (c.length <= 8) return 4;
      return 13;
  }
}
```

---

## 8. ADMIN PRINT ACTION EXTENSION (BFS 5.9.1)

### 8.1 Extension Individual (order detail)

```toml
# extensions/admin-print/shopify.extension.toml
api_version = "2026-01"
[[extensions]]
name = "t:name"
handle = "shopifac-print-invoice"
type = "ui_extension"
[[extensions.targeting]]
module = "./src/PrintActionExtension.jsx"
target = "admin.order-details.print-action.render"
```

```jsx
// PrintActionExtension.jsx
import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';

export default function extension() { render(<PrintInvoice />, document.body); }

function PrintInvoice() {
  const [loading, setLoading] = useState(true);
  const [printUrl, setPrintUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const orderId = shopify.data.value?.selected?.[0]?.id;
        if (!orderId) { setError('No se pudo identificar la orden'); setLoading(false); return; }
        const token = await shopify.auth.getSessionToken();
        const nid = orderId.includes('/') ? orderId.split('/').pop() : orderId;
        const res = await fetch(`app:admin/api/invoices/status/${nid}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.exists) setPrintUrl(`app:admin/api/invoices/print?orderId=${nid}`);
        else setError('No hay factura generada. Generala desde "Mas acciones" > "Generar Factura".');
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <s-admin-print-action><s-text>Cargando factura...</s-text></s-admin-print-action>;
  if (error) return <s-admin-print-action><s-banner status="warning">{error}</s-banner></s-admin-print-action>;
  return <s-admin-print-action src={printUrl} />;
}
```

### 8.2 Extension Bulk (order index) — extension separada

```toml
# extensions/admin-print-bulk/shopify.extension.toml
api_version = "2026-01"
[[extensions]]
name = "t:name"
handle = "shopifac-print-invoice-bulk"
type = "ui_extension"
[[extensions.targeting]]
module = "./src/PrintActionBulk.jsx"
target = "admin.order-index.selection-print-action.render"
```

Logica similar, itera `shopify.data.value?.selected` (array de IDs).

---

## 9. ORDER ACTION EXTENSION — Generar Factura

```toml
# extensions/facturante-action/shopify.extension.toml
api_version = "2026-01"
[[extensions]]
name = "t:name"
handle = "shopifac-generate-invoice"
type = "ui_extension"
[[extensions.targeting]]
module = "./src/ActionExtension.jsx"
target = "admin.order-details.action.render"
```

Modal con boton "Generar Factura" -> POST `app:admin/api/invoices/generate` -> success/error.

---

## 10. POLARIS WEB COMPONENTS — REFERENCIA RAPIDA (2026-01)

### Checkout Extensions

| Componente | Uso |
|---|---|
| `<s-text>` | Texto (appearance: critical/success/subdued) |
| `<s-heading>` | Titulos |
| `<s-text-field>` | Input (label, value, error, onInput, onChange) |
| `<s-select>` | Dropdown (con `<option>` hijos) |
| `<s-checkbox>` | Checkbox (checked, onChange) |
| `<s-button>` | Boton (variant: primary/secondary) |
| `<s-banner>` | Banners (status: info/success/warning/critical) |
| `<s-stack>` | Layout (direction: inline/block, gap) |
| `<s-section>` | Seccion semantica |

### Admin Extensions

| Componente | Uso |
|---|---|
| `<s-admin-action>` | Wrapper admin actions |
| `<s-admin-print-action>` | Wrapper print actions (src=URL del doc) |

### Global `shopify` Object

```javascript
// Signals (Preact auto re-render):
shopify.metafields.value      shopify.cost.value
shopify.shippingAddress.value  shopify.buyerIdentity.value
shopify.cartLines.value

// Methods:
shopify.applyMetafieldChange(change)
shopify.applyAttributeChange(change)
shopify.close()
shopify.auth.getSessionToken()
shopify.i18n.translate('key')
```

---

## 11. TESTING Y DEPLOYMENT

### 11.1 Desarrollo Local

```bash
# Requisitos: Node >= 20, Shopify CLI >= 3.85.3
shopify app dev
# Inicia tunnel, compila extensions, genera shopify.d.ts, abre app en dev store
```

### 11.2 Testing Checkout Extension

- Dev store DEBE tener Plus (feature preview)
- Settings > Checkout > Customize > agregar block "DNI/CUIT para Factura"
- O usar URL param: `?extension_point=purchase.checkout.block.render`

### 11.3 Testing Admin Extensions

- `shopify app dev` las registra automaticamente
- Orders > seleccionar orden > "Print" (print action) / "More actions" (order action)

### 11.4 Deploy

```bash
shopify app deploy
# Compila extensions, verifica < 64 KB, sube a Shopify CDN
```

### 11.5 Deploy Backend (Railway)

- Railway auto-deploy desde Git
- Build: `npx prisma generate && cd client && npm install && npm run build`
- Start: `npx prisma db push --skip-generate && node server/index.js`

### 11.6 Verificar Bundle Size

```bash
# En output de shopify app deploy:
# "Extension shopifac-checkout-dni: 23.4 KB (limit: 64 KB)" OK
# Si > 64 KB: eliminar deps innecesarias de la extension
```

---

## 12. VARIABLES DE ENTORNO

```bash
SHOPIFY_API_KEY=ddb03a81b1ffb2422828a5e3e5d8f177
SHOPIFY_API_SECRET=<secret del Partner Dashboard>
SHOPIFY_APP_URL=https://shopify-facturante-saas-production-d49a.up.railway.app
SCOPES=read_customers,read_orders,write_orders,read_products
DATABASE_URL=postgresql://user:pass@host:port/db
NODE_ENV=production
PORT=3000
```

Scope `read_all_orders` puede ser necesario para ordenes > 60 dias (print action).

---

## 13. PLAN DE EJECUCION POR FASES

### Fase 1 — Fundacion BFS
1. App Bridge latest en `<head>`, `<s-app-nav>`, Contextual Save Bar
2. HomePage con metricas, onboarding guiado, error handling rojo/contextual
3. Mobile responsive

### Fase 2 — Print Actions (BFS 5.9.1 OBLIGATORIO)
4. Extension `admin.order-details.print-action.render`
5. Extension `admin.order-index.selection-print-action.render`
6. Endpoint `/api/invoices/print` (HTML server-side)

### Fase 3 — Checkout DNI/CUIT (Plus)
7. Extension `purchase.checkout.block.render`
8. Metafields `$app:dni-cuit`, lectura en webhook, fallback company

### Fase 4 — Order Action
9. Extension `admin.order-details.action.render`

### Fase 5 — Polish & Submit
10. Web Vitals check, design audit, 50 installs + 5 reviews, aplicar BFS

---

## 14. ERRORES CONOCIDOS

- **Facturante TipoDocumento**: DNI=1, CUIT=6, CUIL=7, Sin identificar/CF=13. Ver spec completa en `facturante_crearcomprobante_spec.md`.
- **Bundle 64 KB**: Preact + Polaris web components cargan desde CDN, NO se bundlean.
- **1 target por print extension**: individual y bulk son extensions separadas.
- **Metafields**: namespace `$app:namespace` para app-owned.
- **Railway**: URL interna no resuelve localmente, usar URL publica.
- **Auth 401**: verificar access token en tabla Shop, session tokens expiran.
- **Facturante genera PDFs**: Shopifac solo mapea y envia. Print action usa HTML generado.

---

## 15. URLS DE REFERENCIA

| Recurso | URL |
|---|---|
| BFS Requirements | https://shopify.dev/docs/apps/launch/built-for-shopify/requirements |
| Checkout UI Extensions 2026-01 | https://shopify.dev/docs/api/checkout-ui-extensions/latest |
| Polaris Web Components | https://shopify.dev/docs/api/checkout-ui-extensions/latest/polaris-web-components |
| Using Polaris Components | https://shopify.dev/docs/api/checkout-ui-extensions/latest/using-polaris-components |
| Upgrading to 2026-01 | https://shopify.dev/docs/api/checkout-ui-extensions/latest/upgrading-to-2026-01 |
| Admin Print Action | https://shopify.dev/docs/apps/build/admin/actions-blocks/build-admin-print-action |
| Admin Action | https://shopify.dev/docs/apps/build/admin/actions-blocks/build-admin-action |
| Checkout Custom Field | https://shopify.dev/docs/apps/build/checkout/fields-banners/add-field |
| Facturante API | https://www.facturante.com/Developers/CrearComprobante |
| Facturante Spec (local) | facturante_crearcomprobante_spec.md |

---

## 16. INSTRUCCIONES PARA CLAUDE CODE

1. **Lee este archivo primero** antes de tocar extensions o codigo BFS.
2. **Lee `facturante_crearcomprobante_spec.md`** antes de tocar facturacion.
3. **Preact + Polaris Web Components** (s-tags) para TODAS las extensions. NUNCA React.
4. **64 KB limit** por bundle. No instalar deps innecesarias en extensions.
5. **Global `shopify` object**, no callbacks ni hooks legacy.
6. **Metafields** namespace `$app:dni-cuit`.
7. **Print Actions = 1 target por extension** -> separar individual y bulk.
8. **Checklist design BFS** (seccion 6.4-6.6) en cada cambio de UI.
9. **NO Asset API** para temas.
10. **Errores en rojo**, contextuales, sin auto-dismiss.
11. **Facturante genera PDFs** -> print action usa HTML server-side.
12. **Scopes actuales**: `read_customers,read_orders,write_orders,read_products`. Agregar `read_all_orders` si necesario.
13. **PowerShell here-strings** (`@'...'@ | Set-Content`) cuando Jota lo pida.
14. **Paso a paso**: Jota prefiere avanzar paso a paso y esperar OK.
