# FRONTEND_HANDOFF.md — Documento Técnico de Arquitectura y Sistema Visual Frontend
**Proyecto:** SolGest ERP  
**Destino:** Equipo de Desarrollo del Módulo Independiente "Mantenimiento" (React)  
**Fecha de Elaboración:** Octubre 2026  
**Auditoría y Referencia:** Protocolo de Excelencia 01.97, Directiva UI-01, Reglas UI-SOLGEST, UI-G y UI-Kit  

---

## INTRODUCCIÓN Y PROPÓSITO DEL DOCUMENTO

El presente documento constituye la especificación técnica integral y exhaustiva del frontend de **SolGest ERP**. Su objetivo primordial es brindar al equipo de desarrollo toda la información arquitectónica, contractual, visual y operativa necesaria para construir un nuevo módulo satélite e independiente denominado **"Mantenimiento"** desarrollado en **React**, asegurando una paridad visual, métrica y funcional del 100% con el sistema existente, sin fisuras de diseño ni inconsistencias ergonómicas.

> **Garantías de Seguridad y Certificación:**
> - Este informe fue generado a partir del análisis exclusivo del código fuente del frontend.
> - **Cero Secretos:** No se incluyen contraseñas, claves privadas, tokens JWT ni connection strings.
> - **Integridad:** No se modificó ningún archivo preexistente de la solución.
> - **Trazabilidad:** Cada dato técnico indica su correspondencia con el código o si es una recomendación técnica de adaptación para React.

---

# 1. RESUMEN DEL FRONTEND

A partir del análisis exhaustivo de `package.json`, `nuxt.config.ts` y la arquitectura del proyecto, se confirman las siguientes tecnologías y dependencias:

* **Framework principal:** **Nuxt** configurado en modo **Single Page Application (SPA)** estricto (`ssr: false` en `nuxt.config.ts`). La capa visual está montada sobre **Vue 3**.
* **Versión exacta:**
  * `nuxt`: **`^4.5.2`**
  * `vue`: **`^3.5.32`**
* **Lenguaje utilizado:** **TypeScript** (`typescript` / definiciones `@types/*`) y JavaScript moderno (ES Modules, ECMAScript 2023+).
* **Herramienta de build:** **Vite** (motor de empaquetado nativo de Nuxt 4) con optimización de dependencias (`optimizeDeps`) y segmentación manual de fragmentos (`manualChunks`) para:
  1. `vendor-primevue` (`primevue`, `@primevue/themes`, `primeicons`, `primeflex`)
  2. `vendor-vue` (`vue`, `pinia`, `vue-router`)
  3. `vendor-reports` (`jspdf`, `jspdf-autotable`, `exceljs`, `file-saver`)
  4. `vendor-cad` (`three`, `dxf-viewer`, `opentype.js`, `earcut`)
* **Gestor de paquetes:** **npm** (gestión de dependencias basada en `package-lock.json`).
* **Librerías UI:**
  * `primevue`: **`^4.3.5`**
  * `@primevue/nuxt-module`: **`^4.3.5`**
  * `@primevue/themes`: **`^4.3.5`** (Preset temático **Nora** adaptado como `SolGestPreset`).
* **Librerías CSS:**
  * `primeflex`: **`^4.0.0`** (sistema de grilla responsiva, utilidades flexbox, espaciado y alineación).
  * Hojas de estilo globales canónicas:
    * `app/assets/css/main.css` (variables CSS corporativas, modo oscuro, componentes base).
    * `app/assets/css/login-tokens.css` (tokens métricos por tipo de dato, clases `.w-field-*`, `.control-36`).
* **Librerías de iconos:**
  * `primeicons`: **`^7.0.0`** (clases de iconos con prefijo `pi pi-*`).
* **Routing:** **Vue Router `^5.0.4`** provisto por el sistema de enrutamiento basado en archivos de Nuxt (`app/pages/**`).
* **Manejo de estado:**
  * `pinia`: **`^3.0.4`**
  * `@pinia/nuxt`: **`^0.11.3`**
* **Manejo de formularios:** Reactividad nativa de Vue 3 (`ref`, `reactive`, `computed`, `v-model`) estructurada mediante componentes de diseño propios: `<FormField>`, `<FormGrid>` y `<FormRow>`. No se utiliza Formik, React Hook Form ni VeeValidate.
* **Validaciones:**
  * En servidor y contratos de API: **`zod` `^4.4.3`** (`server/schemas/`).
  * En frontend: Validaciones reactivas en tiempo real en los componentes, sanitización mediante eventos (`@input`, `@blur`), cálculo de dígitos verificadores (ej. CUIT módulo 11 en `CuitInput.vue`) y formateo de errores técnicos con `formatApiErrorMessage()` (`app/composables/useApiClient.ts`).
* **Cliente HTTP:**
  * Cliente nativo Nuxt: **`$fetch`** (`ofetch`) centralizado y tipado en el composable `useApiClient()` (`app/composables/useApiClient.ts`).
  * Cliente auxiliar instalado: **`axios` `^1.10.0`**.
* **Librerías para tablas:**
  * `primevue/datatable` y `primevue/column` configurados en alta densidad (`class="p-datatable-sm"`).
  * Componente canónico de tabla: `app/components/AppDataTable.vue`.
* **Librerías para gráficos:**
  * **`chart.js` `^4.5.1`**.
* **Librerías de fechas:**
  * Componente `primevue/datepicker`, encapsulado en `DateInput.vue`.
  * Funciones nativas de JavaScript (`Intl.DateTimeFormat`, manipulaciones estándar ISO). *No se utilizan moment, dayjs ni date-fns (confirmado en package.json)*.
* **Notificaciones / alerts / toast:**
  * Notificaciones flotantes: `primevue/toast` (`useToast()`, directiva `<Toast />`).
  * Diálogos de confirmación: `primevue/confirmdialog` (`useConfirm()`, `<ConfirmDialog />`) y componente propio `ConfirmDanger.vue`.
  * Modales informativos: `primevue/dialog` (`<Dialog>`).
* **Otras dependencias importantes del frontend:**
  * `@nuxt/fonts` **`^0.14.0`** (carga y optimización de tipografía Google Fonts 'Inter').
  * `jspdf` **`^3.0.1`** y `jspdf-autotable` **`^5.0.2`** (generación y descarga de informes PDF en cliente).
  * `exceljs` **`^4.4.0`** y `file-saver` **`^2.0.5`** (exportación nativa a hojas de cálculo Excel XLSX).
  * `three` **`^0.186.1`** y `dxf-viewer` **`^1.0.49`** (visor 3D y visualizador de planos CAD industriales).
  * `jsqr` **`^1.4.0`** y `qrcode` **`^1.5.4`** (lectura y generación de códigos QR).

---

# 2. ESTRUCTURA DEL PROYECTO

El frontend de SolGest ERP reside en el directorio canónico `app/` de Nuxt 4 (apoyado por activos públicos en `public/` y endpoints Nitro en `server/`):

