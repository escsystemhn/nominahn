# Prestaciones, documentos, préstamos, incapacidades, turnos, banco y portal de empleo

Añadido el 15 de octubre de 2026. Quedan fuera, a propósito, el kiosco de marcación
y la aplicación móvil.

Este documento dice qué hace cada pieza, quién la usa, qué regla legal aplica y
cuál de esas reglas está verificada contra la fuente. Lo que no está verificado
se deja configurable y se marca así.

## Resumen

| Pieza | Dónde | Permiso |
|---|---|---|
| Liquidaciones y décimos con estados y finiquito en PDF | Nómina → Prestaciones | `prestaciones.ver`, `.generar`, `.aprobar`, `.pagar`, `.anular_pagada` |
| Constancias y contratos desde plantilla | Personal → Documentos, y la ficha del empleado | `documentos.emitir`, `documentos.plantillas` |
| Constancias por autoservicio | Mi espacio → Constancias | sesión vinculada a un empleado |
| Préstamos y anticipos pedidos por el empleado | Mi espacio → Préstamos; se aprueban en Nómina → Deducciones | `deducciones.asignar` para aprobar |
| Incapacidades del IHSS con efecto en planilla | Tiempo y asistencia → Incapacidades | `asistencia.incapacidades` |
| Horarios y turnos, turnos nocturnos, puntualidad | Tiempo y asistencia → Horarios y turnos; Reportes → Puntualidad | `asistencia.turnos` |
| Ficha médica, familiares y beneficiarios | Ficha del empleado → Salud y familia; Mi espacio → Salud y familia | `empleados.salud` para la ficha médica |
| Archivo de pago para el banco | Detalle de planilla aprobada; Prestaciones → Décimos | `planillas.pagar`, `prestaciones.pagar` |
| Formatos de archivo de cada banco | Configuración → Formatos de banco | `configuracion.editar` |
| Portal público de empleo | `/empleos`, sin sesión | publicar: `talento.reclutamiento_gestionar` |

Separación de funciones que conviene conocer: con los roles por omisión, RRHH
configura los formatos de banco pero no descarga el archivo de pago, y el contador
lo descarga pero no cambia los formatos.

## Prestaciones

Una liquidación pasa por Borrador, Aprobada, Pagada y Anulada. Anular una aprobada
o una pagada exige motivo, y anular una pagada exige además un permiso que por
omisión sólo tiene el super administrador. Al anular se puede reactivar al
empleado.

El finiquito en PDF lleva el desglose con su fundamento, el monto en letras, las
firmas del trabajador y del firmante de la empresa, y la nota del Art. 379 del
Código del Trabajo: el finiquito vale cuando se hace ante la autoridad de trabajo.
Si la causa es muerte, el PDF lista a los beneficiarios registrados.

Al liquidar se pueden saldar en el mismo acto los préstamos y anticipos con saldo.

Los décimos calculados se pagan en lote y se anulan con motivo.

## Documentos

Hay tres plantillas de partida: constancia de trabajo, constancia de trabajo y
salario, y contrato individual por tiempo indefinido. Las dos constancias se
pueden pedir por autoservicio; el contrato no.

El texto admite variables como `{{empleado.nombreCompleto}}` y negrita con
`**texto**`. La vista previa avisa de las variables sin dato en el expediente, que
salen como una raya para llenar a mano. El contrato no inventa un horario: si el
empleado no tiene turno asignado, la jornada queda en blanco.

Cada documento emitido lleva folio del año, como `2026-000001`, y se vuelve a
descargar idéntico. Anular uno le pone la marca de agua «ANULADA».

El contenido mínimo del contrato sigue el Art. 37 del Código del Trabajo.

## Préstamos y anticipos

El empleado pide desde Mi espacio y ve cuánto le queda disponible. RRHH aprueba o
rechaza; rechazar exige motivo, que el empleado ve. Al aprobar se crea la deducción
por cuota de cada período de pago, y entra en la siguiente planilla.

Reglas verificadas:
- Un anticipo se descuenta en al menos cinco períodos de pago (Art. 372).
- El salario mínimo no se embarga, y del excedente se puede retener hasta la cuarta
  parte (Art. 371).

Un préstamo cuya cuota pase de esa cuarta parte se puede aprobar igual, pero sólo
con una confirmación expresa en la pantalla.

## Incapacidades

