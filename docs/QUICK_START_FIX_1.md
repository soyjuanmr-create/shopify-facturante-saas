# 🚀 QUICK START: Implementar Fix #1 HOY

**Tiempo estimado:** 30 minutos  
**Dificultad:** 🟢 Fácil  
**Impacto:** 🔴 Crítico (evita 401 token expirado)

---

## ¿Qué es Fix #1?

Tu código busca el token de Shopify pero **NO valida si está expirado**.

```javascript
// ❌ ACTUAL
const sessionRecord = await prisma.session.findFirst(...);
const accessToken = sessionRecord?.accessToken || shop.accessToken;
// ⚠️ Si sessionRecord.expires < now, Shopify rechazará con 401
```

**Fix:** Validar que `session.expires > ahora` antes de usar el token.

---

## 5 PASOS PARA IMPLEMENTAR

### PASO 1: Crear archivo `server/utils/tokenUtils.js`

```javascript
// server/utils/tokenUtils.js

const logger = require('./logger');
const prisma = require('../models/prisma');

/**
 * Obtener access token válido (no expirado) para una tienda
 * 
 * Búsqueda en orden:
 * 1. Session table (más reciente, línea offline)
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
```

**✅ Verificar:** ¿Archivo creado en `server/utils/tokenUtils.js`?

---

### PASO 2: Actualizar `server/routes/invoices.js` - Endpoint GET `/orders`

Abre `server/routes/invoices.js` y reemplaza esto:

**BUSCA (líneas ~20-35):**
```javascript
const express = require('express');
const router = express.Router();
const prisma = require('../models/prisma');
const axios = require('axios');
// ... otros imports
```

**AGREGA ESTE IMPORT:**
```javascript
const { getValidAccessToken } = require('../utils/tokenUtils');
```

**LUEGO, BUSCA (líneas ~40-45):**
```javascript
router.get('/orders', async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop || shop.status !== 'active') return res.status(403).json({ error: 'Tienda no activa' });

    // ❌ VIEJO
    const sessionRecord = await prisma.session.findFirst({
      where: { shop: req.shopDomain, isOnline: false },
      orderBy: { expires: 'desc' },
    });
    const accessToken = (sessionRecord && sessionRecord.accessToken) ? sessionRecord.accessToken : shop.accessToken;

    logger.info('Orders: shop=' + req.shopDomain + ' sessionTable=' + (sessionRecord ? 'found,tok=' + (sessionRecord.accessToken || '').substring(0, 8) : 'NOT FOUND') + ' shopTable=tok=' + (shop.accessToken || '').substring(0, 8));

    if (!accessToken) return res.status(403).json({ error: 'Token de acceso no disponible. Se requiere autorizacion (OAuth).', authRequired: true });
```

**REEMPLAZA POR:**
```javascript
router.get('/orders', async (req, res) => {
  try {
    const shop = await prisma.shop.findUnique({ where: { shopDomain: req.shopDomain } });
    if (!shop || shop.status !== 'active') return res.status(403).json({ error: 'Tienda no activa' });

    // ✅ NUEVO - con validación de expiración
    const accessToken = await getValidAccessToken(req.shopDomain, shop);

    if (!accessToken) {
      return res.status(403).json({ 
        error: 'Token de acceso no disponible. Se requiere autorizacion (OAuth).', 
        authRequired: true 
      });
    }
```

**✅ Verificar:** ¿Reemplazada la sección en GET `/orders`?

---

### PASO 3: Actualizar `server/routes/invoices.js` - Endpoint POST `/generate`

**BUSCA (líneas ~75-85):**
```javascript
router.post('/generate', async (req, res) => {
  try {
    // ...
    const sessionRecord2 = await prisma.session.findFirst({
      where: { shop: shop.shopDomain, isOnline: false },
      orderBy: { expires: 'desc' },
    });
    const accessToken2 = (sessionRecord2 && sessionRecord2.accessToken) ? sessionRecord2.accessToken : shop.accessToken;
    if (!accessToken2) return res.status(403).json({ error: 'Token de acceso no disponible. Se requiere autorizacion (OAuth).', authRequired: true });
```