```text
c:/proy_erpn/
├── app/                              # Código fuente principal del frontend (Nuxt 4 / Vue 3)
│   ├── assets/                       # Hojas de estilo y recursos estáticos
│   │   └── css/
│   │       ├── main.css              # Variables semánticas, modo oscuro, DataTable, Overlays
│   │       └── login-tokens.css      # Tokens métricos, escala de anchos UI-01, control-36
│   ├── components/                   # Biblioteca de componentes Vue compartidos y modales
│   │   ├── artgen/                   # Modales específicos del catálogo maestro de artículos
│   │   ├── asientos/                 # Visores de asientos contables (AsientoVisorModal.vue)
│   │   ├── auth/                     # Componentes de autenticación (LoginBanner, LoginForm)
│   │   ├── AppDataTable.vue          # Tabla de alta densidad estandarizada
│   │   ├── AppLookup.vue             # Selector inteligente con búsqueda avanzada (F3)
│   │   ├── AppPage.vue               # Envoltorio de pantalla con header y toolbar
│   │   ├── FormField.vue             # Campo de formulario con etiqueta vertical y asterisco
│   │   ├── FormGrid.vue              # Contenedor CSS Grid para alineación vertical
│   │   ├── FormRow.vue               # Fila flex para formularios simples
│   │   ├── MoneyInput.vue            # Entrada monetaria tabular alineada a la derecha
│   │   ├── DateInput.vue             # Selector de fecha con atajos de teclado
│   │   ├── CuitInput.vue             # Entrada de CUIT con máscara y validación módulo 11
│   │   ├── SectionCard.vue           # Tarjeta de sección con padding de 16px
│   │   ├── StatusTag.vue             # Badges de estado con colores institucionales
│   │   ├── EmptyState.vue            # Ilustración y texto para grillas sin datos
│   │   ├── IndicadorProceso.vue      # Spinner de progreso anti-flicker (1 a 10s)
│   │   ├── ProgressPanel.vue         # Barra de progreso real SSE (> 10s) con cancelación
│   │   ├── CommandPalette.vue        # Paleta global de comandos (Ctrl+K)
│   │   ├── CompanySelectorModal.vue  # Selector de empresa activa
│   │   ├── ContextSelector.vue       # Selector de sucursal y centro operativo
│   │   └── ...                       # Modales de búsqueda (Entity, Account, Article, CostCenter)
│   ├── composables/                  # Lógica de negocio reutilizable, atajos y clientes
│   │   ├── useApiClient.ts           # Cliente HTTP $fetch configurado con auth y sanitización
│   │   ├── useAtajos.ts              # Gestor centralizado de atajos de teclado
│   │   ├── useDarkMode.ts            # Control de modo oscuro (.app-dark)
│   │   ├── useNumberFormat.ts        # Formateo de números (1.234.567,89)
│   │   ├── useAsientoVisor.ts        # Apertura global de asientos sobre la pantalla actual
│   │   ├── useArticleSearch.ts       # Diálogo global de artículos
│   │   ├── useFormGuard.ts           # Protección contra pérdida de cambios sin guardar
│   │   └── useProcesando.ts          # Gestión de estados de carga y feedback
│   ├── config/                       # Configuraciones y constantes estáticas
│   │   └── menu.ts                   # Árbol maestro de navegación, iconos y permisos
│   ├── layouts/                      # Plantillas estructurales de pantalla
│   │   ├── default.vue               # Layout principal (Sidebar, Header 56px, Tabs, Content)
│   │   └── auth.vue                  # Layout limpio para pantallas de login y onboarding
│   ├── middleware/                   # Guardas de navegación enrutadas
│   │   ├── auth.global.ts            # Guardia global de autenticación, empresa y contexto
│   │   ├── auth.ts                   # Guardia específico de rutas protegidas
│   │   └── admin.ts                  # Guardia de privilegios de administrador
│   ├── pages/                        # Páginas de la aplicación organizadas por módulo
│   │   ├── index.vue                 # Dashboard principal con métricas KPI y accesos rápidos
│   │   ├── login.vue                 # Pantalla de inicio de sesión
│   │   ├── select-contract.vue       # Selector de contrato multi-tenant
│   │   ├── select-company.vue        # Selector de empresa
│   │   ├── select-scope.vue          # Selector de ámbito (Sucursal y Centro Operativo)
│   │   ├── ventas/                   # Módulo de Facturación, Remitos, Cobranzas
│   │   ├── compras/                  # Módulo de Requerimientos, Órdenes, Proveedores
│   │   ├── contabilidad/             # Asientos, Mayor, Resumen de Subcuentas, Balances
│   │   ├── almacen/                  # Depósitos, Stock, Movimientos de Insumos
│   │   ├── produccion/               # Estructura de Productos, Plan de Manufactura
│   │   ├── configuracion/            # Parámetros, Estilos, Roles, Diccionario
│   │   └── crud/                     # Vistas genéricas y personalizadas de catálogos
│   ├── stores/                       # Estado global reactivo con Pinia
│   │   ├── auth.ts                   # Sesión, usuario activo, empresa, sucursal, centro
│   │   ├── acl.ts                    # Matriz de permisos can(modulo, accion)
│   │   ├── menu.ts                   # Menú dinámico y centros operativos disponibles
│   │   ├── tabs.ts                   # Pestañas de trabajo abiertas (Workspace Tabbar)
│   │   ├── formGuard.ts              # Registro de formularios dirty (sin guardar)
│   │   └── style.ts                  # Personalizaciones cosméticas y fuentes
│   ├── theme/                        # Tema y diseño visual institucional
│   │   └── solgest-preset.ts         # Preset Canónico SolGest (Nora + solgestGreen)
│   └── utils/                        # Funciones auxiliares puras
├── public/                           # Archivos estáticos accesibles directamente por URL
│   ├── favicon.png                   # Isotipo oficial de SolGest ERP
│   ├── favicon.ico / favicon-*.png   # Variantes de icono para navegador y dispositivos
│   └── images/                       # Logos institucionales (logo-solgest.png, logo-soltec.png)
├── Logos/                            # Repositorio de recursos de marca, banners y fondos
├── server/                           # Backend Nitro (API REST, middleware de base de datos)
├── nuxt.config.ts                    # Configuración integral de Nuxt 4, Vite y PrimeVue
└── package.json                      # Manifiesto de dependencias y scripts de compilación
```

---

# 3. ARQUITECTURA DEL FRONTEND

### Organización y Flujo de Trabajo
1. **Separación de Páginas (`app/pages/`):**
   * Nuxt mapea automáticamente las carpetas a rutas de URL.
   * Se agrupan por subsistema funcional de negocio: `/ventas`, `/compras`, `/contabilidad`, `/almacen`, `/produccion`, `/configuracion`, `/admin` y `/crud`.
   * Toda página transaccional compleja o ficha de catálogo vive en su propia ruta y se renderiza dentro del sistema de pestañas multiventa.
2. **Separación de Componentes (`app/components/`):**
   * **Componentes Atómicos / Base:** Envoltorios canónicos (`FormField`, `FormGrid`, `FormRow`, `MoneyInput`, `DateInput`, `CuitInput`, `StatusTag`, `SectionCard`, `EmptyState`).
   * **Componentes de Búsqueda y Diálogos:** Localizados en la raíz de `components/` (`EntitySearchDialog`, `AccountSearchDialog`, `ArticleSearchDialog`, `CostCenterSearchDialog`).
   * **Componentes por Dominio:** Subcarpetas para features complejas (`asientos/`, `artgen/`, `auth/`).
3. **Módulos Funcionales:**
   * Los módulos son subsistemas completos. Cada módulo posee catálogos maestros, transacciones y reportes.
4. **Reutilización de Componentes:**
   * Prohibido invocar inputs crudos de PrimeVue sin estandarización. Se utiliza la tríada:
     `<SectionCard>` $ightarrow$ `<FormGrid>` $ightarrow$ `<FormField>` $ightarrow$ `<Input... class="control-36">`.
5. **Dónde vive la Lógica:**
   * **Estado Global y Sesión:** En Pinia (`app/stores/`).
   * **Lógica Reutilizable de Negocio:** En composables (`app/composables/`).
   * **Lógica Específica de Pantalla:** En el bloque `<script setup lang="ts">` del archivo `.vue` de la página.
6. **Dónde están los Servicios y Comunicación API:**
   * No existe una capa tradicional de clases abstractas de servicio (`*Service.ts`). La comunicación se realiza consumiendo el cliente centralizado `useApiClient()` que expone una instancia de `$fetch` preconfigurada con interceptores para JWT (`Authorization`) e ID de empresa (`X-Empresa-Id`).
7. **Tipos e Interfaces:**
   * Definidos en archivos TypeScript dedicados (`app/config/menu.ts`, interfaces en composables) y en esquemas Zod en `server/schemas/`.
8. **Constantes y Helpers:**
   * Localizados en `app/config/` y `app/composables/` (`useNumberFormat.ts`, `useAtajos.ts`).

### Ejemplo Real del Proyecto: Facturación de Ventas
La pantalla `app/pages/ventas/facturacion/index.vue` ejemplifica la arquitectura típica:
* **Cabecera (56px):** Título con icono, subtítulo de trazabilidad, botón primario ("Nueva Factura de Venta") o acciones transaccionales ("Volver a la Grilla", "Limpiar", "Facturar CAE" con `:loading="submitting"`).
* **Pestaña 0 (Gestión de Facturación):** 6 tarjetas métricas KPI con totales monetarios y cantidades, barra de filtros colapsable, y grilla `<DataTable class="p-datatable-sm">` con paginación remota, tags de estado (`<StatusTag>`) y botones de acción por fila.
* **Pestaña 1 (Confección de Factura):** Formulario transaccional con cabecera de comprobante (`<SectionCard>`), selección de cliente con autocompletado y botón F3 para `<EntitySearchDialog>`, grilla interactiva de artículos (`<ArticleSearchDialog>`), y pie fijo de totales con desglose de IVA y percepciones.

---

# 4. LAYOUT PRINCIPAL

La aplicación cuenta con dos layouts: `app/layouts/auth.vue` (para login y selección de empresa) y el layout operacional central `app/layouts/default.vue`.

```text
App (app.vue)
└── Layout (default.vue)
    ├── SidebarTriggerZone (borde izquierdo sensible al puntero)
    ├── Sidebar (aside.layout-sidebar - ancho dinámico 260px a 560px)
    │   ├── SidebarHeader (Isotipo /favicon.png + SolGest ERP + Pin + Close)
    │   ├── MenuControlBar (Título + botones "Expandir todo" / "Colapsar todo")
    │   ├── SidebarNav (<Tree class="sidebar-tree"> jerárquico PrimeVue)
    │   └── SidebarResizer (.sidebar-resizer tirador para arrastre manual o doble clic)
    └── MainContent (.layout-main)
        ├── Topbar (header.layout-topbar - altura 56px)
        │   ├── Left (Botón menú hamburguesa + CompanyBadge + ContextSelector)
        │   ├── Center (Botón canónico "Accesos Rápidos" con atajo Ctrl+K integrado)
        │   └── Right (Buscador móvil, Atajos '?', Modo Oscuro sun/moon, Usuario, Salir)
        ├── WorkspaceTabbar (.workspace-tabbar - altura 36px)
        │   └── WorkspaceTabsContainer (Pestañas multiventa con indicador de dirty state)
        └── ContentArea (main.layout-content - contenedor de slot con overflow flex)
    └── GlobalModals (Montados a nivel layout para disponibilidad universal)
        ├── CompanySelectorModal
        ├── CommandPalette (Ctrl+K)
        ├── AccesosDirectosMenu
        ├── AccesosDirectosGestorModal
        ├── AtajosHelpModal (?)
        ├── AsientoVisorModal (Regla UI-ASIENTO)
        ├── ArticleSearchDialog (§01.132)
        └── ConfirmDialog (PrimeVue)
```

