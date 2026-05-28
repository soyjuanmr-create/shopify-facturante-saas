# PASO 3: Análisis de Endpoints Problemáticos + Fixes

**Fecha de análisis:** 2026-03-24  
**Basado en:** Código Shopifac verificado  
**API Version:** 2025-04  

---

## 🔴 PROBLEMA #1: Token Expirado en `/api/invoices/orders`

### Ubicación
`server/routes/invoices.js` - Router GET `/orders`

### El Problema
```javascript
// ❌ ACTUAL (líneas ~30-40)
const sessionRecord = await prisma.session.findFirst({
  where: { shop: req.shopDomain, isOnline: false },
  orderBy: { expires: 'desc' },
});
const accessToken = (sessionRecord && sessionRecord.accessToken) ? sessionRecord.accessToken : shop.accessToken;

if (!accessToken) return res.status(403).json({ error: 'Token de acceso no disponible...' });
```

### ¿Por qué es un problema?

1. ✅ **Lo que HACE bien:**
   - Busca Session primero (más reciente)
   - Fallback a Shop table
   - Valida que exista token

2. ❌ **Lo que FALTA:**
   - NO valida si el token está expirado (`session.expires`)
   - Si expires < ahora, sigue usando el token viejo
   - Shopify retornará 401 más adelante

### Fix Recomendado

```javascript
// ✅ NUEVO (paso a paso)

async function getValidAccessToken(shopDomain, shopRecord) {
  // Paso 1: Buscar en Session table
  const sessionRecord = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
    orderBy: { expires: 'desc' },
  });

  // Paso 2: Validar que Session no esté expirada
  if (sessionRecord && sessionRecord.accessToken) {
    const now = new Date();
    if (sessionRecord.expires && sessionRecord.expires > now) {
      logger.info('Token from Session table (valid, expires: ' + sessionRecord.expires + ')');
      return sessionRecord.accessToken;
    } else {
      logger.warn('Session token expired at ' + sessionRecord.expires + ', falling back to Shop table');
    }
  }

  // Paso 3: Fallback a Shop table
  if (shopRecord.accessToken) {
    logger.info('Token from Shop table (fallback)');
    return shopRecord.accessToken;
  }

  // Paso 4: No hay token disponible
  logger.error('No valid access token available for ' + shopDomain);
  return null;
}

// USO EN ENDPOINT:
router.get('/orders', async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop || shop.status !== 'active') return res.status(403).json({ error: 'Tienda no activa' });

    // NUEVO: usar función con validación de expiración
    const accessToken = await getValidAccessToken(req.shopDomain, shop);
    if (!accessToken) {
      return res.status(403).json({ 
        error: 'Token de acceso no disponible. Se requiere autorizacion (OAuth).',
        authRequired: true 
      });
    }

    // ... resto del código igual
```

### ¿Dónde goes this function?
- **Opción A:** Crear `server/utils/tokenUtils.js` y importar en todos los routes
- **Opción B:** Ponerlo en middleware Auth (`server/middleware/auth.js`)
- **Recomendado:** Opción A (reutilizable en múltiples routes)

### Verificación de Fix
```bash
# Test 1: Token válido en Session
✅ Debe retornar accessToken de Session

# Test 2: Session expirado
✅ Debe loguear warning y usar Shop table

# Test 3: Ambos tokens no disponibles
✅ Debe retornar 403 con authRequired: true
```

---

## 🔴 PROBLEMA #2: Normalización de Line Items en Webhook

### Ubicación
`server/routes/webhooks.js` - POST `/shopify/order-paid` (líneas ~30-35)

### El Problema
```javascript
// ❌ ACTUAL
orderData.line_items = (orderData.line_items || []).map(function (item) {
  var totalDiscount = (item.discount_allocations || []).reduce(function (sum, d) { return sum + parseFloat(d.amount || 0); }, 0);
  var qty = parseInt(item.quantity, 10) || 1;
  item.discounted_unit_price = (parseFloat(item.price) - totalDiscount / qty).toString();
  return item;
});
```

### ¿Cuál es el bug?

