# Integración NominaHN → SAP Business One 10 (Service Layer)

Documento técnico de diseño e implementación. Fecha: 15 de octubre de 2026.
Base de código analizada: `nominahn` (Next.js 16, Prisma 7, PostgreSQL 18).

Objetivo: al cerrar una planilla, registrar en SAP Business One un asiento de
diario (`JournalEntries`, objeto 30) con el gasto de nómina, las retenciones y
los aportes patronales, y que todo (conexión, cuándo se envía, mapeo de cuentas
y centros de costo) se administre desde **Configuración → SAP - Conexión**.

---

## 1. Resumen ejecutivo

**Veredicto de viabilidad: viable y de bajo riesgo técnico.** El 80 % del trabajo
contable ya existe en la aplicación: `generarPartidaContable()` produce hoy un
asiento balanceado al centavo, con 30 conceptos remapeables por el contador y
desglose por centro de costo. La integración no construye el asiento, **cambia
su destino**: de un CSV descargable a un `POST /JournalEntries`.

Decisiones que ya estaban tomadas (17-ago-2026) y que este diseño respeta:

| Decisión | Por qué |
|---|---|
| Flujo unidireccional NominaHN → B1 | B1 no trae nómina ni localización Honduras; nada en B1 replica IHSS/RAP/ISR/décimos. |
| Service Layer (OData v4) desde Node | Funciona sobre MS SQL desde B1 10.0 PL02. DI API, B1WS y B1if descartados con motivo. |
| Se envía solo la planilla cerrada | `Planilla.cerradaAt` + `hashCalculo` ya existen: son el ancla de idempotencia. |
| Corregir con asiento de reverso | Nunca borrar ni editar en B1. |

**Dos bloqueadores que van antes del código**, y no son de software:

1. **Licencia Indirect Access** cerrada con el partner de SAP (costo recurrente, reglas por región).
2. **Red**: el Service Layer vive en la LAN del cliente, puerto 50000, con certificado propio. Exige que NominaHN corra en esa red o llegue por VPN con IP fija. El despliegue self-hosted en Ubuntu que ya existe en `deploy/` sirve; cualquier opción serverless no.

Y un prerrequisito interno: `CIFRADO_KEY` en el entorno (hoy falta en `.env.local`), porque la contraseña de SAP se guarda cifrada igual que la del correo saliente.

Esfuerzo estimado de desarrollo: **10 a 12 días** de un desarrollador, más el tiempo del consultor B1 y del contador para el catálogo de cuentas y las pruebas contra la empresa de pruebas de SAP. El calendario lo marca la licencia y el catálogo, no el código.

---

## 2. Estado actual de la aplicación

### 2.1 Dónde viven los resultados de la planilla

| Qué | Dónde | Detalle |
|---|---|---|
| Cabecera | `Planilla` | Tipo, período, estado (BORRADOR → CALCULADA → APROBADA → PAGADA / ANULADA), totales bruto/deducciones/neto/patronal, `fechaPago`, `cerradaAt`, `hashCalculo` (SHA-256 del contenido económico), `aprobadoPor`, `pagadoPor`. |
| Línea por empleado | `PlanillaDetalle` | 37 columnas: salario base, horas extra, bonificaciones, IHSS/IVM empleado y patrono, RAP, INFOP, reserva laboral, AFP, ISR, impuesto vecinal, cooperativa, préstamos, adelantos, ausencias, otras, neto, provisiones 13.º/14.º/vacaciones. |
| Préstamos y adelantos | `DeduccionEmpleado` + `AmortizacionPlanilla` | Delta cobrado por planilla, reversible al anular. |
| Inmutabilidad | Triggers SQL (`prisma/sql/02-*.sql`) | Una planilla APROBADA/PAGADA/ANULADA no admite cambios de importes ni borrado. Esto es lo que hace seguro enviar a SAP: lo enviado no puede cambiar después. |

### 2.2 Partida contable existente

- `src/lib/payroll/partida-contable.ts`: función pura. 13 conceptos de gasto (Debe) y 17 de pasivo (Haber), cuadre exacto sin tolerancia, importes negativos registrados en el lado contrario y listados como anomalías.
- `generarPartidaPorCentroCosto()`: reparte **solo el gasto** por centro de costo (empleado → departamento → "SIN-CENTRO") y concilia contra el consolidado al centavo. Los pasivos no se reparten: son obligaciones de la empresa.
- `CuentaContable` + `src/lib/payroll/plan-cuentas.ts`: el contador remapea código y nombre de cada concepto desde `/plan-cuentas`; la `clave` (`sueldos`, `isrPorPagar`…) es estable.
- `CentroCosto` con `cuentaGasto` opcional (subcuenta por área).
- `GET /api/planillas/[id]/partida` entrega el asiento en JSON o CSV, consolidado o por centros.

Asiento real de la planilla mensual de septiembre 2026 de la sucursal de prueba (4 empleados, bruto L 194,000.00): 22 líneas, Debe = Haber = L 250,079.54. Es el ejemplo de la sección 4.

### 2.3 Infraestructura reutilizable

| Pieza | Uso en la integración |
|---|---|
| `src/lib/seguridad/cifrado.ts` (AES-256-GCM, `CIFRADO_KEY`) | Contraseña del usuario de SAP. |
| `ConfiguracionCorreo` + `/api/configuracion/correo` (+ `/prueba`) | Patrón exacto para la pantalla: fila única `id = "default"`, la contraseña entra y no vuelve a salir, botón de prueba con la configuración guardada. |
| Catálogo de permisos (`src/lib/auth/permisos.ts`) | Permisos `sensible` que por omisión solo tiene SUPER_ADMIN: `configuracion.correo`, `configuracion.parametros`. El de SAP sigue el mismo criterio. |
| `audit()` (`src/lib/audit.ts`) | Rastro de cada envío y cada cambio de configuración. |
| `/api/cron/biometrico` (`x-cron-secret`) | Precedente del worker de reintentos. |
| `estado-planilla.ts` (`calcularHashPlanilla`, `verificarIntegridad`) | Verificar que lo que se envía es lo que se cerró. |

### 2.4 El módulo de Administración

En la aplicación se llama **Configuración** (menú lateral, `/configuracion`) y es una pantalla con pestañas: Empresa, Sucursales y departamentos, Salarios, Configuración general, Parámetros de ley, Correo saliente. Cada pestaña sensible aparece solo si el perfil tiene su permiso. El plan de cuentas vive aparte, en Nómina → Plan de cuentas.