### Detalle de Componentes del Layout:
1. **Sidebar Lateral (`aside.layout-sidebar`):**
   * Puede estar colapsado (oculto fuera de pantalla con detección en borde izquierdo `.sidebar-trigger-zone`) o fijado con pin (`sidebarPinned`).
   * **Redimensionamiento:** Posee un tirador en su borde derecho (`.sidebar-resizer`). El usuario puede arrastrarlo entre **260px y 580px**, o hacer **doble clic** para auto-ajustar. El ancho se recuerda en `localStorage.getItem('solgest_sidebar_width')`.
   * **Árbol de Menú:** Implementado con el componente `<Tree>` de PrimeVue customizado, con guías verticales de nivel de rama (`border-left: 1px solid var(--p-content-border-color)`).
2. **Topbar Superior (`header.layout-topbar`):**
   * Altura fija de **56px** (`.header-bar-56`), fija en la parte superior.
   * Contiene `<CompanyBadge>` (muestra la empresa actual y permite cambiarla) y `<ContextSelector>` (permite conmutar sucursal y centro operativo).
   * Botón central estilizado de **Accesos Rápidos** con badge tipográfico `<kbd class="shortcut-pill">Ctrl+K</kbd>`.
3. **Workspace Tabbar (Pestañas Multiventa):**
   * Permite tener múltiples pantallas abiertas simultáneamente sin perder el estado de edición.
   * Cuenta con un **indicador de dirty state** (`formGuardStore.isRouteDirty(tab.to)`) que muestra un punto naranja/rojo y advierte con confirmación modal si el usuario intenta cerrar una pestaña con cambios sin guardar.
4. **Comportamiento Responsive:**
   * En resoluciones menores a 992px (`md:hidden`), el sidebar se transforma en un cajón flotante (*drawer*), el botón de accesos rápidos se compacta y se habilitan botones directos en la barra.

---

# 5. NAVEGACIÓN

La navegación de SolGest ERP está centralizada en el catálogo maestro `app/config/menu.ts`, el cual puede ser sobrescrito dinámicamente desde el backend mediante `/api/me/menu` a través de `app/stores/menu.ts`.

### Mapa Completo del Menú Oficial:

| Módulo ID | Nombre Visible | Icono PrimeIcons | Ruta (`to`) | Permiso Requerido | Submenús / Agrupadores |
|---|---|---|---|---|---|
| **inicio** | Inicio | `pi pi-home` | `/` | Acceso libre autenticado | Dashboard $ightarrow$ Panel de Control |
| **accesos_rapidos** | Accesos Rápidos | `pi pi-bolt` | Dinámicas del usuario | Según ítem | Accesos Frecuentes (Facturación, Asientos, Cuentas, Sujetos) |
| **contabilidad** | Contabilidad | `pi pi-percentage` | — | `asientos.ver`, `ctasmg.ver`, `clipro.ver` | **Catálogos:** Plan de Cuentas (`/crud/ctasmg`), Gestor Plan de Cuentas (`/ctasmg-tree`), Comportamiento cuentas (`/contabilidad/catalogos/comportamiento-cuentas-gestor`), Comprobantes (`/crud/comprob`), Sujetos (`/contabilidad/catalogos/sujetos`), Clientes/Proveedores Tabla (`/crud/clipro`), Asientos Modelos (`/crud/asiento_modelo_md`), Centros de Costos (Unidades Negocio `/crud/unidad_negocios`, Centros `/crud/centro_costos`, SubCentros `/crud/sub_centro_costos`), Períodos (`/crud/periodos`), Bancos (`/crud/cat_entidad_financiera`), Valores Cartera (`/crud/tracar`), Cajas (`/crud/cat_caja`), Medios de Pago (`/crud/medios_pago_cobro`), Cuotas (`/crud/medios_pago_cobro_det`), Monedas (`/crud/monedas`), Valores (`/crud/valores`), Localidades (`/crud/localidades`), Operaciones Actividades (`/crud/operaciones_actividad`), Operaciones Clases (`/crud/operaciones_clase`), Provincias (`/crud/provincias`).<br>**Procesos:** Ingreso de Asientos (`/contabilidad/asientos/nuevo`), Consulta de Asientos (`/contabilidad/asientos/consulta`), Cierre de Períodos (`/contabilidad/procesos/cierre-periodos`).<br>**Reportes:** Mayor General (`/contabilidad/reportes/mayor`), Resumen de Subcuentas (`/contabilidad/reportes/resumen-subcuentas`), Saldos Subdiarios (`/contabilidad/reportes/informe-saldos-subdiarios`), Balance General (`/contabilidad/reportes/balance`), Cartera Valores (`/contabilidad/reportes/cartera-valores`), Impositivos IVA Compras/Ventas/Simple (`/contabilidad/reportes/impositivos/iva/*`). |
| **compras** | Compras | `pi pi-shopping-bag` | — | `compras.ver`, `artgen.ver`, `clipro.ver` | **Catálogos:** Proveedores (`/contabilidad/catalogos/sujetos?tipo=PROVEEDOR`), Localidades, Artículos (Maestro `/crud/artgen`, Reposición MRP, Artículos Proveedor, Familias, Grupos, Rubros, Clases, Líneas, Marcas, Tipos).<br>**Procesos:** Plan Abastecimiento (`/compras/abastecimiento`), Requerimientos (`/compras/requerimientos`), Gestor Requerimientos Pendientes, Solicitudes Cotización, Órdenes de Compra (`/compras/ordenes`), Facturas de Compra (`/compras/facturas`), Órdenes de Pago (`/compras/pagos`), Mesa Cuentas por Pagar, Remitos Recepción (`/compras/remitos`), Captura OCR (`/contabilidad/asientos/ocr-facturas`).<br>**Reportes:** Resumen de Cuenta Proveedores, Informe de Saldos.<br>**Configuración:** Parámetros de Compras. |
| **ventas** | Ventas | `pi pi-shopping-cart` | — | `ventas.ver`, `clipro.ver` | **Catálogos:** Clientes (`/contabilidad/catalogos/sujetos?tipo=CLIENTE`), Clientes No Habituales, Vendedores, Localidades, Obras y Proyectos, Profesionales.<br>**Procesos:** Presupuestos (`/ventas/presupuestos`), Notas de Venta (`/ventas/notas-venta`), Facturación (`/ventas/facturacion`), Remitos de Venta (`/ventas/remitos`), Consulta Documentos, Caja Operativa, Recibos de Cobranza.<br>**Reportes:** Resumen de Cuenta Clientes, Informe de Saldos. |
| **produccion** | Producción | `pi pi-cog` | — | `produccion.ver` | **Catálogos:** Estructura de Productos.<br>**Procesos:** Plan de Manufactura.<br>**Reportes:** Órdenes de Trabajo (`/produccion/ordenes-trabajo`). |
| **almacen** | Almacén | `pi pi-box` | — | `almacen.ver`, `artgen.ver` | **Catálogos:** Artículos (`/crud/artgen`), Depósitos, Ubicaciones, Tipos de Movimientos, Variantes (Talles, Colores, Fragancias), Unidades de Medida.<br>**Procesos:** Movimientos de Stock e Insumos (`/almacen/movimientos`).<br>**Reportes:** Inventario (`/almacen/inventario`). |
| **configuracion** | Configuración | `pi pi-sliders-h` | — | `contractAdminOnly: true` | **General:** Comportamiento (`/configuracion/comportamiento`), Métricas de Datos.<br>**Estructura:** Organización, Regiones, Sucursales, Centros Operativos.<br>**Estructura Procedural:** Diccionario de Formularios.<br>**Impositiva:** ARCA Certificados (`/configuracion/arca`), Tipos Impuestos, Alícuotas IVA, Comprobantes ARCA.<br>**Catálogos Generales:** Clases y Subtipos de Operaciones, Tipos y Estados de Documentos, Situaciones de Cartera, Expedición.<br>**Interface:** Estilos de Presentación (`/configuracion/estilos`).<br>**Contable:** Componentes Contables, Funciones Administrativas, Documentos Primarios, Numeradores Transaccionales, Config Crud Mae-Det. |
| **admin_empresa** | Administración de Empresa | `pi pi-briefcase` | — | `contractAdminOnly: true` | **Usuarios:** Mis Operarios (`/admin/operarios`).<br>**Seguridad:** Roles y Alcance Organizacional (`/configuracion/roles`), Matriz de Permisos de Menú (`/configuracion/reglas-propiedades`), Registro de Auditoría (`/admin/auditoria`). |
| **admin_global** | Administrador Global | `pi pi-globe` | — | `adminOnly: true` | **Ecosistema:** Usuarios Login (`/seguridad/usuarios-login`), Contratos (`/admin/contratos`), Empresas (`/admin/empresas`), Modelos de Menú (`/crud/sistema_modelo_menus`), Ítems de Menú (`/crud/sistema_modelo_menus_items`). |

### Cómo Incorporar el Módulo "Mantenimiento" Sin Romper la Estructura:
Para incorporar "Mantenimiento" al menú respetando el contrato de `ModuleNav`:
1. Agregar la definición en `app/config/menu.ts`:
   ```typescript
   {
     id: 'mantenimiento',
     label: 'Mantenimiento',
     icon: 'pi pi-wrench',
     groups: [
       {
         label: 'Gestión de Equipos',
         items: [
           { label: 'Máquinas y Equipos', icon: 'pi pi-cog', to: '/mantenimiento/maquinas', permission: { module: 'mantenimiento', action: 'ver' } },
           { label: 'Intervenciones Técnicas', icon: 'pi pi-wrench', to: '/mantenimiento/intervenciones', permission: { module: 'mantenimiento', action: 'ver' } },
           { label: 'Mantenimientos Preventivos', icon: 'pi pi-calendar', to: '/mantenimiento/preventivos', permission: { module: 'mantenimiento', action: 'ver' } },
           { label: 'Repuestos y Consumibles', icon: 'pi pi-box', to: '/mantenimiento/repuestos', permission: { module: 'mantenimiento', action: 'ver' } }
         ]
       },
       {
         label: 'Reportes y Tableros',
         items: [
           { label: 'Historial de Fallas e Indicadores MTBF/MTTR', icon: 'pi pi-chart-bar', to: '/mantenimiento/reportes', permission: { module: 'mantenimiento', action: 'ver' } }
         ]
       }
     ]
   }
   ```