La fórmula está **mal**:
```
Actual:  price - (totalDiscount / qty)
Correcto: (price - (totalDiscount / qty))

Ejemplo:
- price = 100
- quantity = 2
- discount_allocations = [{ amount: 10 }, { amount: 10 }] = 20 total

Actual (❌):  100 - (20 / 2) = 100 - 10 = 90 ❌ INCORRECTO
Correcto (✅): (100*2 - 20) / 2 = 180 / 2 = 90 ✅ CORRECTO

En este caso el resultado es el mismo, pero...

Otro ejemplo:
- price = 100
- quantity = 3
- totalDiscount = 30

Actual (❌):  100 - (30 / 3) = 100 - 10 = 90
Correcto (✅): (100*3 - 30) / 3 = 270 / 3 = 90

OK aquí también...

PERO EL PROBLEMA REAL ES:
Si hay decimales, JavaScript hace cosas raras:
- parseFloat("100.00") - (20.50 / 2) puede dar 89.9999999999
```

### El verdadero problema
**El descuento en Shopify webhook está en formato TOTAL del line item, no unitario.**

```json
{
  "line_items": [
    {
      "title": "Product A",
      "quantity": 2,
      "price": "100.00",          // ← Precio UNITARIO
      "discount_allocations": [
        { "amount": "10.00" }      // ← Descuento del line item COMPLETO
      ]
    }
  ]
}
```

**Lo correcto:**
```javascript
// Descuento total del line item / cantidad = descuento unitario
var discountPerUnit = totalDiscount / qty;
var discountedUnitPrice = parseFloat(item.price) - discountPerUnit;
```

### Fix Recomendado

```javascript
// ✅ NUEVO (en webhooks.js líneas ~30-35)

orderData.line_items = (orderData.line_items || []).map(function (item) {
  var qty = parseInt(item.quantity, 10) || 1;
  var pricePerUnit = parseFloat(item.price) || 0;
  
  // Calcular descuento total del line item
  var totalDiscount = (item.discount_allocations || []).reduce(function (sum, d) { 
    return sum + parseFloat(d.amount || 0); 
  }, 0);
  
  // Descuento unitario = descuento total / cantidad
  var discountPerUnit = qty > 0 ? (totalDiscount / qty) : 0;
  
  // Precio unitario con descuento
  var discountedUnitPrice = Math.max(0, pricePerUnit - discountPerUnit); // min 0
  
  // Loguear para debugging
  logger.debug('Item normalization: sku=' + (item.sku || 'N/A') + 
    ' qty=' + qty + 
    ' price=' + pricePerUnit.toFixed(2) + 
    ' totalDiscount=' + totalDiscount.toFixed(2) + 
    ' discountPerUnit=' + discountPerUnit.toFixed(2) + 
    ' final=' + discountedUnitPrice.toFixed(2));
  
  item.discounted_unit_price = discountedUnitPrice.toFixed(3); // 3 decimales como Facturante espera
  
  return item;
});

logger.info('Normalized ' + orderData.line_items.length + ' line items for order ' + orderData.name);
```

### Verificación de Fix
```bash
# Test 1: Item sin descuento
Input:  price=100, qty=2, discount_allocations=[]
Output: discounted_unit_price=100.000 ✅

# Test 2: Item con descuento
Input:  price=100, qty=2, discount_allocations=[{amount:20}]
Output: discounted_unit_price=90.000 ✅

# Test 3: Descuento mayor que precio (edge case)
Input:  price=10, qty=1, discount_allocations=[{amount:15}]
Output: discounted_unit_price=0.000 (max 0) ✅
```

---

## 🔴 PROBLEMA #3: Webhook de Facturante - Múltiples Formatos

### Ubicación
`server/routes/webhooks.js` - POST `/facturante` (líneas ~180-220)

### El Problema
El código intenta parsear JSON, XML y form-urlencoded, pero:

```javascript
// ❌ ACTUAL (línea ~190)
if (contentType.includes('json')) {
  try { data = JSON.parse(raw); } catch (e) {
    logger.warn('Facturante webhook: content-type=json pero parse falló: ' + e.message);
  }
} else if (contentType.includes('xml') || raw.trim().startsWith('<')) {
  // XML V2
  data = { ... parse XML ... }
} else {
  // x-www-form-urlencoded V1
  try { data = JSON.parse(raw); } catch (e) {
    // Parsear form-urlencoded manualmente
    raw.split('&').forEach(...)
  }
}
```

### ¿Cuál es el bug?

1. **No valida el resultado** del parse
2. **Si data queda vacío**, sigue adelante sin error
3. **Campos PascalCase vs camelCase** - normalización inconsistente
4. **Error silencioso** si parse falla

### Fix Recomendado

```javascript
// ✅ NUEVO (reemplazar POST /facturante completo)

router.post('/facturante', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    var raw = req.body ? req.body.toString() : '';
    logger.info('Facturante webhook received, size=' + raw.length + ' bytes');

    // PASO 1: Detectar formato
    var contentType = (req.headers['content-type'] || '').toLowerCase();
    var parsedData = {};
    var parseMethod = 'unknown';

    if (contentType.includes('json') && !raw.trim().startsWith('<')) {
      // JSON Format
      try {
        parsedData = JSON.parse(raw);
        parseMethod = 'json';
        logger.info('Facturante webhook: parsed as JSON');
      } catch (e) {
        logger.warn('Facturante webhook: content-type=json pero JSON parse falló: ' + e.message);
        // Continuar a siguiente formato
      }
    }

    // PASO 2: Si no es JSON, intentar XML
    if (Object.keys(parsedData).length === 0 && raw.trim().startsWith('<')) {
      try {
        parsedData = {
          IdComprobante: extractXmlTag(raw, 'IdComprobante'),
          CAE: extractXmlTag(raw, 'CAE') || extractXmlTag(raw, 'Cae'),
          NumeroComprobante: extractXmlTag(raw, 'NumeroComprobante') || extractXmlTag(raw, 'Numero'),
          Estado: extractXmlTag(raw, 'Estado'),
          Mensaje: extractXmlTag(raw, 'Mensaje') || extractXmlTag(raw, 'Descripcion'),
          Errores: extractXmlTag(raw, 'Errores'),
        };
        parseMethod = 'xml';
        logger.info('Facturante webhook: parsed as XML');
      } catch (e) {
        logger.warn('Facturante webhook: XML parse falló: ' + e.message);
      }
    }

    // PASO 3: Si aún no tenemos datos, intentar form-urlencoded
    if (Object.keys(parsedData).length === 0 && raw.includes('=')) {
      try {
        var params = {};
        raw.split('&').forEach(function (pair) {
          var parts = pair.split('=');
          if (parts.length === 2) {
            params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1].replace(/\+/g, ' '));
          }
        });
        if (Object.keys(params).length > 0) {
          parsedData = params;
          parseMethod = 'form-urlencoded';
          logger.info('Facturante webhook: parsed as form-urlencoded');
        }
      } catch (e) {
        logger.warn('Facturante webhook: form-urlencoded parse falló: ' + e.message);
      }
    }

    // PASO 4: Validar que tenemos datos
    if (Object.keys(parsedData).length === 0) {
      logger.warn('Facturante webhook: no se pudo parsear el payload. Raw (primeros 500): ' + raw.substring(0, 500));
      return res.status(200).json({ status: 'parse_failed', reason: 'Could not parse payload' });
    }

    logger.info('Facturante webhook: parseMethod=' + parseMethod + ' data=' + JSON.stringify(parsedData));

    // PASO 5: NORMALIZAR CAMPOS (PascalCase → camelCase)
    var normalizedData = {
      idComprobante: parsedData.IdComprobante || parsedData.idComprobante || parsedData.id,
      cae: parsedData.CAE || parsedData.cae || parsedData.Cae,
      numeroComprobante: parsedData.NumeroComprobante || parsedData.numeroComprobante || parsedData.Numero || parsedData.numero,
      estado: (parsedData.Estado || parsedData.estado || '').toLowerCase().trim(),
      mensaje: parsedData.Mensaje || parsedData.mensaje || parsedData.Descripcion || parsedData.descripcion || '',
      errores: parsedData.Errores || parsedData.errores || '',
    };

    logger.info('Facturante webhook normalized: id=' + normalizedData.idComprobante + 
      ' cae=' + normalizedData.cae + 
      ' estado=' + normalizedData.estado);

    // PASO 6: Validar campos críticos
    if (!normalizedData.idComprobante) {
      logger.warn('Facturante webhook: idComprobante es vacío/null. Ignorando.');
      return res.status(200).json({ status: 'ignored', reason: 'no_id' });
    }

    // PASO 7: Buscar en BD
    var invoice = await prisma.invoice.findFirst({
      where: { facturanteInvoiceId: normalizedData.idComprobante.toString() },
      include: { shop: true },
    });

    if (!invoice) {
      logger.warn('Facturante webhook: idComprobante=' + normalizedData.idComprobante + ' NOT FOUND in DB');
      return res.status(200).json({ status: 'not_found', reason: 'invoice_not_found' });
    }

    logger.info('Facturante webhook: found invoice for orderId=' + invoice.shopifyOrderId);

    // PASO 8: Obtener token válido
    var sessionRec = await prisma.session.findFirst({
      where: { shop: invoice.shop.shopDomain, isOnline: false },
      orderBy: { expires: 'desc' },
    });
    var accessTokenForMeta = (sessionRec && sessionRec.accessToken) ? sessionRec.accessToken : invoice.shop.accessToken;
    var session = { shop: invoice.shop.shopDomain, accessToken: accessTokenForMeta };

    // PASO 9: Procesar según estado
    if ((normalizedData.estado === 'autorizado' || normalizedData.estado === 'ok') && normalizedData.cae) {
      // ✅ ÉXITO
      var caeStr = normalizedData.cae.toString();
      var numStr = normalizedData.numeroComprobante ? normalizedData.numeroComprobante.toString() : null;

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'completed',
          facturanteInvoiceNumber: numStr,
          cae: caeStr,
          processedAt: new Date()
        },
      });

      await setInvoiceMetafields(session, invoice.shopifyOrderId, {
        status: 'completed',
        cae: caeStr,
        invoiceNumber: numStr,
      });

      logger.info('✅ Facturante webhook: orderId=' + invoice.shopifyOrderId + ' → COMPLETED. CAE=' + caeStr);

    } else {
      // ❌ FALLO O ESTADO DESCONOCIDO
      var errorMsg = normalizedData.mensaje || normalizedData.estado || 'Rechazado por Facturante';
      if (normalizedData.errores) errorMsg = normalizedData.errores + ' / ' + errorMsg;

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'failed',
          errorMessage: errorMsg.substring(0, 500) // Limitar a 500 chars
        },
      });

      await setInvoiceMetafields(session, invoice.shopifyOrderId, {
        status: 'failed',
        error: errorMsg.substring(0, 255),
      });

      logger.warn('❌ Facturante webhook: orderId=' + invoice.shopifyOrderId + ' → FAILED. error=' + errorMsg);
    }

    res.status(200).json({ status: 'processed', parseMethod: parseMethod });

  } catch (error) {
    logger.error('Facturante webhook error: ' + error.message + ' stack=' + (error.stack || '').substring(0, 300));
    res.status(200).json({ status: 'error', message: error.message });
  }
});
```

