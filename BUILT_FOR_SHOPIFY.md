# Shopifac — Directrices Built for Shopify (BFS)

> **Propósito de este documento:** Servir como referencia técnica y de diseño para que cualquier desarrollador o asistente de IA que trabaje en este proyecto conozca y aplique los requisitos del programa Built for Shopify. Todas las decisiones de arquitectura, diseño y UX deben alinearse con estas directrices.

> **Categoría de la app:** Invoices and Receipts (Facturación Electrónica Argentina via Facturante.com / AFIP)

> **Fuente oficial:** <https://shopify.dev/docs/apps/launch/built-for-shopify/requirements>

---

## 1. Resumen de Estado Actual

| Requisito | Estado | Prioridad | Notas |
|---|---|---|---|
| App Store Requirements | Pendiente | Alta | Publicar la app en el App Store |
| Good Partner Standing | Cumple | Alta | Cuenta Partner sin infracciones |
| 50+ instalaciones netas | Pendiente | Alta | Requiere tracción post-lanzamiento |
| 5+ reviews | Pendiente | Alta | Solicitar reviews a early adopters |
| Rating mínimo | Pendiente | Alta | Depende de calidad de la app |
| Admin Performance (LCP/CLS/INP) | Pendiente | Crítica | Implementar optimizaciones |
| Storefront Performance | Cumple | Media | App no impacta storefront |
| App embebida en admin | Cumple | Crítica | Usa App Bridge v4 |
| Workflows dentro de Shopify | Pendiente | Alta | Verificar flujos completos |
| Sign-up sin login extra | Pendiente | Alta | Evaluar flujo de Facturante |
| Desinstalación limpia | Cumple | Alta | No usa Theme App Extensions |
| No usa Asset API | Cumple | Alta | No modifica temas |
| Diseño UX (Polaris) | Pendiente | Crítica | Audit completa de UI |
| Mobile-friendly | Pendiente | Alta | Test en dispositivos móviles |
| Nav Menu (s-app-nav) | Pendiente | Alta | Implementar navegación nativa |
| Contextual Save Bar | Pendiente | Alta | Integrar en formularios |
| Onboarding claro | Pendiente | Alta | Diseñar flujo de bienvenida |
| Homepage útil | Pendiente | Alta | Mostrar métricas de facturación |
| Admin Print Action Extension | Pendiente | Crítica | **Requisito de categoría obligatorio** |
| No dark patterns | Cumple | Alta | Sin prácticas engañosas |

---

## 2. Prerequisitos Generales

### 2.1 Cumplir requisitos del App Store

- Listing completo con descripción detallada en inglés y español.
- Screenshots de alta calidad mostrando la app embebida en el admin.
- Página de política de privacidad accesible.
- Documentación de soporte / FAQ.
- Video demo de la funcionalidad principal.

### 2.2 Good Partner Standing

- La cuenta Partner debe cumplir con el Partner Program Agreement y Shopify API License and Terms of Use.
- No debe haber infracciones activas ni pendientes.

### 2.3 Mínimo de instalaciones y reseñas

- Mínimo **50 instalaciones netas** de tiendas activas en planes de pago.
- Mínimo **5 reseñas** con rating que supere el umbral mínimo reciente.
- Estrategia: lanzar con pricing competitivo para Argentina, contactar contadores y gestores que trabajen con múltiples tiendas Shopify en LATAM, solicitar reviews genuinas tras resolver exitosamente las primeras facturas.

---

## 3. Rendimiento (Performance)

Shopify mide el rendimiento usando Web Vitals dentro del admin. La app debe cumplir los siguientes umbrales en el **percentil 75** de cargas de página, con un mínimo de 100 llamadas en los últimos 28 días.

### 3.1 Largest Contentful Paint (LCP) — Objetivo: ≤ 2.5s

- Implementar skeleton screens mientras cargan los datos de facturas.
- Lazy-load componentes pesados (tablas de historial, gráficos).
- Minimizar el bundle de React con code-splitting por ruta.
- Cachear datos del shop y configuración de Facturante localmente.
- Usar App Bridge v4 correctamente para optimizar carga inicial.

