/**
 * El catálogo de tipos de deducción visto por RRHH: categorías con su efecto legal,
 * códigos y lectura de lo que se escribe en una plantilla. PURO: sirve en el
 * navegador y en el servidor.
 *
 * LA CATEGORÍA NO ES UNA ETIQUETA: decide hasta cuánto se cobra (Arts. 371 a 373 del
 * Código del Trabajo, ver `aplicarDeducciones`) y si baja la base del ISR (AFP). Por
 * eso cada una lleva su ayuda, y por eso no se ofrecen «Legal» ni «Impuesto»: los
 * tipos de ley (IHSS, RAP, INFOP) y la retención fija de ISR son del sistema y se
 * configuran en Parámetros de ley; uno nuevo con esa categoría no lo calcularía nadie.
 */

export type CategoriaDeduccion =
  | "PRESTAMO" | "ADELANTO" | "COOPERATIVA" | "AFP" | "VOLUNTARIA" | "OTRO" | "PENSION_ALIMENTICIA" | "EMBARGO";

export interface InfoCategoria {
  valor: CategoriaDeduccion;
  etiqueta: string;
  ayuda: string;
}

export const CATEGORIAS: readonly InfoCategoria[] = [
  { valor: "VOLUNTARIA", etiqueta: "Descuento autorizado", ayuda: "Seguros, préstamos de banco o del RAP, cuentas por cobrar y otros que el trabajador autorizó por escrito. Se cobran sin pasar del neto." },
  { valor: "COOPERATIVA", etiqueta: "Cooperativa", ayuda: "Aportaciones y préstamos de cooperativa (Art. 373). Se cobran sin pasar del neto." },
  { valor: "PRESTAMO", etiqueta: "Préstamo de la empresa", ayuda: "Deuda con el patrono: se cobra hasta la cuarta parte de lo que excede al salario mínimo (Art. 372). Lo que no alcanza queda en el saldo." },
  { valor: "ADELANTO", etiqueta: "Adelanto de salario", ayuda: "Anticipo a cuenta del salario: se descuenta completo, sin pasar del neto." },
  { valor: "AFP", etiqueta: "AFP o fondo de pensiones", ayuda: "Aporte voluntario a una AFP: se resta antes de calcular el ISR." },
  { valor: "PENSION_ALIMENTICIA", etiqueta: "Pensión alimenticia (judicial)", ayuda: "Orden judicial: hasta el 50 % del salario, incluso del mínimo (Art. 371). Se cobra primero." },
  { valor: "EMBARGO", etiqueta: "Embargo judicial", ayuda: "Orden judicial: comparte con los préstamos de la empresa la cuarta parte de lo que excede al mínimo (Art. 371)." },
  { valor: "OTRO", etiqueta: "Otro", ayuda: "Cualquier otro descuento autorizado. Se cobra sin pasar del neto." },
];

const POR_VALOR = new Map(CATEGORIAS.map((c) => [c.valor, c]));

/** Las de ley y de impuesto existen en la base, pero no se crean desde aquí. */
const ETIQUETA_SISTEMA: Record<string, string> = { LEGAL: "De ley", IMPUESTO: "Impuesto" };

export function etiquetaCategoria(valor: string): string {
  return POR_VALOR.get(valor as CategoriaDeduccion)?.etiqueta ?? ETIQUETA_SISTEMA[valor] ?? valor;
}

export function esCategoriaAsignable(valor: string): valor is CategoriaDeduccion {
  return POR_VALOR.has(valor as CategoriaDeduccion);
}

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const SINONIMOS: Array<[RegExp, CategoriaDeduccion]> = [
  [/^(voluntaria|descuento autorizado|autorizad[oa]|seguro|banco)/, "VOLUNTARIA"],
  [/^coop/, "COOPERATIVA"],
  [/^(prestamo|ptmo)/, "PRESTAMO"],
  [/^(adelanto|anticipo)/, "ADELANTO"],
  [/^(afp|fondo de pensiones|pension voluntaria)/, "AFP"],
  [/^(pension alimenticia|alimentos|pension)/, "PENSION_ALIMENTICIA"],
  [/^embargo/, "EMBARGO"],
  [/^otr/, "OTRO"],
];

/** La categoría escrita en un archivo: el valor interno o la etiqueta, sin importar tildes ni mayúsculas. */
export function leerCategoria(texto: string): CategoriaDeduccion | null {
  const t = plano(texto);
  if (!t) return null;
  for (const c of CATEGORIAS) if (t === plano(c.valor) || t === plano(c.etiqueta)) return c.valor;
  for (const [patron, valor] of SINONIMOS) if (patron.test(t)) return valor;
  return null;
}

/**
 * Categoría probable por el nombre, para PROPONERLA al crear un tipo desde una columna.
 * Es una sugerencia que la persona confirma: «Ptmo RAP» es un préstamo de un tercero
 * (descuento autorizado), no de la empresa, y eso cambia el tope.
 */
export function sugerirCategoria(nombre: string): CategoriaDeduccion {
  const t = ` ${plano(nombre)} `;
  if (/ coop/.test(t)) return "COOPERATIVA";
  if (/ (afp|pension voluntaria|fondo de pension)/.test(t)) return "AFP";
  if (/ (alimentos|alimenticia)/.test(t)) return "PENSION_ALIMENTICIA";
  if (/ embargo/.test(t)) return "EMBARGO";
  if (/ (adelanto|anticipo)/.test(t)) return "ADELANTO";
  if (/ (prestamo|ptmo|ptamo|prest)/.test(t) && !/ (rap|banc|bac|atlantida|ficohsa|banpais|occidente|davivienda|lafise|cxc|cuenta)/.test(t)) return "PRESTAMO";
  return "VOLUNTARIA";
}

