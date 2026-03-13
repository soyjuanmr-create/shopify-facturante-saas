# Checkout DNI/CUIT — Guía de implementación para stores no-Plus

## El problema central

**Las Checkout UI Extensions para los pasos de información, envío y pago son EXCLUSIVAS de Shopify Plus.**

Esto incluye targets como:
- `purchase.checkout.contact.render-after` ❌ Solo Plus
- `purchase.checkout.delivery-address.render-before` ❌ Solo Plus
- `purchase.checkout.shipping-option-list.render-after` ❌ Solo Plus

El target `purchase.checkout.block.render` también es **Solo Plus** porque requiere que el merchant lo agregue manualmente en el checkout editor, y ese editor solo está disponible en Plus.

## Targets disponibles para TODOS los planes

Estos targets sí funcionan sin Plus:

| Target | Dónde aparece |
|---|---|
| `purchase.thank-you.block.render` | Página "Gracias por tu compra" |
| `purchase.order-status.block.render` | Página de estado del pedido |
| `customer-account.order-status.block.render` | Cuenta del cliente |

## Conclusión para Shopifac

**No es posible agregar el campo DNI/CUIT directamente en el formulario de checkout para merchants no-Plus usando Checkout UI Extensions.**

---

## Soluciones alternativas

### Opción A — Campo "Empresa" (workaround actual) ✅ Recomendada a corto plazo

Usar el campo nativo `company` de Shopify renombrado visualmente en el tema como "DNI / CUIT".

**Implementación en el tema (Liquid):**
```liquid
{% comment %} En checkout.liquid o via script en Additional Scripts {% endcomment %}
```

**Problema:** No se puede renombrar via código desde una app — el merchant lo hace manualmente en:
`Configuración > Checkout > Información del cliente > Nombre de la empresa`

El merchant cambia la etiqueta a "DNI / CUIT (sin espacios ni guiones)" desde el admin.

**Lectura en Shopifac:**
```js
// En server/routes/webhooks.js al recibir orders/paid
const dniCuit = order.billing_address?.company || 
                order.shipping_address?.company || 
                '';
```

**Pros:** Funciona hoy, sin código extra, sin requisito Plus.  
**Contras:** El campo no tiene validación de formato DNI/CUIT.

---

### Opción B — Additional Scripts / Web Pixel (validación JS) ⚠️ Deprecado

Inyectar JS de validación via "Additional Scripts" en Settings > Checkout.

**Problema:** Shopify está deprecando Additional Scripts. No recomendado para apps nuevas.

---

### Opción C — Shopify Plus (solución completa) 🎯 Largo plazo

Con Plus, la Checkout UI Extension actual (`checkout-dni`) funcionaría correctamente usando el target `purchase.checkout.contact.render-after`.

**El código actual en `CheckoutDNI.js` es correcto para Plus.**

Para merchants Plus: solo hay que cambiar el target en `shopify.extension.toml` a:
```toml
[[extensions.targeting]]
target = "purchase.checkout.contact.render-after"
module = "./src/CheckoutDNI.js"
```

---

### Opción D — Thank You Page (captura post-checkout) ⚡ Viable sin Plus

Capturar el DNI/CUIT en la página de "Gracias por tu compra" usando el target `purchase.thank-you.block.render`.

**Flujo:**
1. Cliente completa checkout sin DNI/CUIT
2. En la página de confirmación aparece un campo "Ingresá tu DNI/CUIT para recibir tu factura"
3. El cliente completa el campo
4. Shopifac guarda el dato via metafield en la orden
5. Shopifac genera la factura cuando recibe el dato

**Pros:** Funciona sin Plus, experiencia aceptable para facturación.  
**Contras:** El cliente puede ignorar el campo y no se genera la factura automáticamente.

**Implementación del target:**
```toml
[[extensions.targeting]]
target = "purchase.thank-you.block.render"
module = "./src/CheckoutDNI.js"
```

**Cambio necesario en CheckoutDNI.js:**
```js
import {
  extension,
  TextField,
  BlockStack,
  Button,
  Text,
} from '@shopify/ui-extensions/checkout';

export default extension(
  'purchase.thank-you.block.render',
  (root, api) => {
    // Misma lógica pero guardando en metafield de la orden
    // via applyMetafieldChange en lugar de applyAttributeChange
  }
);
```

---

## Plan de acción recomendado para Shopifac

### Fase inmediata (sin Plus):
1. **Instruir al merchant** en el onboarding a renombrar el campo "Empresa" a "DNI / CUIT" en su checkout
2. **Leer el campo `company`** en el webhook `orders/paid` como fuente del DNI/CUIT
3. **Validar el formato** en el servidor antes de enviar a Facturante
4. **Mostrar error claro** en la app si la orden no tiene DNI/CUIT válido

### Fase Thank You Page (sin Plus, mejor UX):
1. Implementar `purchase.thank-you.block.render` para captura post-checkout
2. Guardar DNI/CUIT como metafield de la orden
3. Trigger de facturación cuando el metafield es completado

### Fase Plus (solución ideal):
1. Activar `purchase.checkout.contact.render-after` 
2. El campo aparece nativo en el checkout con validación en tiempo real
3. Campo obligatorio antes de continuar

---

## Configuración actual del archivo toml (estado correcto)

```toml
api_version = "2026-01"

[[extensions]]
name = "t:name"
handle = "shopifac-checkout-dni"
uid = "fd8da97f-bb70-39a0-cac4-432f3f1a9e550d309139"
type = "ui_extension"

# Para stores NO Plus — Thank You page
[[extensions.targeting]]
target = "purchase.thank-you.block.render"
module = "./src/CheckoutDNI.js"

# Para stores Plus — descomentar y comentar el anterior
# [[extensions.targeting]]
# target = "purchase.checkout.contact.render-after"
# module = "./src/CheckoutDNI.js"

[extensions.capabilities]
api_access = true
```

---

## Notas para el onboarding de Shopifac

Agregar en el paso de configuración inicial la instrucción al merchant:

> "Para que Shopifac pueda generar tu factura automáticamente, necesitás renombrar el campo 'Empresa' en tu checkout:
> 1. Ir a **Configuración > Checkout**
> 2. En **Información del cliente**, cambiar la etiqueta del campo Empresa a: `DNI / CUIT (sin espacios ni guiones)`
> 3. Marcar el campo como **Requerido**"

Este paso debe estar en el onboarding como Paso 1, antes de cualquier configuración de Facturante.
