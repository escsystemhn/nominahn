/**
 * Cuatro perfiles de empresa con un período de incidencias cada uno. Sirven de ejemplo de
 * configuración y de prueba de regresión (`ejemplos.test.ts`). Salarios y personas son
 * ILUSTRATIVOS; las fechas son reales (el 2 de noviembre de 2026 es lunes).
 */

import { POLITICA_POR_OMISION, type PoliticaAsistencia } from "./politica";
import type { EntradaDeducciones } from "./motor";

const L_V_8 = { 1: 8, 2: 8, 3: 8, 4: 8, 5: 8 };

/** 1. Maquila: planilla semanal, 44 h con sábado de 4, reglamento estricto pero dentro de la ley. */
export const MAQUILA_ESTRICTA: PoliticaAsistencia = {
  ...POLITICA_POR_OMISION,
  descontarTiempo: true,
  tardanzas: { tolerancia: { modo: "POR_EVENTO", minutos: 5, descontarCompletoSiExcede: true }, redondeo: { modo: "BLOQUES", minutos: 15 } },
  salidasAnticipadas: { tolerancia: { modo: "NINGUNA" }, redondeo: { modo: "BLOQUES", minutos: 15 } },
  umbralAusencia: { activo: true, minutos: 120, siTrabajo: "MEDIA_JORNADA" },
  ausencias: { ...POLITICA_POR_OMISION.ausencias, feriadoAdyacente: "ALERTAR" },
};

/** 2. Oficina administrativa: mensual, bolsa de gracia, compensación y sin séptimo (política B). */
export const OFICINA_FLEXIBLE: PoliticaAsistencia = {
  ...POLITICA_POR_OMISION,
  descontarTiempo: true,
  tardanzas: { tolerancia: { modo: "BOLSA_PERIODO", minutos: 30, alAgotarse: "SOLO_EXCEDENTE" }, redondeo: { modo: "MINUTO_EXACTO" } },
  salidasAnticipadas: { tolerancia: { modo: "POR_EVENTO", minutos: 10, descontarCompletoSiExcede: false }, redondeo: { modo: "MINUTO_EXACTO" } },
  compensacion: { activa: true },
  ausencias: { ...POLITICA_POR_OMISION.ausencias, septimo: { ...POLITICA_POR_OMISION.ausencias.septimo, MENSUAL: { modo: "NINGUNO" } } },
};

/** 3. Tienda: quincenal, jornada mixta de lunes a sábado, días reales y séptimo proporcional (política C). */
export const COMERCIO_PROPORCIONAL: PoliticaAsistencia = {
  ...POLITICA_POR_OMISION,
  descontarTiempo: true,
  divisor: { tipo: "DIAS_REALES" },
  tardanzas: { tolerancia: { modo: "POR_EVENTO", minutos: 10, descontarCompletoSiExcede: false }, redondeo: { modo: "BLOQUES", minutos: 30 } },
  umbralAusencia: { activo: true, minutos: 180, siTrabajo: "MEDIA_JORNADA" },
  ausencias: {
    ...POLITICA_POR_OMISION.ausencias,
    septimo: { ...POLITICA_POR_OMISION.ausencias.septimo, QUINCENAL: { modo: "PROPORCIONAL", diasSemana: 6 } },
    feriadoAdyacente: "ALERTAR",
  },
};

/**
 * 4. Seguridad nocturna con un reglamento AGRESIVO, tal como lo trae un cliente: el motor
 * lo aplica para medir su exposición y deja las alertas de riesgo legal.
 */
export const REGLAMENTO_AGRESIVO: PoliticaAsistencia = {
  ...POLITICA_POR_OMISION,
  descontarTiempo: true,
  divisor: { tipo: "LABORABLES", dias: 26 },
  tardanzas: { tolerancia: { modo: "BOLSA_PERIODO", minutos: 15, alAgotarse: "TOTAL_ACUMULADO" }, redondeo: { modo: "BLOQUES", minutos: 60 } },
  ausencias: { ...POLITICA_POR_OMISION.ausencias, feriadoAdyacente: "DESCONTAR_FERIADO" },
  proteccion: { excesoSobreTiempoReal: "PERMITIR_CON_ALERTA" },
};

