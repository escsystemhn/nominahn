/**
 * Definición de las columnas de los archivos de empleados, deducciones y horas extra.
 *
 * UNA SOLA FUENTE PARA LAS DOS DIRECCIONES: el exportador escribe estas
 * cabeceras y el importador las espera. Si estuvieran declaradas por separado,
 * el archivo dejaría de ser de ida y vuelta en cuanto una de las dos listas
 * cambiara — y ese es justo el flujo real de RRHH: exportar, corregir en Excel,
 * volver a importar.
 *
 * LAS RELACIONES VIAJAN POR CÓDIGO, NUNCA POR ID. Un `cuid` como
 * `clx3k9f2a0000...` no le dice nada a quien edita la hoja y no sobrevive a un
 * cambio de entorno. Sucursal y tipo de deducción se identifican por su código;
 * departamento y puesto, por su nombre dentro del padre; el supervisor, por el
 * código del empleado.
 */

import type { ColumnaCsv } from "./tipos";

export type { ColumnaCsv };

// ─── EMPLEADOS ────────────────────────────────────────────────────────────────

export const COLUMNAS_EMPLEADO: readonly ColumnaCsv[] = [
  {
    clave: "codigo",
    etiqueta: "Codigo",
    descripcion:
      "Código del empleado. Es la CLAVE: si existe se actualiza el registro, si está vacío se da de alta y el sistema asigna uno.",
    ejemplo: "EMP-0001",
  },
  { clave: "primer_nombre", etiqueta: "Primer Nombre", descripcion: "Obligatorio.", requerido: true, ejemplo: "Ana" },
  { clave: "segundo_nombre", etiqueta: "Segundo Nombre", descripcion: "Opcional.", ejemplo: "María" },
  { clave: "primer_apellido", etiqueta: "Primer Apellido", descripcion: "Obligatorio.", requerido: true, ejemplo: "Núñez" },
  { clave: "segundo_apellido", etiqueta: "Segundo Apellido", descripcion: "Opcional.", ejemplo: "Discua" },
  {
    clave: "identidad",
    etiqueta: "Identidad",
    descripcion: "13 dígitos. Se guarda sin guiones. No puede repetirse entre empleados.",
    sensible: true,
    ejemplo: "0801-1990-12345",
  },
  { clave: "rtn", etiqueta: "RTN", descripcion: "14 dígitos. Opcional.", sensible: true, ejemplo: "08011990123451" },
  { clave: "ihss_nro", etiqueta: "No. IHSS", descripcion: "Número de afiliación al IHSS.", sensible: true },
  { clave: "rap_nro", etiqueta: "No. RAP", descripcion: "Número de afiliación al RAP.", sensible: true },
  {
    clave: "fecha_nacimiento",
    etiqueta: "Fecha Nacimiento",
    descripcion: "DD/MM/AAAA. Obligatoria en altas.",
    requerido: true,
    sensible: true,
    ejemplo: "15/03/1990",
  },
  { clave: "genero", etiqueta: "Genero", descripcion: "M o F.", requerido: true, sensible: true, ejemplo: "F" },
  { clave: "estado_civil", etiqueta: "Estado Civil", descripcion: "Texto libre. Opcional.", sensible: true, ejemplo: "Soltera" },
  { clave: "nacionalidad", etiqueta: "Nacionalidad", descripcion: "Por omisión, Hondureño.", ejemplo: "Hondureña" },
  { clave: "telefono_personal", etiqueta: "Telefono", descripcion: "Opcional.", sensible: true, ejemplo: "9988-7766" },
  { clave: "contacto_emergencia", etiqueta: "Contacto Emergencia", descripcion: "Nombre de la persona a contactar.", sensible: true },
  { clave: "telefono_emergencia", etiqueta: "Telefono Emergencia", descripcion: "Opcional.", sensible: true },
  { clave: "direccion", etiqueta: "Direccion", descripcion: "Opcional.", sensible: true },
  {
    clave: "fecha_ingreso",
    etiqueta: "Fecha Ingreso",
    descripcion: "DD/MM/AAAA. Obligatoria en altas. Determina antigüedad, vacaciones y devengo de décimos.",
    requerido: true,
    ejemplo: "01/02/2024",
  },
  {
    clave: "fecha_salida",
    etiqueta: "Fecha Salida",
    descripcion: "DD/MM/AAAA. Obligatoria si el Estado es INACTIVO.",
  },
  {
    clave: "estado",
    etiqueta: "Estado",
    descripcion: "ACTIVO, INACTIVO, SUSPENDIDO, VACACIONES o PERMISO. Por omisión, ACTIVO.",
    ejemplo: "ACTIVO",
  },
  {
    clave: "tipo_contrato",
    etiqueta: "Tipo Contrato",
    descripcion: "INDEFINIDO, TEMPORAL, PRUEBA o SERVICIO.",
    requerido: true,
    ejemplo: "INDEFINIDO",
  },
  {
    clave: "tipo_planilla",
    etiqueta: "Tipo Planilla",
    descripcion: "SEMANAL, QUINCENAL o MENSUAL.",
    requerido: true,
    ejemplo: "MENSUAL",
  },
  {
    clave: "salario_base",
    etiqueta: "Salario Base",
    descripcion:
      "Importe en Lempiras. Cambiarlo genera un registro en el historial salarial, igual que si se editara por pantalla.",
    requerido: true,
    sensible: true,
    ejemplo: "15000.00",
  },
  { clave: "banco", etiqueta: "Banco", descripcion: "Opcional.", sensible: true, ejemplo: "Banco Atlántida" },
  { clave: "cuenta_bancaria", etiqueta: "Cuenta Bancaria", descripcion: "Opcional.", sensible: true },
  {
    clave: "sucursal",
    etiqueta: "Sucursal",
    descripcion: "CÓDIGO de la sucursal (o su nombre exacto). Debe existir previamente.",
    requerido: true,
    ejemplo: "TGU",
  },
  {
    clave: "division",
    etiqueta: "División",
    descripcion:
      "Nombre de la división dentro de esa sucursal. Opcional: sólo hace falta si la sucursal tiene departamentos con el mismo nombre en varias divisiones.",
    ejemplo: "PAGSA MAYOREO",
  },
  {
    clave: "departamento",
    etiqueta: "Departamento",
    descripcion: "Nombre del departamento dentro de esa sucursal (y de esa división, si se indica). Debe existir previamente.",
    requerido: true,
    ejemplo: "Contabilidad",
  },
  {
    clave: "puesto",
    etiqueta: "Puesto",
    descripcion: "Nombre del puesto dentro de ese departamento. Opcional.",
    ejemplo: "Analista Contable",
  },
  {
    clave: "supervisor_codigo",
    etiqueta: "Codigo Supervisor",
    descripcion:
      "Código del empleado que es su jefe directo. Decide quién aprueba sus permisos y quién lo evalúa. Opcional.",
    ejemplo: "EMP-0007",
  },
  {
    clave: "centro_costo",
    etiqueta: "Centro Costo",
    descripcion:
      "CÓDIGO del centro de costo al que se imputa su gasto. Vacío = hereda el de su departamento. Opcional.",
    ejemplo: "ADM",
  },
  {
    clave: "email_corporativo",
    etiqueta: "Correo Corporativo",
    descripcion: "Correo de trabajo, para el directorio. No es el usuario de acceso al sistema.",
    ejemplo: "ana.nunez@empresa.hn",
  },
  {
    clave: "extension",
    etiqueta: "Extension",
    descripcion: "Extensión telefónica interna, para el directorio.",
    ejemplo: "1042",
  },
] as const;

