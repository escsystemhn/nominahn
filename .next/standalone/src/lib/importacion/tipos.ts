/**
 * Tipos compartidos entre el servidor (validación y aplicación de lotes) y el
 * cliente (asistente de importación).
 *
 * Viven aparte porque el componente de React que dibuja la vista previa no puede
 * arrastrar el módulo de columnas —que importa Prisma— hasta el navegador.
 */

export interface ColumnaCsv {
  /** Nombre estable con el que se busca la columna en el archivo. */
  readonly clave: string;
  /** Cabecera que se escribe al exportar. */
  readonly etiqueta: string;
  /** Ayuda que se muestra en la plantilla y en el asistente. */
  readonly descripcion: string;
  /** Requiere el permiso de datos personales para exportarse. */
  readonly sensible?: boolean;
  /** Obligatoria al dar de alta un registro nuevo. */
  readonly requerido?: boolean;
  /** Se exporta para dar contexto, pero al importar se ignora. */
  readonly soloLectura?: boolean;
  readonly ejemplo?: string;
  /** Celda numérica en Excel, para columnas que no están en la lista fija de `xlsx.ts` (los tipos de deducción). */
  readonly formato?: "monto" | "entero";
}

/** Lo que completa las rutas /api/importar y /api/exportar. */
export type RecursoImportacion = "empleados" | "deducciones" | "horas-extra" | "tipos-deduccion" | "horarios";

/** Qué se permite hacer con las filas del archivo. */
export type ModoImportacion = "CREAR" | "ACTUALIZAR" | "CREAR_O_ACTUALIZAR";

export type Severidad = "ERROR" | "AVISO";

/**
 * Una incidencia detectada al validar.
 *
 * ERROR bloquea la fila; AVISO la deja pasar informando. La distinción importa:
 * un archivo de 300 filas con 2 errores debe poder aplicarse tras corregir esas
 * 2, no obligar a repasar las 300.
 */
export interface Incidencia {
  /** Línea REAL del archivo, la que ve el usuario al abrirlo. */
  linea: number;
  /** Cabecera afectada, si la incidencia es de una columna concreta. */
  columna?: string;
  severidad: Severidad;
  mensaje: string;
}

/**
 * Filas de datos leídas del archivo: las de la vista previa (altas, cambios y omitidas) y
 * las que tienen errores. Antes se contaban sólo las primeras y «N filas leídas» salía corto
 * justo cuando había errores.
 */
export function filasLeidas(r: { previsualizacion: { linea: number }[]; incidencias: Incidencia[] }): number {
  const lineas = new Set(r.previsualizacion.map((f) => f.linea));
  for (const i of r.incidencias) if (i.severidad === "ERROR" && i.linea > 1) lineas.add(i.linea);
  return lineas.size;
}

/** Qué se hará con una fila si se confirma el lote. */
export type AccionFila = "CREAR" | "ACTUALIZAR" | "OMITIR";

/** Resumen de una fila para la vista previa, sin exponer el registro completo. */
export interface FilaPrevisualizada {
  linea: number;
  /** QUITAR: un monto del período que deja de cobrarse. */
  accion: AccionFila | "QUITAR";
  /** Identificador legible: código de empleado, o empleado + deducción. */
  referencia: string;
  /** Descripción corta de lo que cambia, para las filas de actualización. */
  cambios?: string[];
}

/** Lo que devuelve la fase de validación. */
export interface InformeValidacion {
  loteId: string | null;
  tipo: "EMPLEADOS" | "DEDUCCIONES" | "HORAS_EXTRA" | "HORARIOS";
  nombreArchivo: string;
  totalFilas: number;
  totalCrear: number;
  totalActualizar: number;
  totalOmitir: number;
  totalErrores: number;
  incidencias: Incidencia[];
  filas: FilaPrevisualizada[];
  /** Cabeceras del archivo que no corresponden a ninguna columna conocida. */
  columnasDesconocidas: string[];
  /** Momento en que el lote deja de poder confirmarse. */
  expiraEn: string | null;
  /** `false` cuando hay errores: no hay nada que confirmar. */
  aplicable: boolean;
  /** Cifras propias de la vista previa, en lugar de altas, actualizaciones y omitidas. */
  cifras?: Array<{ label: string; valor: number }>;
  /** Una línea que dice qué se va a aplicar, sobre la tabla de detalle. */
  resumen?: string;
  /** Montos del período: columnas que todavía no son tipos de deducción, con lo que se propone para crearlas. */
  tiposNuevos?: TipoSugerido[];
}

/** Una columna del archivo de montos que no es un tipo de deducción, y cómo se propone crearlo. */
export interface TipoSugerido {
  cabecera: string;
  nombre: string;
  codigo: string;
  /** Categoría propuesta (`CategoriaDeduccion`); la persona la confirma. */
  tipo: string;
  /** Celdas con monto en esa columna. */
  conMontos: number;
  /** Se propone crearla (marcada). */
  crear: boolean;
  /** Por qué se propone no crearla. */
  motivo: string | null;
}

/** Lo que devuelve la fase de aplicación. */
export interface ResultadoImportacion {
  loteId: string;
  creados: number;
  actualizados: number;
  omitidos: number;
  /** Frase del resultado, si el recurso la escribe a su manera. */
  mensaje?: string;
}