export const EJEMPLOS: { nombre: string; entrada: EntradaDeducciones }[] = [
  {
    nombre: "Maquila, semanal, reglamento estricto",
    entrada: {
      perfil: { salarioMensual: 12000, frecuencia: "SEMANAL", jornada: { tipo: "DIURNA" }, horario: { ...L_V_8, 6: 4 } },
      politica: MAQUILA_ESTRICTA,
      periodo: { desde: "2026-11-02", hasta: "2026-11-08" },
      incidencias: [
        { tipo: "TARDANZA", fecha: "2026-11-02", minutos: 3 },
        { tipo: "TARDANZA", fecha: "2026-11-03", minutos: 7 },
        { tipo: "AUSENCIA", fecha: "2026-11-04", clasificacion: "INJUSTIFICADA" },
        { tipo: "TARDANZA", fecha: "2026-11-05", minutos: 150, trabajoElResto: true },
        { tipo: "SALIDA_ANTICIPADA", fecha: "2026-11-06", minutos: 20 },
      ],
    },
  },
  {
    nombre: "Oficina administrativa, mensual, flexible",
    entrada: {
      perfil: { salarioMensual: 30000, frecuencia: "MENSUAL", jornada: { tipo: "DIURNA" }, horario: L_V_8 },
      politica: OFICINA_FLEXIBLE,
      periodo: { desde: "2026-11-01", hasta: "2026-11-30" },
      incidencias: [
        { tipo: "TARDANZA", fecha: "2026-11-03", minutos: 10 },
        { tipo: "TARDANZA", fecha: "2026-11-05", minutos: 25, minutosDespuesDeSalida: 25 },
        { tipo: "TARDANZA", fecha: "2026-11-10", minutos: 15 },
        { tipo: "TARDANZA", fecha: "2026-11-12", minutos: 12 },
        { tipo: "SALIDA_ANTICIPADA", fecha: "2026-11-18", minutos: 30 },
        { tipo: "AUSENCIA", fecha: "2026-11-19", clasificacion: "SIN_GOCE" },
        { tipo: "AUSENCIA", fecha: "2026-11-24", clasificacion: "INJUSTIFICADA" },
        { tipo: "AUSENCIA", fecha: "2026-11-26", clasificacion: "INCAPACIDAD" },
      ],
    },
  },
  {
    nombre: "Tienda, quincenal, jornada mixta",
    entrada: {
      perfil: { salarioMensual: 18000, frecuencia: "QUINCENAL", jornada: { tipo: "MIXTA" }, horario: { 1: 7, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7 } },
      politica: COMERCIO_PROPORCIONAL,
      periodo: { desde: "2026-11-01", hasta: "2026-11-15" },
      incidencias: [
        { tipo: "TARDANZA", fecha: "2026-11-04", minutos: 25 },
        { tipo: "TARDANZA", fecha: "2026-11-06", minutos: 8 },
        { tipo: "AUSENCIA", fecha: "2026-11-09", clasificacion: "INJUSTIFICADA" },
        { tipo: "AUSENCIA", fecha: "2026-11-11", clasificacion: "INJUSTIFICADA" },
        { tipo: "TARDANZA", fecha: "2026-11-13", minutos: 200, trabajoElResto: true },
      ],
    },
  },
  {
    nombre: "Seguridad nocturna, quincenal, reglamento agresivo",
    entrada: {
      perfil: { salarioMensual: 15000, frecuencia: "QUINCENAL", jornada: { tipo: "NOCTURNA" }, horario: { 1: 6, 2: 6, 3: 6, 4: 6, 5: 6, 6: 6 } },
      politica: REGLAMENTO_AGRESIVO,
      periodo: { desde: "2026-10-16", hasta: "2026-10-31" },
      feriados: ["2026-10-21"],
      incidencias: [
        { tipo: "TARDANZA", fecha: "2026-10-16", minutos: 10 },
        { tipo: "TARDANZA", fecha: "2026-10-19", minutos: 9 },
        { tipo: "AUSENCIA", fecha: "2026-10-20", clasificacion: "INJUSTIFICADA" },
        { tipo: "TARDANZA", fecha: "2026-10-23", minutos: 5 },
      ],
    },
  },
];
