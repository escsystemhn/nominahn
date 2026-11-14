/**
 * Generador de horarios rotativos. PURO: recibe todo en memoria y devuelve el
 * plan ya validado por `validarPlan`.
 *
 * CÓMO DECIDE
 *
 *   1. Descansos, semana por semana y equipo por equipo (sucursal × puesto).
 *      Plazo legal: nadie pasa de 6 días seguidos (Art. 338). Dentro de ese
 *      plazo se elige el día con más holgura (personas disponibles menos las que
 *      exige la cobertura) y se rotan los fines de semana. Con UN descanso por
 *      semana el día libre sólo puede adelantarse, nunca atrasarse —atrasarlo
 *      daría 7 días seguidos—; por eso quien lleva 3 semanas sin descansar
 *      sábado ni domingo recibe un descanso adicional ese fin de semana, si la
 *      cobertura lo permite. Trabajar menos de 44 h no reduce el salario
 *      (Art. 328).
 *
 *   2. Turnos del día. Primero se decide QUÉ turnos del catálogo cubren los
 *      mínimos por franja de 15 minutos (y los que sobran refuerzan las horas
 *      pico); después QUIÉN hace cada uno, por asignación de costo mínimo. El
 *      costo expresa la política de rotación de aperturas y cierres y la
 *      estabilidad que pide el Art. 337 («evitar cambiar los turnos en forma que
 *      altere las horas de descanso y comidas»).
 *
 *   3. Lo que quede descubierto se intenta cubrir con traslados de personas que
 *      aceptan moverse y cuya sucursal no queda corta sin ellas. Sólo si la
 *      empresa lo autoriza se prolongan turnos con horas extra, que quedan
 *      marcadas y clasificadas (Art. 330).
 *
 * Nunca programa horas extra por diseño: los turnos del catálogo que superan la
 * jornada legal de su tipo se descartan y se avisa por qué.
 */

import {
  analizarJornada,
  topeSemanalH,
  horaDeMinutos,
  horas,
  VISPERA_HORA_MAX,
  EDAD_MINIMA_TRABAJO,
  maxDiarioMenorH,
  EXENTO_MAX_PERMANENCIA_H,
  MAX_ORDINARIA_MAS_EXTRA_H,
  MAX_DIAS_CON_EXTRA_SEMANA,
  MAX_DIAS_CONSECUTIVOS,
  DESCANSO_LEGAL_ENTRE_JORNADAS_H,
  UMBRAL_NOCTURNA_MIN,
  MAX_DIARIO_H,
  type TipoJornada,
} from "./ley";
import { rango, diaIso, lunesDe, sumarDias, diasEntre, esFinDeSemana, NOMBRE_DIA } from "./fechas";
import { validarPlan, categoriaTurno, type EntradaValidacion } from "./validar";
import { asignacionMinima } from "./hungaro";
import type { Alerta, CategoriaTurno, DiaPlan, EmpleadoPlan, ResultadoValidacion, TurnoCatalogo } from "./tipos";

export interface Ausencia {
  empleadoId: string;
  fecha: string;
  motivo: string;
}

export interface EntradaGenerador extends Omit<EntradaValidacion, "dias"> {
  ausencias: Ausencia[];
}

export interface ResultadoGenerador extends ResultadoValidacion {
  plan: DiaPlan[];
  /** Explicaciones del generador (turnos descartados, personas sin cobertura, etc.). */
  notas: Alerta[];
}

const SLOT = 15;
const IMPOSIBLE = 1_000_000;
const MOTIVO_ROTACION_FINDE = "Descanso adicional: rotación de fines de semana";

/**
 * El descanso SEMANAL es el que no lleva motivo. Los demás días sin trabajo
 * (descansos adicionales, indisponibilidad, sucursal cerrada) no lo son, y la
 * regla de la víspera (Art. 341) sólo se refiere al semanal.
 */
export const esDescansoSemanal = (d: Pick<DiaPlan, "estado" | "motivo"> | undefined) => d?.estado === "DESCANSO" && !d.motivo;

interface TurnoPrep extends TurnoCatalogo {
  tipo: TipoJornada;
  efectivos: number;
  ordinarios: number;
  extra: number;
  nocturnos: number;
  categoria: CategoriaTurno;
  lapso: number;
}

interface Estado {
  finAbs: number | null;
  racha: number;
  semana: string | null;
  ordSemana: number;
  tiposSemana: TipoJornada[];
  categoriasSemana: CategoriaTurno[];
  categoriaSemanaPasada: CategoriaTurno | null;
  ultimaCategoria: CategoriaTurno | null;
  ultimoTurnoId: string | null;
  conteo: Record<CategoriaTurno, number>;
  finesDeSemana: number;
  semanasSinFinDeSemana: number;
  diasExtraSemana: number;
}

interface Asignado {
  turno: TurnoPrep;
  entrada: number;
  salida: number;
  sucursalId: string;
  esTraslado: boolean;
}

const predominante = (cats: CategoriaTurno[]): CategoriaTurno | null => {
  const a = cats.filter((c) => c === "APERTURA").length;
  const c = cats.filter((x) => x === "CIERRE").length;
  if (a === 0 && c === 0) return cats.length ? "INTERMEDIO" : null;
  return a >= c ? "APERTURA" : "CIERRE";
};
const opuesta = (c: CategoriaTurno | null): CategoriaTurno | null =>
  c === "APERTURA" ? "CIERRE" : c === "CIERRE" ? "APERTURA" : c;

