# EJEMPLO REAL: Agregar endpoint para Sincronizar Estado de Orden

**Scenario:** El webhook de Facturante no llegó. Quieres agregar un endpoint que verifique el estado manualmente.

---

## ✅ SOLICITUD CORRECTA (usa el template)

### Solicitud: Agregar endpoint de polling manual para sincronizar estado

**Contexto de la App**
- Nombre: Shopifac
- Framework: Node.js + Express
- BD: PostgreSQL + Prisma
- API Shopify: v2025-04
- Documentación de referencia: Ver `shopify-api-reference.json`

---

### Cambio Solicitado

**Archivo a modificar:** `server/routes/invoices.js`

**Tipo de cambio:**
- [x] Agregar nuevo endpoint
- [ ] Modificar endpoint existente
- [ ] Agregar validación
- [ ] Manejar nuevo caso de error

---

### Detalles Técnicos

**Endpoint a crear:**
```
POST /api/invoices/sync-status/:orderId
```

**Lógica:**
1. Obtener orden del DB (Invoice table)
2. Si status = 'completed' → retornar CAE (ya está listo)
3. Si status = 'processing' → consultar Facturante por estado
4. Si Facturante dice 'autorizado' → actualizar DB a 'completed' + escribir metafields en Shopify

**Query Shopify para escribir metafields:**
```graphql
mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key value }
    userErrors { field message code }
  }
}
```

**Variables:**
```json
{
  "metafields": [
    {
      "ownerId": "gid://shopify/Order/{orderId}",
      "namespace": "shopifac",
      "key": "invoice_status",
      "type": "single_line_text_field",
      "value": "completed"
    },
    {
      "ownerId": "gid://shopify/Order/{orderId}",
      "namespace": "shopifac",
      "key": "invoice_cae",
      "type": "single_line_text_field",
      "value": "{cae}"
    }
  ]
}
```

**Estructura de respuesta esperada de Facturante:**
```json
{
  "estado": "autorizado",
  "cae": "61234567890123",
  "numero": "1234",
  "mensaje": "OK"
}
```

**Estructura esperada de respuesta Shopify (metafields):**
```json
{
  "data": {
    "metafieldsSet": {
      "metafields": [
        {
          "id": "gid://shopify/Metafield/123456",
          "namespace": "shopifac",
          "key": "invoice_status",
          "value": "completed"
        }
      ],
      "userErrors": []
    }
  }
}
```

---

### Validaciones Requeridas

- [x] Token de acceso válido (Session table → Shop table fallback)
- [x] Order existe en BD con facturanteInvoiceId
- [x] Si ya está 'completed', no hacer nada
- [x] Consultar Facturante (puede fallar si ID no existe)
- [x] Validar que estado de Facturante sea 'autorizado' O 'ok'
- [x] Escribir metafields en Shopify solo si autorizado

---

### Casos de Error a Manejar

```
404: Orden no existe en BD
  → Retornar: { error: "No existe comprobante para esta orden" }

400: Status no es 'processing' (ya está completado)
  → Retornar: { status: 'completed', cae: invoice.cae }

502: Facturante no responde o retorna error
  → Loguear: 'Error consultando Facturante: [mensaje]'
  → Retornar: { error: 'Error al consultar Facturante', tip: 'Intenta en unos minutos' }

500: Falla al escribir metafields en Shopify
  → Loguear pero NO fallar el endpoint (es no-bloqueante)
  → Retornar mismo resultado de Facturante
```

---

### Referencias de Código Existente

**Similar a `/api/invoices/generate`** que ya existe en `server/routes/invoices.js`

Usa exactamente el mismo patrón:
1. Buscar shop en DB
2. Obtener accessToken (Session → Shop)
3. Crear instancia FacturanteService
4. Llamar método (en este caso `consultarComprobante` en lugar de `crearComprobante`)
5. Actualizar DB
6. Escribir metafields en Shopify (no-bloqueante)

---

### Validación Post-Código

**Antes de merguear, verificar:**
- [x] ¿Se consulta Session table ANTES de Shop table para el token?
- [x] ¿Hay try-catch alrededor de consultarComprobante()?
- [x] ¿Se valida que response.estado es 'autorizado' O 'ok'?
- [x] ¿Se actualiza la BD con status, cae y facturanteInvoiceNumber?
- [x] ¿Se escribe metafields en Shopify después (no-bloqueante)?
- [x] ¿Se loguean todos los estados transicionales?
- [x] ¿Se maneja error cuando facturanteInvoiceId es null?
- [x] ¿No hay hardcoded URLs ni tokens?

---

### ❌ QUÉ NO HACER

- ❌ Asumir que Facturante retorna SIEMPRE CAE en respuesta
- ❌ Olvidar validar que facturanteInvoiceId existe antes de consultar
- ❌ Hacer que falle todo si metafields no se escribe en Shopify
- ❌ Usar API version diferente a 2025-04
- ❌ No loguear los estados intermedios (debugging es CRÍTICO aquí)
- ❌ Olvidar que el webhook podría llegar MIENTRAS estamos sincronizando

---

## CÓMO USARÍAS ESTO CON CLAUDE CODE

**Comando en terminal:**
```bash
# Opción 1: Interactivo
claude-code server/routes/invoices.js

# Opción 2: Con contexto
claude-code --context "$(cat shopify-api-reference.json)" "Agrega endpoint POST /api/invoices/sync-status/:orderId según CLAUDE_CODE_TEMPLATE.md"
```

**Lo que dirías en Claude Code:**
```
Agrega un nuevo endpoint POST /api/invoices/sync-status/:orderId en server/routes/invoices.js

Requisitos:
1. Obtener orden del DB
2. Si status='completed', retornar CAE existente
3. Si status='processing', consultar Facturante.consultarComprobante()
4. Si Facturante retorna estado='autorizado' o 'ok', marcar como completed + escribir metafields
5. Validar token (Session → Shop fallback)
6. Loguear todos los estados
7. Manejo de errores para cada caso (ver template)

Referencia: shopify-api-reference.json (metafieldsSet mutation)
```

---

## RESULTADO ESPERADO

El código que Claude Code genere debería:

✅ Buscar el token correctamente  
✅ Consultar Facturante sin alucinaciones (usa `FacturanteService`)  
✅ Escribir metafields con la mutation exacta del archivo de referencia  
✅ Manejar todos los errores listados  
✅ Loguear cada paso  
✅ No asumir estructuras de respuesta  
✅ Ser no-bloqueante en caso de falla de metafields  

---

## ¿Y SI CLAUDE CODE GENERA ALGO INCORRECTO?

**Ejemplo: Genera query GraphQL diferente a la del archivo de referencia**

Lo que dirías:
```
El query que generaste no coincide con shopify-api-reference.json.

Tu query:
{
  metafieldsSet(metafields: $metafields) {
    ...
  }
}

Debe ser (según shopify-api-reference.json):
mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key value }
    userErrors { field message code }
  }
}

Por favor verifica el archivo de referencia y corrígelo.
```

---

## NEXT STEPS

1. ✅ Descarguen `shopify-api-reference.json` y `CLAUDE_CODE_TEMPLATE.md` a su repo
2. ✅ Úsenlo SIEMPRE que necesiten modificar endpoints Shopify
3. ✅ Si Claude Code genera algo incorrecto, señalen la diferencia vs el archivo de referencia
4. ✅ No mergeen hasta que el código coincida exactamente con las refs