// ─── DEDUCCIONES ASIGNADAS A EMPLEADOS ────────────────────────────────────────

export const COLUMNAS_DEDUCCION: readonly ColumnaCsv[] = [
  {
    clave: "empleado_codigo",
    etiqueta: "Codigo Empleado",
    descripcion: "Código del empleado al que se le aplica. Debe existir.",
    requerido: true,
    ejemplo: "EMP-0001",
  },
  {
    clave: "empleado_nombre",
    etiqueta: "Empleado",
    descripcion: "Sólo informativo, para poder revisar el archivo. Al importar se ignora.",
    soloLectura: true,
  },
  {
    clave: "tipo_deduccion_codigo",
    etiqueta: "Codigo Deduccion",
    descripcion: "Código del tipo de deducción configurado en el sistema (p. ej. PRESTAMO).",
    requerido: true,
    ejemplo: "PRESTAMO",
  },
  {
    clave: "tipo_deduccion_nombre",
    etiqueta: "Tipo Deduccion",
    descripcion: "Sólo informativo. Al importar se ignora.",
    soloLectura: true,
  },
  {
    clave: "monto",
    etiqueta: "Monto",
    descripcion: "Total a descontar, en Lempiras. Mayor que cero. Si en Cuotas pone 0, es lo que se descuenta en cada planilla.",
    requerido: true,
    sensible: true,
    ejemplo: "3000.00",
  },
  {
    clave: "cuotas_meses",
    etiqueta: "Cuotas",
    descripcion: "Número de cuotas en que se reparte el total. Vacío = descuento único. 0 = se cobra en cada planilla, sin fin.",
    ejemplo: "12",
  },
  {
    clave: "fecha_inicio",
    etiqueta: "Fecha Inicio",
    descripcion: "DD/MM/AAAA. Desde cuándo se aplica.",
    requerido: true,
    ejemplo: "01/09/2026",
  },
  { clave: "fecha_fin", etiqueta: "Fecha Fin", descripcion: "DD/MM/AAAA. Opcional." },
  { clave: "activo", etiqueta: "Activa", descripcion: "Sí o No. Por omisión, Sí." },
  { clave: "observacion", etiqueta: "Observacion", descripcion: "Motivo o referencia. Opcional." },
  {
    clave: "saldo",
    etiqueta: "Saldo",
    descripcion: "Saldo pendiente calculado por el sistema. Sólo informativo; al importar se ignora.",
    sensible: true,
    soloLectura: true,
  },
  {
    clave: "cuotas_pagadas",
    etiqueta: "Cuotas Pagadas",
    descripcion: "Cuotas ya amortizadas en planilla. Sólo informativo; al importar se ignora.",
    soloLectura: true,
  },
] as const;

