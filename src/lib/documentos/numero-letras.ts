/**
 * Montos en letras, como se escriben en constancias, contratos y finiquitos:
 * «DIEZ MIL QUINIENTOS LEMPIRAS CON 25/100».
 *
 * Ortografía de la RAE: dieciséis, veintidós, veintitrés, veintiséis y la
 * apócope «veintiún» / «un» delante de un sustantivo («veintiún mil»,
 * «un millón», «un lempira»).
 */

const UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const DIEZ_A_VEINTINUEVE = [
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE",
  "VEINTE", "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE",
];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

/** 0 a 999. `apocope` convierte el «uno» final en «un» (delante de sustantivo). */
function centenas(n: number, apocope: boolean): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto > 0) {
    if (resto < 10) {
      partes.push(apocope && resto === 1 ? "UN" : UNIDADES[resto]);
    } else if (resto < 30) {
      const t = DIEZ_A_VEINTINUEVE[resto - 10];
      partes.push(apocope && resto === 21 ? "VEINTIÚN" : t);
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u === 0 ? DECENAS[d] : `${DECENAS[d]} Y ${apocope && u === 1 ? "UN" : UNIDADES[u]}`);
    }
  }
  return partes.join(" ");
}

/**
 * Entero no negativo en letras. `apocope`: el número precede a un sustantivo
 * («veintiún lempiras»), no se dice suelto («veintiuno»).
 */
export function enteroALetras(n: number, apocope = false): string {
  if (!Number.isFinite(n) || n < 0) throw new Error("Monto inválido");
  n = Math.floor(n);
  if (n === 0) return "CERO";
  if (n >= 1e12) throw new Error("Monto demasiado grande");

  const millones = Math.floor(n / 1e6);
  const miles = Math.floor((n % 1e6) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];

  if (millones > 0) {
    partes.push(millones === 1 ? "UN MILLÓN" : `${enteroALetras(millones, true)} MILLONES`);
  }
  if (miles > 0) {
    // «mil», no «un mil»; «veintiún mil», no «veintiuno mil».
    partes.push(miles === 1 ? "MIL" : `${centenas(miles, true)} MIL`);
  }
  if (resto > 0) partes.push(centenas(resto, apocope));

  return partes.join(" ");
}

/** Monto en lempiras con centavos: «UN LEMPIRA CON 50/100», «DOS MIL LEMPIRAS EXACTOS» no; siempre «CON 00/100». */
export function montoALetras(monto: number | string, moneda = { singular: "LEMPIRA", plural: "LEMPIRAS" }): string {
  const valor = Math.round(Number(monto) * 100);
  if (!Number.isFinite(valor) || valor < 0) throw new Error("Monto inválido");
  const enteros = Math.floor(valor / 100);
  const centavos = valor % 100;
  const nombre = enteros === 1 ? moneda.singular : moneda.plural;
  // «Un millón de lempiras»: tras millón(es) exacto(s) va «de».
  const de = enteros >= 1e6 && enteros % 1e6 === 0 ? "DE " : "";
  return `${enteroALetras(enteros, true)} ${de}${nombre} CON ${String(centavos).padStart(2, "0")}/100`;
}