2. En la base de datos (tabla `public.sistema_modelo_menus_items`), dar de alta los mismos registros para que el endpoint dinámico `/api/me/menu` los retorne según los permisos asignados a cada usuario.

---

# 6. SISTEMA VISUAL / DESIGN SYSTEM

## Colores

### 1. Paleta Primaria Institucional (Verde Esmeralda SolGest):
Definida en `app/theme/solgest-preset.ts` (`solgestGreen`):
* `50`: **`#ecfdf5`** (Fondos sutiles, selección de chips, banners activos)
* `100`: **`#d1fae5`**
* `200`: **`#a7f3d0`**
* `300`: **`#6ee7b7`**
* `400`: **`#34d399`**
* `500`: **`#10b981`** (Primario en modo oscuro)
* `600`: **`#059669`** (Primario corporativo estándar en modo claro)
* `700`: **`#047857`** (Hover en botones primarios)
* `800`: **`#065f46`** (Active / Pressed)
* `900`: **`#064e3b`**
* `950`: **`#022c22`**

### 2. Superficies y Fondos:
* **Fondo general del viewport (`--surface-ground`):**
  * Light: **`#f8fafc`** (Slate-50)
  * Dark: **`#09090b`** (Zinc-950)
* **Fondo de Tarjetas / Cards (`--surface-card`):**
  * Light: **`#ffffff`**
  * Dark: **`#18181b`** (Zinc-900)
* **Fondo del Sidebar y Header:**
  * Light: **`#ffffff`**
  * Dark: **`#18181b`**
* **Bordes (`--surface-border`, `--p-content-border-color`):**
  * Light: **`rgba(0, 0, 0, 0.08)`** (gris sutil 50% atenuado)
  * Dark: **`rgba(255, 255, 255, 0.08)`**
  * En líneas de tablas (`td`): **`rgba(0, 0, 0, 0.05)`** (Light) / **`rgba(255, 255, 255, 0.05)`** (Dark).
* **Superficies Overlays / Desplegables:**
  * **100% Sólidas y Opacas** (`background-color: var(--surface-card, #ffffff) !important`), `z-index: 1200`, sombra `0 10px 25px -5px rgba(0, 0, 0, 0.15)`.

### 3. Textos:
* **Texto Principal (`--text-color`):**
  * Light: **`#0f172a`** (Slate-900)
  * Dark: **`#f4f4f5`** (Zinc-100)
* **Texto Secundario / Labels (`--text-color-secondary`, `--form-label-color`):**
  * Light: **`#64748b`** (Slate-500) o **`#475569`** (`text-700` en inputs)
  * Dark: **`#a1a1aa`** (Zinc-400)
* **Placeholder (`--form-placeholder-color`):**
  * Light: **`#94a3b8`**
  * Dark: **`#71717a`**

### 4. Estados y Selecciones en Tablas:
* **Fila Seleccionada en DataTable:**
  * Light: Fondo **`#dbeafe`** (Azul pastel iluminado), texto **`#0f172a`**, borde izquierdo canónico **`box-shadow: inset 4px 0 0 0 #059669`**.
  * Dark: Fondo **`#1e293b`**, texto **`#f8fafc`**, borde izquierdo **`box-shadow: inset 4px 0 0 0 #10b981`**.
* **Hover en Fila:**
  * Light: **`#bfdbfe`**
  * Dark: **`#334155`**

### 5. Estados Semánticos y Colores Contables:
* **Éxito:** **`#15803d`** (Green-700 Light) / **`#4ade80`** (Dark).
* **Advertencia:** **`#d97706`** (Amber-600) / **`#fbbf24`** (Dark).
* **Error / Peligro:** **`#b91c1c`** (Red-700) / **`#f87171`** (Dark).
* **Información:** **`#1e40af`** (Blue-800) / **`#60a5fa`** (Dark).
* **Convención Contable Canónica:**
  * **Debe:** `#1e40af` (Azul)
  * **Haber:** `#b91c1c` (Rojo)
  * **Partida Doble Cuadrada:** `#15803d` (Verde)
  * **Desbalance:** `#b91c1c` (Rojo intenso)

---

## Tipografía

* **Familia Tipográfica Única:**
  `font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;`
* **Importación:** Configurada globalmente vía `@nuxt/fonts` con pesos `[400, 500, 600, 700]` en `nuxt.config.ts`.
* **Escala de Tamaños:**
  * **Controles, Inputs, Dropdowns y Celdas de Grilla:** **`0.8125rem` (13px)**. Previene cortes inferiores en letras descendentes (*g, p, q, y*).
  * **Etiquetas de Campo (`<label>`):** **`11px`** o **`12px`** (`0.75rem`), peso **`600`**, siempre situadas sobre el campo.
  * **Cabeceras de Tabla (`<th>`):** **`12px`** (`0.75rem`), peso **`700`**, mayúsculas sutiles o títulos claros.
  * **Badges y Chips de Filtro:** **`11px`** (`0.6875rem`).
  * **Subtítulos y Toolbars:** **`14px`** (`0.875rem`).
  * **Títulos de Sección / Tarjetas:** **`16px`** (`1rem`), peso **`700`**.
  * **Título Principal de Pantalla:** **`20px` a `24px`** (`1.25rem` a `1.5rem`), peso **`700`**.
* **Números e Importes Tabulares:** Obligatorio **`font-variant-numeric: tabular-nums`** (clase `.tabular-nums`) en todas las columnas monetarias, fechas y cantidades.

---

## Espaciado y Dimensiones

* **Grilla Métrica de 4px:**
  * Valores válidos canónicos: **`4px`**, **`8px`**, **`12px`**, **`16px`**, **`24px`**, **`32px`**.
* **Altura Unificada de Controles:**
  * Todos los controles de formulario miden exactamente **`36px`** (`--control-h: 36px`, clase **`.control-36`**).
* **Padding de Tarjetas (`SectionCard` / `.card`):**
  * **`16px`** (`p-3` / `--card-pad: 16px`).
* **Separación entre Filas de Formulario:**
  * **`12px`** vertical (`gap-3`) en flex o **`16px`** (`row-gap: 16px`) en `<FormGrid>`.
* **Separación Horizontal entre Campos:**
  * **`8px`** (`column-gap: 8px`) dentro de un grupo (ej. Desde / Hasta).
  * **`16px` de track vacío** entre grupos distintos (distancia efectiva 8 + 16 + 8 = **`32px`**).
* **Barras Fijas:**
  * Header superior (Topbar): **`56px`** (`.header-bar-56`).
  * Pestañas de trabajo (Workspace Tabbar): **`36px`**.
  * Sidebar: ancho base **`260px`** a **`290px`**, expandible hasta **`560px`**.

---

## Escala Canónica de Anchos por Tipo de Dato (Directiva UI-01)

| Token CSS | Ancho Fijo | Clase Utilitaria | Uso Específico |
|---|---|---|---|
| `--w-letter` | **`40px`** | `.w-field-letter` | Letra de factura/comprobante (A, B, C, M, E, X) |
| `--w-code-xs` | **`72px`** | `.w-field-code-xs` | Códigos ultracortos de 2 a 4 caracteres |
| `--w-pto` | **`84px`** | `.w-field-pto` | Punto de venta / emisión (5 dígitos con relleno a la izquierda) |
| `--w-pct` | **`80px`** | `.w-field-pct` | Porcentajes (% bonificación, alícuotas de IVA) |
| `--w-qty` | **`96px`** | `.w-field-qty` | Cantidades de stock, bultos, unidades |
| `--w-num-sm` | **`120px`** | `.w-field-num-sm` | Número de comprobante (8 dígitos), remito, cupones |
| `--w-amount` | **`128px`** | `.w-field-amount` | Importes en pesos/dólares, precios unitarios (alineados a derecha) |
| `--w-date` | **`140px` / `165px`** | `.w-field-date` | Campos de fecha con icono de calendario |
| `--w-select-sm` | **`200px`** | `.w-field-select-sm` | Desplegables cortos: Condición de IVA, Períodos, Moneda |
| `--w-select-md` | **`260px`** | `.w-field-select-md` | Desplegables medios: Tipo Operación, Vendedor, Medio de Pago |
| `--w-text-md` | **`320px`** | `.w-field-text-md` | Nombres breves, búsquedas simples |
| `--w-account-group` | **`364px`** | `.w-field-account-group` | Selector agrupado de Plan de Cuentas / Centro de Costo |
| `--w-fill` | **`1fr / flex: 1`** | `.w-field-fill` | Observaciones, razones sociales, descripciones largas |

> **Regla de Oro:** **Prohibido aplicar `w-full` o columnas de flex arbitrarias (`col-6`) a campos cortos o de longitud fija.**

---

## Bordes y Sombras

* **Border Radius:**
  * Tarjetas, contenedores, inputs y botones: **`4px`** (`border-radius: 4px` / `{border.radius.sm}`).
  * Badges y píldoras: **`9999px`** (`border-round`).
  * Modales y overlays: **`6px`**.