/**
 * Una columna de planilla que NO es una deducción por empleado: totales, salario, o
 * algo de ley que calcula la planilla. Al crear tipos desde un archivo se propone no
 * crearla.
 */
export function noEsDeduccionPorEmpleado(nombre: string): string | null {
  const t = ` ${plano(nombre)} `;
  if (esColumnaIsr(nombre)) return "Es la retención del ISR: no es una deducción más, la maneja Parámetros de ley.";
  if (/ (total|neto|bruto|sueldo|salario|devengado|liquido|a pagar|dias|horas|codigo|nombre|cargo|puesto) /.test(t)) return "Parece un total o un dato del empleado, no una deducción.";
  if (/ (ihss|ivm|rap|infop|isr|vecinal|impuesto|seguro social|reserva laboral) /.test(t) && !/ (prestamo|ptmo|ptamo|prest|cxc)/.test(t)) return "Parece de ley: la calcula la planilla.";
  return null;
}

/**
 * Abreviaturas de las planillas hechas a mano, para reconocer «Ptamo. BANCATLAN» como
 * «Préstamo BANCATLAN» o «Ret. Seg.Med.» como «Retención seguro médico».
 */
const ABREVIATURAS: Record<string, string> = {
  ptamo: "prestamo", ptmo: "prestamo", pmo: "prestamo", prest: "prestamo", prestamos: "prestamo",
  coop: "cooperativa", coope: "cooperativa", cooperativas: "cooperativa",
  ret: "retencion", retenc: "retencion", retenciones: "retencion",
  seg: "seguro", seguros: "seguro", med: "medico", medica: "medico",
  cta: "cuenta", ctas: "cuentas", fact: "facturas", facts: "facturas", factura: "facturas",
  desc: "descuento", descuentos: "descuento", aport: "aportacion", aportaciones: "aportacion",
};
const PALABRAS_VACIAS = new Set(["de", "del", "la", "el", "los", "las", "y", "por", "a", "al", "en"]);

/**
 * El nombre reducido a sus palabras, con las abreviaturas escritas completas y sin
 * artículos: dos nombres con la misma forma son el mismo descuento. Sólo se compara
 * por igualdad, así que no confunde «Préstamo RAP» con «Préstamo BANCATLAN».
 */
export function nombreComparable(texto: string): string {
  return plano(texto).split(" ").filter(Boolean).map((p) => ABREVIATURAS[p] ?? p).filter((p) => !PALABRAS_VACIAS.has(p)).join(" ");
}

/** «Retención en la fuente», «ISR», «Ret. ISR», «Impuesto sobre la renta»: la columna del ISR de una planilla. */
export function esColumnaIsr(cabecera: string): boolean {
  const t = ` ${nombreComparable(cabecera)} `;
  if (/ (prestamo|cxc|cuenta|cuentas) /.test(t)) return false;
  return / (isr|retencion fuente|impuesto sobre renta) /.test(t);
}

export const PATRON_CODIGO = /^[A-Z0-9][A-Z0-9_-]{0,29}$/;

/** El código como se guarda: mayúsculas, sin tildes, guiones en lugar de espacios. */
export function normalizarCodigo(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim().replace(/\s+/g, "-").replace(/[^A-Z0-9_-]/g, "");
}

/** Un código corto y libre a partir del nombre: «Cooperativa ELGA» → COOP-ELGA. */
export function sugerirCodigo(nombre: string, ocupados: ReadonlySet<string>): string {
  const ABREVIA: Record<string, string> = { COOPERATIVA: "COOP", PRESTAMO: "PTMO", PRESTAMOS: "PTMO", SEGURO: "SEG", MEDICO: "MED", ADELANTO: "ADEL", CUENTA: "CTA", COBRAR: "COB", EMBARGO: "EMB", PENSION: "PENS", ALIMENTICIA: "ALIM" };
  const vacias = new Set(["DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "POR", "A"]);
  const palabras = normalizarCodigo(nombre.replace(/[^\p{L}\p{N}]+/gu, " ")).split("-").filter((p) => p && !vacias.has(p));
  let base = palabras.map((p) => ABREVIA[p] ?? p).join("-").slice(0, 24).replace(/-+$/, "") || "DED";
  if (!/^[A-Z0-9]/.test(base)) base = `D${base}`;
  let codigo = base, n = 2;
  while (ocupados.has(codigo)) codigo = `${base}-${n++}`;
  return codigo;
}

/**
 * De una cabecera «Cooperativa ELGA (COOP-ELGA)» saca el nombre y el código. Sólo es
 * código lo que va en MAYÚSCULAS entre paréntesis, como lo escribe la exportación:
 * «Seguro (familiar)» es un nombre con paréntesis.
 */
export function partirCabecera(cabecera: string): { nombre: string; codigo: string | null } {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(cabecera.trim());
  if (m && m[1].trim() && PATRON_CODIGO.test(m[2].trim())) return { nombre: m[1].trim(), codigo: m[2].trim() };
  return { nombre: cabecera.trim(), codigo: null };
}
