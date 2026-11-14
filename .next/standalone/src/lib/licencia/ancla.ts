/**
 * Registro de la evaluación («ancla»): cuándo empezó y la mayor fecha vista.
 *
 * Se guarda en TRES sitios, y vale la fecha de inicio más antigua de los que
 * sean válidos:
 *
 *   · el registro de Windows (HKLM), que escribe sólo el instalador y que la
 *     desinstalación no borra: reinstalar no reinicia los 30 días;
 *   · un archivo en ProgramData, fuera de la carpeta del programa;
 *   · la propia base de datos: quien conserva sus datos conserva su fecha.
 *
 * FORMATO. `G360E1.<datos base64url>.<HMAC-SHA256 base64url>`. La clave del HMAC
 * se deriva del MachineGuid del equipo, así que un registro copiado a otra
 * computadora no valida, y editar la fecha a mano rompe la firma.
 *
 * LO QUE ESTO NO ES. Toda protección que se verifica en el propio equipo, sin
 * servidor, se puede saltar con tiempo y un depurador: el secreto viaja dentro
 * del programa. Esto frena lo casual —reinstalar, atrasar el reloj, editar un
 * archivo, borrar uno de los tres registros— y nada más. Lo que no se puede
 * falsificar es la LICENCIA, firmada con Ed25519 por el servidor SDL (sdl.ts):
 * para fabricar una hace falta la clave privada, que nunca sale de ESC System.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";

const PREFIJO = "G360E1";
export const PRODUCTO_ANCLA = "NOMINA";

// Secreto de producto. Ver «Lo que esto no es» arriba: no protege por sí solo.
const SECRETO = "g360-nomina|ancla|9c1f7e3a52d84b06b7e1d4a8c2f06e95";

export interface DatosAncla {
  v: 1;
  producto: string;
  /** ISO 8601. Inicio de la evaluación. */
  inicio: string;
  /** ISO 8601. Mayor fecha vista por el servidor (el reloj no retrocede). */
  mayorVisto: string;
  /** Huella corta del MachineGuid: dice «otro equipo» en vez de «alterado». */
  equipo: string;
}

export type LecturaAncla =
  | { estado: "valida"; datos: DatosAncla }
  | { estado: "otro_equipo" }
  | { estado: "alterada" };

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function huellaEquipo(machineGuid: string): string {
  return createHash("sha256").update(machineGuid.trim().toLowerCase()).digest("hex").slice(0, 16);
}

function clave(machineGuid: string): Buffer {
  return createHash("sha256").update(`${SECRETO}|${machineGuid.trim().toLowerCase()}`).digest();
}

export function firmarAncla(
  datos: Omit<DatosAncla, "v" | "producto" | "equipo">,
  machineGuid: string
): string {
  const completo: DatosAncla = {
    v: 1,
    producto: PRODUCTO_ANCLA,
    inicio: datos.inicio,
    mayorVisto: datos.mayorVisto,
    equipo: huellaEquipo(machineGuid),
  };
  const cuerpo = `${PREFIJO}.${b64(JSON.stringify(completo))}`;
  const firma = createHmac("sha256", clave(machineGuid)).update(cuerpo, "ascii").digest();
  return `${cuerpo}.${b64(firma)}`;
}

export function leerAncla(token: string, machineGuid: string): LecturaAncla {
  const partes = token.trim().split(".");
  if (partes.length !== 3 || partes[0] !== PREFIJO) return { estado: "alterada" };

  let datos: DatosAncla;
  try {
    datos = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
  } catch {
    return { estado: "alterada" };
  }
  if (datos?.equipo !== huellaEquipo(machineGuid)) return { estado: "otro_equipo" };

  const esperada = createHmac("sha256", clave(machineGuid))
    .update(`${partes[0]}.${partes[1]}`, "ascii")
    .digest();
  const recibida = Buffer.from(partes[2], "base64url");
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) {
    return { estado: "alterada" };
  }

  const inicio = Date.parse(datos.inicio);
  const mayorVisto = Date.parse(datos.mayorVisto);
  if (datos.v !== 1 || datos.producto !== PRODUCTO_ANCLA || !Number.isFinite(inicio) || !Number.isFinite(mayorVisto)) {
    return { estado: "alterada" };
  }
  return { estado: "valida", datos };
}

export type ResultadoAnclas =
  | { estado: "sin_registro" }
  | { estado: "otro_equipo" }
  | { estado: "alterada" }
  | { estado: "valida"; inicio: Date; mayorVisto: Date; validas: number };

/**
 * Combina lo que se encontró en cada sitio.
 *
 * Basta UN registro de otro equipo o alterado para bloquear: si se ignorara, el
 * camino para reiniciar la evaluación sería alterar los registros que estorban y
 * dejar sólo el que conviene. Entre los válidos manda el inicio más antiguo y la
 * mayor fecha vista.
 */
export function combinarAnclas(lecturas: LecturaAncla[]): ResultadoAnclas {
  if (lecturas.some((l) => l.estado === "otro_equipo")) return { estado: "otro_equipo" };
  if (lecturas.some((l) => l.estado === "alterada")) return { estado: "alterada" };

  const validas = lecturas.filter((l): l is Extract<LecturaAncla, { estado: "valida" }> => l.estado === "valida");
  if (validas.length === 0) return { estado: "sin_registro" };

  const inicio = Math.min(...validas.map((l) => Date.parse(l.datos.inicio)));
  const mayorVisto = Math.max(...validas.map((l) => Date.parse(l.datos.mayorVisto)));
  return { estado: "valida", inicio: new Date(inicio), mayorVisto: new Date(mayorVisto), validas: validas.length };
}