* **Sombras (Box Shadows):**
  * Tarjeta estándar: `box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05)` (`shadow-1`).
  * Overlays, Popovers y Dropdowns: `box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)`.
  * Diálogos Modales: `box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35)`.

---

# 7. TEMA

* **Ubicación del archivo principal:** `app/theme/solgest-preset.ts`
* **Configuración en Nuxt:** `nuxt.config.ts` bajo la sección `primevue.options.theme`:
  ```typescript
  theme: {
    preset: SolGestPreset,
    options: {
      prefix: 'p',
      darkModeSelector: '.app-dark',
      cssLayer: false
    }
  }
  ```
* **Estructura del Preset:** Basado en **Nora** (`@primevue/themes/nora`), modificado con `definePreset` para garantizar alta densidad de datos.

### Fragmento Esencial para Reproducir en React:
```typescript
export const SolGestDesignTokens = {
  primary: {
    50: '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    300: '#6ee7b7',
    400: '#34d399',
    500: '#10b981',
    600: '#059669', // Brand Primary
    700: '#047857',
    800: '#065f46',
    900: '#064e3b',
    950: '#022c22',
  },
  surface: {
    ground: '#f8fafc',
    card: '#ffffff',
    border: 'rgba(0, 0, 0, 0.08)',
    text: '#0f172a',
    textSecondary: '#64748b',
  },
  controlHeight: '36px',
  borderRadius: '4px',
  fontFamily: "'Inter', sans-serif",
  fontSize: '0.8125rem', // 13px
};
```

---

# 8. BOTONES

SolGest ERP estandariza los botones mediante el componente `Button` de PrimeVue:

* **Variantes y Severidades:**
  * **Primary (Acción principal única):** `severity="primary"` (Fondo verde `#059669`, texto blanco, `font-bold`). Solo 1 acción primaria por pantalla.
  * **Secondary (Acción neutral/secundaria):** `severity="secondary"` (Gris `#64748b`). Generalmente en variante `outlined` para "Volver a la grilla", "Cancelar", "Cerrar".
  * **Danger (Acciones destructivas):** `severity="danger"` (Rojo `#b91c1c`). Siempre acompañado de confirmación modal.
  * **Success:** `severity="success"` (Verde). Usado en confirmación transaccional como "Facturar (CAE)".
  * **Warning / Help / Info:** Variantes específicas para supervisión o fichas técnicas.
  * **Icon Button (Botón compacto):** Clase **`.btn-icon-36`** (`width: 36px; height: 36px; padding: 0;`).
* **Estados Obligatorios:**
  * **Loading:** `:loading="loading"` (deshabilita el botón e inserta un spinner sincronizado).
  * **Disabled:** `:disabled="loading || !isValid"` (opacidad `0.6`, cursor `not-allowed`).
  * **Altura canónica:** `class="control-36"` y `size="small"`.

### Ejemplo Real de Botonera:
```html
<div class="flex gap-2 align-items-center">
  <Button label="Volver a la Grilla" icon="pi pi-list" severity="secondary" size="small" outlined class="control-36" @click="goBack" />
  <Button label="Limpiar" icon="pi pi-refresh" severity="secondary" size="small" text class="control-36" @click="resetForm" />
  <Button label="Guardar Registro" icon="pi pi-check" severity="primary" size="small" class="font-bold control-36" :loading="saving" @click="handleSave" />
</div>
```

---

# 9. INPUTS Y FORMULARIOS

### Componentes de Entrada Utilizados:
* `InputText`: Campos de texto alfanuméricos.
* `InputNumber`: Cantidades, importes y alícuotas (`locale="en-US"`, decimalSeparator `.`, miles sin separación en teclado, `tabular-nums`).
* `Dropdown` / `Select`: Desplegables de selección única con filtro integrado (`filter`).
* `AutoComplete`: Búsqueda predictiva con retraso de 250ms.
* `Checkbox` y `RadioButton`: Selección múltiple y opciones exclusivas.
* `Textarea`: Observaciones y textos extensos (`rows="3"`).
* `DatePicker`: Selector de fecha con máscara `dd/mm/aaaa`.
* `ToggleSwitch` / `InputSwitch`: Selectores booleanos de alta visibilidad (36x20px en `.p-toggleswitch-sm`).
* `FileUpload`: Subida de certificados, comprobantes y planos técnicos.

### Estructura de Formularios (Reglas UI-A y UI-G):
1. **Etiqueta Arriba:** Toda etiqueta `<label>` se sitúa estrictamente encima del input.
2. **Campos Requeridos:** Llevan asterisco rojo: `<span class="text-red-500">*</span>`.
3. **Contenedor Compartido (`<FormGrid>`):** Cuando el formulario tiene 2 o más filas, se utiliza incondicionalmente un grid CSS unificado con columnas derivadas de la fila más exigente y canaletas explícitas de 16px (separación entre grupos de 32px), asegurando alineación vertical estricta.

### Ejemplo Representativo:
```html
<FormGrid data-ui-grid="formulario-maquinas">
  <FormField label="Código de Máquina" required class="w-field-code-xs">
    <InputText v-model="formData.codigo" class="control-36 w-field-code-xs" maxlength="6" />
  </FormField>

  <FormField label="Descripción / Nombre del Equipo" required class="w-field-fill">
    <InputText v-model="formData.descripcion" class="control-36 w-full" maxlength="100" />
  </FormField>

  <FormField label="Centro Operativo" required class="w-field-select-md">
    <Dropdown v-model="formData.centro_id" :options="centros" optionLabel="nombre" optionValue="id" class="control-36 w-field-select-md" />
  </FormField>
</FormGrid>
```

---

# 10. TABLAS

La grilla de datos es el corazón operativo del sistema:
* **Librería:** `primevue/datatable` envuelto en `app/components/AppDataTable.vue`.
* **Densidad:** Siempre **`class="p-datatable-sm"`**.
* **Headers:** Fondo sutil (`surface-100`), texto 12px con `font-weight: 700`, borde inferior `1px solid var(--surface-border)`.
* **Celdas y Filas:** Altura compacta (`padding: 0.25rem 0.5rem`), borde inferior atenuado `rgba(0,0,0,0.05)`.
* **Alineación de Columnas:**
  * Códigos, estados, fechas: centrados (`.text-center`).
  * Nombres, descripciones: a la izquierda (`.text-left`).
  * Cantidades, importes y porcentajes: a la derecha (`.text-right`) con clase `.tabular-nums`.
* **Selección de Renglón:**
  * Fondo iluminado **`#dbeafe`** con texto **`#0f172a`** y franja verde izquierda institucional (`box-shadow: inset 4px 0 0 0 #059669`).
* **Scroll Interno Acotado:** Tablas extensas implementan `scrollable scrollHeight="flex"` con cabeceras fijas (*sticky*). Prohibido que la tabla desborde el alto de la ventana del navegador.
* **Paginación:** Paginador remoto (`lazy`, `:totalRecords`, `:rows="10"`, selector `[10, 25, 50]`).
* **Overlay de Carga:** Máscara translúcida (`rgba(255, 255, 255, 0.72)` con `backdrop-filter: blur(1.5px)`) con spinner verde institucional.

---

# 11. MODALES / DRAWERS / DIÁLOGOS

* **Cuándo se usan:**
  * Exclusivamente para **tareas cortas** ($le 6$ campos), **confirmaciones de peligro** y **búsquedas avanzadas / selección** (`AppLookup`, `EntitySearchDialog`, `ArticleSearchDialog`).
  * **Prohibición:** La confección de transacciones complejas (Facturas, Asientos, Órdenes) se realiza en páginas completas con pestañas multiventa, **NUNCA en modales**.
* **Componente Base:** `primevue/dialog` y `primevue/confirmdialog`.
* **Estilos y Fondo:**
  * Fondo 100% sólido opaco: `var(--surface-card, #ffffff)` (Light) / `#18181b` (Dark).
  * Máscara modal (*backdrop*): `rgba(15, 23, 42, 0.6)` con filtro desenfoque `backdrop-filter: blur(3px)`.
* **Tamaños Habituales:**
  * Pequeño / Confirmaciones: `width: 420px` a `500px`.
  * Mediano / Búsquedas: `width: 750px` a `900px`.
  * Amplio / Fichas técnicas: `width: 90vw; max-width: 1200px`.

---

# 12. CARDS Y PANELES

* **Clase Base Card:** `.card` (`background: var(--surface-card); border: 1px solid var(--surface-border); border-radius: 4px;`).
* **Componente `<SectionCard>`:** Contenedor de sección de formulario con cabecera de título, padding interior de 16px y separación estándar.
* **Tarjetas Métricas KPI (Dashboards y Gestión):**
  * Bloque con `border-1 surface-border border-round surface-card shadow-1`.
  * Título en mayúsculas pequeñas (11px, `text-500 font-semibold`).
  * Cifra destacada en 24px (`text-2xl font-bold text-900`).
  * Subtexto o comparativa en 12px (`font-mono` o `text-600`).
* **Paneles de Pestañas:** `<TabView>` / `<TabPanel>` o componentes `<Tabs>` de PrimeVue 4 con borde inferior atenuado (`surface-border`).

---

# 13. ICONOGRAFÍA

