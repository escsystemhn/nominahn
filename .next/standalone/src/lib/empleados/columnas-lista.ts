/**
 * Columnas de la lista de Empleados que cada quien elige ver (pedido de Edbin, 2026-11-18:
 * «que se pueda quitar o agregar campos a la vista»).
 *
 * La elección se guarda en una cookie de este navegador para que el servidor dibuje la
 * tabla ya con sus columnas, sin parpadeo. No es una decisión de seguridad: una columna
 * de datos personales sólo se dibuja con `empleados.pii`, diga lo que diga la cookie.
 * La lista de qué es dato personal es la misma de `GET /api/empleados` (CAMPOS_SENSIBLES).
 *
 * «Empleado» (nombre y foto) no está aquí: va siempre, porque es lo que abre la ficha.
 */

import type { NivelesEstructura } from "@/lib/organizacion/estructura";
import type { ColumnaLista } from "@/lib/empleados/lista";

export const COOKIE_COLUMNAS = "g360_empleados_columnas";
/** Lo que se guarda cuando se quitan todas: una cookie vacía volvería a las de siempre. */
export const NINGUNA_COLUMNA = "_";

export const CLAVES_COLUMNA = [
  "codigo", "identidad", "rtn", "ihss", "rap",
  "sucursal", "division", "departamento", "puesto", "jefe", "centroCosto",
  "frecuencia", "contrato", "ingreso", "antiguedad", "salida", "estado",
  "salario", "banco", "cuenta",
  "correo", "extension", "telefono", "correoPersonal",
  "genero", "estadoCivil", "nacimiento",
] as const;
export type ClaveColumna = (typeof CLAVES_COLUMNA)[number];

export const GRUPOS_COLUMNAS = ["Identificación", "Organización", "Laboral", "Pago", "Contacto", "Datos personales"] as const;
export type GrupoColumnas = (typeof GRUPOS_COLUMNAS)[number];

export interface DefColumna {
  clave: ClaveColumna;
  etiqueta: (n: NivelesEstructura) => string;
  grupo: GrupoColumnas;
  /** Dato personal o de nómina: sólo con `empleados.pii`. */
  pii: boolean;
  /** Visible mientras la persona no elija otra cosa. */
  porOmision: boolean;
  /** Si la columna ordena la lista, por qué campo (ver `ordenDeConsulta`). */
  orden?: ColumnaLista;
  /** Cifras: a la derecha y ordenadas de mayor a menor al primer clic. */
  num?: boolean;
  /** Fechas y montos arrancan de mayor a menor. */
  desc?: boolean;
  /** Sólo existe con el nivel División encendido (la «sucursal» de la jerarquía). */
  requiereDivisiones?: boolean;
}

const fija = (texto: string) => () => texto;

