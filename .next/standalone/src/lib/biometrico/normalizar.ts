/**
 * De marcación cruda del equipo a fila de `MarcajeEvento`.
 *
 * Hace tres cosas y ninguna es cosmética:
 *
 *   1. Convierte la hora de PARED del reloj a un instante real. El equipo no
 *      manda zona horaria; manda «08:00» y punto.
 *   2. Resuelve el PIN a un empleado vía `EmpleadoPin`.
 *   3. Lo que no resuelve, lo deja en CUARENTENA. Nunca lo descarta.
 */

import { diaHN } from "@/lib/utils";
import type { EventoCrudo } from "./driver";

/**
 * Instante real de una hora de pared, dado el desfase del equipo.
 *
 * NO usa `new Date(anio, mes, dia, ...)`: ese constructor interpreta los
 * componentes en la zona del PROCESO, así que el resultado cambiaría según dónde
 * corra o cómo esté configurado el entorno de pruebas. Con el offset explícito
 * del dispositivo el cálculo es el mismo en todas partes.
 *
 * Honduras es UTC−6 fijo y sin horario de verano, de ahí que un offset en
 * minutos baste y no haga falta una librería de zonas horarias.
 */
export function instanteDePared(pared: EventoCrudo["pared"], offsetMinutos: number): Date {
  const utc = Date.UTC(pared.anio, pared.mes - 1, pared.dia, pared.hora, pared.minuto, pared.segundo);
  return new Date(utc - offsetMinutos * 60_000);
}

export interface EventoNormalizado {
  dispositivoId: string;
  pin: string;
  empleadoId: string | null;
  ocurridoEn: Date;
  fechaLocal: Date;
  tipo: "ENTRADA" | "SALIDA" | "DESCONOCIDO";
  estado: "PENDIENTE" | "CUARENTENA";
  verificacion: string | null;
  crudo: unknown;
}

/**
 * Normaliza un lote.
 *
 * `pinesConocidos` mapea PIN → empleadoId para ESTE dispositivo. Se pasa ya
 * resuelto en vez de consultar por evento: un buffer de reloj trae miles de
 * marcas y una consulta por cada una es un problema de rendimiento evitable.
 */
export function normalizarLote(opts: {
  dispositivoId: string;
  offsetMinutos: number;
  eventos: EventoCrudo[];
  pinesConocidos: Map<string, string>;
}): EventoNormalizado[] {
  const { dispositivoId, offsetMinutos, eventos, pinesConocidos } = opts;

  return eventos.map((e) => {
    const ocurridoEn = instanteDePared(e.pared, offsetMinutos);
    const empleadoId = pinesConocidos.get(e.pin) ?? null;

    return {
      dispositivoId,
      pin: e.pin,
      empleadoId,
      ocurridoEn,
      // El día laboral es el día de CALENDARIO hondureño del instante: una marca
      // de las 23:40 ocurre a las 05:40 UTC del día siguiente, y tomarla en UTC
      // la imputaría al día equivocado.
      fechaLocal: diaHN(ocurridoEn),
      tipo: e.tipo ?? "DESCONOCIDO",
      // Un PIN sin dueño NO se descarta: queda visible y, cuando alguien lo
      // asigne, se reprocesa hacia atrás.
      estado: empleadoId ? "PENDIENTE" : "CUARENTENA",
      verificacion: e.verificacion ?? null,
      crudo: e.crudo ?? null,
    };
  });
}
