/**
 * Conceptos de ley editables en Configuración → Parámetros de ley.
 *
 * Lo comparten la API y la pantalla (no importa Prisma), para que las dos
 * coincidan en qué campos lleva cada concepto: INFOP no tiene parte del
 * empleado, RAP tiene piso y techo, IHSS e IVM sólo techo.
 */

import { PARAMETROS_DEFAULT } from "./calculos-hn";

export const CODIGOS_CONCEPTO_LEY = ["IHSS", "IVM", "RAP", "RESERVA_LABORAL", "INFOP"] as const;
export type CodigoConceptoLey = (typeof CODIGOS_CONCEPTO_LEY)[number];

export interface MetaConceptoLey {
  codigo: CodigoConceptoLey;
  nombre: string;
  descripcion: string;
  /** El concepto se descuenta al empleado (INFOP es sólo patronal). */
  tieneEmpleado: boolean;
  /** Techo de la base cotizable. */
  tieneTope: boolean;
  /** Piso de la base: RAP cotiza sobre el excedente del salario sobre él. */
  tienePiso: boolean;
  /** Valores 2026 del motor, usados si el concepto no está en la base. */
  defecto: {
    porcentajeEmpleado: number | null;
    porcentajeEmpleador: number;
    topeMaximo: number | null;
    topeMinimo: number | null;
  };
}

const D = PARAMETROS_DEFAULT;

export const CONCEPTOS_LEY: Record<CodigoConceptoLey, MetaConceptoLey> = {
  IHSS: {
    codigo: "IHSS",
    nombre: "IHSS — Enfermedad y Maternidad (EM)",
    descripcion: "Régimen de atención de salud del IHSS. Cotiza sobre el salario hasta el techo.",
    tieneEmpleado: true,
    tieneTope: true,
    tienePiso: false,
    defecto: { porcentajeEmpleado: D.ihssEmpleado, porcentajeEmpleador: D.ihssEmpleador, topeMaximo: D.ihssTope, topeMinimo: null },
  },
  IVM: {
    codigo: "IVM",
    nombre: "IHSS — Invalidez, Vejez y Muerte (IVM)",
    descripcion: "Régimen de pensiones del IHSS. El aporte del Estado (0.5 %) es informativo y no se edita aquí.",
    tieneEmpleado: true,
    tieneTope: true,
    tienePiso: false,
    defecto: { porcentajeEmpleado: D.ivmEmpleado, porcentajeEmpleador: D.ivmEmpleador, topeMaximo: D.ivmTope, topeMinimo: null },
  },
  RAP: {
    codigo: "RAP",
    nombre: "RAP — Fondo de Vivienda (FOVIIF)",
    descripcion:
      "Aporte del trabajador y del patrono al fondo de vivienda del RAP. Por porcentaje cotiza sobre " +
      "el excedente del salario sobre el piso, hasta el techo.",
    tieneEmpleado: true,
    tieneTope: true,
    tienePiso: true,
    defecto: { porcentajeEmpleado: D.rapEmpleado, porcentajeEmpleador: D.rapEmpleador, topeMaximo: D.rapTope, topeMinimo: D.rapPiso },
  },
  RESERVA_LABORAL: {
    codigo: "RESERVA_LABORAL",
    nombre: "Fondo de Reserva Laboral (RAP)",
    descripcion:
      "Aporte sólo patronal sobre el salario ordinario, sin piso y topado. Se acumula a nombre del " +
      "trabajador y al liquidar se descuenta del auxilio de cesantía (Decreto 47-2024).",
    tieneEmpleado: false,
    tieneTope: true,
    tienePiso: false,
    defecto: {
      porcentajeEmpleado: null,
      porcentajeEmpleador: D.reservaLaboralEmpleador,
      topeMaximo: D.reservaLaboralTope,
      topeMinimo: null,
    },
  },
  INFOP: {
    codigo: "INFOP",
    nombre: "INFOP — Formación Profesional",
    descripcion: "Aporte sólo patronal sobre el salario. No se descuenta al empleado.",
    tieneEmpleado: false,
    tieneTope: false,
    tienePiso: false,
    defecto: { porcentajeEmpleado: null, porcentajeEmpleador: D.infopEmpleador, topeMaximo: null, topeMinimo: null },
  },
};

export function esCodigoConceptoLey(c: string): c is CodigoConceptoLey {
  return (CODIGOS_CONCEPTO_LEY as readonly string[]).includes(c);
}

/**
 * La base guarda las tasas como fracción (0.025) con 4 decimales; la pantalla
 * las muestra como porcentaje (2.5) con hasta 2. Redondear en cada paso evita
 * que 0.025 × 100 aparezca como 2.5000000000000004.
 */
export const fraccionAPorcentaje = (f: number) => Math.round(f * 1_000_000) / 10_000;
export const porcentajeAFraccion = (p: number) => Math.round(p * 100) / 10_000;
