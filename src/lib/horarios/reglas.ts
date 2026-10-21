/** Reglas del planificador guardadas por la empresa. PURO. */

import { DESCANSO_LEGAL_ENTRE_JORNADAS_H } from "./ley";
import { REGLAS_POR_OMISION, type ModoVispera, type PoliticaRotacion, type ReglasHorario } from "./tipos";

const VISPERA: ModoVispera[] = ["EXIGIR", "ADVERTIR", "NO_APLICAR"];
const ROTACION: PoliticaRotacion[] = ["SEMANAL", "EQUITATIVA", "FIJA"];

export function normalizarReglas(x: unknown): ReglasHorario {
  const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const descanso = Number(r.descansoEntreJornadasH);
  return {
    // Nunca por debajo de las 10 h del Art. 327.
    descansoEntreJornadasH: Number.isFinite(descanso)
      ? Math.min(24, Math.max(DESCANSO_LEGAL_ENTRE_JORNADAS_H, descanso))
      : REGLAS_POR_OMISION.descansoEntreJornadasH,
    vispera: VISPERA.includes(r.vispera as ModoVispera) ? (r.vispera as ModoVispera) : REGLAS_POR_OMISION.vispera,
    rotacion: ROTACION.includes(r.rotacion as PoliticaRotacion) ? (r.rotacion as PoliticaRotacion) : REGLAS_POR_OMISION.rotacion,
    permitirExtra: r.permitirExtra === true,
    puestosExentos: Array.isArray(r.puestosExentos) ? r.puestosExentos.filter((v): v is string => typeof v === "string") : [],
  };
}

export const ETIQUETA_VISPERA: Record<ModoVispera, string> = {
  EXIGIR: "Exigir: salida a más tardar a la 1:00 p. m. la víspera del descanso",
  ADVERTIR: "Advertir, sin obligar",
  NO_APLICAR: "No aplicar",
};

export const ETIQUETA_ROTACION: Record<PoliticaRotacion, string> = {
  SEMANAL: "Semanal: la misma franja toda la semana y se alterna apertura/cierre cada semana",
  EQUITATIVA: "Equitativa: reparte aperturas y cierres por igual entre el equipo",
  FIJA: "Fija: cada persona mantiene su franja habitual",
};