**REEMPLAZA POR:**
```javascript
router.post('/generate', async (req, res) => {
  try {
    // ...
    const accessToken2 = await getValidAccessToken(shop.shopDomain, shop);
    if (!accessToken2) {
      return res.status(403).json({ 
        error: 'Token de acceso no disponible. Se requiere autorizacion (OAuth).', 
        authRequired: true 
      });
    }
```

**✅ Verificar:** ¿Reemplazada la sección en POST `/generate`?

---

### PASO 4: Verificar que compila

```bash
# En la raíz del proyecto
node -c server/routes/invoices.js

# Debería retornar vacío (sin errores de sintaxis)
```

Si hay error, verifica que:
- ✅ El import está al inicio del archivo
- ✅ Los paréntesis y llaves están balanceados
- ✅ No hay comillas desapareadas

**✅ Verificar:** ¿Compila sin errores?

---

### PASO 5: Testear el cambio

#### Test Local (sin servidor corriendo)

```bash
# Verifica que el módulo se carga
node -e "const t = require('./server/utils/tokenUtils'); console.log(typeof t.getValidAccessToken)"

# Debería imprimir: function
```

#### Test con Servidor (si tienes DB local)

```bash
# Inicia el servidor
npm run dev

# En otra terminal, test el endpoint
curl -H "Authorization: Bearer token_falso" \
  http://localhost:3000/api/invoices/orders

# Debería retornar: { error: "Token de acceso no disponible", authRequired: true }
```

**✅ Verificar:** ¿Los tests pasan?

---

## ✅ CHECKLIST FINAL

- [ ] Creé `server/utils/tokenUtils.js`
- [ ] Agregué import en `server/routes/invoices.js`
- [ ] Reemplacé GET `/orders`
- [ ] Reemplacé POST `/generate`
- [ ] El código compila sin errores
- [ ] Testeé al menos localmente
- [ ] No rompí nada más (revisar otros imports)

---

## 🎯 QUÉ HACE ESTE FIX

### ANTES (❌)
```
Usuario: compra algo
Shopify: marca orden como pagada
Tu app: busca token de Session
       token existe pero EXPIRADO
Shopify: 401 "Invalid access token"
Usuario: NO VE su factura
```

### DESPUÉS (✅)
```
Usuario: compra algo
Shopify: marca orden como pagada
Tu app: busca token de Session
       valida que NO esté expirado
       si expiró → usa token de Shop
Shopify: 200 OK
Usuario: ✅ Ve su factura
```

---

## ❓ PROBLEMAS COMUNES

### "Error: Cannot find module '../utils/tokenUtils'"
**Solución:** Verifica que creaste el archivo en `server/utils/tokenUtils.js` (no en otro lugar)

### "asyncSession.expires is undefined"
**Solución:** Algunos registros viejos de Session podrían no tener expires. El código maneja esto: `if (expiresAt && expiresAt > now)`

### "Sigue retornando 401 de Shopify"
**Solución:** Podría ser que:
1. El token en BD está corrupto
2. Session expiró hace MUCHO tiempo
3. Tienda fue desinstalada

Loguea para debugging: `logger.info(...)` muestra qué token se usó

---

## 🚀 PRÓXIMO PASO

Una vez que esto funcione:
1. Haz commit: `git commit -m "fix: validar token expirado en /orders y /generate"`
2. Crea PR
3. Pide review
4. Una vez aprobado → Deploy a staging
5. Test en staging 
6. Deploy a producción

**Luego:** Vamos con Fix #2 (descuentos)

---

## 📞 ¿NECESITAS AYUDA?

Si algo no funciona:
1. Copia el error exacto
2. Verifica contra este documento
3. Revisa que los archivos estén en los lugares correctos
4. Loguea los valores intermedios

**Pregunta:** ¿A qué error te enfrentas específicamente?