/** Orden lexicográfico: positivo si `a` es mejor (mayor) que `b`. */
function compararClaves(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function generarPlan(e: EntradaGenerador): ResultadoGenerador {
  const notas: Alerta[] = [];
  const fechas = rango(e.desde, e.hasta);
  const abs = (fecha: string, min: number) => diasEntre(e.desde, fecha) * 1440 + min;
  const reglas = e.reglas;
  const descansoPolitica = Math.max(DESCANSO_LEGAL_ENTRE_JORNADAS_H, reglas.descansoEntreJornadasH) * 60;

  // ─── Catálogo de turnos ──────────────────────────────────────────────────
  const prep: TurnoPrep[] = e.turnos.map((t) => {
    const r = analizarJornada({ entrada: t.entrada, salida: t.salida, pausa: t.pausa }, { ordinariasPactadasH: t.ordinariasPactadasH });
    return {
      ...t, tipo: r.tipo, efectivos: r.efectivos, ordinarios: r.ordinarios, extra: r.extraTotal,
      nocturnos: r.minutosNocturnos, categoria: categoriaTurno(t.entrada, t.salida), lapso: t.salida - t.entrada,
    };
  }).sort((a, b) => a.entrada - b.entrada || a.codigo.localeCompare(b.codigo));
  const sinExtra = prep.filter((t) => t.extra === 0);
  for (const t of prep.filter((x) => x.extra > 0)) {
    const motivoNoche = t.tipo === "NOCTURNA" && t.nocturnos >= UMBRAL_NOCTURNA_MIN && t.nocturnos < t.lapso
      ? ` (Art. 321: ${horas(t.nocturnos)} h nocturnas la vuelven nocturna)` : "";
    notas.push({
      nivel: "AVISO", tipo: "LEGAL", codigo: "GEN_TURNO_DESCARTADO", articulo: "Arts. 321 y 322",
      mensaje: `El turno «${t.nombre}» (${horaDeMinutos(t.entrada)}–${horaDeMinutos(t.salida)}) es jornada ${t.tipo.toLowerCase()}${motivoNoche}: ` +
        `tiene ${horas(t.efectivos)} h efectivas y el máximo es ${MAX_DIARIO_H[t.tipo]} h. No se usó, para no programar horas extra.`,
    });
  }
  const minOrdinarios = sinExtra.length ? Math.min(...sinExtra.map((t) => t.ordinarios)) : 0;

  // ─── Requisitos ──────────────────────────────────────────────────────────
  const cerrada = (sucursalId: string, fecha: string) =>
    e.horarioAtencion.some((h) => h.sucursalId === sucursalId && h.dia === diaIso(fecha) && h.cerrado);
  const cacheExigido = new Map<string, Map<number, number>>();
  /** Mínimo por franja de 15 min de un puesto en una sucursal y fecha (franjas relativas a su medianoche). */
  const exigido = (sucursalId: string, puestoId: string, fecha: string): Map<number, number> => {
    const k = `${sucursalId}|${puestoId}|${fecha}`;
    let m = cacheExigido.get(k);
    if (m) return m;
    m = new Map();
    if (!cerrada(sucursalId, fecha)) {
      for (const r of e.requisitos) {
        if (r.sucursalId !== sucursalId || r.puestoId !== puestoId || !r.dias.includes(diaIso(fecha))) continue;
        for (let t = r.desde; t < r.hasta; t += SLOT) m.set(t, Math.max(m.get(t) ?? 0, r.minimo));
      }
    }
    cacheExigido.set(k, m);
    return m;
  };
  const cubre = (a: number, b: number, s: number) => a <= s && b >= s + SLOT;

  /** Cuántos turnos del catálogo hacen falta para cubrir los mínimos de un día (cota para repartir descansos). */
  const necesarios = (sucursalId: string, puestoId: string, fecha: string): number => {
    const ex = exigido(sucursalId, puestoId, fecha);
    if (ex.size === 0) return 0;
    const falta = new Map(ex);
    let n = 0;
    for (let i = 0; i < 60; i++) {
      let mejor: TurnoPrep | null = null;
      let mejorG = 0;
      for (const t of sinExtra) {
        let g = 0;
        for (const [s, v] of falta) if (v > 0 && cubre(t.entrada, t.salida, s)) g++;
        if (g > mejorG) { mejorG = g; mejor = t; }
      }
      if (!mejor) break;
      n++;
      for (const [s, v] of falta) if (v > 0 && cubre(mejor.entrada, mejor.salida, s)) falta.set(s, v - 1);
    }
    return n;
  };

  // ─── Personas y equipos ──────────────────────────────────────────────────
  const grupos = new Map<string, EmpleadoPlan[]>();
  const sinCobertura: EmpleadoPlan[] = [];
  const tieneRequisitos = (s: string, p: string) => e.requisitos.some((r) => r.sucursalId === s && r.puestoId === p);
  const menoresDe14: EmpleadoPlan[] = [];
  for (const p of [...e.empleados].sort((a, b) => a.codigo.localeCompare(b.codigo))) {
    if (p.edad < EDAD_MINIMA_TRABAJO) { menoresDe14.push(p); continue; }
    if (!tieneRequisitos(p.sucursalId, p.puestoId)) { sinCobertura.push(p); continue; }
    const k = `${p.sucursalId}|${p.puestoId}`;
    grupos.set(k, [...(grupos.get(k) ?? []), p]);
  }
  if (sinCobertura.length) {
    notas.push({
      nivel: "INFO", tipo: "OPERATIVA", codigo: "GEN_SIN_COBERTURA",
      mensaje: `${sinCobertura.length} persona(s) no se programaron porque su puesto no tiene cobertura definida en su sucursal: ${sinCobertura.map((x) => x.nombre).join(", ")}.`,
    });
  }
  if (menoresDe14.length) {
    notas.push({
      nivel: "ERROR", tipo: "LEGAL", codigo: "GEN_MENOR_DE_14", articulo: "Código de la Niñez, Art. 120",
      mensaje: `No se programó a ${menoresDe14.map((x) => `${x.nombre} (${x.edad} años)`).join(", ")}: la ley no permite autorizar el trabajo de menores de 14. Revise la fecha de nacimiento.`,
    });
  }
  const programados = [...grupos.values()].flat();
  const empPorId = new Map(programados.map((p) => [p.id, p]));
  // Un menor sólo puede tomar turnos diurnos dentro de su tope diario; si el catálogo no tiene ninguno, decirlo.
  const menoresSinTurno = programados.filter((p) => {
    const tope = maxDiarioMenorH(p.edad);
    return tope !== null && !sinExtra.some((t) => t.nocturnos === 0 && t.efectivos <= tope * 60);
  });
  if (menoresSinTurno.length) {
    notas.push({
      nivel: "AVISO", tipo: "LEGAL", codigo: "GEN_MENOR_SIN_TURNO", articulo: "Código de la Niñez, Art. 125",
      mensaje: `${menoresSinTurno.map((x) => `${x.nombre} (${x.edad} años)`).join(", ")}: ningún turno del catálogo es diurno y dentro de su jornada máxima ` +
        "(4 h diarias de 14 a 15 años, 6 h de 16 a 17), así que no se le(s) programó. Cree un turno corto para menores.",
    });
  }

  // ─── Estado inicial desde el historial ───────────────────────────────────
  const estado = new Map<string, Estado>();
  for (const p of programados) {
    const hist = e.historial.filter((d) => d.empleadoId === p.id && d.fecha < e.desde).sort((a, b) => a.fecha.localeCompare(b.fecha));
    let racha = 0;
    let esperado = sumarDias(e.desde, -1);
    for (const d of [...hist].reverse()) {
      if (d.fecha !== esperado || d.estado !== "TURNO") break;
      racha++;
      esperado = sumarDias(esperado, -1);
    }
    const ultimo = [...hist].reverse().find((d) => d.estado === "TURNO" && d.salida !== null);
    const semanaInicio = lunesDe(e.desde);
    const deEstaSemana = hist.filter((d) => d.estado === "TURNO" && d.fecha >= semanaInicio && d.entrada !== null && d.salida !== null);
    const deLaAnterior = hist.filter((d) => d.estado === "TURNO" && d.fecha >= sumarDias(semanaInicio, -7) && d.fecha < semanaInicio && d.entrada !== null && d.salida !== null);
    const conteo: Record<CategoriaTurno, number> = { APERTURA: 0, INTERMEDIO: 0, CIERRE: 0, MEDIA: 0 };
    for (const d of hist) if (d.estado === "TURNO" && d.entrada !== null && d.salida !== null) conteo[categoriaTurno(d.entrada, d.salida)]++;
    estado.set(p.id, {
      finAbs: ultimo ? abs(ultimo.fecha, ultimo.salida!) : null,
      racha,
      semana: semanaInicio,
      ordSemana: deEstaSemana.reduce((s, d) => s + analizarJornada({ entrada: d.entrada!, salida: d.salida!, pausa: d.pausa }).ordinarios, 0),
      tiposSemana: deEstaSemana.map((d) => analizarJornada({ entrada: d.entrada!, salida: d.salida!, pausa: d.pausa }).tipo),
      categoriasSemana: deEstaSemana.map((d) => categoriaTurno(d.entrada!, d.salida!)),
      categoriaSemanaPasada: predominante(deLaAnterior.map((d) => categoriaTurno(d.entrada!, d.salida!))),
      ultimaCategoria: ultimo ? categoriaTurno(ultimo.entrada!, ultimo.salida!) : null,
      ultimoTurnoId: ultimo?.turnoId ?? null,
      conteo,
      finesDeSemana: 0,
      semanasSinFinDeSemana: 0,
      diasExtraSemana: 0,
    });
  }

  // ─── Días ya decididos: ausencias, indisponibles, sucursal cerrada ───────
  const dia = new Map<string, DiaPlan>(); // `${empleadoId}|${fecha}`
  const k2 = (id: string, f: string) => `${id}|${f}`;
  const fijar = (p: EmpleadoPlan, fecha: string, estadoDia: DiaPlan["estado"], motivo: string | null) =>
    dia.set(k2(p.id, fecha), {
      empleadoId: p.id, fecha, estado: estadoDia, sucursalId: estadoDia === "TURNO" ? p.sucursalId : null,
      turnoId: null, entrada: null, salida: null, pausa: 0, esTraslado: false, motivo,
    });
  for (const a of e.ausencias) {
    const p = empPorId.get(a.empleadoId);
    if (p && a.fecha >= e.desde && a.fecha <= e.hasta) fijar(p, a.fecha, "AUSENCIA", a.motivo);
  }
  for (const p of programados) {
    for (const fecha of fechas) {
      if (dia.has(k2(p.id, fecha))) continue;
      if (p.preferencias.diasNoDisponible.includes(diaIso(fecha))) {
        fijar(p, fecha, "DESCANSO", `No disponible los ${NOMBRE_DIA[diaIso(fecha)]}${p.preferencias.motivo ? ` (${p.preferencias.motivo})` : ""}`);
      } else if (cerrada(p.sucursalId, fecha)) {
        fijar(p, fecha, "DESCANSO", "Sucursal cerrada");
      }
    }
  }
  const libre = (id: string, fecha: string) => !dia.has(k2(id, fecha));
  /** Días de media jornada (víspera del descanso en semanas de 6 días). */
  const diaCorto = new Set<string>();

  // ─── 1. Descansos semanales ──────────────────────────────────────────────
  const semanas = [...new Set(fechas.map(lunesDe))].sort();
  /** ¿Algún miembro del equipo `de` acepta trasladarse a la sucursal del equipo `a`? */
  const prestaA = (de: EmpleadoPlan[], a: EmpleadoPlan[]) =>
    de[0].puestoId === a[0].puestoId && de[0].sucursalId !== a[0].sucursalId &&
    de.some((p) => p.preferencias.permiteTraslado && (!p.preferencias.sucursalesTraslado.length || p.preferencias.sucursalesTraslado.includes(a[0].sucursalId)));

  // Los equipos enlazados por traslados (mismo puesto) reparten sus descansos
  // juntos: si Centro puede prestar gerentes a Norte, que un gerente de Norte
  // descanse depende de que Centro tenga holgura ese día, y los fines de semana
  // se reparten con equidad entre todos ellos, no sólo dentro de cada sucursal.
  const claves = [...grupos.keys()].sort();
  const padre = new Map(claves.map((k) => [k, k]));
  const raiz = (k: string): string => (padre.get(k) === k ? k : raiz(padre.get(k)!));
  for (const a of claves) for (const b of claves) if (prestaA(grupos.get(a)!, grupos.get(b)!)) padre.set(raiz(a), raiz(b));
  const pozos = new Map<string, string[]>();
  for (const k of claves) pozos.set(raiz(k), [...(pozos.get(raiz(k)) ?? []), k]);

  for (const [indiceSemana, lunes] of semanas.entries()) {
    const diasW = fechas.filter((f) => lunesDe(f) === lunes);
    for (const clavesPozo of pozos.values()) {
      const cap = new Map<string, Map<string, number>>();
      for (const k of clavesPozo) {
        const lista = grupos.get(k)!;
        const { sucursalId, puestoId } = lista[0];
        cap.set(k, new Map(diasW.map((f) => [f, lista.filter((p) => libre(p.id, f)).length - necesarios(sucursalId, puestoId, f)])));
      }
      const claveDe = new Map<string, string>();
      for (const k of clavesPozo) for (const p of grupos.get(k)!) claveDe.set(p.id, k);
      /**
       * Holgura de un día para que descanse alguien del equipo `k`: la propia,
       * más lo que le pueden prestar los equipos que tienen de sobra, menos lo
       * que este equipo debe prestar a los que quedan cortos.
       */
      const holgura = (k: string, f: string): number => {
        const lista = grupos.get(k)!;
        let h = cap.get(k)!.get(f) ?? 0;
        for (const otro of clavesPozo) {
          if (otro === k) continue;
          const c = cap.get(otro)!.get(f) ?? 0;
          if (prestaA(grupos.get(otro)!, lista)) h += Math.max(0, c);
          if (prestaA(lista, grupos.get(otro)!)) h += Math.min(0, c);
        }
        return h;
      };
      const restar = (k: string, f: string) => cap.get(k)!.set(f, (cap.get(k)!.get(f) ?? 0) - 1);
      /**
       * Semana inglesa: 44 h = 5 jornadas de 8 h + media jornada (Art. 322). En
       * una semana de 6 días, la media jornada es la víspera del descanso —que
       * con el Art. 341 además debe terminar a la 1:00 p. m.—. Así el descanso
       * semanal cuesta la tarde del día anterior, y ese costo entra en la
       * holgura: si no, todos harían media jornada el mismo sábado.
       */
      const visperaDe = (f: string) => sumarDias(f, -1);
      const holguraDescanso = (k: string, f: string) => {
        const v = visperaDe(f);
        const hv = v && diasW.includes(v) ? holgura(k, v) : Number.POSITIVE_INFINITY;
        return Math.min(holgura(k, f), hv);
      };
      const descansoSemanal = (p: EmpleadoPlan, k: string, f: string) => {
        fijar(p, f, "DESCANSO", null);
        restar(k, f);
        const v = visperaDe(f);
        const trabajados = diasW.filter((x) => libre(p.id, x)).length;
        if (fechas.includes(v) && libre(p.id, v) && (trabajados >= 6 || reglas.vispera === "EXIGIR")) {
          diaCorto.add(k2(p.id, v));
          if (diasW.includes(v)) restar(k, v);
        }
      };
      const personas = clavesPozo.flatMap((k) => grupos.get(k)!);
      const minFinde = Math.min(...personas.map((p) => estado.get(p.id)!.finesDeSemana));

      /** Racha máxima de la semana si descansa en `extra` (además de los días ya fijados). */
      const rachaMax = (p: EmpleadoPlan, extra: string | null) => {
        let r = estado.get(p.id)!.racha;
        let max = r;
        for (const f of diasW) {
          r = libre(p.id, f) && f !== extra ? r + 1 : 0;
          max = Math.max(max, r);
        }
        return max;
      };

      // Menores de 16: descansan TODOS los domingos (Art. 338, sin excepción).
      for (const p of personas.filter((x) => x.edad < 16)) {
        const domingo = diasW.find((f) => diaIso(f) === 7 && libre(p.id, f));
        if (domingo) descansoSemanal(p, claveDe.get(p.id)!, domingo);
      }

      const opciones = (p: EmpleadoPlan) => diasW.filter((f) => libre(p.id, f) && rachaMax(p, f) <= MAX_DIAS_CONSECUTIVOS);
      const necesitan = personas.filter((p) => rachaMax(p, null) > MAX_DIAS_CONSECUTIVOS);
      necesitan.sort((a, b) =>
        opciones(a).length - opciones(b).length ||
        estado.get(a.id)!.finesDeSemana - estado.get(b.id)!.finesDeSemana ||
        a.codigo.localeCompare(b.codigo)
      );
      for (const p of necesitan) {
        const st = estado.get(p.id)!;
        const k = claveDe.get(p.id)!;
        const cands = opciones(p);
        const lista2 = cands.length ? cands : diasW.filter((f) => libre(p.id, f));
        if (!lista2.length) continue;
        const puntaje = (f: string, i: number) => {
          const h = holguraDescanso(k, f);
          let s = (h > 0 ? 100 : 0) + 3 * h + 0.1 * i;
          // Fin de semana: para quien menos ha tenido; quien ya tuvo más lo cede.
          if (esFinDeSemana(f)) s += st.finesDeSemana === minFinde ? 6 : -8 * (st.finesDeSemana - minFinde);
          if (p.preferencias.diaDescansoPreferido === diaIso(f)) s += 6;
          if (diaIso(f) === 7) s += 1; // Art. 338: «preferentemente el domingo»
          return s;
        };
        const elegido = lista2.map((f, i) => ({ f, s: puntaje(f, i) })).sort((a, b) => b.s - a.s)[0].f;
        descansoSemanal(p, k, elegido);
      }

      // Rotación de fines de semana. Con un solo descanso por semana el día libre
      // sólo se adelanta; para que vuelva al fin de semana hace falta un descanso
      // adicional, que se da a quien menos fines de semana lleva, si hay holgura.
      const porFinde = [...personas].sort((a, b) => estado.get(a.id)!.finesDeSemana - estado.get(b.id)!.finesDeSemana || a.codigo.localeCompare(b.codigo));
      for (const p of porFinde) {
        const st = estado.get(p.id)!;
        const k = claveDe.get(p.id)!;
        const yaTiene = diasW.some((f) => esFinDeSemana(f) && dia.get(k2(p.id, f))?.estado === "DESCANSO");
        const leToca = (st.finesDeSemana === 0 && indiceSemana >= 1) || st.semanasSinFinDeSemana >= 2;
        if (yaTiene || !leToca || p.edad < 16) continue;
        const finde = diasW.filter((f) => esFinDeSemana(f) && libre(p.id, f) && holgura(k, f) > 0);
        if (finde.length) {
          const f = finde.sort((a, b) => holgura(k, b) - holgura(k, a) || diaIso(b) - diaIso(a))[0];
          fijar(p, f, "DESCANSO", MOTIVO_ROTACION_FINDE);
          restar(k, f);
        }
      }

      for (const p of personas) {
        const st = estado.get(p.id)!;
        const descansosFinde = diasW.filter((f) => esFinDeSemana(f) && dia.get(k2(p.id, f))?.estado === "DESCANSO").length;
        st.finesDeSemana += descansosFinde;
        if (diasW.length === 7) st.semanasSinFinDeSemana = descansosFinde > 0 ? 0 : st.semanasSinFinDeSemana + 1;
        // La racha al cerrar la semana es el punto de partida de la siguiente.
        let r = st.racha;
        for (const f of diasW) r = libre(p.id, f) ? r + 1 : 0;
        st.racha = r;
      }
    }
  }
  // Las rachas se recalculan día a día en la asignación: se vuelven a tomar del historial.
  for (const p of programados) {
    const hist = e.historial.filter((d) => d.empleadoId === p.id && d.fecha < e.desde).sort((a, b) => b.fecha.localeCompare(a.fecha));
    let racha = 0;
    let esperado = sumarDias(e.desde, -1);
    for (const d of hist) {
      if (d.fecha !== esperado || d.estado !== "TURNO") break;
      racha++;
      esperado = sumarDias(esperado, -1);
    }
    estado.get(p.id)!.racha = racha;
  }

  // ─── 2. Turnos de cada día ───────────────────────────────────────────────
  let visperasSinTurno = 0;
  const asignadosPorFecha = new Map<string, Map<string, Asignado>>();

  for (const fecha of fechas) {
    const lunes = lunesDe(fecha);
    for (const p of programados) {
      const st = estado.get(p.id)!;
      if (st.semana !== lunes) {
        st.categoriaSemanaPasada = predominante(st.categoriasSemana) ?? st.categoriaSemanaPasada;
        st.semana = lunes;
        st.ordSemana = 0;
        st.tiposSemana = [];
        st.categoriasSemana = [];
        st.diasExtraSemana = 0;
      }
    }

    const asignados = new Map<string, Asignado>();
    asignadosPorFecha.set(fecha, asignados);
    const ayer = asignadosPorFecha.get(sumarDias(fecha, -1));

    const esVispera = (p: EmpleadoPlan, f: string) => esDescansoSemanal(dia.get(k2(p.id, sumarDias(f, 1))));

    const turnosPara = (p: EmpleadoPlan) => (p.exento ? prep.filter((t) => t.lapso <= EXENTO_MAX_PERMANENCIA_H * 60) : sinExtra);

    /** Lo que no depende del día anterior: menores, preferencias y la víspera del descanso. */
    const permitido = (p: EmpleadoPlan, t: TurnoPrep, f: string): boolean => {
      const pref = p.preferencias;
      const rige = pref.diasRestriccion.length === 0 || pref.diasRestriccion.includes(diaIso(f));
      const topeMenor = maxDiarioMenorH(p.edad);
      if (topeMenor !== null && (t.nocturnos > 0 || t.efectivos > topeMenor * 60)) return false;
      if (pref.soloDiurna && t.tipo !== "DIURNA") return false;
      if (rige && pref.noAntesDe !== null && t.entrada < pref.noAntesDe) return false;
      if (rige && pref.noDespuesDe !== null && t.salida > pref.noDespuesDe) return false;
      if (reglas.vispera === "EXIGIR" && esVispera(p, f) && t.salida > VISPERA_HORA_MAX) return false;
      return true;
    };

    /** Turnos posibles para una persona hoy, sin horas extra. */
    const factibles = (p: EmpleadoPlan, respetarPolitica: boolean, conFuturo: boolean): TurnoPrep[] => {
      const st = estado.get(p.id)!;
      const descansoMin = respetarPolitica ? descansoPolitica : DESCANSO_LEGAL_ENTRE_JORNADAS_H * 60;
      // Anticipación: si mañana sólo podrá entrar temprano (víspera de su
      // descanso, estudios, etc.), hoy no puede salir tan tarde que mañana no
      // alcance su descanso entre jornadas.
      const manana = sumarDias(fecha, 1);
      let salidaMaxima = Number.POSITIVE_INFINITY;
      if (fechas.includes(manana) && libre(p.id, manana)) {
        const deManana = turnosPara(p).filter((t) => permitido(p, t, manana));
        if (deManana.length) salidaMaxima = Math.max(...deManana.map((t) => t.entrada)) + 1440 - descansoMin;
      }
      const restantes = conFuturo
        ? fechas.filter((f) => f > fecha && lunesDe(f) === lunes && libre(p.id, f)).length
        : 0;
      return turnosPara(p).filter((t) => {
        if (st.finAbs !== null && abs(fecha, t.entrada) - st.finAbs < descansoMin) return false;
        if (t.salida > salidaMaxima) return false;
        if (!permitido(p, t, fecha)) return false;
        if (!p.exento) {
          const tipos = [...st.tiposSemana, t.tipo, ...Array(restantes).fill(t.tipo)];
          if (st.ordSemana + t.ordinarios + restantes * minOrdinarios > topeSemanalH(tipos) * 60 + 0.5) return false;
        }
        return true;
      });
    };
    const opcionesDe = (p: EmpleadoPlan): TurnoPrep[] => {
      for (const [politica, futuro] of [[true, true], [true, false], [false, true], [false, false]] as const) {
        const r = factibles(p, politica, futuro);
        if (!r.length) continue;
        // La media jornada es para su día (la víspera del descanso) o el último
        // recurso: como relleno de un día normal sólo le quita horas a la persona.
        if (diaCorto.has(k2(p.id, fecha))) {
          const medias = r.filter((t) => t.categoria === "MEDIA");
          return medias.length ? medias : r;
        }
        if (reglas.vispera === "EXIGIR" && esVispera(p, fecha)) return r;
        const completas = r.filter((t) => t.categoria !== "MEDIA");
        return completas.length ? completas : r;
      }
      return [];
    };

    const costoRotacion = (p: EmpleadoPlan, t: TurnoPrep, promedio: Record<CategoriaTurno, number>): number => {
      const st = estado.get(p.id)!;
      let c = st.ultimoTurnoId && st.ultimoTurnoId !== t.id ? 1 : 0;
      // Regla de la víspera en modo «advertir»: se prefiere salir temprano, sin obligar.
      if (reglas.vispera === "ADVERTIR" && esVispera(p, fecha) && t.salida > VISPERA_HORA_MAX) c += 8;
      if (t.categoria === "MEDIA") return c;
      if (reglas.rotacion === "SEMANAL") {
        const ultima = [...st.categoriasSemana].reverse().find((x) => x !== "MEDIA");
        if (ultima) c += t.categoria !== ultima ? 6 : 0;
        else {
          const preferida = opuesta(st.categoriaSemanaPasada);
          if (preferida && t.categoria !== preferida) c += 3;
        }
      } else if (reglas.rotacion === "EQUITATIVA") {
        for (const cat of ["APERTURA", "CIERRE"] as const) if (t.categoria === cat) c += 2 * (st.conteo[cat] - promedio[cat]);
        if (st.ultimaCategoria && st.ultimaCategoria !== t.categoria) c += 2;
      } else {
        const fija = (Object.entries(st.conteo) as [CategoriaTurno, number][])
          .filter(([cat]) => cat !== "MEDIA").sort((a, b) => b[1] - a[1])[0];
        if (fija && fija[1] > 0 && t.categoria !== fija[0]) c += 6;
      }
      return c;
    };

    const cobertura = new Map<string, Map<number, number>>(); // `${sucursal}|${puesto}` → franja → personas
    const cov = (s: string, puesto: string, fe: string) => {
      const k = `${s}|${puesto}`;
      let m = cobertura.get(k);
      if (!m) {
        m = new Map();
        // Turnos de ayer que cruzan la medianoche cubren las primeras franjas de hoy.
        for (const [id, a] of ayer ?? []) {
          if (a.sucursalId !== s || empPorId.get(id)?.puestoId !== puesto) continue;
          for (const franja of exigido(s, puesto, fe).keys()) if (cubre(a.entrada - 1440, a.salida - 1440, franja)) m.set(franja, (m.get(franja) ?? 0) + 1);
        }
        cobertura.set(k, m);
      }
      return m;
    };
    const sumar = (s: string, puesto: string, entrada: number, salida: number, signo: 1 | -1) => {
      const m = cov(s, puesto, fecha);
      for (const franja of exigido(s, puesto, fecha).keys()) if (cubre(entrada, salida, franja)) m.set(franja, (m.get(franja) ?? 0) + signo);
    };
    const falta = (s: string, puesto: string) => {
      const ex = exigido(s, puesto, fecha);
      const m = cov(s, puesto, fecha);
      const r = new Map<number, number>();
      for (const [franja, v] of ex) if (v - (m.get(franja) ?? 0) > 0) r.set(franja, v - (m.get(franja) ?? 0));
      return r;
    };
    const ganancia = (t: { entrada: number; salida: number }, faltante: Map<number, number>) => {
      let g = 0;
      for (const franja of faltante.keys()) if (cubre(t.entrada, t.salida, franja)) g++;
      return g;
    };
    const asignar = (p: EmpleadoPlan, t: TurnoPrep, sucursalId: string, entrada = t.entrada, salida = t.salida) => {
      asignados.set(p.id, { turno: t, entrada, salida, sucursalId, esTraslado: sucursalId !== p.sucursalId });
      sumar(sucursalId, p.puestoId, entrada, salida, 1);
    };

    const opcionesHoy = new Map<string, TurnoPrep[]>();
    for (const lista of grupos.values()) {
      const { sucursalId, puestoId } = lista[0];
      const trabajan = lista.filter((p) => libre(p.id, fecha));
      for (const p of trabajan) {
        const ops = opcionesDe(p);
        if (ops.length === 0) {
          const porVispera = reglas.vispera === "EXIGIR" && esVispera(p, fecha);
          if (porVispera) visperasSinTurno++;
          fijar(p, fecha, "DESCANSO", porVispera
            ? "Descanso adicional: no hay turno que termine a la 1:00 p. m. la víspera de su descanso (Art. 341)"
            : "Descanso adicional: ningún turno cumple su descanso entre jornadas, su tope semanal o sus restricciones");
        } else {
          opcionesHoy.set(p.id, ops);
        }
      }
      const disponibles = trabajan.filter((p) => opcionesHoy.has(p.id));
      if (!disponibles.length) continue;

      const promedio: Record<CategoriaTurno, number> = { APERTURA: 0, INTERMEDIO: 0, CIERRE: 0, MEDIA: 0 };
      for (const cat of Object.keys(promedio) as CategoriaTurno[]) {
        promedio[cat] = lista.reduce((s, p) => s + estado.get(p.id)!.conteo[cat], 0) / lista.length;
      }

      // a) Qué turnos hacen falta: primero los que cubren mínimos, luego los que
      //    refuerzan las horas pico. Cada turno que entra debe poder hacerlo
      //    alguien (emparejamiento persona-turno), para que el reparto de abajo
      //    nunca deje una franja sin la persona que la iba a cubrir.
      const resto = disponibles;
      const union = [...new Map(resto.flatMap((p) => opcionesHoy.get(p.id)!).map((t) => [t.id, t])).values()];
      const puedeHacer = (p: EmpleadoPlan, t: TurnoPrep) => opcionesHoy.get(p.id)!.some((x) => x.id === t.id);
      const emparejable = (turnosDia: TurnoPrep[]): boolean => {
        const duenoDe = new Map<number, number>(); // persona → turno
        const pareja = new Array<number>(turnosDia.length).fill(-1);
        const intentar = (j: number, vistos: Set<number>): boolean => {
          for (let i = 0; i < resto.length; i++) {
            if (vistos.has(i) || !puedeHacer(resto[i], turnosDia[j])) continue;
            vistos.add(i);
            const otro = duenoDe.get(i);
            if (otro === undefined || intentar(otro, vistos)) {
              duenoDe.set(i, j);
              pareja[j] = i;
              return true;
            }
          }
          return false;
        };
        return turnosDia.every((_, j) => intentar(j, new Set()));
      };
      const elegidos: TurnoPrep[] = [];
      const simulado = new Map(cov(sucursalId, puestoId, fecha));
      const ex = exigido(sucursalId, puestoId, fecha);
      const pueden = (t: TurnoPrep) => resto.filter((p) => puedeHacer(p, t)).length;
      const sinSolucion = new Set<number>();
      while (elegidos.length < resto.length) {
        const faltante = new Map<number, number>();
        for (const [franja, v] of ex) if (!sinSolucion.has(franja) && v - (simulado.get(franja) ?? 0) > 0) faltante.set(franja, v);
        const candidatos: { t: TurnoPrep; clave: number[] }[] = [];
        for (const t of union) {
          if (faltante.size) {
            const g = ganancia(t, faltante);
            if (g === 0) continue;
            let desperdicio = 0;
            for (const franja of ex.keys()) if (cubre(t.entrada, t.salida, franja) && !faltante.has(franja)) desperdicio++;
            candidatos.push({ t, clave: [g, -desperdicio, pueden(t)] });
          } else {
            let peso = 0;
            for (const [franja, v] of ex) if (cubre(t.entrada, t.salida, franja)) peso += v / ((simulado.get(franja) ?? 0) + 1);
            candidatos.push({ t, clave: [Math.round(peso * 1000), pueden(t), t.ordinarios] });
          }
        }
        candidatos.sort((a, b) => compararClaves(b.clave, a.clave) || a.t.codigo.localeCompare(b.t.codigo));
        const mejor = candidatos.find((c) => emparejable([...elegidos, c.t]))?.t;
        if (!mejor) {
          if (faltante.size) {
            // Nadie disponible puede cubrir estas franjas: quedan como faltante y se sigue con el refuerzo.
            for (const franja of faltante.keys()) sinSolucion.add(franja);
            continue;
          }
          break;
        }
        elegidos.push(mejor);
        for (const franja of ex.keys()) if (cubre(mejor.entrada, mejor.salida, franja)) simulado.set(franja, (simulado.get(franja) ?? 0) + 1);
      }

      // b) …y quién hace cada uno: asignación de costo mínimo según la rotación.
      const matriz = resto.map((p) => elegidos.map((t) => (puedeHacer(p, t) ? costoRotacion(p, t, promedio) * 10 : IMPOSIBLE)));
      for (const fila of matriz) while (fila.length < resto.length) fila.push(IMPOSIBLE);
      const minimo = Math.min(0, ...matriz.flat());
      const asignacion = asignacionMinima(matriz.map((fila) => fila.map((c) => c - minimo)));
      resto.forEach((p, i) => {
        const j = asignacion[i];
        if (j >= 0 && j < elegidos.length && matriz[i][j] < IMPOSIBLE) {
          asignar(p, elegidos[j], sucursalId);
        } else {
          // Sólo pasa si sobraba gente sin turno útil: refuerza donde más falta.
          const f = falta(sucursalId, puestoId);
          const t = [...opcionesHoy.get(p.id)!].sort((a, b) =>
            ganancia(b, f) - ganancia(a, f) || costoRotacion(p, a, promedio) - costoRotacion(p, b, promedio) || a.codigo.localeCompare(b.codigo))[0];
          asignar(p, t, sucursalId);
        }
      });
    }

    // ─── 3. Traslados para cubrir faltantes ────────────────────────────────
    for (const lista of grupos.values()) {
      const { sucursalId, puestoId } = lista[0];
      for (let intento = 0; intento < 10; intento++) {
        const f = falta(sucursalId, puestoId);
        if (!f.size) break;
        let mejor: { p: EmpleadoPlan; t: TurnoPrep; g: number } | null = null;
        for (const [id, a] of asignados) {
          const p = empPorId.get(id)!;
          if (p.puestoId !== puestoId || a.sucursalId === sucursalId || a.esTraslado) continue;
          const pref = p.preferencias;
          if (!pref.permiteTraslado || (pref.sucursalesTraslado.length && !pref.sucursalesTraslado.includes(sucursalId))) continue;
          // ¿Su sucursal sigue cubierta sin esta persona?
          const ex2 = exigido(a.sucursalId, puestoId, fecha);
          const cov2 = cov(a.sucursalId, puestoId, fecha);
          const dejaHueco = [...ex2].some(([franja, v]) => cubre(a.entrada, a.salida, franja) && (cov2.get(franja) ?? 0) - 1 < v);
          if (dejaHueco) continue;
          for (const t of opcionesHoy.get(p.id) ?? []) {
            const g = ganancia(t, f);
            if (g > 0 && (!mejor || g > mejor.g)) mejor = { p, t, g };
          }
        }
        if (!mejor) break;
        const previo = asignados.get(mejor.p.id)!;
        sumar(previo.sucursalId, puestoId, previo.entrada, previo.salida, -1);
        asignar(mejor.p, mejor.t, sucursalId);
      }
    }

    // ─── 4. Horas extra autorizadas (prolongar turnos) ─────────────────────
    if (reglas.permitirExtra) {
      for (const lista of grupos.values()) {
        const { sucursalId, puestoId } = lista[0];
        const f = falta(sucursalId, puestoId);
        if (!f.size) continue;
        const franjas = [...f.keys()].sort((a, b) => a - b);
        // Tramos contiguos descubiertos.
        const tramos: [number, number][] = [];
        for (const franja of franjas) {
          const ult = tramos[tramos.length - 1];
          if (ult && ult[1] === franja) ult[1] = franja + SLOT;
          else tramos.push([franja, franja + SLOT]);
        }
        for (const [a, b] of tramos) {
          let mejor: { id: string; entrada: number; salida: number; extension: number } | null = null;
          for (const [id, x] of asignados) {
            const p = empPorId.get(id)!;
            if (x.sucursalId !== sucursalId || p.puestoId !== puestoId || p.exento || maxDiarioMenorH(p.edad) !== null) continue;
            const st = estado.get(id)!;
            if (st.diasExtraSemana >= MAX_DIAS_CON_EXTRA_SEMANA) continue;
            const opciones: [number, number][] = [];
            if (x.salida >= a && x.salida < b) opciones.push([x.entrada, b]);
            if (x.entrada > a && x.entrada <= b) opciones.push([a, x.salida]);
            for (const [ne, ns] of opciones) {
              const efectivos = analizarJornada({ entrada: ne, salida: ns, pausa: x.turno.pausa }).efectivos;
              if (efectivos > MAX_ORDINARIA_MAS_EXTRA_H * 60) continue;
              if (ne < x.entrada && st.finAbs !== null && abs(fecha, ne) - st.finAbs < descansoPolitica) continue;
              const extension = ns - ne - (x.salida - x.entrada);
              if (!mejor || extension < mejor.extension) mejor = { id, entrada: ne, salida: ns, extension };
            }
          }
          if (mejor) {
            const x = asignados.get(mejor.id)!;
            sumar(sucursalId, puestoId, x.entrada, x.salida, -1);
            asignados.set(mejor.id, { ...x, entrada: mejor.entrada, salida: mejor.salida });
            sumar(sucursalId, puestoId, mejor.entrada, mejor.salida, 1);
            estado.get(mejor.id)!.diasExtraSemana++;
          }
        }
      }
    }

    // ─── Cierre del día ────────────────────────────────────────────────────
    for (const p of programados) {
      const st = estado.get(p.id)!;
      const a = asignados.get(p.id);
      if (!a) {
        if (!dia.has(k2(p.id, fecha))) fijar(p, fecha, "DESCANSO", null);
        st.racha = 0;
        continue;
      }
      dia.set(k2(p.id, fecha), {
        empleadoId: p.id, fecha, estado: "TURNO", sucursalId: a.sucursalId, turnoId: a.turno.id,
        entrada: a.entrada, salida: a.salida, pausa: a.turno.pausa, esTraslado: a.esTraslado, motivo: null,
      });
      const r = analizarJornada({ entrada: a.entrada, salida: a.salida, pausa: a.turno.pausa }, { ordinariasPactadasH: a.turno.ordinariasPactadasH, exento: p.exento });
      st.finAbs = abs(fecha, a.salida);
      st.racha++;
      st.ordSemana += r.ordinarios;
      st.tiposSemana.push(r.tipo);
      const cat = categoriaTurno(a.entrada, a.salida);
      st.categoriasSemana.push(cat);
      st.conteo[cat]++;
      st.ultimaCategoria = cat;
      st.ultimoTurnoId = a.turno.id;
    }
  }

  if (visperasSinTurno > 0) {
    notas.push({
      nivel: "AVISO", tipo: "LEGAL", codigo: "GEN_SIN_MEDIA_JORNADA", articulo: "Art. 341",
      mensaje: `${visperasSinTurno} víspera(s) de descanso quedaron como descanso adicional porque ningún turno termina a la 1:00 p. m. o antes. ` +
        "Cree un turno de media jornada (por ejemplo 07:00–12:00) o cambie la regla de la víspera en Reglas.",
    });
  }
  if (!sinExtra.length) {
    notas.push({ nivel: "ERROR", tipo: "LEGAL", codigo: "GEN_SIN_TURNOS", mensaje: "No hay ningún turno activo dentro de la jornada legal: no se pudo programar a nadie." });
  }

  const plan = [...dia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.empleadoId.localeCompare(b.empleadoId));
  const validacion = validarPlan({ ...e, empleados: programados, dias: plan });

  // Si la media jornada de la víspera empieza antes de que termine el descanso de quien cerró,
  // el día anterior a la víspera nadie puede cerrar: explicar de dónde salen esos huecos.
  // Se compara con el cierre que más usa el plan: el catálogo es de toda la empresa y
  // puede tener turnos de noche que estos puestos nunca toman.
  const usos = new Map<string, number>();
  for (const d of plan) if (d.estado === "TURNO" && d.turnoId) usos.set(d.turnoId, (usos.get(d.turnoId) ?? 0) + 1);
  const cierres = sinExtra.filter((t) => t.categoria === "CIERRE" && usos.has(t.id));
  const medias = sinExtra.filter((t) => t.salida <= VISPERA_HORA_MAX);
  if (cierres.length && medias.length && reglas.vispera === "EXIGIR") {
    const cierre = cierres.reduce((a, b) => (usos.get(b.id)! > usos.get(a.id)! ? b : a));
    const media = medias.reduce((a, b) => (b.entrada > a.entrada ? b : a));
    const regreso = cierre.salida + descansoPolitica - 1440;
    const salidaAntes = media.entrada + 1440 - descansoPolitica;
    if (media.entrada < regreso && validacion.faltantes.some((f) => f.hasta > salidaAntes)) {
      const sugerencia = regreso + 120 <= VISPERA_HORA_MAX
        ? ` Un turno de media jornada de ${horaDeMinutos(regreso)} a ${horaDeMinutos(VISPERA_HORA_MAX)} permite cerrar ese día.`
        : " Ninguna media jornada cabe entre el fin de ese descanso y la 1:00 p. m.";
      notas.push({
        nivel: "INFO", tipo: "OPERATIVA", codigo: "GEN_MEDIA_JORNADA_TEMPRANA", articulo: "Arts. 327 y 341",
        mensaje: `La media jornada de la víspera del descanso más tardía («${media.nombre}») empieza a las ${horaDeMinutos(media.entrada)}; ` +
          `quien cierra a las ${horaDeMinutos(cierre.salida % 1440)} no puede tomarla al día siguiente sin bajar de ${descansoPolitica / 60} h de descanso entre jornadas. ` +
          `Por eso el día anterior a cada víspera sólo se programan turnos que terminan a las ${horaDeMinutos(salidaAntes)}, y los cierres de ese día quedan cortos.` + sugerencia,
      });
    }
  }
  return { ...validacion, plan, notas };
}