Reglas verificadas en el Reglamento de Incapacidad Temporal del IHSS (La Gaceta,
29 de mayo de 2020):
- Art. 71: los tres primeros días los paga el patrono y el IHSS desde el cuarto.
  Una incapacidad no pasa de 365 días.
- Art. 34: maternidad de 42 días antes y 42 después del parto.

El Art. 136 del Código del Trabajo obliga al patrono a cubrir la diferencia en
maternidad; por eso el complemento patronal por omisión es 34 % en maternidad.

**Sin verificar:** el 66 % del subsidio del IHSS. Sólo se usa para el subsidio
estimado y para fijar el complemento, y se cambia en la misma pantalla.

En la planilla, los días a cargo del IHSS se descuentan a razón de salario entre 30
por día, menos el complemento. No cuentan como ausencias.

Una prórroga no reinicia los días del patrono, y las fechas no se pueden traslapar.
Cada incapacidad guarda las reglas vigentes al registrarla.

## Turnos

El turno decide desde qué hora se paga la hora extra, el almuerzo que se descuenta
y la puntualidad. Sin asignación se usa el diurno de 8 horas de siempre.

Límites legales verificados (Arts. 321 y 322 del Código del Trabajo):

| Jornada | Por día | Por semana |
|---|---|---|
| Diurna | 8 h | 44 h |
| Mixta | 7 h | 42 h |
| Nocturna | 6 h | 36 h |

Un turno que cruza medianoche guarda la salida en el día siguiente. Las marcas de
madrugada se asignan a la jornada del día anterior.

Las tardanzas salen en el reporte de Puntualidad. Son informativas: no se descuentan
de la planilla.

## Archivo para el banco

El sistema no trae formatos de bancos hondureños: ninguno se pudo verificar y un
formato inventado haría rechazar el archivo. Trae un CSV genérico, y cada empresa
describe en Configuración → Formatos de banco el formato que le entregue su banco:
- separado por un carácter o de ancho fijo;
- columnas, ancho, alineación y relleno con espacios o ceros;
- monto con punto, con coma o en centavos, y la fecha en cuatro formatos;
- codificación UTF-8 o Latin-1, fin de línea, encabezado y línea de total;
- un filtro opcional por banco del empleado.

La vista previa usa dos empleados de ejemplo. Compárela con el ejemplo del banco
antes de usar el formato.

Sólo se genera para planillas aprobadas o pagadas. Quedan fuera, y se listan, los
empleados sin cuenta, los de otro banco y los netos en cero. Cada descarga queda en
la bitácora.

## Portal de empleo

`/empleos` muestra las vacantes abiertas, no internas y publicadas a mano. Una
convocatoria interna no se puede publicar. El candidato envía nombre, correo,
teléfono opcional, mensaje opcional y su currículo en PDF, y acepta el uso de sus
datos. Entra al tablero de reclutamiento con la fuente «Portal de empleo».

Defensas de la única escritura sin sesión de la aplicación:
- el currículo debe ser PDF por su firma, no por la extensión, y no pasar del límite
  de tamaño;
- campo trampa para bots, que responde como si todo saliera bien y no guarda nada;
- cinco postulaciones por IP y hora, y sesenta por vacante y hora sea cual sea la IP;
- repetir con el mismo correo no crea otro candidato.

El límite por IP usa la última entrada de `x-forwarded-for`, que añade el proxy.
Sin un proxy delante no hay IP fiable y sólo rige el techo por vacante. Ambos
límites viven en la memoria del proceso: con varias instancias habría que llevarlos
a una base compartida.

## Pruebas

Cada pieza tiene pruebas unitarias de sus reglas. Además se probó de punta a punta
contra el servidor de producción y la base de pruebas en Docker: 95 comprobaciones,
sin errores de JavaScript en las páginas. Entre ellas:
- el archivo de ancho fijo con filas de 63 caracteres, sin acentos y con montos que
  cuadran al centavo con la planilla;
- una incapacidad de 7 días más una prórroga de 3 que descuentan 7 días en la
  planilla, y la cuota de un préstamo aprobado descontada en la misma planilla;
- un turno de 23:00 a 05:00 con la salida guardada al día siguiente y una tardanza
  de 7 minutos en el reporte;
- el portal de empleo sin sesión, con sus rechazos, el límite por IP y la descarga
  del currículo sólo para reclutamiento.
