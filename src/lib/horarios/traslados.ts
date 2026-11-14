/**
 * Traslados temporales entre sucursales (TrasladoTemporal): lo puro. Las fechas son
 * cadenas AAAA-MM-DD, como en el resto del planificador.
 */

export interface TrasladoPlan {
  id: string;
  empleadoId: string;
  sucursalOrigenId: string;
  sucursalDestinoId: string;
  /** AAAA-MM-DD, ambos incluidos. */
  desde: string;
  hasta: string;
  motivo: string | null;
}

/** La sucursal a la que está trasladado ese día, o null. */
export function destinoEn(traslados: readonly TrasladoPlan[], empleadoId: string, fecha: string): string | null {
  const t = traslados.find((x) => x.empleadoId === empleadoId && x.desde <= fecha && fecha <= x.hasta);
  return t ? t.sucursalDestinoId : null;
}

export const seCruzan = (a: { desde: string; hasta: string }, b: { desde: string; hasta: string }) => a.desde <= b.hasta && b.desde <= a.hasta;

/**
 * Lo que impide registrar un traslado. Un empleado no puede estar trasladado a dos
 * sucursales el mismo día, ni a la suya.
 */
export function erroresDeTraslado(
  nuevo: { empleadoId: string; sucursalDestinoId: string; desde: string; hasta: string },
  sucursalPropia: string,
  existentes: readonly TrasladoPlan[]
): string[] {
  const e: string[] = [];
  if (nuevo.desde > nuevo.hasta) e.push("La fecha final es anterior a la inicial.");
  if (nuevo.sucursalDestinoId === sucursalPropia) e.push("Ya trabaja en esa sucursal: un traslado es a otra.");
  const cruce = existentes.find((t) => t.empleadoId === nuevo.empleadoId && seCruzan(t, nuevo));
  if (cruce) e.push(`Ya tiene un traslado del ${fechaCorta(cruce.desde)} al ${fechaCorta(cruce.hasta)} que se cruza con estas fechas.`);
  return e;
}

/**
 * Agrupa fechas sueltas en tramos seguidos: la importación crea un traslado por tramo
 * (lunes a miércoles y viernes son dos traslados, no uno de cinco días).
 */
export function tramosSeguidos(fechas: readonly string[]): { desde: string; hasta: string }[] {
  const orden = [...new Set(fechas)].sort();
  const tramos: { desde: string; hasta: string }[] = [];
  for (const f of orden) {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && diaSiguiente(ultimo.hasta) === f) ultimo.hasta = f;
    else tramos.push({ desde: f, hasta: f });
  }
  return tramos;
}

function diaSiguiente(f: string): string {
  const d = new Date(`${f}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