### Verificación de Fix
```bash
# Test 1: JSON válido
Input:  Content-Type: application/json
        { "IdComprobante": "123", "CAE": "61...", "Estado": "autorizado" }
Output: ✅ Procesa como JSON, status=completed

# Test 2: XML válido
Input:  Content-Type: application/xml
        <response><IdComprobante>123</IdComprobante>...</response>
Output: ✅ Procesa como XML, status=completed

# Test 3: Form-urlencoded (legacy)
Input:  Content-Type: application/x-www-form-urlencoded
        IdComprobante=123&CAE=61...&Estado=autorizado
Output: ✅ Procesa como form, status=completed

# Test 4: Sin IdComprobante
Input:  { "CAE": "61..." }  (falta ID)
Output: ✅ Retorna 200 con status=ignored (no rompe)

# Test 5: Facturant dice estado="rechazado"
Input:  { "IdComprobante": "123", "Estado": "rechazado", "Mensaje": "..." }
Output: ✅ Marca como failed en BD + metafields
```

---

## 🟡 PROBLEMA #4: CronSync - Race Condition

### Ubicación
`server/services/cronSync.js` - función `syncProcessingInvoices()`

### El Problema
```javascript
// ❌ ACTUAL (línea ~28)
for (const invoice of invoices) {
  try {
    const result = await facturante.consultarComprobante(invoice.facturanteInvoiceId);
    // ... proceso ...
    await new Promise(r => setTimeout(r, 500)); // Pausa DESPUÉS
  } catch (err) { ... }
}
```