// ─── CATÁLOGO DE TIPOS DE DEDUCCIÓN ──────────────────────────────────────────

export const COLUMNAS_TIPO_DEDUCCION: readonly ColumnaCsv[] = [
  {
    clave: "codigo",
    etiqueta: "Codigo",
    descripcion: "Código corto y único, sin espacios (letras, números, guion). Es la CLAVE: si existe se actualiza; si no, se crea. Es el que va en los demás archivos y no se cambia después.",
    requerido: true,
    ejemplo: "COOP-ELGA",
  },
  { clave: "nombre", etiqueta: "Nombre", descripcion: "Como se verá en pantallas, planilla y comprobantes. Obligatorio al crear.", requerido: true, ejemplo: "Cooperativa ELGA" },
  {
    clave: "categoria",
    etiqueta: "Categoria",
    descripcion: "Elija de la lista. Decide hasta cuánto se cobra: Préstamo de la empresa y Embargo judicial, hasta la cuarta parte de lo que excede al mínimo (Arts. 371-372); Pensión alimenticia, hasta el 50 %; AFP baja la base del ISR; las demás, sin pasar del neto. Obligatoria al crear.",
    requerido: true,
    ejemplo: "Cooperativa",
  },
  { clave: "monto_habitual", etiqueta: "Monto Habitual", descripcion: "Opcional. Se propone al asignarlo a un empleado (por ejemplo, el seguro médico). Vacío: sin monto habitual.", formato: "monto", ejemplo: "500.00" },
  { clave: "descripcion", etiqueta: "Descripcion", descripcion: "Opcional. Para qué es, a quién se le paga.", ejemplo: "Cooperativa de ahorro y crédito ELGA" },
  { clave: "activo", etiqueta: "Activo", descripcion: "Sí o No. Vacío: Sí al crear y sin cambio al actualizar. Uno inactivo ya no se ofrece para asignar, pero lo asignado se sigue cobrando.", ejemplo: "Sí" },
] as const;

// ─── HORAS EXTRA ──────────────────────────────────────────────────────────────