### 3.2 Cumulative Layout Shift (CLS) — Objetivo: ≤ 0.1

- Definir dimensiones explícitas en todos los contenedores de datos.
- Reservar espacio para banners, alertas y elementos dinámicos.
- Evitar inserción de contenido que desplace el layout tras carga inicial.
- Usar placeholders con tamaños fijos para tablas de facturas.

### 3.3 Interaction to Next Paint (INP) — Objetivo: ≤ 200ms

- Respuesta inmediata visual al hacer click en "Generar factura" (spinner/loading).
- Delegar operaciones pesadas de Facturante SOAP a workers/background.
- Usar `React.memo` y `useMemo` para evitar re-renders innecesarios.

### 3.4 Storefront Performance

- La app NO debe reducir el Lighthouse performance score del storefront en más de 10 puntos.
- Shopifac no inyecta código en el storefront (es puramente admin/facturación), por lo que se cumple de forma natural.

---

## 4. Integración

### 4.1 App embebida en el Admin

- **OBLIGATORIO:** Toda la app debe cargar dentro del iframe del admin de Shopify usando App Bridge v4.
- Usar session token authentication (no OAuth redirects visibles al merchant).
- No redirigir a Facturante.com para ningún workflow principal.
- No embeber páginas web externas como app home.

### 4.2 Workflows principales dentro de Shopify

Los comerciantes deben poder completar TODOS los flujos principales sin salir del admin:

- Configurar credenciales AFIP/Facturante.
- Generar facturas desde órdenes.
- Ver historial de facturas.
- Imprimir/descargar facturas.
- Configurar datos fiscales de la tienda.

### 4.3 Sign-up sin login adicional

- El comerciante NO debe necesitar crear una cuenta separada en Facturante.com.
- Si se requiere un token/API key de Facturante, el proceso de obtención debe ser guiado paso a paso dentro de la app.
- **Acción crítica:** Evaluar si se puede automatizar la creación de cuenta Facturante vía API, o al menos minimizar los pasos manuales con un onboarding guiado.

### 4.4 Desinstalación limpia

- Implementar correctamente el webhook `APP_UNINSTALLED` para limpiar datos de sesión en la base de datos.
- No dejar código residual en temas (no aplica directamente porque Shopifac no modifica temas).

### 4.5 No usar Asset API

- No usar la Asset API para crear, modificar ni eliminar archivos del tema bajo ninguna circunstancia.
- Shopifac cumple esto inherentemente al no interactuar con temas.

---

## 5. Diseño (Design)

### 5.1 Aspecto Familiar

#### 5.1.1 Buenas prácticas de UX

- Usar **exclusivamente componentes de Polaris 13** (Cards, DataTable, Layout, Page, Banner, etc.).
- Los botones primarios deben usar el color estándar de Polaris (NO verde, púrpura ni colores custom).
- No usar fuentes serif ni script; mantener la fuente del sistema Shopify.
- Spacing consistente con el admin de Shopify.
- Todo el contenido principal dentro de `Card` components.
- Contraste de texto conforme a **WCAG 2.1 AA**.
- Botón de retroceso en todas las subpáginas.
- En un grupo o lista, si algunos items tienen iconos, todos deben tenerlos.

#### 5.1.2 Mobile-friendly

- Ninguna página debe requerir scroll horizontal en móvil.
- Las tablas de facturas deben adaptarse (stacking o scroll horizontal controlado).
- Testear en iPhone, Android y tablet.
- Los layouts de dos columnas deben hacer stack en móvil.

#### 5.1.3 Nombre conciso de la app

- "Shopifac" no debe truncarse en el menú de navegación cuando está pinneado.

#### 5.1.4 Nav Menu — Usar `s-app-nav` de App Bridge

```jsx
// Implementar navegación nativa del admin, NO un menú propio
// Secciones recomendadas:
// - Inicio (homepage con métricas)
// - Facturas (listado e historial)
// - Configuración (datos fiscales, credenciales Facturante)
// - Ayuda (FAQ y soporte)
```