**"SAP - Conexión" encaja como una pestaña más de Configuración**, detrás del permiso `configuracion.sap`. Dentro lleva cuatro secciones (conexión, comportamiento, mapeo, bitácora). No hace falta un módulo nuevo en el menú.

### 2.5 Huecos a cubrir

1. No hay tabla de salida (outbox) ni enlace planilla ↔ asiento de SAP.
2. El mapeo del plan de cuentas guarda el código del catálogo del cliente, pero el Service Layer exige el `AcctCode` interno de B1, que en planes segmentados es `_SYS00000000123` y no el código visible (`FormatCode`).
3. Los centros de costo no tienen el código de centro de beneficio / norma de reparto de B1.
4. No hay worker de reintentos ni traducción de errores de SAP.

---

## 3. Diseño del submódulo Configuración → SAP - Conexión

### 3.1 Modelo de datos (Prisma)

```prisma
enum ModoEnvioSap   { MANUAL  AL_APROBAR  AL_PAGAR }
enum EstadoEnvioSap { PENDIENTE  ENVIANDO  ENVIADO  ERROR  CANCELADO }
enum TipoEnvioSap   { ASIENTO  REVERSO }

/// Conexión y comportamiento. Una sola fila, id = "default", como ConfiguracionCorreo.
model IntegracionSap {
  id                  String        @id @default("default")
  activo              Boolean       @default(false)
  /// https://servidor:50000/b1s/v1/
  urlBase             String
  companyDb           String
  usuario             String
  /// AES-256-GCM con CIFRADO_KEY. Nunca sale de la API.
  passwordCifrado     String?
  modoEnvio           ModoEnvioSap  @default(MANUAL)
  incluirProvisiones  Boolean       @default(true)
  porCentroCosto      Boolean       @default(false)
  /// Dimensión de B1 (1 a 5) en la que viven los centros de costo → CostingCode…CostingCode5.
  dimensionCentro     Int           @default(1)
  /// Fecha contable del asiento: PAGO (fechaPago) o FIN_PERIODO (fechaFin).
  fechaContable       String        @default("PAGO")
  /// OJDT.TransCode, 4 caracteres, p. ej. "NOMI". Opcional.
  codigoTransaccion   String?
  /// Serie de numeración del asiento si la empresa usa series. Opcional.
  serie               Int?
  memoPlantilla       String        @default("Planilla {tipo} {desde} al {hasta}")
  /// Resultado de la última prueba de conexión.
  ultimaPruebaAt      DateTime?
  ultimaPruebaOk      Boolean?
  ultimaPruebaDetalle String?
  versionSap          String?
  actualizadoPor      String?
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt
}

/// Outbox: una fila por planilla y tipo de envío. Los reintentos actualizan la fila.
model SapEnvioAsiento {
  id               String         @id @default(cuid())
  planillaId       String
  planilla         Planilla       @relation(fields: [planillaId], references: [id])
  tipo             TipoEnvioSap   @default(ASIENTO)
  estado           EstadoEnvioSap @default(PENDIENTE)
  /// Huella de la planilla al encolar. Si no coincide al enviar, se aborta.
  hashCalculo      String
  /// JSON exacto enviado (o por enviar): es lo que se audita y lo que se reintenta.
  payload          Json
  respuesta        Json?
  /// JournalEntries.JdtNum (OJDT.TransId) y JournalEntries.Number.
  sapTransId       Int?
  sapNumero        Int?
  intentos         Int            @default(0)
  proximoIntentoAt DateTime?
  /// Lock del worker: evita que dos procesos envíen la misma fila.
  bloqueadoHasta   DateTime?
  errorCodigo      String?
  errorMensaje     String?        @db.Text
  errorTraducido   String?
  esTransitorio    Boolean?
  /// Para REVERSO: el envío que se revierte.
  reversoDeId      String?
  creadoPor        String?
  enviadoAt        DateTime?
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  bitacora         SapBitacora[]

  @@unique([planillaId, tipo])
  @@index([estado, proximoIntentoAt])
}

/// Un registro por intento, para que el contador vea qué dijo SAP y cuándo.
model SapBitacora {
  id          String          @id @default(cuid())
  envioId     String
  envio       SapEnvioAsiento @relation(fields: [envioId], references: [id], onDelete: Cascade)
  intento     Int
  httpStatus  Int?
  duracionMs  Int
  resultado   String          // OK | ERROR
  errorCodigo String?
  mensaje     String?         @db.Text
  createdAt   DateTime        @default(now())

  @@index([envioId, createdAt])
}
```

Cambios en modelos existentes (todos aditivos, columnas nulas):

```prisma
model CuentaContable {
  // … existente …
  /// AcctCode interno de B1 para esta clave. Lo que viaja en AccountCode.
  sapAcctCode     String?
  sapNombre       String?
  sapActiva       Boolean?
  sapVerificadaAt DateTime?
}

model CentroCosto {
  // … existente …
  /// Centro de beneficio / norma de reparto en B1 (va en CostingCodeN).
  sapCostingCode  String?
  /// Proyecto de B1, si la empresa imputa la nómina a proyectos. Opcional.
  sapProjectCode  String?
}

model Planilla {
  // … existente …
  enviosSap SapEnvioAsiento[]
}
```

Por qué el mapeo de cuentas vive en `CuentaContable` y no en una tabla nueva: el contador ya remapea ahí los 30 conceptos; una segunda tabla obligaría a mantener dos listas iguales. La columna `sapAcctCode` es el único dato nuevo que B1 necesita.

### 3.2 Permisos nuevos

| Código | Quién por omisión | Para qué |
|---|---|---|
| `configuracion.sap` (sensible) | SUPER_ADMIN | Credenciales, comportamiento, mapeo. |
| `planillas.sap_enviar` (sensible) | CONTADOR, ADMIN_RRHH | Botones "Enviar a SAP", "Reintentar", "Enviar reverso". |
| Ver estado y bitácora | `planillas.contabilidad` (existe) | Columna y pestaña de SAP en la planilla. |

### 3.3 API