* **Librería:** **PrimeIcons `^7.0.0`** (formato de clase CSS: `pi pi-<nombre>`).
* **Estilo:** Iconos de línea (*outline*) de 16x16px nativos.
* **Forma de Importación:** Carga global de la hoja de estilos `primeicons/primeicons.css` en `nuxt.config.ts`.
* **Iconos Reales Frecuentes en el Sistema:**
  * Navegación y estructura: `pi-home`, `pi-bars`, `pi-chevron-down`, `pi-chevron-right`, `pi-times`, `pi-pushpin`, `pi-sitemap`.
  * Acciones: `pi-plus`, `pi-search`, `pi-pencil`, `pi-trash`, `pi-refresh`, `pi-check`, `pi-print`, `pi-download`, `pi-bolt`.
  * Módulos de negocio: `pi-shopping-cart` (Ventas), `pi-shopping-bag` (Compras), `pi-percentage` (Contabilidad), `pi-box` (Almacén), `pi-cog` (Producción/Configuración), `pi-wrench` (Mantenimiento recomendado).
  * Estados: `pi-check-circle` (Éxito), `pi-shield` (Supervisado), `pi-exclamation-triangle` (Alerta), `pi-info-circle` (Información).

---

# 14. FEEDBACK AL USUARIO

* **Toast:** `useToast().add({ severity: 'success'|'info'|'warn'|'error', summary: '...', detail: '...', life: 4000 })`.
* **Confirmaciones:** `useConfirm().require({ message: '...', header: '...', icon: 'pi pi-exclamation-triangle', accept: () => {} })`.
* **Protocolo de Tiempos de Respuesta (Directiva 01.97):**
  * **Demora < 1 s:** No se muestra nada.
  * **Demora 1 a 10 s:** Indicador indeterminado con texto (`useProcesando` o `<IndicadorProceso>` con filtro anti-flicker de 400ms).
  * **Demora > 10 s:** Barra con % real + etapa + botón Cancelar con corte real en PostgreSQL (`<ProgressPanel>` vía SSE con `createEventStream`).
  * **Demora > 60 s:** Tarea asincrónica en cola (`pg-boss`) y notificación al concluir.
* **Cero Porcentajes Simulados:** Prohibido mostrar barras estimadas por tiempo si no hay progreso cuantitativo real.
* **Estados Vacíos:** Componente `<EmptyState icon="pi pi-box" message="No se encontraron registros" />` con botón de acción sugerida.

---

# 15. RESPONSIVE DESIGN

* **Breakpoints Estándar PrimeFlex:**
  * `sm`: **`576px`** (Móviles en horizontal)
  * `md`: **`768px`** (Tablets)
  * `lg`: **`992px`** (Laptops / Escritorio compacto)
  * `xl`: **`1200px`** (Monitores estándar de escritorio)
* **Objetivo de Diseño Industrial (Uso en Planta / Celulares):**
  * En dispositivos móviles (`< 768px`), el sidebar se colapsa a modo cajón flotante activado por el botón hamburguesa (`pi-bars`).
  * Los formularios de múltiples columnas colapsan a 1 columna (`col-12 md:col-6 lg:col-4`).
  * Las tablas deben implementar scroll horizontal táctil o estructura de tarjetas de lectura rápida.
  * La barra de botones de acción debe mantenerse anclada en el pie visible de la pantalla móvil (`position: sticky; bottom: 0`).
* **Ergonomía de Escritorio a 100% de Zoom (Regla R-UI-02: Zero Page-Scroll):**
  * En resoluciones a partir de 1366×768, la página **no debe generar scroll vertical en la ventana del navegador (`body`/`html`)**.
  * Las tablas usan scroll interno (`scrollable scrollHeight="flex"`) y las botoneras permanecen siempre visibles.

---

# 16. AUTENTICACIÓN DESDE EL FRONTEND

> *Nota de Seguridad:* Toda la información descripta corresponde a la arquitectura del cliente sin exponer secretos.

* **Pantalla de Login (`app/pages/login.vue`):**
  * Renderizada con layout `auth`.
  * Presenta `LoginBanner` corporativo y `LoginForm` con captura de usuario y contraseña o acceso con Google.
* **Almacenamiento de Sesión:**
  * Token de acceso JWT en **`localStorage.getItem('accessToken')`** y replicado en cookies del navegador (`SameSite=Lax; max-age=28800` / 8 horas).
  * Usuario activo serializado en **`localStorage.getItem('currentUser')`**.
* **Flujo de Onboarding Multi-Tenant:**
  1. `/login` $ightarrow$ Valida credenciales contra `/api/auth/login`.
  2. Si tiene múltiples contratos $ightarrow$ Redirige a `/select-contract`.
  3. Si no tiene empresa activa $ightarrow$ Redirige a `/select-company`.
  4. Si no tiene ámbito operativo $ightarrow$ Redirige a `/select-scope` (selección de Sucursal y Centro Operativo).
  5. Con contexto completo $ightarrow$ Redirige a la pantalla inicial `/`.
* **Guardia Global (`app/middleware/auth.global.ts`):**
  * Intercepta cada navegación, verifica la existencia de `accessToken`, empresa y ámbito, y carga automáticamente los permisos ACL vía `aclStore.fetch()`.
* **Mecanismo de Cierre de Sesión (Logout):**
  * Invocado desde la barra superior (`authStore.logout()`), limpia el store de Pinia, elimina cookies y claves de `localStorage`, y navega a `/login`.

---

# 17. ROLES Y PERMISOS

* **Representación en el Frontend:**
  * Administrador Global: `currentUser.role === 'admin'`.
  * Administrador del Contrato: `currentUser.es_administrador_contrato === true`.
  * Operarios y Usuarios de Negocio: Matriz granular de permisos gestionada en `app/stores/acl.ts`.
* **Estructura de la Matriz ACL:**
  * Objeto indexado por módulo y acción: `{ [modulo: string]: { [accion: string]: boolean } }`.
  * Ejemplo: `{ ventas: { ver: true, crear: true, anular: false }, ctasmg: { ver: true } }`.
* **Evaluación en Código:**
  * Vía store: `aclStore.can('mantenimiento', 'ver')`.
  * Vía composable: `useCan('mantenimiento', 'crear')`.
* **Ocultamiento de Menús y Botones:**
  * Las opciones de navegación se filtran reactivamente en `default.vue` mediante la propiedad computada `filteredMenu`.
  * Botones operativos en formularios aplican `:disabled="!canEdit"` o `v-if="canDelete"`.

---

# 18. API / SERVICES

* **Herramienta Central:** Cliente HTTP configurado con **`$fetch.create`** en `app/composables/useApiClient.ts`.
* **Configuración Base:**
  * `baseURL: '/api'`
  * Detección automática para evitar duplicación `/api/api/`.
* **Interceptores de Solicitud (`onRequest`):**
  * Inyecta header de autorización: `Authorization: Bearer <accessToken>`.
  * Inyecta header de aislamiento tenant: `X-Empresa-Id: <selectedCompanyId>`.
* **Interceptores de Respuesta (`onResponseError`):**
  * Captura respuestas HTTP 401 (No Autorizado), ejecuta `authStore.logout()` y redirige automáticamente al usuario a `/login`.
* **Sanitización de Errores (`formatApiErrorMessage`):**
  * Limpia las cadenas de error HTTP devueltas por el backend (ej. elimina prefijos `[PUT] "/api/...": 403`) para mostrar un texto limpio y comercial en las alertas Toast.

---

# 19. CONVENCIONES DE CÓDIGO

* **Componentes Vue / React:**
  * Nombres de componentes: **PascalCase** (`SectionCard.vue`, `AppDataTable.vue`, `FormField.vue`).
* **Nombres de Archivos y Rutas:**
  * Páginas: **kebab-case** (`resumen-subcuentas.vue`, `cierre-periodos.vue`, `nueva.vue`).
  * Composables / Hooks: **camelCase** con prefijo `use` (`useApiClient.ts`, `useNumberFormat.ts`, `useAtajos.ts`).
  * Stores: **camelCase** (`auth.ts`, `acl.ts`, `menu.ts`, `formGuard.ts`).
* **Aliases de Rutas:**
  * `~/` o `@/` resuelve a la raíz del directorio frontend (`app/`).
* **Organización Interna de Componentes:**
  * `<template>` primero, seguido de `<script setup lang="ts">` y `<style scoped>` al final si se requieren ajustes locales.

---

# 20. COMPONENTES REUTILIZABLES

A continuación se detallan los componentes compartidos existentes en el proyecto que deben tomarse como referencia directa para el nuevo módulo:

