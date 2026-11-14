/**
 * Subida del material de capacitación por partes. Lo usan el panel (navegador) y las rutas
 * (servidor): aquí no va nada de Node.
 *
 * Por qué por partes: Next.js sólo le deja al manejador los primeros 10 MB del cuerpo de una
 * petición que pasa por el proxy (proxyClientMaxBodySize); el resto lo descarta y el archivo
 * llegaba cortado, aunque la respuesta dijera que se guardó. Además, el Caddy de la edición
 * instalable limita cada petición a 6 MB. Con partes de 4 MB pasan las dos, y el proxy sigue
 * protegiendo la ruta (sesión, origen, licencia).
 */

/** Bytes de cada parte: por debajo de los 6 MB del Caddy y de los 10 MB de Next. */
export const TAMANO_PARTE = 4 * 1024 * 1024;

const RE_SUBIDA = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** El identificador de una subida es un UUID v4 en minúsculas: también es parte del nombre del archivo temporal. */
export const subidaValida = (id: string | null | undefined): id is string => !!id && RE_SUBIDA.test(id);

/** UUID v4 que funciona también fuera de HTTPS (crypto.randomUUID sólo existe en contextos seguros). */
export function nuevaSubida(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Lo que el servidor guarda de una subida en curso, junto al archivo temporal. */
export interface EstadoSubida {
  usuarioId: string;
  capacitacionId: string;
  /** Bytes recibidos hasta ahora. */
  bytes: number;
}

export type Revision = { ok: true } | { ok: false; status: number; error: string };

/**
 * ¿Se acepta esta parte? Las partes llegan en orden: cada una empieza donde terminó la
 * anterior. La primera (desde = 0) empieza de cero, también si se reintenta.
 */
export function revisarParte(
  estado: EstadoSubida | null,
  p: { usuarioId: string; capacitacionId: string; desde: number; largo: number; max: number }
): Revision {
  if (!Number.isInteger(p.desde) || p.desde < 0) return { ok: false, status: 400, error: "Parte sin posición válida." };
  if (p.largo <= 0) return { ok: false, status: 400, error: "La parte llegó vacía." };
  if (p.largo > TAMANO_PARTE) return { ok: false, status: 413, error: "La parte es más grande de lo permitido." };
  if (p.desde + p.largo > p.max) return { ok: false, status: 413, error: `El archivo pasa del máximo de ${Math.round(p.max / 1024 / 1024)} MB.` };
  if (estado && (estado.usuarioId !== p.usuarioId || estado.capacitacionId !== p.capacitacionId)) {
    return { ok: false, status: 409, error: "Esa subida no es suya." };
  }
  if (p.desde === 0) return { ok: true };
  if (!estado) return { ok: false, status: 409, error: "La subida no empezó o ya venció: vuelva a subir el archivo." };
  if (estado.bytes !== p.desde) return { ok: false, status: 409, error: "Las partes llegaron desordenadas: vuelva a subir el archivo." };
  return { ok: true };
}

/** ¿Está completa la subida que se quiere cerrar? */
export function revisarCierre(estado: EstadoSubida | null, p: { usuarioId: string; capacitacionId: string; total: number }): Revision {
  if (!estado) return { ok: false, status: 409, error: "La subida no empezó o ya venció: vuelva a subir el archivo." };
  if (estado.usuarioId !== p.usuarioId || estado.capacitacionId !== p.capacitacionId) return { ok: false, status: 409, error: "Esa subida no es suya." };
  if (!Number.isInteger(p.total) || p.total <= 0) return { ok: false, status: 400, error: "Falta el tamaño del archivo." };
  if (estado.bytes !== p.total) {
    return { ok: false, status: 400, error: `El archivo llegó incompleto (${estado.bytes.toLocaleString("es-HN")} de ${p.total.toLocaleString("es-HN")} bytes): vuelva a subirlo.` };
  }
  return { ok: true };
}
