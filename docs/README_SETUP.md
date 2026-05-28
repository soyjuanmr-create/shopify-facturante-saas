# 📋 RESUMEN EJECUTIVO: Shopifac Claude Code Expert Setup

**Objetivo:** Configurar Claude Code como experto en apps Shopify SIN alucinaciones.

---

## 📦 ARCHIVOS GENERADOS (Paso 1-3)

### 1. `shopify-api-reference.json`
**¿Qué es?** Biblia de endpoints verificados contra tu código real  
**Contiene:**
- API endpoints exactos (GraphQL 2025-04)
- Queries y mutations verificadas
- Variables y respuestas esperadas
- Errores comunes + soluciones
- Patrones importantes (token, precios, IDs)

**Cuándo usarlo:** Siempre que hagas cambios a Shopify

---

### 2. `CLAUDE_CODE_TEMPLATE.md`
**¿Qué es?** Template de prompt para solicitar cambios a Claude Code  
**Contiene:**
- Estructura obligatoria para solicitudes
- Checklist post-código
- Validaciones requeridas
- Qué NO hacer
- Instrucciones paso a paso

**Cuándo usarlo:** SIEMPRE antes de pedir cambios a Claude Code

---

### 3. `EJEMPLO_USO_TEMPLATE.md`
**¿Qué es?** Ejemplo completo: cómo usar el template en la práctica  
**Contiene:**
- Scenario real (endpoint sync-status)
- Solicitud correcta vs incorrecta
- Cómo evaluar código de Claude Code
- Cómo pedir correcciones

**Cuándo usarlo:** Tu primera solicitud a Claude Code

---

### 4. `PASO_3_FIXES_DETALLADOS.md` (este documento)
**¿Qué es?** Análisis de 5 problemas en tu código actual  
**Contiene:**
- Problema + ubicación exacta
- ¿Por qué es un problema?
- Fix recomendado (código completo)
- Verificación de fix
- Orden de implementación

**Cuándo usarlo:** Para mejorar endpoints existentes

---

## 🎯 CÓMO USARLOS JUNTOS

### Escenario 1: Agregar NUEVO endpoint
```
1. Lee shopify-api-reference.json
   ↓
2. Copia CLAUDE_CODE_TEMPLATE.md
   ↓
3. Rellena los campos
   ↓
4. Pégalo en Claude Code
   ↓
5. Claude Code genera código
   ↓
6. Verifica contra shopify-api-reference.json
   ↓
7. Si no coincide → señala diferencia + pide corrección
```

### Escenario 2: Modificar endpoint EXISTENTE
```
1. Consulta PASO_3_FIXES_DETALLADOS.md
   ↓
2. Identifica el fix aplicable
   ↓
3. Copia el código del fix
   ↓
4. Rellena CLAUDE_CODE_TEMPLATE.md con el fix
   ↓
5. Solicita a Claude Code
   ↓
6. Verifica usando checklist del template
```

### Escenario 3: DEBUG de problema en producción
```
1. Consulta logs (busca errores Shopify)
   ↓
2. Identifica si es por token/descuento/webhook/etc
   ↓
3. Busca en PASO_3_FIXES_DETALLADOS.md
   ↓
4. Aplica el fix
   ↓
5. Usa template para solicitar a Claude Code
```

---

## 🚀 PLAN DE ACCIÓN INMEDIATO

### SEMANA 1: Implementar Fixes Críticos

#### Lunes-Martes: Fix #1 (Token expirado)
```
1. Crea server/utils/tokenUtils.js
2. Implementa getValidAccessToken()
3. Aplica en GET /orders + POST /generate
4. Test: Verifica que rechaza token expirado
```

**Solicitud a Claude Code:**
```
Crear función getValidAccessToken(shopDomain, shopRecord) 
en server/utils/tokenUtils.js que:
1. Busque en Session table (isOnline: false, más reciente)
2. Valide que session.expires > ahora
3. Si expirado o no existe, use Shop table
4. Retorne token válido o null
5. Loguee cuál fuente usó

Luego importarla en server/routes/invoices.js 
y usarla en GET /orders y POST /generate

Referencia: PASO_3_FIXES_DETALLADOS.md - PROBLEMA #1
```

#### Miércoles: Fix #2 (Descuentos)
```
1. Modifica webhooks.js POST /shopify/order-paid
2. Implementa normalización correcta de descuentos
3. Loguea cada item normalizado
4. Test: Verifica cálculo con descuentos
```

**Solicitud a Claude Code:**
```
En server/routes/webhooks.js POST /shopify/order-paid,
reemplaza la normalización de line_items.

Cambios:
1. discountPerUnit = totalDiscount / qty
2. discountedUnitPrice = max(0, price - discountPerUnit)
3. Loguea: sku, qty, price, discount, final
4. Usa .toFixed(3) para precisión

Referencia: PASO_3_FIXES_DETALLADOS.md - PROBLEMA #2
```

#### Jueves-Viernes: Fix #5 (Reutilizar token)
```
1. Aplica getValidAccessToken() a POST /generate
2. Test completo de flow
3. Deploy a staging
```

---

### SEMANA 2: Implementar Fixes Importantes

#### Lunes-Miércoles: Fix #3 (Webhook Facturante)
```
1. Reemplaza parser de webhook en webhooks.js POST /facturante
2. Soporta JSON, XML, form-urlencoded
3. Normaliza campos PascalCase → camelCase
4. Loguea cada paso
```