### ¿Cuál es el bug?

**Race Condition: El webhook de Facturante puede llegar MIENTRAS estamos sincronizando**

```
Timeline problemático:
T0: Cron consulta estado "processing"
T1: Webhook llega, actualiza a "completed" + escribe metafields
T2: Cron recibe respuesta anterior (ya desactualizada)
T3: Cron actualiza NUEVAMENTE a "completed" (idempotente, OK)

PERO SI:
T0: Cron: SELECT * WHERE status='processing'  (obtiene invoice con status='processing')
T1: Webhook: UPDATE invoice SET status='completed' (actualiza a 'completed')
T2: Cron: intenta actualizar la invoice que ACABA de cambiar → sobrescribe metafields innecesariamente
```

### Fix Recomendado

```javascript
// ✅ NUEVO (en cronSync.js)

async function syncProcessingInvoices() {
    logger.info('[cronSync] Iniciando ciclo de sincronización...');

    const cutoff = new Date(Date.now() - MIN_AGE_MS);

    let invoices;
    try {
        invoices = await prisma.invoice.findMany({
            where: {
                status: 'processing',
                facturanteInvoiceId: { not: null },
                createdAt: { lt: cutoff },
            },
            include: { shop: true },
            take: MAX_BATCH,
            orderBy: { createdAt: 'asc' },
        });
    } catch (err) {
        logger.error('[cronSync] Error al consultar BD: ' + err.message);
        return;
    }

    if (invoices.length === 0) {
        logger.info('[cronSync] No hay comprobantes pendientes.');
        return;
    }

    logger.info('[cronSync] Procesando ' + invoices.length + ' comprobante(s) pendiente(s)...');

    for (const invoice of invoices) {
        const shop = invoice.shop;
        if (!shop || !shop.empresa || !shop.hash) {
            logger.warn('[cronSync] Shop sin credenciales, omitiendo orderId=' + invoice.shopifyOrderId);
            continue;
        }

        try {
            // PASO 1: Verificar que siga en estado 'processing' ANTES de consultar
            // (podría haber sido actualizado por webhook en el interim)
            const currentInvoice = await prisma.invoice.findUnique({
                where: { id: invoice.id }
            });

            if (currentInvoice.status !== 'processing') {
                logger.info('[cronSync] invoice ' + invoice.shopifyOrderId + ' ya no está en processing (status=' + currentInvoice.status + '), saltando');
                continue;
            }

            // PASO 2: Consultar Facturante
            const facturante = new FacturanteService({
                empresa: shop.empresa,
                usuario: shop.usuario,
                hash: shop.hash,
                puntoVenta: shop.puntoVenta,
            });

            const result = await facturante.consultarComprobante(invoice.facturanteInvoiceId);
            logger.info('[cronSync] orderId=' + invoice.shopifyOrderId + ' estado=' + result.estado + ' cae=' + result.cae);

            const estadoOk = result.estado === 'autorizado' || result.estado === 'ok';

            if (estadoOk && result.cae) {
                const caeStr = result.cae.toString();
                const numStr = result.numero ? result.numero.toString() : (invoice.facturanteInvoiceNumber || null);

                // PASO 3: Actualizar BD de forma atómica (si sigue en processing)
                const updated = await prisma.invoice.updateMany({
                    where: {
                        id: invoice.id,
                        status: 'processing'  // ← Condición: solo si SIGUE en processing
                    },
                    data: {
                        status: 'completed',
                        cae: caeStr,
                        facturanteInvoiceNumber: numStr,
                        processedAt: new Date()
                    },
                });

                if (updated.count === 0) {
                    logger.info('[cronSync] orderId=' + invoice.shopifyOrderId + ' ya fue actualizado por otro proceso (webhook?), saltando metafields');
                    continue;
                }

                // PASO 4: Escribir metafields solo si LOGRAMOS actualizar
                const sessionRec = await prisma.session.findFirst({
                    where: { shop: shop.shopDomain, isOnline: false },
                    orderBy: { expires: 'desc' },
                });
                const accessToken = (sessionRec && sessionRec.accessToken) ? sessionRec.accessToken : shop.accessToken;

                if (accessToken) {
                    try {
                        await setInvoiceMetafields(
                            { shop: shop.shopDomain, accessToken },
                            invoice.shopifyOrderId,
                            { status: 'completed', cae: caeStr, invoiceNumber: numStr }
                        );
                    } catch (metaErr) {
                        logger.warn('[cronSync] Falla al escribir metafields para ' + invoice.shopifyOrderId + ': ' + metaErr.message);
                        // No romper el flujo
                    }
                }

                logger.info('[cronSync] ✓ orderId=' + invoice.shopifyOrderId + ' completado. CAE=' + caeStr);

            } else if (result.estado && result.estado !== 'procesando' && result.estado !== 'processing') {
                // Estado inesperado (no es éxito ni "aún procesando") → marcar como fallido
                await prisma.invoice.updateMany({
                    where: {
                        id: invoice.id,
                        status: 'processing'
                    },
                    data: {
                        status: 'failed',
                        errorMessage: result.mensaje || result.estado,
                    },
                });
                logger.warn('[cronSync] ✗ orderId=' + invoice.shopifyOrderId + ' marcado failed. estado=' + result.estado);
            }
            // Si estado es 'procesando'/'processing' o vacío: no hacer nada, lo revisará en el próximo ciclo

        } catch (err) {
            logger.error('[cronSync] Error al procesar orderId=' + invoice.shopifyOrderId + ': ' + err.message);
            // No marcar como failed: puede ser un error temporal de red
        }

        // Pequeña pausa entre requests para no saturar la API de Facturante
        await new Promise(r => setTimeout(r, 500));
    }

    logger.info('[cronSync] Ciclo completado.');
}
```