| Componente | Ubicación | Uso | Props Principales |
|---|---|---|---|
| `AppPage` | `app/components/AppPage.vue` | Envoltorio raíz de página con título, migas de pan y barra de herramientas | `title`, `subtitle`, `icon`, `breadcrumbs` |
| `AppDataTable` | `app/components/AppDataTable.vue` | Grilla de datos estandarizada con densidad compacta (`p-datatable-sm`) | `value`, `columns`, `loading`, `paginator`, `rows`, `totalRecords` |
| `SectionCard` | `app/components/SectionCard.vue` | Tarjeta contenedora de sección de formulario con padding 16px | `title`, `icon` |
| `FormField` | `app/components/FormField.vue` | Contenedor de campo individual con etiqueta superior y asterisco de requerido | `label`, `required`, `error`, `hint` |
| `FormGrid` | `app/components/FormGrid.vue` | Contenedor CSS Grid para alineación vertical estricta entre múltiples filas | `columnsTemplate`, `gap` |
| `FormRow` | `app/components/FormRow.vue` | Contenedor flex horizontal para formularios simples de 1 fila | `gap`, `align` |
| `MoneyInput` | `app/components/MoneyInput.vue` | Entrada de importes alineada a derecha, `tabular-nums`, sin separador de miles en teclado | `modelValue`, `disabled`, `currency`, `maxlength` |
| `DateInput` | `app/components/DateInput.vue` | Selector de fecha con atajos de teclado (`h`=hoy, `+`, `-`) | `modelValue`, `disabled`, `minDate`, `maxDate` |
| `CuitInput` | `app/components/CuitInput.vue` | Entrada de CUIT con máscara `99-99999999-9` y validación de dígito | `modelValue`, `disabled` |
| `AppLookup` | `app/components/AppLookup.vue` | Campo de búsqueda inteligente con autocompletado y atajo F3 para diálogo | `modelValue`, `catalog`, `labelField`, `valueField` |
| `StatusTag` | `app/components/StatusTag.vue` | Etiqueta semántica para estados (Borrador, Activo, Pendiente, Anulado) | `value`, `severity` |
| `EmptyState` | `app/components/EmptyState.vue` | Ilustración, mensaje explicativo y botón de acción ante grillas vacías | `icon`, `title`, `description`, `actionLabel` |
| `IndicadorProceso` | `app/components/IndicadorProceso.vue` | Spinner de progreso anti-flicker con texto para operaciones de 1 a 10s | `visible`, `mensaje` |
| `ProgressPanel` | `app/components/ProgressPanel.vue` | Barra con porcentaje real SSE y botón Cancelar para tareas > 10s | `taskId`, `onCancel` |
| `ConfirmDanger` | `app/components/ConfirmDanger.vue` | Diálogo modal de confirmación para eliminaciones o acciones críticas | `visible`, `title`, `message`, `onAccept` |
| `EntitySearchDialog` | `app/components/EntitySearchDialog.vue` | Diálogo de búsqueda avanzada de Clientes / Proveedores | `visible`, `tipo` ('cliente' | 'proveedor'), `onSelect` |
| `ArticleSearchDialog` | `app/components/ArticleSearchDialog.vue` | Diálogo de búsqueda avanzada del catálogo de artículos | `visible`, `onSelect` |
| `AsientoVisorModal` | `app/components/asientos/AsientoVisorModal.vue`| Visor modal universal de asientos contables sobre la pantalla actual | `transaccionId`, `onGuardado` |

---

# 21. ASSETS

* **Logos e Isotipos:**
  * `public/favicon.png` (Isotipo institucional verde y azul, 55 KB).
  * `public/favicon-32x32.png`, `public/favicon-192x192.png`, `public/favicon.ico`.
  * `public/images/logo-solgest.png` (Logo institucional con isotipo + texto).
  * `public/images/logo-soltec.png` (Logo de la empresa desarrolladora).
* **Fondos de Pantalla:**
  * `Logos/solgest-fondo.jpg` (Fondo texturizado para pantallas de bienvenida/login).
* **Fuentes:**
  * Familia **`Inter`** suministrada automáticamente mediante el módulo `@nuxt/fonts` conectándose con Google Fonts.
* **Iconos Propios:**
  * No hay tipografías de iconos propietarias; se utiliza exclusivamente **PrimeIcons `^7.0.0`**.

---

# 22. PANTALLAS REPRESENTATIVAS

Se seleccionaron 4 pantallas maestras que representan los floorplans canónicos del sistema:

### 1. Confección de Facturas de Venta (`app/pages/ventas/facturacion/index.vue` - Pestaña 1)
* **Floorplan:** *Documento Transaccional*.
* **Layout:** Cabecera con selector de talonario, letra y punto de venta; selector de cliente con atajo F3; grilla de artículos editable con cálculo reactivo de IVA y bonificación; pie de totales anclado con partida doble y botón "Facturar (CAE)".
* **Componentes:** `SectionCard`, `EntitySearchDialog`, `ArticleSearchDialog`, `MoneyInput`, `Button`.

### 2. Resumen de Subcuentas (`app/pages/contabilidad/reportes/resumen-subcuentas.vue`)
* **Floorplan:** *Consulta / Reporte*.
* **Layout:** Barra de título de 56px; barra superior con chips de filtros activos y botón "Modificar Parámetros"; panel de filtros `<FormGrid>` estructurado; menú popup para exportar a PDF y Excel; grilla de subcuentas con columnas coloreadas (Debe en azul, Haber en rojo, Saldos en verde/rojo) y apertura de asiento contable en visor flotante.
* **Componentes:** `FormGrid`, `FormField`, `DateInput`, `Menu`, `Button`, `Toast`.

### 3. Maestro de Artículos (`app/pages/crud/artgen.vue`)
* **Floorplan:** *Ficha de Catálogo*.
* **Layout:** Barra lateral o toolbar con acciones CRUD (Nuevo, Guardar, Cancelar, Eliminar); pestañas de organización (General, Costos/Fletes, Precios/Venta, Clasificación, Fotos/Planos CAD); visor 3D para archivos DXF.
* **Componentes:** `VerticalToolbarCrud`, `Tabs`, `TabList`, `TabPanels`, `InputText`, `Dropdown`, `ArticuloCadViewerModal`.

### 4. Panel de Control / Dashboard (`app/pages/index.vue`)
* **Floorplan:** *Tablero de Gestión (KPI)*.
* **Layout:** Encabezado con bienvenida y botón "Actualizar Métricas"; grilla de tarjetas KPI con sombras (`shadow-2`), iconos coloreados por subsistema y estados de carga con `<Skeleton>`; accesos directos personales configurados por el usuario.
* **Componentes:** `Card`, `Skeleton`, `Button`.

---

# 23. PLANTILLA PARA UNA NUEVA PÁGINA (REACT)

Para que el desarrollador del módulo **Mantenimiento** construya la página de **Máquinas y Equipos**, se transcribe la plantilla adaptada a React utilizando componentes equivalentes de **PrimeReact**:

```tsx
// src/modules/mantenimiento/pages/MaquinasPage.tsx
import React, { useState, useEffect } from 'react';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { Dropdown } from 'primereact/dropdown';
import { Tag } from 'primereact/tag';
import { Toast } from 'primereact/toast';

export const MaquinasPage: React.FC = () => {
  const [maquinas, setMaquinas] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [globalFilter, setGlobalFilter] = useState<string>('');
  const [selectedMaquina, setSelectedMaquina] = useState<any>(null);

  return (
    <div className="card p-3 flex flex-column gap-3">
      {/* 1. Barra de Título y Acciones Canónicas (Header Bar 56px) */}
      <div className="header-bar-56 flex flex-column md:flex-row justify-content-between align-items-start md:align-items-center gap-2 border-bottom-1 surface-border pb-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-primary flex align-items-center gap-2 m-0">
            <i className="pi pi-cog"></i> Gestión de Máquinas y Equipos
          </h1>
          <span className="text-xs text-500 font-medium">
            Mantenimiento &bull; Catálogos &bull; Parque de Maquinarias e Instalaciones
          </span>
        </div>

        <div className="flex gap-2 align-items-center">
          <Button
            label="Nueva Máquina"
            icon="pi pi-plus"
            severity="primary"
            size="small"
            className="font-bold control-36"
            onClick={() => {/* Abrir creación */}}
          />
        </div>
      </div>

      {/* 2. Barra de Búsqueda Rápida */}
      <div className="flex justify-content-between align-items-center">
        <div className="p-inputgroup control-36" style={{ maxWidth: '320px' }}>
          <span className="p-inputgroup-addon"><i className="pi pi-search"></i></span>
          <InputText
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Buscar por código, serie o nombre..."
            className="control-36"
          />
        </div>
      </div>

      {/* 3. Grilla de Alta Densidad (p-datatable-sm) */}
      <DataTable
        value={maquinas}
        loading={loading}
        className="p-datatable-sm"
        selectionMode="single"
        selection={selectedMaquina}
        onSelectionChange={(e) => setSelectedMaquina(e.value)}
        paginator
        rows={10}
        rowsPerPageOptions={[10, 25, 50]}
        emptyMessage="No se registran máquinas o equipos en el sistema."
      >
        <Column field="codigo" header="Código" className="w-field-code-xs font-bold" />
        <Column field="nombre" header="Nombre / Denominación" className="w-field-fill" />
        <Column field="numero_serie" header="N° de Serie" className="w-field-num-sm" />
        <Column field="centro_operativo" header="Centro Operativo" className="w-field-select-md" />
        <Column
          field="estado"
          header="Estado"
          className="text-center"
          body={(row) => (
            <Tag
              value={row.estado}
              severity={row.estado === 'OPERATIVA' ? 'success' : 'danger'}
            />
          )}
        />
        <Column
          header="Acciones"
          className="text-right"
          body={(row) => (
            <div className="flex justify-content-end gap-1">
              <Button icon="pi pi-pencil" text rounded size="small" severity="secondary" title="Editar" />
              <Button icon="pi pi-history" text rounded size="small" severity="info" title="Ver Historial" />
            </div>
          )}
        />
      </DataTable>
    </div>
  );
};
```

---

# 24. PROPUESTA DE INTEGRACIÓN DEL MÓDULO MANTENIMIENTO

### Evaluación de la Estructura Propuesta:
La estructura sugerida por el usuario:
```text
src/
└── modules/
    └── mantenimiento/
        ├── maquinas/
        ├── intervenciones/
        ├── preventivos/
        ├── repuestos/
        └── reportes/
```
* **Evaluación respecto a la arquitectura actual:**
  * En SolGest ERP (Nuxt 4), el sistema utiliza enrutamiento basado en archivos bajo `app/pages/` (`app/pages/mantenimiento/maquinas.vue`, etc.).
  * Si el módulo Mantenimiento se desarrolla como una aplicación independiente en **React**, dicha estructura de carpetas (`src/modules/mantenimiento/...`) es **excelente y modular**.