| Ruta | Método | Función |
|---|---|---|
| `/api/configuracion/sap` | GET / PUT | Leer (sin contraseña, solo `tienePassword`) y guardar. Contraseña vacía = conservar; `null` = borrar. 503 si falta `CIFRADO_KEY`. |
| `/api/configuracion/sap/prueba` | POST | Login → lee `$metadata` (longitudes de campo) y `ChartOfAccounts?$top=1` → Logout. Devuelve versión, `SessionTimeout`, ms y error legible. Guarda `ultimaPrueba*`. |
| `/api/configuracion/sap/cuentas?q=` | GET | Busca en `ChartOfAccounts` por `Code` o `FormatCode`; devuelve `Code`, `Name`, `FormatCode`, `ActiveAccount`. Para el selector del mapeo. |
| `/api/configuracion/sap/mapeo` | GET / PUT | Los 30 conceptos con su `sapAcctCode` y los centros de costo con `sapCostingCode`. "Validar todo" consulta cada cuenta en B1 y marca inactivas o inexistentes. |
| `/api/planillas/[id]/sap` | GET | Estado del envío, bitácora y **vista previa del payload** sin enviar. |
| `/api/planillas/[id]/sap` | POST `{ accion: "enviar" \| "reintentar" \| "reverso" }` | Encola y procesa. |
| `/api/cron/sap` | POST (`x-cron-secret`) | Worker: procesa PENDIENTE y ERROR transitorio con `proximoIntentoAt <= now`. |

### 3.4 Pantalla

Pestaña "SAP - Conexión" en Configuración, con cuatro bloques en este orden:

1. **Conexión**: URL base, base de datos, usuario, contraseña (vacía = conservar), interruptor "Integración activa", botón **Probar conexión** que muestra versión de B1, tiempo de sesión y el error traducido si falla. Aviso si falta `CIFRADO_KEY`, igual que en Correo saliente.
2. **Comportamiento**: cuándo enviar (manual, al aprobar, al pagar), fecha contable (pago o fin de período), incluir provisiones, repartir gasto por centro de costo y en qué dimensión, código de transacción, serie, plantilla del memo.
3. **Mapeo contable**: tabla con los 30 conceptos (clave, cuenta del plan local, cuenta en SAP con buscador, nombre en SAP, estado de validación) agrupados en Gasto y Pasivos, más la tabla de centros de costo con su código en B1. Botón "Validar contra SAP". Un concepto con importe en una planilla y sin cuenta en SAP bloquea el envío con mensaje claro.
4. **Bitácora**: últimos envíos (planilla, estado, número de asiento, intentos, último error) con enlace a la planilla.

En el detalle de la planilla: una línea "SAP: no enviado / pendiente / enviado, asiento 12345 / error: …" junto al estado, y los botones según permiso y estado. Además "Ver asiento (vista previa)" para que el contador revise el JSON antes del primer envío real.

---

## 4. Flujo del asiento contable

### 4.1 Sesión con el Service Layer

```
POST {urlBase}Login
{ "CompanyDB": "SBO_CLIENTE", "UserName": "nominahn", "Password": "•••" }
→ 200  { "SessionId": "…", "Version": "1000240", "SessionTimeout": 30 }
   Set-Cookie: B1SESSION=…; ROUTEID=…
```

Reglas del cliente HTTP (`src/lib/sap/service-layer.ts`):

- Una sesión en memoria por proceso, reutilizada hasta `SessionTimeout − 2` minutos. Cada login consume un cupo de licencia: no se hace login por petición.
- Cookies `B1SESSION` y `ROUTEID` se reenvían en cada llamada; `ROUTEID` es obligatoria si el SL está detrás de balanceador.
- Ante HTTP 401 (sesión caducada) se hace **un** login nuevo y se repite la petición una vez.
- `POST Logout` al terminar un lote del worker y al probar conexión.
- Certificado propio del servidor: `NODE_EXTRA_CA_CERTS=/ruta/ca.pem` en el servicio systemd. Nunca `rejectUnauthorized: false`.
- Tiempo máximo por petición 20 s (`AbortController`); el worker procesa lotes de 10 por ejecución.
- Usuario de SAP dedicado (`nominahn`), con autorización solo para crear asientos y leer el plan de cuentas.

### 4.2 Payload de `JournalEntries`

Construido por `src/lib/sap/asiento.ts` a partir de `generarPartidaContable()` o `generarPartidaPorCentroCosto()`. Reglas:

- Cada línea lleva `Debit` o `Credit` (el otro en 0), importes positivos con 2 decimales. El cuadre exacto lo garantiza el motor; se reverifica antes de enviar.
- `AccountCode` = `CuentaContable.sapAcctCode` de la clave. Sin mapeo → no se envía.
- `LineMemo` = nombre del concepto, truncado a 50 caracteres (longitud de `JDT1.LineMemo`). `Memo` truncado a 50 (`OJDT.Memo`). `Reference` y `Reference2` a 100. Las longitudes reales se leen de `$metadata` en la prueba de conexión y se guardan.
- `Reference2` = id de la planilla: es la llave de reconciliación. `Reference` = etiqueta legible.
- Con reparto por centros: las líneas de gasto se emiten por centro con `CostingCode` (o `CostingCode2…5` según `dimensionCentro`); los pasivos van sin dimensión. Un empleado sin centro bloquea el envío si el reparto está activo.
- `ReferenceDate` y `DueDate` = fecha contable configurada; `TaxDate` = fin del período.

Ejemplo real, planilla mensual 01/09/2026 al 30/09/2026 de la sucursal de prueba (consolidada, sin centros). Los `AccountCode` son los del plan de ejemplo y se sustituyen por los `AcctCode` del cliente:

```json
{
  "ReferenceDate": "2026-09-30",
  "DueDate": "2026-09-30",
  "TaxDate": "2026-09-30",
  "Memo": "Planilla mensual 01/09/2026 al 30/09/2026",
  "Reference": "NOM-MENSUAL-2026-09-30",
  "Reference2": "prueba-planilla-m-2026-09",
  "TransactionCode": "NOMI",
  "JournalEntryLines": [
    { "AccountCode": "610201", "Debit": 194000.00, "Credit": 0, "LineMemo": "Sueldos y Salarios Ordinarios" },
    { "AccountCode": "610601", "Debit": 2000.00,   "Credit": 0, "LineMemo": "Aporte Patronal IHSS-EM" },
    { "AccountCode": "610602", "Debit": 1666.44,   "Credit": 0, "LineMemo": "Aporte Patronal IVM" },
    { "AccountCode": "610603", "Debit": 1639.25,   "Credit": 0, "LineMemo": "Aporte Patronal RAP" },
    { "AccountCode": "610604", "Debit": 1940.00,   "Credit": 0, "LineMemo": "Aporte Patronal INFOP" },
    { "AccountCode": "610605", "Debit": 6275.85,   "Credit": 0, "LineMemo": "Aporte Patronal Reserva Laboral (RAP)" },
    { "AccountCode": "610901", "Debit": 16166.67,  "Credit": 0, "LineMemo": "Provision Decimo Tercer Mes (Aguinaldo)" },
    { "AccountCode": "610902", "Debit": 16166.67,  "Credit": 0, "LineMemo": "Provision Decimo Cuarto Mes" },
    { "AccountCode": "610903", "Debit": 10224.66,  "Credit": 0, "LineMemo": "Provision Vacaciones" },
    { "AccountCode": "210301", "Debit": 0, "Credit": 3000.00,   "LineMemo": "IHSS-EM por Pagar" },
    { "AccountCode": "210302", "Debit": 0, "Credit": 2856.76,   "LineMemo": "IHSS-IVM por Pagar" },
    { "AccountCode": "210303", "Debit": 0, "Credit": 3278.50,   "LineMemo": "RAP por Pagar" },
    { "AccountCode": "210304", "Debit": 0, "Credit": 1940.00,   "LineMemo": "INFOP por Pagar" },
    { "AccountCode": "210305", "Debit": 0, "Credit": 6275.85,   "LineMemo": "Reserva Laboral RAP por Pagar" },
    { "AccountCode": "210306", "Debit": 0, "Credit": 2850.00,   "LineMemo": "AFP por Pagar" },
    { "AccountCode": "210307", "Debit": 0, "Credit": 19984.67,  "LineMemo": "ISR Retenido por Pagar" },
    { "AccountCode": "210308", "Debit": 0, "Credit": 951.41,    "LineMemo": "Impuesto Vecinal por Pagar" },
    { "AccountCode": "210309", "Debit": 0, "Credit": 500.00,    "LineMemo": "Cooperativa por Pagar" },
    { "AccountCode": "210601", "Debit": 0, "Credit": 16166.67,  "LineMemo": "Decimo Tercer Mes por Pagar" },
    { "AccountCode": "210602", "Debit": 0, "Credit": 16166.67,  "LineMemo": "Decimo Cuarto Mes por Pagar" },
    { "AccountCode": "210603", "Debit": 0, "Credit": 10224.66,  "LineMemo": "Provision Vacaciones por Pagar" },
    { "AccountCode": "2111", "Debit": 0, "Credit": 165884.35, "LineMemo": "Sueldos por Pagar (Neto)" }
  ]
}
```

Suma Debe = Suma Haber = 250,079.54. Con reparto por centro de costo (dimensión 1), las líneas de gasto se desdoblan; fragmento real de la misma planilla:

```json
{ "AccountCode": "610201", "Debit": 155500.00, "Credit": 0, "LineMemo": "Sueldos y Salarios Ordinarios", "CostingCode": "ADM" },
{ "AccountCode": "610201", "Debit": 38500.00,  "Credit": 0, "LineMemo": "Sueldos y Salarios Ordinarios", "CostingCode": "VTA" },
{ "AccountCode": "610605", "Debit": 4735.85,   "Credit": 0, "LineMemo": "Aporte Patronal Reserva Laboral (RAP)", "CostingCode": "ADM" },
{ "AccountCode": "610605", "Debit": 1540.00,   "Credit": 0, "LineMemo": "Aporte Patronal Reserva Laboral (RAP)", "CostingCode": "VTA" }
```

Respuesta de SAP al crear (HTTP 201): el cuerpo devuelve el asiento con `JdtNum` (clave, = `OJDT.TransId`) y `Number`. Se guardan en `sapTransId` y `sapNumero`. Para asientos no existe `DocEntry`: es el nombre que usan los documentos de marketing; en asientos la clave es `JdtNum`.

### 4.3 Estados, idempotencia y reintentos

```
PENDIENTE ──(worker/botón)──► ENVIANDO ──201──► ENVIADO
                                   │
                                   ├── error transitorio ──► PENDIENTE (proximoIntentoAt = backoff)
                                   └── error de negocio  ──► ERROR (espera acción humana)
ERROR ──(reintentar tras corregir)──► PENDIENTE
PENDIENTE / ERROR ──(cancelar)──► CANCELADO
```

- **Encolado**: al cambiar de estado la planilla (`PATCH /api/planillas/[id]`) a APROBADA o PAGADA según `modoEnvio`, se inserta la fila `SapEnvioAsiento` **dentro de la misma transacción** con el payload ya construido y el `hashCalculo` de la planilla. Nunca se llama a SAP dentro de la transacción. Tras el commit se dispara el procesamiento en segundo plano; el cron es la red de seguridad.
- **Idempotencia**: una fila por planilla y tipo (`@@unique`). Antes de cada POST, el worker consulta `GET JournalEntries?$select=JdtNum,Number&$filter=Reference2 eq '<planillaId>'`. Si ya existe (respuesta perdida en un intento anterior) marca ENVIADO con ese número en vez de duplicar. B1 no impone unicidad de `Reference2`: esta consulta es la que la garantiza.
- **Verificación**: si `Planilla.hashCalculo` difiere del guardado en la fila (planilla reabierta y recalculada), se cancela y se encola una nueva.
- **Reintentos**: solo para errores transitorios (red, 5xx, 401, 503), con esperas de 1, 5, 15, 60 minutos y luego cada 6 horas, hasta 10 intentos. Los errores de negocio (período cerrado, cuenta inactiva, dimensión obligatoria) no se reintentan solos: quedan en ERROR con el texto traducido y el botón "Reintentar" para cuando el contador corrija.
- **Lock**: `UPDATE … SET bloqueadoHasta = now() + 2 min WHERE id = ? AND (bloqueadoHasta IS NULL OR bloqueadoHasta < now())`; sin fila afectada, otro proceso la tiene.
- **Reverso**: al anular una planilla ya enviada se encola `tipo = REVERSO` con las líneas invertidas, `Memo` "Reverso planilla …" y `Reference2` = `<planillaId>-R`. Mismo flujo, misma bitácora. Nunca se borra en B1.

### 4.4 Errores del Service Layer y su traducción

Formato OData: `{ "error": { "code": -5002, "message": { "lang": "en-us", "value": "…" } } }`. Los textos exactos varían por versión; la tabla mapea por patrón.