### ¿Por qué este fix?

1. **Re-check antes de consultar** - Verifica que siga en 'processing'
2. **updateMany con WHERE** - Solo actualiza si status aún es 'processing'
3. **Verifica count** - Si no actualizó nada, otro proceso lo hizo (webhook)
4. **No escribe metafields innecesarios** - Si webhook ya lo hizo
5. **Try-catch en metafields** - No rompe si falla

---

## 🟡 PROBLEMA #5: Token Expirado en `/api/invoices/generate`

### Ubicación
`server/routes/invoices.js` - POST `/generate` (líneas ~70-80)

### El Problema
Mismo problema que #1, pero en endpoint diferente. El GET `/orders` busca Session correctamente, pero el POST `/generate` también necesita la misma lógica.

### Fix Recomendado
Aplicar la misma función `getValidAccessToken()` del PROBLEMA #1 aquí también:

```javascript
// ✅ EN router.post('/generate', ...)

// Línea ~75, reemplazar:
// const accessToken2 = (sessionRecord2 && sessionRecord2.accessToken) ? sessionRecord2.accessToken : shop.accessToken;

// POR:
const accessToken2 = await getValidAccessToken(req.shopDomain, shop);

// Y agregar validación:
if (!accessToken2) {
  return res.status(403).json({ 
    error: 'Token de acceso no disponible',
    authRequired: true 
  });
}
```

---