### Estrategias de Integración Técnica:

#### Opción 1: Aplicación Satélite Embebida (Recomendada para Repositorios Separados)
* Mantenimiento corre como un proyecto React independiente (con Vite o Next.js).
* Se integra dentro de SolGest ERP mediante un contenedor de iframe con comunicación bidireccional por `postMessage` o compartiendo el dominio (mismo hostname, ruta `/mantenimiento/*` mediante reverse proxy).
* El usuario navega desde el sidebar de SolGest sin percibir el cambio de entorno gracias a la paridad de estilos y tokens.

#### Opción 2: Microfrontend (Module Federation con Vite)
* La aplicación React expone sus páginas/componentes vía Webpack/Vite Module Federation.
* Un contenedor React montado en una página comodín de Nuxt (`app/pages/mantenimiento/[...slug].vue`) monta el componente React correspondiente.

---

# 25. INFORMACIÓN QUE DEBEMOS COPIAR AL NUEVO PROYECTO

Para asegurar que el módulo React sea visualmente idéntico, la información se divide en tres niveles de prioridad:

### A. Imprescindible Copiar / Reproducir:
1. **La paleta de colores y variables CSS:**
   * Replicar las definiciones de `app/assets/css/main.css` y `app/assets/css/login-tokens.css`.
   * Color primario `#059669` (Light) / `#10b981` (Dark).
   * Selección de tabla con azul `#dbeafe` y franja izquierda verde `inset 4px 0 0 0 #059669`.
2. **Tokens de Anchos Métricos por Tipo de Dato:**
   * Declarar obligatoriamente las clases `.w-field-*` (`.w-field-code-xs: 72px`, `.w-field-pto: 84px`, `.w-field-amount: 128px`, `.w-field-date: 140px`, etc.).
3. **Altura de Control Uniforme de 36px:**
   * La clase `.control-36` con `height: 36px !important` y tamaño tipográfico `0.8125rem` (13px).
4. **Tipografía:**
   * Importar Google Fonts **`Inter`** (pesos 400, 500, 600, 700).
5. **Iconografía:**
   * Instalar y cargar **`primeicons/primeicons.css`**.
6. **Librería UI en React:**
   * Utilizar **PrimeReact** (v10+) con el tema **Nora** (o réplica del SolGestPreset) y **PrimeFlex**.

### B. Conveniente Reutilizar:
1. **Contrato de Headers HTTP:**
   * Replicar el envío de los headers `Authorization: Bearer <token>` y `X-Empresa-Id: <empresa_id>` en cada solicitud a la API.
2. **Formateo de Moneda y Números:**
   * Replicar la lógica de `useNumberFormat.ts` (separador de miles con punto `.` y decimal con coma `,`).
3. **Componentes Análogos:**
   * Desarrollar en React componentes equivalentes a `<SectionCard>`, `<FormField>`, `<FormGrid>` y `<MoneyInput>`.

### C. No es Necesario Compartir:
1. El motor de base de datos Nitro ni esquemas de backend específicos de otros módulos.
2. Los visores de facturación electrónica ARCA ni utilitarios de liquidación de sueldos o contabilidad general.

---

# 26. RIESGOS DE INTEGRACIÓN FUTURA Y MITIGACIONES

| Riesgo Identificado | Causa Potencial | Estrategia de Prevención desde Ahora |
|---|---|---|
| **Inconsistencia de Versiones de UI** | Nuxt utiliza PrimeVue 4; React utilizará PrimeReact 10. | Utilizar en React las mismas clases atómicas de PrimeFlex (`p-datatable-sm`, `p-3`, `gap-3`) y las mismas variables CSS institucionales (`--primary-color`, `--surface-card`). |
| **Colisión de Estilos Globales** | Reglas de CSS que afecten selectores globales como `body` o `input`. | Prefijar las clases del módulo o usar CSS Modules / Tailwind con prefijo o encapsulamiento en un contenedor raíz `.solgest-mantenimiento-root`. |
| **Desincronización de Autenticación** | El módulo React no lee el token o no detecta la expiración de la sesión. | Consumir el token JWT desde `localStorage.getItem('accessToken')` o las cookies `SameSite=Lax` compartidas bajo el mismo dominio base. |
| **Desalineación Visual de Formularios** | Usar `w-full` o anchos arbitrarios en React rompiendo la Directiva UI-01. | Prohibir expresamente `w-full` en datos fijos; obligar al uso de las clases métricas canónicas (`.w-field-*`) y altura de 36px. |
| **Pérdida de la Identidad en Modo Oscuro** | Colores con valores hexadecimales fijos (`#fff`) en el código de React. | Usar siempre variables semánticas (`var(--surface-card)`, `var(--surface-border)`) y respetar el selector `.app-dark`. |
| **Incompatibilidad de Routing** | Rutas colisionando entre Nuxt y el router de React. | Prefijar todas las rutas del módulo satélite con el prefijo unificado `/mantenimiento/*`. |

---

# 27. CHECKLIST PARA EL EQUIPO DE MANTENIMIENTO

Utilice esta lista de verificación técnica antes de iniciar y durante el desarrollo del módulo:

- [ ] **Tecnología Base:** React 18+ con TypeScript 5+.
- [ ] **Librería de Componentes:** PrimeReact 10+ configurado con tema base **Nora**.
- [ ] **Sistema de Layout y CSS:** PrimeFlex 4.0+ y CSS con variables de SolGest ERP.
- [ ] **Tipografía:** Google Fonts **Inter** (pesos 400, 500, 600, 700), tamaño base de controles en **13px** (`0.8125rem`).
- [ ] **Iconografía:** **PrimeIcons 7+** con clases `pi pi-*`.
- [ ] **Color Primario Institucional:** Verde SolGest `#059669` (Light) / `#10b981` (Dark).
- [ ] **Color de Superficies:** Fondo general `#f8fafc` (Light) / `#09090b` (Dark), Tarjetas `#ffffff` / `#18181b`.
- [ ] **Bordes y Esquinas:** Border radius de **4px** en botones, inputs y tarjetas (`border-radius: 4px`).
- [ ] **Altura de Controles:** Exactamente **36px** (`.control-36`) en inputs, dropdowns, botones y calendarios.
- [ ] **Escala de Anchos:** Aplicar clases canónicas (`.w-field-code-xs`, `.w-field-pto`, `.w-field-amount`, `.w-field-date`, etc.). Prohibido `w-full` en datos cortos.
- [ ] **Tablas:** Densidad compacta con **`.p-datatable-sm`**, alineación a la derecha de importes con **`.tabular-nums`**, y selección de fila con fondo **`#dbeafe`** y borde izquierdo verde `inset 4px 0 0 0 #059669`.
- [ ] **Formularios:** Etiquetas arriba con `font-weight: 600`, asterisco rojo en campos requeridos, y alineación en contenedor CSS Grid compartido (`<FormGrid>`).
- [ ] **Modales y Overlays:** Superficie **100% sólida opaca** (`background: var(--surface-card)`), borde de 1px y `z-index: 1200`. Sin transparencias.
- [ ] **Zero Page-Scroll:** En pantallas de escritorio, evitar el scroll vertical de página (`body`); utilizar scroll interno en tablas (`scrollHeight="flex"`) y mantener fijas las botoneras de acción.
- [ ] **Autenticación e Interceptores:** Leer token de `localStorage.getItem('accessToken')` y enviar siempre los headers `Authorization: Bearer <token>` y `X-Empresa-Id: <id>`.
- [ ] **Rutas:** Todas las pantallas deben responder bajo el prefijo unificado `/mantenimiento/*`.

---

# CERTIFICACIÓN FINAL Y DECLARACIÓN DE HALLAZGOS

1. **Revisión de Seguridad y Secretos:**
   * Certifico que este informe **no contiene contraseñas, tokens JWT, connection strings, claves de acceso ni secretos** del entorno de desarrollo ni de producción.
2. **Partes 100% Confirmadas por Código:**
   * Todas las versiones de librerías y dependencias (obtenidas de `package.json`).
   * Configuración de Nuxt, tema SolGestPreset, dark mode, fuentes y segmentación de chunks (`nuxt.config.ts`).
   * Paleta canónica `solgestGreen`, colores contables y tokens de padding/border-radius (`app/theme/solgest-preset.ts`).
   * Variables CSS globales, estilos de DataTable, overlays sólidos y toggles (`app/assets/css/main.css`).
   * Escala métrica de anchos por tipo de dato y altura de 36px (`app/assets/css/login-tokens.css`).
   * Estructura completa del árbol de navegación, rutas, iconos y permisos (`app/config/menu.ts`).
   * Layout default, topbar de 56px, sidebar resizable, tabs con guard de dirty state (`app/layouts/default.vue`).
   * Mecanismo de autenticación, almacenamiento en localStorage/cookies y headers de API (`useApiClient.ts`, `auth.ts`, `acl.ts`).
   * Componentes reutilizables existentes en `app/components/`.
3. **Información No Definida en el Proyecto:**
   * *Librería de formularios de terceros en frontend:* **No definido en el proyecto** (el sistema utiliza reactividad pura de Vue 3, no Formik ni VeeValidate).
   * *Librería externa de fechas (Moment/Dayjs/date-fns):* **No definido en el proyecto** (se utiliza el objeto nativo Date y formateadores estándar).
   * *Código fuente del módulo Mantenimiento:* **No definido en el proyecto** (es una especificación para desarrollo futuro).
4. **Integridad del Repositorio:**
   * **No se ha modificado ningún archivo preexistente del proyecto.**
