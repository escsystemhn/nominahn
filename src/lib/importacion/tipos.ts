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
}

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

/** Qué se hará con una fila si se confirma el lote. */
export type AccionFila = "CREAR" | "ACTUALIZAR" | "OMITIR";

/** Resumen de una fila para la vista previa, sin exponer el registro completo. */
export interface FilaPrevisualizada {
  linea: number;
  accion: AccionFila;
  /** Identificador legible: código de empleado, o empleado + deducción. */
  referencia: string;
  /** Descripción corta de lo que cambia, para las filas de actualización. */
  cambios?: string[];
}

/** Lo que devuelve la fase de validación. */
export interface InformeValidacion {
  loteId: string | null;
  tipo: "EMPLEADOS" | "DEDUCCIONES";
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
}

/** Lo que devuelve la fase de aplicación. */
export interface ResultadoImportacion {
  loteId: string;
  creados: number;
  actualizados: number;
  omitidos: number;
}