#### Jueves-Viernes: Fix #4 (Race condition Cron)
```
1. Modifica cronSync.js syncProcessingInvoices()
2. Re-check status antes de actualizar
3. updateMany CON condición
4. Verifica count para detectar race condition
```

---

## ✅ CHECKLIST: ANTES DE USAR CON CLAUDE CODE

- [ ] Descargué estos 4 archivos a mi proyecto
  - [ ] `shopify-api-reference.json`
  - [ ] `CLAUDE_CODE_TEMPLATE.md`
  - [ ] `EJEMPLO_USO_TEMPLATE.md`
  - [ ] `PASO_3_FIXES_DETALLADOS.md`

- [ ] Los agregué a `.gitignore` si son sensibles
  ```
  # .gitignore
  shopify-api-reference.json  # Opcional, pero buena idea
  CLAUDE_CODE_*.md            # Docs de referencia
  PASO_3_*.md
  ```

- [ ] Entiendo los 3 pasos:
  - [ ] Paso 1 = referencia verificada
  - [ ] Paso 2 = cómo solicitar cambios
  - [ ] Paso 3 = qué fixes necesita el código

- [ ] Estoy listo para implementar Fixes (Semana 1):
  - [ ] Fix #1: Token expirado ← PRIMERO
  - [ ] Fix #2: Descuentos
  - [ ] Fix #5: Reutilizar token

- [ ] Planeo Fixes Semana 2:
  - [ ] Fix #3: Webhook Facturante
  - [ ] Fix #4: Race condition Cron

---

## 🤖 PROMPT RECOMENDADO PARA CLAUDE CODE (Primera Solicitud)

```
Voy a hacer que seas experto en nuestra app Shopifac.

Aquí están los 4 archivos de referencia:
1. shopify-api-reference.json - endpoints verificados
2. CLAUDE_CODE_TEMPLATE.md - cómo solicitar cambios
3. EJEMPLO_USO_TEMPLATE.md - ejemplo práctico
4. PASO_3_FIXES_DETALLADOS.md - problemas + soluciones

IMPORTANTE:
- Cada solicitud que recibas sobre Shopify 
  debe ser en formato del TEMPLATE
- Verifica TODO contra shopify-api-reference.json
- Si generas query/mutation que NO coincida con el archivo de referencia
  te lo voy a señalar y pedirás que lo corrijas
- NUNCA asumir estructuras de respuestas
- SIEMPRE validar tokens, errores GraphQL, IDs de Shopify

¿Entendido? De aquí en adelante, cuando pida cambios a endpoints Shopify,
usaré el template y tú verificarás contra el archivo de referencia.

Primera solicitud:
[PEGA AQUÍ TU SOLICITUD CON EL TEMPLATE]
```

---

## 📞 SOPORTE: Si Claude Code Genera Código Incorrecto

**Señala el error específicamente:**
```
❌ Tu query es:
{ orders(first: 50) { ... } }

✅ Debe ser (según shopify-api-reference.json):
{ orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "financial_status:paid") { ... } }

Diferencia: Faltan sortKey, reverse y query.
Por favor corrígelo verificando el archivo de referencia.
```

**No hagas:**
```
❌ "Tu código está mal" (muy vago)
❌ "No funciona" (sin contexto)
❌ "Está alucinando" (sin ejemplo)
```

**Sí haz:**
```
✅ "Tu query no coincide con shopify-api-reference.json línea X"
✅ "Esperado: [lo correcto], Actual: [lo que generaste]"
✅ "Por favor verifica contra el archivo de referencia y corrígelo"
```

---

## 🎓 BENEFICIOS DE ESTE SETUP

1. **Sin alucinaciones** - Todo verificado contra código real
2. **Reproducible** - Otros devs usan el mismo template
3. **Auditable** - Cada cambio se puede rastrear vs referencia
4. **Escalable** - Funciona para más endpoints
5. **Documentado** - Todo bien explicado
6. **Defensible** - Si algo falla, miras el archivo de referencia

---

## 📚 RECURSOS

- Docs Shopify: https://shopify.dev/docs/api/admin-rest/2025-04
- Docs Shopify GraphQL: https://shopify.dev/docs/api/admin-graphql/2025-04
- Facturante API: https://www.facturante.com/api-documentation

---

## 🎯 PRÓXIMOS PASOS

1. **Ahora:** Descarguen y revisen los 4 archivos
2. **Mañana:** Creen rama `fix/shopify-endpoints`
3. **Esta semana:** Implementen Fix #1 (token expirado)
4. **Próxima semana:** Implementen Fix #2 + #5
5. **Semana 3:** Implementen Fix #3 + #4
6. **Semana 4:** Deploy a producción + monitoreo

---

## 💡 CONSEJO FINAL

**El poder de este setup está en la CONSISTENCIA.**

Cada vez que necesites cambios Shopify:
1. Consulta el archivo de referencia
2. Rellena el template
3. Solicita a Claude Code
4. Verifica contra referencia
5. Si no coincide → señala + pide corrección

No cortes atajos. En 2-3 semanas, Claude Code será EXPERTO en tu app.

---

**¿Preguntas antes de empezar?** 👇

**¿Listo para Semana 1 (Fix #1)?**