export const COLUMNAS_HORAS_EXTRA: readonly ColumnaCsv[] = [
  {
    clave: "empleado_codigo",
    etiqueta: "Codigo Empleado",
    descripcion: "Código del empleado. Ponga el código o el DNI: con uno basta; si pone los dos, deben ser de la misma persona.",
    ejemplo: "EMP-0001",
  },
  {
    clave: "identidad",
    etiqueta: "DNI",
    descripcion: "Número de identidad del empleado, 13 dígitos, con o sin guiones. Sirve en lugar del código.",
    sensible: true,
    ejemplo: "0801-1990-12345",
  },
  {
    clave: "empleado_nombre",
    etiqueta: "Empleado",
    descripcion: "Sólo informativo, para poder revisar el archivo. Al importar se ignora.",
    soloLectura: true,
  },
  {
    clave: "fecha",
    etiqueta: "Fecha",
    descripcion: "DD/MM/AAAA. El día trabajado. Cada fila reemplaza las horas de ese día.",
    requerido: true,
    ejemplo: "15/10/2026",
  },
  { clave: "normales", etiqueta: "Horas normales", descripcion: "Horas de la jornada ordinaria trabajadas ese día. Opcional: en blanco conserva las que tenga. No cambian el salario (la planilla paga el salario del período); sirven para los indicadores de asistencia.", ejemplo: "8" },
  { clave: "ausencia", etiqueta: "Ausencia", descripcion: "Sí = faltó ese día sin permiso: se descuenta en la planilla y la fila no lleva horas. No = trabajó (borra una ausencia anterior). En blanco = conserva lo que tenga.", ejemplo: "No" },
  { clave: "diurnas", etiqueta: "Extra 25%", descripcion: "Horas extra trabajadas en el período diurno (5:00 a 19:00): recargo de 25 % sobre la hora diurna (Art. 330). Sólo la cantidad: el sistema calcula el costo. En blanco = 0.", ejemplo: "2" },
  { clave: "mixtas", etiqueta: "Extra 50%", descripcion: "Horas extra de una jornada diurna o mixta trabajadas en el período nocturno (19:00 a 5:00): recargo de 50 % sobre la hora diurna (Art. 330). En blanco = 0.", ejemplo: "1.5" },
  { clave: "nocturnas", etiqueta: "Extra 75%", descripcion: "Horas extra que prolongan una jornada nocturna: recargo de 75 % sobre la hora nocturna, salario ÷ 30 ÷ 6 (Art. 330). En blanco = 0.", ejemplo: "0" },
  { clave: "feriado", etiqueta: "Extra 100%", descripcion: "Cantidad de horas con recargo de 100 % (feriado o día de descanso, se pagan al doble). En blanco = 0.", ejemplo: "0" },
  { clave: "observacion", etiqueta: "Observacion", descripcion: "Motivo o referencia. Opcional.", ejemplo: "Inventario de fin de mes" },
] as const;

// ─── AYUDAS ───────────────────────────────────────────────────────────────────

/**
 * Columnas que puede ver quien exporta.
 *
 * ES LA MISMA PUERTA QUE `/api/empleados`: sin el permiso `empleados.pii`, la
 * respuesta llega sin identidad, RTN, salario, dirección ni cuenta bancaria. Un
 * exportador que ignorara esta distinción convertiría el botón «Exportar» en la
 * vía para sacar en un archivo justo lo que la pantalla oculta.
 */
export function columnasVisibles(columnas: readonly ColumnaCsv[], vePII: boolean): ColumnaCsv[] {
  return vePII ? [...columnas] : columnas.filter((c) => !c.sensible);
}

/** Cabeceras tal como se escriben en el archivo. */
export function etiquetas(columnas: readonly ColumnaCsv[]): string[] {
  return columnas.map((c) => c.etiqueta);
}

/**
 * Columnas que el importador busca en el archivo, con su clave y su etiqueta.
 *
 * Se devuelven las DOS formas porque el archivo puede venir del exportador (que
 * escribe la etiqueta) o de una plantilla editada a mano (donde a veces se
 * conserva la clave). Ver `mapearColumnas`.
 *
 * Incluye las columnas de sólo lectura a propósito: así una «Saldo» que venga de
 * una exportación previa no se reporta como cabecera desconocida. Se reconoce y
 * se ignora, que no es lo mismo que no reconocerla.
 */
export function clavesEsperadas(
  columnas: readonly ColumnaCsv[]
): Array<{ clave: string; etiqueta: string }> {
  return columnas.map((c) => ({ clave: c.clave, etiqueta: c.etiqueta }));
}

/** Columnas que el importador sí escribe. */
export function columnasEscribibles(columnas: readonly ColumnaCsv[]): ColumnaCsv[] {
  return columnas.filter((c) => !c.soloLectura);
}

/**
 * Fila de ejemplo para la plantilla vacía.
 *
 * Una plantilla con sólo cabeceras deja al usuario adivinando el formato de las
 * fechas y de los enumerados; con una fila de muestra, el archivo se explica solo.
 */
export function filaEjemplo(columnas: readonly ColumnaCsv[]): string[] {
  return columnas.map((c) => c.ejemplo ?? "");
}