- No crear un menú de navegación propio dentro de la app.
- Al navegar a una subpágina, el item padre del nav debe estar resaltado.
- No renderizar emojis dentro del menú de navegación.

#### 5.1.5 Contextual Save Bar

- Todos los formularios de configuración DEBEN integrar el Contextual Save Bar de App Bridge.
- El comerciante NO debe poder navegar fuera sin interactuar con Save/Discard.
- Aplica a: configuración de datos fiscales, credenciales Facturante, preferencias de facturación.

```jsx
// Usar el API de App Bridge:
// import { useSaveBar } from '@shopify/app-bridge-react';
// O el componente s-save-bar de App Bridge web components
```

#### 5.1.6 Modales

- Usar `s-modal` de App Bridge para confirmaciones (generar factura, anular factura).
- Los botones de acción deben ir en los slots `primary-action` y `secondary-actions` del modal.
- No usar el deprecated Polaris Fullscreen bar.

### 5.2 App útil (Helpful)

#### 5.2.1 Ortografía y gramática

- Todo el copy debe tener ortografía y gramática correctas en español e inglés.
- Etiquetas, headings y botones deben ser claros y con contexto suficiente.
- No usar labels ambiguas como "Tiempo" sin aclarar la unidad.

#### 5.2.2 Onboarding claro

Implementar un flujo de onboarding guiado con pasos claros:

1. Bienvenida y explicación de la app.
2. Configurar datos fiscales de la tienda (CUIT, razón social, domicilio fiscal, condición IVA).
3. Conectar con Facturante (credenciales API).
4. Generar primera factura de prueba.
5. Confirmación de setup completo.

Reglas:
- El onboarding debe ser **desechable** una vez completado.
- No debe sugerir instalar otras apps como paso de onboarding.
- No debe estar colapsado ni difícil de encontrar.
- Después de completado, debe haber mecanismo para eliminar la UI de onboarding.

#### 5.2.3 Homepage útil

La página de inicio DEBE mostrar contenido dinámico, no solo estático:

- Estado de conexión con Facturante/AFIP (activo/inactivo).
- Métricas clave: facturas emitidas este mes, total facturado, última factura.
- Alertas de errores recientes o facturas pendientes.
- Si hay app blocks/embeds activables en tema, comunicar su estado con `app.extensions()`.
- Después de descartar elementos desechables, la homepage NO debe quedar solo con contenido estático.

#### 5.2.4 Mensajes de error claros

- Los errores DEBEN mostrarse en **rojo**.
- Los errores DEBEN aparecer junto al campo relevante cuando sea posible.
- Los errores NO deben desaparecer automáticamente (no usar toasts para errores).
- No mostrar campos en rojo sin mensaje de error correspondiente.
- No mostrar errores de validación antes de que el usuario interactúe.
- Los errores de la API de Facturante/AFIP deben traducirse a mensajes comprensibles.

#### 5.2.5 Guía a acciones lógicas

- En grupos de botones, la acción principal debe ser visualmente dominante.
- Ejemplo: al confirmar factura → botón primario "Generar factura", secundario "Cancelar".
- No usar dos botones secondary para acciones opuestas.

#### 5.2.6 Previews visibles

- Si la app permite personalizar algo visual (ej: plantilla de factura), el merchant debe poder ver los cambios en tiempo real.
- El preview y los controles deben ser visibles simultáneamente en desktop.

### 5.3 App amigable (User-friendly)

- **No hacer afirmaciones falsas** sobre resultados (no prometer ahorro de tiempo específico).
- **No presionar merchants** con timers visibles ni lenguaje de culpa/vergüenza para upgrades.
- **No distraer** con animaciones innecesarias, modales al cargar página, ni popovers automáticos.
- **No usar color rojo** para nada que no sea error o acción destructiva.
- **No impersonar a Shopify** — no usar el logo de Shopify ni colores magic purple para features de IA.
- **Contenido promocional** debe ser desechable y no reaparecer después de cerrarlo.
- **Features premium** deben estar deshabilitadas visual y funcionalmente, con indicación clara del plan requerido.
- **Features exclusivas de Shopify Plus** deben estar ocultas para merchants no-Plus.

