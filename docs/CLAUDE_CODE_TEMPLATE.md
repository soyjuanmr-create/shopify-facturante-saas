# TEMPLATE: Solicitud a Claude Code para Modificar Endpoints Shopify

**INSTRUCCIONES:** Copia este template y rellena las secciones en `[BRACKETS]`. Pégalo completo en Claude Code.

---

## Solicitud: [Descripción breve de qué quieres hacer]

### Contexto de la App
- **Nombre:** Shopifac
- **Framework:** Node.js + Express
- **BD:** PostgreSQL + Prisma
- **API Shopify:** v2025-04
- **Documentación de referencia:** Ver `shopify-api-reference.json` en la raíz del proyecto

### Requisito Principal
**IMPORTANTE:** Este endpoint modifica/lee datos de Shopify. ANTES de escribir código:
1. Consulta `shopify-api-reference.json` para verificar el endpoint exacto
2. Valida que la query/mutación sea compatible con API 2025-04
3. NO asumar estructura de respuestas
4. Incluir validación de tokens SIEMPRE

---

## Cambio Solicitado

**Archivo a modificar:** `server/routes/[ARCHIVO].js`

**Tipo de cambio:**
- [ ] Agregar nuevo endpoint
- [ ] Modificar endpoint existente
- [ ] Agregar validación
- [ ] Manejar nuevo caso de error

---

## Detalles Técnicos (RELLENA ESTO)

### Endpoint a Modificar/Crear
```
[GET/POST] /api/[RUTA]
```

### Query/Mutación Shopify Exacta
```graphql
[Pega aquí la query/mutación COMPLETA de shopify-api-reference.json o de la documentación oficial]
```

### Variables Esperadas
```json
{
  "variable1": "tipo y descripción"
}
```

### Estructura de Respuesta Esperada
```json
{
  "data": {
    "expectedField": "tipo"
  }
}
```

### Validaciones Requeridas
- [ ] Token de acceso válido
- [ ] Shop domain correcto
- [ ] Respuesta contiene campos esperados
- [ ] Manejo de errores GraphQL (resp.data.errors)

### Casos de Error a Manejar
```
[Describe cada error posible]
Ej:
- 401: Token expirado → buscar en Session table
- 404: Recurso no encontrado → validar ID
- 500: Error GraphQL → loguear resp.data.errors
```

---

## Referencias de Código Existente

**Similar a este endpoint existente:** `[RUTA del endpoint similar]`

**Que usa:**
```javascript
// Fragmento del código similar para contexto
[Pega 5-10 líneas del endpoint similar]
```

---

## Validación Post-Código (CHECKLIST)

**Antes de confirmar el código, verificar:**
- [ ] ¿La query/mutación coincide exactamente con `shopify-api-reference.json`?
- [ ] ¿Se valida accessToken? (Session table → Shop table fallback)
- [ ] ¿Hay try-catch para errores Shopify?
- [ ] ¿Se loguean los headers de respuesta?
- [ ] ¿Se manejan resp.data.errors para GraphQL?
- [ ] ¿Las variables están escapadas/validadas?
- [ ] ¿El ID está en formato correcto? (gid://shopify/... o numeric)
- [ ] ¿No hay hardcoded URLs/tokens?

---

## IMPORTANTE: NO HACER

❌ **NUNCA hagas esto:**
- Asumir estructura de respuestas sin verificar
- Usar endpoints REST cuando la query está en GraphQL
- Olvidar validar token (puede estar expirado)
- Usar versión de API diferente a 2025-04
- Hardcodear URLs o scopes
- Confundir gid://shopify/Order/123 con solo 123

---

## Ejemplo Completo (REFERENCIA)

### Solicitud: Agregar endpoint para obtener lista de órdenes

**Archivo a modificar:** `server/routes/invoices.js`

**Endpoint a crear:**
```
GET /api/invoices/orders?cursor=[CURSOR]
```

**Query Shopify Exacta:**
```graphql
{ 
  orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "financial_status:paid", after: "[CURSOR]") { 
    pageInfo { hasNextPage endCursor } 
    edges { 
      node { 
        id 
        name 
        createdAt 
        totalPriceSet { presentmentMoney { amount } } 
        customer { firstName lastName email } 
      } 
    } 
  } 
}
```

**Estructura de Respuesta Esperada:**
```json
{
  "data": {
    "orders": {
      "pageInfo": {
        "hasNextPage": true,
        "endCursor": "eyJkaXJlY3Rpb24iOiJuZXh0IiwibGFzdF9pZCI6bnVsbH0="
      },
      "edges": [
        {
          "node": {
            "id": "gid://shopify/Order/123456",
            "name": "#1001",
            "createdAt": "2024-03-20T10:30:00Z",
            "totalPriceSet": {
              "presentmentMoney": {
                "amount": "299.99"
              }
            },
            "customer": {
              "firstName": "John",
              "lastName": "Doe",
              "email": "john@example.com"
            }
          }
        }
      ]
    }
  }
}
```

**Validaciones Requeridas:**
- Token válido (Session o Shop table)
- Respuesta contiene data.orders.edges
- Cursor válido si se proporciona

**Casos de Error:**
- 401: Token expirado o no disponible
- 500: GraphQL error (verificar resp.data.errors)

---

## Instrucciones Finales para Claude Code

1. **Lee `shopify-api-reference.json`** antes de escribir cualquier línea
2. **Valida la query** contra la documentación oficial de Shopify
3. **Implementa try-catch** con errores específicos de Shopify
4. **Loguea todo** (tokens truncados, URLs, errores)
5. **No asumas respuestas** - valida campos antes de usarlos
6. **Comenta el código** explicando por qué validas cosas específicas

---

## Comando para Pedir a Claude Code

**Opción 1 - En Claude.ai:**
```
Actualizar [endpoint] según este template:

[PEGA AQUÍ TODO LO DE ARRIBA RELLENO]
```

**Opción 2 - En Claude Code CLI:**
```bash
claude-code --context "$(cat shopify-api-reference.json)" "Actualizar endpoint según este template: [PEGA TEMPLATE]"
```

---

**IMPORTANTE:** Este template es tu DEFENSA contra alucinaciones. Úsalo **SIEMPRE** que toques endpoints Shopify.

Si Claude Code genera código que NO coincide con `shopify-api-reference.json`:
1. ❌ **NO lo mergees**
2. ✅ Señala la diferencia
3. ✅ Pide que verifique contra el archivo de referencia
4. ✅ Pide que lo corrija paso a paso