export const COLUMNAS: readonly DefColumna[] = [
  { clave: "codigo", etiqueta: fija("Código"), grupo: "Identificación", pii: false, porOmision: true, orden: "codigo" },
  { clave: "identidad", etiqueta: fija("Identidad"), grupo: "Identificación", pii: true, porOmision: false, orden: "identidad" },
  { clave: "rtn", etiqueta: fija("RTN"), grupo: "Identificación", pii: true, porOmision: false },
  { clave: "ihss", etiqueta: fija("N.º IHSS"), grupo: "Identificación", pii: true, porOmision: false },
  { clave: "rap", etiqueta: fija("N.º RAP"), grupo: "Identificación", pii: true, porOmision: false },

  { clave: "sucursal", etiqueta: (n) => n.sucursal, grupo: "Organización", pii: false, porOmision: true, orden: "sucursal" },
  { clave: "division", etiqueta: (n) => n.division, grupo: "Organización", pii: false, porOmision: true, orden: "division", requiereDivisiones: true },
  { clave: "departamento", etiqueta: fija("Departamento"), grupo: "Organización", pii: false, porOmision: true, orden: "departamento" },
  { clave: "puesto", etiqueta: fija("Puesto"), grupo: "Organización", pii: false, porOmision: true, orden: "puesto" },
  { clave: "jefe", etiqueta: fija("Jefe directo"), grupo: "Organización", pii: false, porOmision: false, orden: "jefe" },
  { clave: "centroCosto", etiqueta: fija("Centro de costo"), grupo: "Organización", pii: false, porOmision: false },

  { clave: "frecuencia", etiqueta: fija("Frecuencia de pago"), grupo: "Laboral", pii: false, porOmision: false, orden: "frecuencia" },
  { clave: "contrato", etiqueta: fija("Tipo de contrato"), grupo: "Laboral", pii: false, porOmision: false, orden: "contrato" },
  { clave: "ingreso", etiqueta: fija("Ingreso"), grupo: "Laboral", pii: false, porOmision: true, orden: "ingreso", desc: true },
  { clave: "antiguedad", etiqueta: fija("Antigüedad"), grupo: "Laboral", pii: false, porOmision: false, orden: "antiguedad", desc: true },
  { clave: "salida", etiqueta: fija("Fecha de salida"), grupo: "Laboral", pii: true, porOmision: false, orden: "salida", desc: true },
  { clave: "estado", etiqueta: fija("Estado"), grupo: "Laboral", pii: false, porOmision: true, orden: "estado" },

  { clave: "salario", etiqueta: fija("Salario base"), grupo: "Pago", pii: true, porOmision: true, orden: "salario", num: true, desc: true },
  { clave: "banco", etiqueta: fija("Banco"), grupo: "Pago", pii: true, porOmision: false },
  { clave: "cuenta", etiqueta: fija("Cuenta bancaria"), grupo: "Pago", pii: true, porOmision: false },

  // El correo y la extensión corporativos son de directorio; el teléfono y el correo personales, no.
  { clave: "correo", etiqueta: fija("Correo corporativo"), grupo: "Contacto", pii: false, porOmision: false },
  { clave: "extension", etiqueta: fija("Extensión"), grupo: "Contacto", pii: false, porOmision: false },
  { clave: "telefono", etiqueta: fija("Teléfono personal"), grupo: "Contacto", pii: true, porOmision: false },
  { clave: "correoPersonal", etiqueta: fija("Correo personal"), grupo: "Contacto", pii: true, porOmision: false },

  { clave: "genero", etiqueta: fija("Género"), grupo: "Datos personales", pii: true, porOmision: false },
  { clave: "estadoCivil", etiqueta: fija("Estado civil"), grupo: "Datos personales", pii: true, porOmision: false },
  { clave: "nacimiento", etiqueta: fija("Nacimiento"), grupo: "Datos personales", pii: true, porOmision: false, orden: "nacimiento", desc: true },
];

export interface OpcionesColumnas {
  vePII: boolean;
  conDivisiones: boolean;
}

/** Las columnas que esta persona puede elegir, en el orden del catálogo. */
export function columnasDisponibles({ vePII, conDivisiones }: OpcionesColumnas): DefColumna[] {
  return COLUMNAS.filter((c) => (vePII || !c.pii) && (conDivisiones || !c.requiereDivisiones));
}

export function columnasPorOmision(opciones: OpcionesColumnas): ClaveColumna[] {
  return columnasDisponibles(opciones).filter((c) => c.porOmision).map((c) => c.clave);
}

/**
 * Las columnas visibles según la cookie («codigo,sucursal,…»). Lo que no existe o no
 * está permitido se ignora; sin cookie, o si no queda ninguna válida, las de siempre.
 * `NINGUNA_COLUMNA` deja sólo «Empleado».
 * El orden es siempre el del catálogo: quitar y volver a poner no desordena la tabla.
 */
export function leerColumnas(valor: string | undefined | null, opciones: OpcionesColumnas): ClaveColumna[] {
  if (valor?.trim() === NINGUNA_COLUMNA) return [];
  const pedidas = new Set((valor ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const validas = columnasDisponibles(opciones).filter((c) => pedidas.has(c.clave)).map((c) => c.clave);
  return validas.length > 0 ? validas : columnasPorOmision(opciones);
}

/** Lo que se guarda en la cookie: sólo claves conocidas, sin repetir, en el orden del catálogo. */
export function textoColumnas(claves: readonly string[]): string {
  const pedidas = new Set(claves);
  return CLAVES_COLUMNA.filter((c) => pedidas.has(c)).join(",");
}