---

## 6. Requisitos Específicos: Invoices and Receipts

> **⚠️ CRÍTICO: Este es el requisito de categoría obligatorio para Shopifac.**

### 6.1 Admin Print Action Extension

La app **DEBE** implementar una extensión de tipo `admin print action` que permita:

1. **Imprimir factura desde la página de detalle de una orden individual.**
2. **Imprimir facturas para múltiples órdenes seleccionadas desde la página índice de órdenes.**

#### Implementación requerida:

```
Extensión: admin print action
Ubicación: extensions/print-invoice/
Target: admin.order-details.print-action, admin.order-index.selection-print-action
```

- La extensión print action debe generar el PDF de la factura AFIP y abrirlo en el diálogo de impresión del navegador.
- Si la factura aún no existe para esa orden, ofrecer generarla antes de imprimir.
- Para selección múltiple, generar un PDF combinado o imprimir secuencialmente.
- Manejar errores con mensajes claros si la factura no puede generarse (ej: datos fiscales incompletos, error de conexión con AFIP).

#### Estado actual:

Shopifac ya tiene configuradas dos UI extensions (admin print action y order action). **Verificar que ambas funcionan correctamente en ambos contextos** (detalle individual y selección múltiple).

---

## 7. Plan de Acción Prioritario

### Fase 1: Fundamentos (Semanas 1–4)

- [ ] Completar deployment funcional en Railway.
- [ ] Verificar flujo completo OAuth + instalación.
- [ ] Testear integración Facturante SOAP end-to-end.
- [ ] Implementar Admin Print Action Extension funcional.
- [ ] Implementar Order Action Extension funcional.

### Fase 2: Diseño y UX (Semanas 5–8)

- [ ] Auditoría completa de UI con Polaris 13.
- [ ] Implementar `s-app-nav` para navegación.
- [ ] Implementar Contextual Save Bar en formularios.
- [ ] Diseñar e implementar flujo de onboarding.
- [ ] Crear homepage con métricas y estado de conexión.
- [ ] Testear y optimizar para móvil.

### Fase 3: Rendimiento (Semanas 9–10)

- [ ] Implementar code-splitting y lazy loading.
- [ ] Optimizar LCP con skeleton screens.
- [ ] Optimizar CLS con dimensiones fijas.
- [ ] Optimizar INP con respuestas visuales inmediatas.
- [ ] Monitorizar Web Vitals en Partner Dashboard.

### Fase 4: Lanzamiento y Tracción (Semanas 11–16)

- [ ] Publicar en Shopify App Store.
- [ ] Campaña de adquisición: contadores, agencias LATAM, comunidades Shopify.
- [ ] Alcanzar 50+ instalaciones netas.
- [ ] Solicitar reviews a primeros usuarios satisfechos.
- [ ] Resolver issues rápidamente para mantener rating alto.

### Fase 5: Aplicación BFS (Semana 17+)

- [ ] Verificar todos los criterios en la página Distribution del Partner Dashboard.
- [ ] Aplicar para evaluación Built for Shopify.
- [ ] Responder a feedback de Shopify y corregir hallazgos.
- [ ] Mantener cumplimiento continuo (revisión anual).

---

## 8. Referencias

- [Built for Shopify — Overview](https://shopify.dev/docs/apps/launch/built-for-shopify)
- [Built for Shopify — Requirements](https://shopify.dev/docs/apps/launch/built-for-shopify/requirements)
- [Polaris Design System](https://polaris.shopify.com/)
- [App Bridge v4](https://shopify.dev/docs/api/app-bridge)
- [Admin Extensions (Print Action)](https://shopify.dev/docs/apps/build/admin/actions-blocks)
- [Web Vitals — Optimización](https://shopify.dev/docs/apps/build/performance)
- [Blog: New perks and criteria for BFS (2025)](https://www.shopify.com/partners/blog/built-for-shopify-updates)
- [App Store Requirements Checklist](https://shopify.dev/docs/apps/launch/app-requirements-checklist)