| HTTP / código | Mensaje típico de SAP | Texto para el contador | Reintenta |
|---|---|---|---|
| ECONNREFUSED, ETIMEDOUT, ENOTFOUND | — | "No se alcanza el Service Layer en {host}. Revise red o VPN." | Sí |
| 401 | Invalid session / session timeout | "La sesión con SAP caducó; se vuelve a conectar." | Sí (1 relogin) |
| 403 | No authorization | "El usuario {usuario} no tiene permiso en SAP para crear asientos." | No |
| 400, -5002 | Posting period is locked / Date deviates from permissible range | "El período contable de SAP está cerrado para el {fecha}. Pida abrirlo o cambie la fecha contable." | No |
| 400, -5002 | Account … is not active / not permitted | "La cuenta {cuenta} está inactiva o es de título en SAP. Corrija el mapeo." | No |
| 400, -5002 | Dimension / profit center required | "La cuenta {cuenta} exige centro de costo en la dimensión {n} y la línea no lo trae." | No |
| 400 | Transaction is not balanced | "El asiento no cuadra: diferencia {d}." (defensivo; el motor lo impide) | No |
| 400, -1116 / licencia | Indirect access / no license | "SAP rechaza la conexión por licencia. Contacte al partner." | No |
| 500 / 503 | — | "SAP no respondió ({status}); se reintenta." | Sí |

Cada intento deja una fila en `SapBitacora` con estado HTTP, duración, código y mensaje original. El `audit()` registra quién envió, reintentó o canceló.

---

## 5. Plan de implementación

### 5.1 Arquitectura de código

```
src/lib/sap/
  config.ts          carga IntegracionSap y descifra la contraseña; valida que esté activa y completa
  service-layer.ts   cliente HTTP: login/sesión/logout, get/post, relogin en 401, timeouts, errores tipados
  errores.ts         clasificación transitorio/negocio y traducción al español
  asiento.ts         PURO: PartidaContable | PartidaPorCentroCosto + mapeo → payload JournalEntries, validaciones y truncados
  envio.ts           orquestador: construir, encolar, procesar una fila, reconciliar por Reference2, reverso
  worker.ts          procesar lote de pendientes con lock y backoff
src/app/api/configuracion/sap/{route,prueba/route,cuentas/route,mapeo/route}.ts
src/app/api/planillas/[id]/sap/route.ts
src/app/api/cron/sap/route.ts
src/components/config/SapConexionConfig.tsx      (pestaña)
src/components/payroll/SapEstadoPlanilla.tsx     (bloque en el detalle de planilla)
```

Esqueleto del cliente (lo esencial):