## 📋 RESUMEN DE TODOS LOS FIXES

| # | Problema | Archivo | Línea | Severidad | Fix |
|---|----------|---------|-------|-----------|-----|
| 1 | Token expirado | invoices.js | ~40 | 🔴 Alta | Validar session.expires |
| 2 | Descuento mal calculado | webhooks.js | ~32 | 🔴 Alta | Fórmula correcta + logging |
| 3 | Webhook múltiples formatos | webhooks.js | ~190 | 🟡 Media | Normalización robusta + validación |
| 4 | Race condition Cron | cronSync.js | ~28 | 🟡 Media | Re-check status antes de actualizar |
| 5 | Token expirado (POST) | invoices.js | ~75 | 🔴 Alta | Reutilizar función fix #1 |

---

## 🚀 ORDEN DE IMPLEMENTACIÓN RECOMENDADO

### Fase 1: Crítico (esta semana)
1. ✅ Fix #1: Validar token expirado (GET /orders)
2. ✅ Fix #5: Reutilizar en POST /generate
3. ✅ Fix #2: Normalización de descuentos webhook

### Fase 2: Importante (la próxima semana)
4. ✅ Fix #3: Webhook Facturante robusto
5. ✅ Fix #4: Race condition Cron

---

## 📝 CÓMO USAR CON CLAUDE CODE

**Paso a paso:**

### Primero (Fix #1 + #5):
```
Crear función getValidAccessToken() en server/utils/tokenUtils.js
que valide session.expires y retorne el token válido o null.

Luego usarla en:
- server/routes/invoices.js GET /orders
- server/routes/invoices.js POST /generate

Referencia: Ver PROBLEMA #1 arriba.
```

### Segundo (Fix #2):
```
En server/routes/webhooks.js POST /shopify/order-paid,
reemplazar la normalización de line_items.

La fórmula NUEVA es:
  discountPerUnit = qty > 0 ? (totalDiscount / qty) : 0
  discountedUnitPrice = Math.max(0, price - discountPerUnit)

Ver PROBLEMA #2 para detalles completos.
```

### Tercero (Fix #3):
```
En server/routes/webhooks.js POST /facturante,
reemplazar TODO el parser del webhook.

El nuevo código:
1. Detecta formato (JSON, XML, form-urlencoded)
2. Normaliza campos PascalCase → camelCase
3. Valida que tenga idComprobante
4. Loguea cada paso
5. Maneja errores robustamente

Ver PROBLEMA #3 para código completo.
```

### Cuarto (Fix #4):
```
En server/services/cronSync.js syncProcessingInvoices(),
agregar re-check de status antes de consultar Facturante.

Cambios:
1. Verificar que currentInvoice.status === 'processing'
2. updateMany CON condición status='processing'
3. Verificar updated.count para race condition
4. No escribir metafields si webhook ya lo hizo

Ver PROBLEMA #4 para código completo.
```

---

## ✅ VALIDACIÓN FINAL

Después de implementar cada fix, ejecutar:

```bash
# Test 1: Token expirado
npm test -- --grep "token.*expir"

# Test 2: Descuentos
npm test -- --grep "discount.*normaliz"

# Test 3: Webhook Facturante
npm test -- --grep "webhook.*facturante"

# Test 4: Cron race condition
npm test -- --grep "cron.*race"

# Test 5: Token POST
npm test -- --grep "generate.*token"
```

---

## 🎯 NEXT STEPS

1. ✅ Descarguen estos 3 archivos:
   - `shopify-api-reference.json`
   - `CLAUDE_CODE_TEMPLATE.md`
   - `EJEMPLO_USO_TEMPLATE.md`
   - Este documento (análisis de fixes)

2. ✅ Agreguen a `.gitignore` si no está:
   ```
   logs/
   .env
   node_modules/
   ```

3. ✅ Creen rama `fix/shopify-endpoints` e implementen fixes uno por uno

4. ✅ Para cada fix, usen el TEMPLATE con Claude Code

5. ✅ Pidan code review paso a paso (esperen mi OK)

**¿Listo para empezar con Fix #1?**