```ts
export class ServiceLayer {
  private sesion: { cookie: string; expira: number } | null = null;
  constructor(private cfg: { urlBase: string; companyDb: string; usuario: string; password: string }) {}

  private async login() {
    const r = await this.http("Login", { method: "POST", body: { CompanyDB: this.cfg.companyDb, UserName: this.cfg.usuario, Password: this.cfg.password } }, false);
    const cookies = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "); // B1SESSION + ROUTEID
    this.sesion = { cookie: cookies, expira: Date.now() + (r.json.SessionTimeout - 2) * 60_000 };
    return r.json as { Version: string; SessionTimeout: number };
  }

  async llamar<T>(ruta: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    if (!this.sesion || Date.now() > this.sesion.expira) await this.login();
    try {
      return (await this.http(ruta, init, true)).json as T;
    } catch (e) {
      if (e instanceof ErrorServiceLayer && e.http === 401) { await this.login(); return (await this.http(ruta, init, true)).json as T; }
      throw e;
    }
  }

  crearAsiento(payload: PayloadJournalEntry) {
    return this.llamar<{ JdtNum: number; Number: number }>("JournalEntries", { method: "POST", body: payload });
  }

  buscarPorReferencia2(ref: string) {
    return this.llamar<{ value: { JdtNum: number; Number: number }[] }>(
      `JournalEntries?$select=JdtNum,Number&$filter=Reference2 eq '${ref.replace(/'/g, "''")}'`
    );
  }

  logout() { return this.http("Logout", { method: "POST" }, true).catch(() => undefined); }
}
```

### 5.2 Dónde se dispara el envío

| Modo | Disparo | Uso recomendado |
|---|---|---|
| MANUAL | Botón "Enviar a SAP" en la planilla cerrada | Primeras semanas: el contador revisa la vista previa antes de cada envío. |
| AL_APROBAR | Transición CALCULADA → APROBADA | Cuando el gasto se reconoce al aprobar. |
| AL_PAGAR | Transición APROBADA → PAGADA | Cuando la contabilidad registra con la fecha de pago. |

En los modos automáticos el botón sigue disponible para reintentos. El cron (`/api/cron/sap`) corre cada 5 minutos desde el programador del servidor, igual que el del biométrico. Fase 2 opcional: un segundo asiento de pago (Debe "Sueldos por pagar", Haber banco) al marcar PAGADA, con `cuentaBanco` en la configuración.

### 5.3 Pruebas

- Unitarias (`vitest`): `asiento.ts` (cuadre, truncados, dimensión, bloqueo por mapeo incompleto), `errores.ts` (clasificación), `service-layer.ts` con `fetch` simulado (relogin en 401, cookies, timeouts), máquina de estados del outbox.
- Integración sin SAP: un **Service Layer simulado** (servidor Node de 150 líneas que responde Login, JournalEntries, ChartOfAccounts y $metadata, con escenarios de período cerrado y sesión caducada) en el entorno Docker de pruebas.
- Aceptación: empresa de pruebas de B1 del partner, con el catálogo real del cliente y el contador validando el primer asiento línea por línea.

### 5.4 Ruta de trabajo

| # | Tarea | Depende de | Estimación |
|---|---|---|---|
| 0 | Prerrequisitos: licencia Indirect Access, acceso de red al SL, usuario de SAP dedicado, empresa de pruebas, `CIFRADO_KEY` en el servidor, lista de cuentas del contador. | — | Externo |
| 1 | Esquema: `IntegracionSap`, `SapEnvioAsiento`, `SapBitacora`, columnas en `CuentaContable` y `CentroCosto`; permisos `configuracion.sap` y `planillas.sap_enviar`; `db:push` + `db:constraints`. Aplicar a la base real con la secuencia de siempre (diff, conteo, aprobación, recuento). | 0 (solo `CIFRADO_KEY`) | 0.5 d |
| 2 | Cliente Service Layer + errores + pruebas con `fetch` simulado. | 1 | 1.5 d |
| 3 | Pestaña Conexión y comportamiento + `GET/PUT /api/configuracion/sap` + Probar conexión (lee `$metadata` y guarda longitudes y versión). | 2 | 1 d |
| 4 | Mapeo contable: buscador de cuentas en B1, columnas `sapAcctCode`/`sapCostingCode`, "Validar contra SAP". | 3 | 1.5 d |
| 5 | `asiento.ts` + vista previa JSON en el detalle de planilla + pruebas. | 4 | 1 d |
| 6 | Outbox, envío manual, bitácora, bloque de estado en la planilla, auditoría. | 5 | 1.5 d |
| 7 | Disparo automático al aprobar/pagar, worker cron, backoff, lock, reconciliación por `Reference2`. | 6 | 1 d |
| 8 | Reverso al anular planilla enviada. | 7 | 0.5 d |
| 9 | Service Layer simulado + recorrido E2E en Docker (incluye sesión caducada y período cerrado). | 7 | 1 d |
| 10 | Aceptación contra la empresa de pruebas del partner; ajuste de traducciones y del mapeo con el contador. | 0, 9 | 2 d + consultor |

Total de desarrollo: 11.5 días. El paso 10 es el único cuyo calendario no controla el equipo.

### 5.5 Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| Licencia o red bloquean el arranque | Entregable alternativo ya acordado: exportar la partida en formato Data Transfer Workbench desde el CSV actual (2 días), sin licencia ni red. Valida el mapeo igual. |
| Catálogo segmentado: `AcctCode` ≠ código visible | El buscador de cuentas resuelve por `FormatCode` y guarda el `AcctCode`; la validación lo comprueba. |
| Doble asiento por respuesta perdida | Reconciliación por `Reference2` antes de cada POST. |
| Cambio de planilla después de encolar | Hash de cierre comparado al enviar; los triggers impiden el cambio de importes. |
| Sesiones que consumen licencia | Una sesión por proceso, reutilizada; logout al terminar lotes. |
| Contraseña de SAP expuesta | Cifrada con `CIFRADO_KEY`; nunca sale de la API; usuario de SAP con permisos mínimos. |

---

## 6. Estado de la implementación (15 de octubre de 2026)

### 6.1 Qué quedó construido

| Pieza | Dónde | Estado |
|---|---|---|
| Esquema: `IntegracionSap`, `SapEnvioAsiento`, `SapBitacora`, enums `ModoEnvioSap`/`EstadoEnvioSap`/`TipoEnvioSap`; `sapAcctCode`/`sapNombre`/`sapActiva`/`sapVerificadaAt` en `CuentaContable`; `sapCostingCode`/`sapProjectCode` en `CentroCosto` | `prisma/schema.prisma` | En el esquema y en la base de pruebas. **Pendiente en la base real** (SQL de 107 líneas, sólo aditivo: 3 enums, 2 `ALTER TABLE ADD COLUMN`, 3 `CREATE TABLE`). |
| Cliente del Service Layer: una sesión por instancia, cookies `B1SESSION`+`ROUTEID`, relogin único ante 401, tiempo máximo de 20 s, `fetch` inyectable | `src/lib/sap/service-layer.ts` | Hecho, con tests. |
| Clasificación y traducción de errores (transitorio o de negocio; texto para el contador) | `src/lib/sap/errores.ts` | Hecho, con tests. Los patrones se escribieron con los mensajes documentados de B1; **no se han contrastado con un SAP real**. Lo que no encaja sale con el texto y código originales. |
| Partida → `JournalEntries` (fechas, memo, referencias, centros de costo en la dimensión elegida, reverso, recorte a las longitudes del servidor) | `src/lib/sap/asiento.ts` | Hecho, con tests. Puro: no toca red ni base. |
| Cola de salida, reconciliación por `Reference2`, reintentos 1/5/15/60 min y luego 6 h hasta 10 intentos, cancelación si la huella de la planilla cambió, reverso al anular | `src/lib/sap/envio.ts`, `reintentos.ts` | Hecho. Probado de extremo a extremo contra un Service Layer de mentira. |
| API: `/api/configuracion/sap` (GET/PUT), `/prueba`, `/cuentas?q=`, `/mapeo` (GET/PUT con `verificar`), `/api/planillas/[id]/sap` (GET/POST), `/api/cron/sap` | `src/app/api/...` | Hecho. Todas con `requerirPermiso`; el cron con `x-cron-secret`. |
| Pantalla Configuración → **SAP - Conexión** (Conexión, Comportamiento, Mapeo contable, Bitácora) | `src/components/config/SapConexionConfig.tsx` | Hecho. |
| Bloque **SAP Business One** en el detalle de la planilla (estado, número de asiento, error traducido, botones, vista previa del asiento, intentos) | `src/components/payroll/SapEstadoPlanilla.tsx` | Hecho. No aparece si SAP no está configurado. |
| Disparo automático al aprobar o pagar, y reverso al anular, dentro de la transacción del cambio de estado; la llamada a SAP va después del commit | `src/app/api/planillas/[id]/route.ts` | Hecho. |
| Permisos `configuracion.sap` (sensible) y `planillas.sap_enviar` (sensible; ADMIN_RRHH y CONTADOR por rol) | `src/lib/auth/permisos.ts` | Hecho. **Los perfiles ya creados no lo reciben solos**: ver 6.3. |
| Pruebas: 40 unitarias nuevas (747 en total) y un recorrido E2E con Playwright contra el mock | `src/lib/sap/*.test.ts` | Verde el 15-10-2026. |

### 6.2 Cómo se pone en marcha

1. **Con el partner de SAP**: un usuario de B1 dedicado a la nómina con licencia de
   acceso indirecto, autorizaciones sólo sobre *Journal Entry* y *Chart of
   Accounts*; la URL del Service Layer (`https://servidor:50000/b1s/v1/`), el
   nombre de la base de empresa (`CompanyDB`), y el certificado CA si es propio.
   Confirmar en qué **dimensión** de B1 viven los centros de beneficio (por
   omisión la 1) y si la contabilidad exige centro de costo en las cuentas de gasto.
2. **En el servidor**: `CIFRADO_KEY` (sin ella no se guarda la contraseña de SAP),
   `NODE_EXTRA_CA_CERTS` apuntando a la CA si el certificado es propio (nunca se
   desactiva la verificación TLS), y una tarea cada 5 minutos que haga
   `POST /api/cron/sap` con el encabezado `x-cron-secret` (`CRON_SECRET`).
3. **Configuración → SAP - Conexión**:
   - *Conexión*: URL, base de empresa, usuario, contraseña; **Probar conexión**
     entra, lee una cuenta del plan, toma del `$metadata` las longitudes de
     Memo/LineMemo/Reference y sale. Marcar **Integración activa**.
   - *Comportamiento*: cuándo se envía (manual, al aprobar, al pagar), fecha
     contable (pago o fin de período), provisiones, reparto por centro de costo
     y dimensión, código de transacción, serie y plantilla del memo.
   - *Mapeo contable*: a cada cuenta local que recibe conceptos de nómina se le
     pone su `AcctCode` de SAP (se puede buscar por prefijo en vivo); a cada
     centro de costo su código en SAP. **Guardar y verificar en SAP** confirma
     que existen y están activas y guarda nombre y fecha de verificación.
   - *Bitácora*: últimos envíos con estado, número de SAP e intentos.
4. **Usuarios → Perfiles**: conceder «Enviar asientos a SAP» a Contabilidad y
   RRHH (ver 6.3), y «SAP Business One» a quien deba configurarlo (por omisión
   sólo el super administrador, igual que el correo saliente).
5. **En cada planilla** aprobada o pagada aparece el bloque *SAP Business One*
   con el estado, el botón **Enviar a SAP** / **Reintentar envío** y la vista
   previa del asiento exactamente como se manda.

### 6.3 Decisiones tomadas al implementar

- **Perfiles existentes.** Los permisos efectivos de un usuario con perfil salen
  del perfil, no del rol. Los perfiles RRHH y CONTABILIDAD se guardaron cuando el
  catálogo tenía 52 permisos; los dos nuevos no les llegan solos (`permisosNoVistos`
  existe en `permisos.ts` pero ninguna ruta lo aplica todavía). Hay que
  concederlos desde Usuarios → Perfiles, o con el `UPDATE` que acompaña al SQL
  del esquema.
- **Envío manual en línea, automático en segundo plano.** Quien pulsa el botón
  espera la respuesta de SAP (hasta 20 s). Al aprobar o pagar, la fila queda
  encolada en la misma transacción y se procesa justo después del commit; si el
  servidor se reinicia en medio, la recoge el cron.
- **Un mapeo incompleto no bloquea la nómina.** Si al aprobar falta una cuenta
  de SAP, la planilla se aprueba igual y el envío queda en ERROR con la lista de
  conceptos sin cuenta; se corrige el mapeo y se reintenta desde la planilla.
- **Huella de cierre.** El payload se construye con el `hashCalculo` de la
  planilla. Si se reabre y recalcula, el envío pendiente se CANCELA en vez de
  mandar cifras viejas; al reaprobar se vuelve a encolar.
- **Reconciliación.** Antes de cada `POST JournalEntries` se consulta
  `JournalEntries?$filter=Reference2 eq '<id de la planilla>'`. Si ya existe
  (una respuesta perdida en un intento anterior), se toma ese número y no se
  duplica. El reverso usa `Reference2 = <id>-R`.
- **Longitudes del servidor.** Se leen del `$metadata` en la prueba de conexión y
  se guardan; el asiento se recorta antes de enviarse. Si no hay `$metadata`,
  se usan 50/50/100.
- **Código visible o interno.** Si en el mapeo se teclea el código visible
  (`FormatCode`) de un plan segmentado, la verificación lo sustituye por el
  `AcctCode` interno (`_SYS…`), que es el que acepta `JournalEntries`.
- **Nada se cachea del plan de SAP.** La búsqueda de cuentas es en vivo; lo
  único que se guarda es el código elegido y lo verificado.

### 6.4 Pendiente y no verificado

- **Nunca se ha hablado con un SAP real.** El recorrido E2E usó un Service
  Layer de mentira que reproduce la forma de las respuestas documentadas. La
  primera conexión real puede sacar mensajes de error con otra redacción; la
  traducción cae al texto original con su código, que es lo que pedirá el
  consultor de B1.
- **Base real**: aplicar el SQL del esquema (y el `UPDATE` de perfiles) con
  aprobación expresa.
- **`CIFRADO_KEY`** no está en el `.env.local` de desarrollo: hasta ponerla no se
  puede guardar la contraseña de SAP (la prueba de conexión sí funciona con la
  contraseña tecleada).
- **Licencia de acceso indirecto** y autorizaciones del usuario: con el partner.
- **Series y `TransactionCode`** son opcionales y dependen de cómo esté
  configurada la contabilidad en B1.

### 6.5 Catálogo de SAP y sucursales (añadido el 15 de octubre de 2026)

Pedido por Edbin: *reemplazar el catálogo local por el de SAP, previa vista
previa con confirmación; SAP manda; y dar la opción de sucursales.*

**Importar el catálogo (Mapeo contable → «Importar el catálogo desde SAP»).**
- Lee el plan completo con `ChartOfAccounts` paginado (`Prefer: odata.maxpagesize=500`
  y `@odata.nextLink`; si el servidor rechaza el `$select`, se repite sin él).
- Reconstruye el árbol con `FatherAccountKey`; el tipo NIIF sale del **cajón**
  raíz (1 Activo, 2 Pasivo, 3 Patrimonio, 4 Ingresos, 5 Costo, 6 Gastos,
  7 y 9 Gastos, 8 Ingresos) y, si no se reconoce, del `AccountType`.
  `ActiveAccount` = tYES es cuenta de detalle (recibe asientos) y tNO de
  título; `FrozenFor` = tYES la deja inactiva. `codigo` = `FormatCode`
  (visible), `sapAcctCode` = `Code` (interno, el que acepta `JournalEntries`).
- **Vista previa obligatoria**: total de cuentas, de detalle, de título,
  inactivas, por tipo; cuentas locales que se borran; conceptos que se
  reenganchan y los que quedarían sin cuenta, con el motivo. Sólo se escribe al
  teclear `REEMPLAZAR`.
- **Reemplazo en una transacción**: desengancha los mapeos, borra el catálogo
  local, crea el de SAP (ya verificado, con nombre y fecha), reengancha cada
  concepto por código de SAP y, si no, por código visible; exige que la cuenta
  sea de detalle, activa y del tipo admitido para el concepto. El rastro de
  auditoría guarda el mapeo anterior completo.
- **Desde entonces SAP manda**: `IntegracionSap.catalogoOrigen = "SAP"`; en Plan
  de cuentas no se crean, editan ni borran cuentas (la API responde 409 y la
  pantalla lo dice). El mapeo concepto → cuenta sigue siendo decisión local.
  «Volver a importar» repite el proceso conservando el mapeo.
- Lo que no se hace: no se sincroniza solo (es un botón), no se cachea el plan
  de SAP fuera del catálogo, y no se adivina el mapeo de conceptos nuevos.

**Sucursales (Comportamiento → «SAP tiene varias sucursales»).**
- Cuando SAP trabaja con varias sucursales, cada línea del asiento lleva
  `BPLID`. Se leen en vivo de `BusinessPlaces` (si la entidad no existe, el
  mensaje lo dice) y en Mapeo contable se asigna a cada sucursal local su
  equivalente (`Sucursal.sapBplId`).
- Regla: la planilla de una sucursal va al `BPLID` de esa sucursal; la planilla
  de toda la empresa va a la **sucursal por omisión** elegida en Comportamiento.
  Sin equivalente, el asiento no se construye y la planilla lo muestra con el
  motivo. El error de SAP por sucursal faltante se traduce.
- No verificado contra un SAP real: el nombre `BPLID` en `JournalEntryLines` y
  la obligatoriedad cuando la empresa tiene sucursales activas se tomaron de la
  documentación del SDK y de la comunidad; el `$metadata` del servidor del
  cliente lo confirma (el mock lo publica así).

**Esquema**: `IntegracionSap` += `usaSucursales`, `sapBplIdPorDefecto`,
`catalogoOrigen`, `catalogoImportadoAt`, `catalogoCuentas`; `Sucursal` +=
`sapBplId`, `sapBplNombre`. Aplicado en la base de pruebas; en la real con
aprobación.

**Pruebas**: 16 unitarias nuevas (`catalogo-sap.test.ts`, `listas.test.ts`;
763 en total) y un segundo recorrido E2E con el mock alimentado por un
volcado del catálogo local más diferencias deliberadas (una cuenta renombrada,
dos nuevas, una congelada): vista previa, confirmación, reemplazo, sólo
lectura, envío con el catálogo importado, reimportación, y los cuatro casos de
sucursales (por omisión, mapeada, sin equivalente, sin por omisión).

### 6.6 Base de datos y credenciales (añadido el 15 de octubre de 2026)

Pedido por Edbin: *dentro de las parametrizaciones de SAP, incluir la base de
datos y las credenciales*, con el mismo criterio que la pestaña Parametrizaciones
de SAP_EstCta.

**Qué guarda la pestaña Conexión ahora.**

| Bloque | Campos | Para qué |
|---|---|---|
| Service Layer | URL, base de datos de la empresa, usuario de SAP, contraseña de SAP | Login y envío de asientos (sin cambios) |
| Base de datos (SQL Server) | Servidor, puerto, instancia opcional, usuario de SQL Server, contraseña, cifrar (TLS), confiar en el certificado | Sólo lectura: probar la base y listar empresas |

- La base de la empresa es UNA: la misma `CompanyDB` del Service Layer es la
  base que se abre en SQL Server.
- **Probar base de datos** abre esa base y dice servidor, versión de SQL Server,
  usuario, nombre de la empresa (`OADM.CompnyName`), moneda local
  (`OADM.MainCurncy`) y versión de SAP (`CINF.Version`). Avisa si la base no
  tiene las tablas de SAP, si el usuario puede escribir (basta `db_datareader`)
  y si la moneda local no es lempira.
- **Listar empresas** lee `SBO-COMMON.dbo.SRGC` y ofrece las empresas en un
  desplegable que rellena la base de la empresa. Si el usuario no ve
  SBO-COMMON, lista las bases con `OADM` a las que sí tiene acceso.
- La aplicación **nunca escribe** en la base de SAP: sólo hay consultas fijas,
  los nombres de base se validan, la conexión declara intención de sólo lectura,
  y los asientos van siempre por el Service Layer.
- Las pruebas usan lo que hay en el formulario, sin guardarlo.

**Credenciales.**
- Ambas contraseñas se cifran con `CIFRADO_KEY` (AES-256-GCM) y nunca vuelven
  de la API; el rastro de auditoría sólo dice si cambiaron.
- **Una contraseña guardada sólo se usa contra el destino para el que se
  guardó.** Si cambia la URL del Service Layer, o el servidor, puerto o
  instancia de SQL Server, hay que escribirla de nuevo (mismo criterio que
  `exigirPasswordNueva` de SAP_EstCta). Esto aplica también a la contraseña de
  SAP, que antes se conservaba aunque cambiara la URL.
- Dejar el servidor de SQL Server vacío borra servidor, usuario y contraseña.

**Errores de SQL Server traducidos**: usuario o contraseña, base inexistente,
usuario sin acceso a la base, instancia no encontrada, certificado no confiable,
servidor inalcanzable. SQL Server responde «Login failed» tanto para una
contraseña mala como para una base inexistente; se distingue entrando a
`master` con las mismas credenciales.

**Driver**: `mssql` 12.7.1 y `tedious` 20.3.3 fijados a versiones con más de
tres semanas publicadas; seis dependencias indirectas recientes se fijaron con
`overrides` bajo `tedious`. Sin soporte para SAP HANA: un cliente en HANA usa
sólo el Service Layer, que es suficiente para enviar asientos.

**Pruebas**: 10 unitarias nuevas (773 en total) y un recorrido E2E contra un SQL
Server 2022 real en Docker con SBO-COMMON, dos empresas, una base ajena y dos
usuarios de lectura.

## Fuentes

- SAP, *Working with SAP Business One Service Layer* (10.0): https://help.sap.com/doc/fc2f5477516c404c8bf9ad1315a17238/10.0/en-US/Working_with_SAP_Business_One_Service_Layer.pdf
- SAP, *Service Layer API Reference* (10.0): https://help.sap.com/doc/056f69366b5345a386bb8149f1700c19/10.0/en-US/Service%20Layer%20API%20Reference.html
- Hechos verificados el 17-ago-2026 sobre B1 10.0 (Service Layer sobre MS SQL, localizaciones, licencia Indirect Access): ver notas del proyecto.
