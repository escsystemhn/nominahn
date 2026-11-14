/**
 * Validación de un plan de horarios contra el Código del Trabajo y la cobertura
 * mínima de cada sucursal. PURO: sin base de datos.
 *
 * Valida el plan que salió del generador y también el que una persona editó a
 * mano: es la misma función, así que ninguna edición puede saltarse una regla.
 * Los días ya publicados antes del plan (`historial`) se usan para la
 * continuidad —días seguidos, descanso entre jornadas, horas de la semana— pero
 * no se reportan.
 */

import {
  analizarJornada,
  topeSemanalH,
  horaDeMinutos,
  horas,
  ETIQUETA_EXTRA,
  MAX_DIAS_CONSECUTIVOS,
  DESCANSO_LEGAL_ENTRE_JORNADAS_H,
  VISPERA_HORA_MAX,
  MAX_ORDINARIA_MAS_EXTRA_H,
  MAX_DIAS_CON_EXTRA_SEMANA,
  EXENTO_MAX_PERMANENCIA_H,
  EXENTO_DESCANSO_MIN,
  EDAD_MINIMA_TRABAJO,
  ADOLESCENTE_AUTORIZABLE_HASTA,
  FIN_NOCHE,
  maxDiarioMenorH,
  type ClaseExtra,
} from "./ley";
import { diaIso, lunesDe, sumarDias, rango, esFinDeSemana, fechaCorta, diasEntre } from "./fechas";
import type {
  Alerta,
  CategoriaTurno,
  DiaCalculado,
  DiaPlan,
  EmpleadoPlan,
  Faltante,
  FeriadoPlan,
  HorarioAtencionDia,
  ReglasHorario,
  Requisito,
  ResultadoValidacion,
  ResumenEmpleado,
  ResumenSemana,
  TurnoCatalogo,
} from "./tipos";

export interface EntradaValidacion {
  desde: string;
  hasta: string;
  empleados: EmpleadoPlan[];
  dias: DiaPlan[];
  historial: DiaPlan[];
  turnos: TurnoCatalogo[];
  requisitos: Requisito[];
  horarioAtencion: HorarioAtencionDia[];
  feriados: FeriadoPlan[];
  reglas: ReglasHorario;
  nombres?: { sucursales: Record<string, string>; puestos: Record<string, string> };
}

const SLOT = 15;
const cero = (): Record<ClaseExtra, number> => ({ DIURNA_25: 0, NOCTURNA_50: 0, PROLONGACION_NOCTURNA_75: 0 });

/** Apertura, intermedio, cierre o media jornada (la de la víspera del descanso). */
export function categoriaTurno(entrada: number, salida: number): CategoriaTurno {
  if (salida <= VISPERA_HORA_MAX && salida - entrada <= 6 * 60) return "MEDIA";
  if (salida >= 20 * 60) return "CIERRE";
  if (entrada < 9 * 60) return "APERTURA";
  return "INTERMEDIO";
}

const rangoHoras = (a: number, b: number) => `${horaDeMinutos(a)}–${horaDeMinutos(b)}${b > 1440 ? " (+1)" : ""}`;

export function validarPlan(e: EntradaValidacion): ResultadoValidacion {
  const alertas: Alerta[] = [];
  const emp = new Map(e.empleados.map((x) => [x.id, x]));
  const turnos = new Map(e.turnos.map((t) => [t.id, t]));
  const nomSuc = (id: string | null | undefined) => (id ? e.nombres?.sucursales[id] ?? id : "");
  const nomPue = (id: string | null | undefined) => (id ? e.nombres?.puestos[id] ?? id : "");
  const nomEmp = (id: string) => emp.get(id)?.nombre ?? id;
  const enPlan = (f: string) => f >= e.desde && f <= e.hasta;

  const feriado = (fecha: string, sucursalId: string | null): string | null =>
    e.feriados.find((f) => f.fecha === fecha && (f.sucursalId === null || f.sucursalId === sucursalId))?.nombre ?? null;

  // ─── Cálculo por día ─────────────────────────────────────────────────────
  const calcular = (d: DiaPlan): DiaCalculado => {
    const base: DiaCalculado = {
      ...d, tipo: null, efectivosMin: 0, ordinariosMin: 0, nocturnosMin: 0, extra: cero(), extraTotalMin: 0, feriado: null, categoria: null,
    };
    if (d.estado !== "TURNO" || d.entrada === null || d.salida === null) return base;
    const turno = d.turnoId ? turnos.get(d.turnoId) : undefined;
    const r = analizarJornada(
      { entrada: d.entrada, salida: d.salida, pausa: d.pausa },
      { ordinariasPactadasH: turno && !d.manual ? turno.ordinariasPactadasH : undefined, exento: emp.get(d.empleadoId)?.exento }
    );
    return {
      ...base,
      tipo: r.tipo,
      efectivosMin: r.efectivos,
      ordinariosMin: r.ordinarios,
      nocturnosMin: r.minutosNocturnos,
      extra: r.extra,
      extraTotalMin: r.extraTotal,
      feriado: feriado(d.fecha, d.sucursalId),
      categoria: categoriaTurno(d.entrada, d.salida),
    };
  };

  const planCalc = e.dias.map(calcular);
  const fechasPlan = new Set(e.dias.map((d) => `${d.empleadoId}|${d.fecha}`));
  const histCalc = e.historial.filter((d) => !fechasPlan.has(`${d.empleadoId}|${d.fecha}`)).map(calcular);

  const porEmpleado = new Map<string, DiaCalculado[]>();
  for (const d of [...histCalc, ...planCalc]) {
    const l = porEmpleado.get(d.empleadoId) ?? [];
    l.push(d);
    porEmpleado.set(d.empleadoId, l);
  }
  for (const l of porEmpleado.values()) l.sort((a, b) => a.fecha.localeCompare(b.fecha));

  // ─── Reglas por día y por secuencia ──────────────────────────────────────
  for (const [empleadoId, lista] of porEmpleado) {
    const p = emp.get(empleadoId);
    if (!p) continue;
    const nombre = nomEmp(empleadoId);
    let consecutivos = 0;
    let ultimo: DiaCalculado | null = null;

    for (let i = 0; i < lista.length; i++) {
      const d = lista[i];
      const reportar = enPlan(d.fecha);
      const add = (a: Omit<Alerta, "empleadoId" | "fecha">) => {
        if (reportar) alertas.push({ ...a, empleadoId, fecha: d.fecha });
      };

      // Huecos de fechas (días sin registro) cortan la racha.
      if (ultimo && diasEntre(ultimo.fecha, d.fecha) > 1) consecutivos = 0;

      if (d.estado !== "TURNO" || d.entrada === null || d.salida === null) {
        consecutivos = 0;
        ultimo = d;
        continue;
      }

      consecutivos++;
      const lapso = d.salida - d.entrada;

      if (consecutivos > MAX_DIAS_CONSECUTIVOS) {
        add({
          nivel: "ERROR", tipo: "LEGAL", codigo: "DIAS_CONSECUTIVOS", articulo: "Art. 338",
          mensaje: `${nombre}: ${consecutivos} días seguidos de trabajo el ${fechaCorta(d.fecha)}. Corresponde 1 día de descanso por cada 6 trabajados.`,
        });
      }

      // Descanso entre jornadas (Art. 327) y traslapes.
      const anterior = [...lista.slice(0, i)].reverse().find((x) => x.estado === "TURNO" && x.salida !== null);
      if (anterior && anterior.salida !== null) {
        const finAnterior = diasEntre(d.fecha, anterior.fecha) * 1440 + anterior.salida;
        const descansoMin = d.entrada - finAnterior;
        if (descansoMin < 0) {
          add({ nivel: "ERROR", tipo: "LEGAL", codigo: "TRASLAPE", mensaje: `${nombre}: el turno del ${fechaCorta(d.fecha)} empieza antes de terminar el del ${fechaCorta(anterior.fecha)}.` });
        } else if (descansoMin < DESCANSO_LEGAL_ENTRE_JORNADAS_H * 60) {
          add({
            nivel: "ERROR", tipo: "LEGAL", codigo: "DESCANSO_ENTRE_JORNADAS", articulo: "Art. 327",
            mensaje: `${nombre}: sólo ${horas(descansoMin)} h de descanso antes del turno del ${fechaCorta(d.fecha)}; el mínimo legal es ${DESCANSO_LEGAL_ENTRE_JORNADAS_H} h.`,
          });
        } else if (descansoMin < e.reglas.descansoEntreJornadasH * 60) {
          add({
            nivel: "AVISO", tipo: "LEGAL", codigo: "DESCANSO_POLITICA",
            mensaje: `${nombre}: ${horas(descansoMin)} h de descanso antes del turno del ${fechaCorta(d.fecha)}; cumple la ley (10 h) pero no la política de la empresa (${e.reglas.descansoEntreJornadasH} h).`,
          });
        }
      }

      // Jornada.
      if (p.exento) {
        if (lapso > EXENTO_MAX_PERMANENCIA_H * 60) {
          add({ nivel: "ERROR", tipo: "LEGAL", codigo: "EXENTO_12H", articulo: "Art. 325", mensaje: `${nombre} (cargo de dirección o confianza): ${horas(lapso)} h de permanencia el ${fechaCorta(d.fecha)}; el máximo es ${EXENTO_MAX_PERMANENCIA_H} h.` });
        }
        if (lapso > 6 * 60 && d.pausa < EXENTO_DESCANSO_MIN) {
          add({ nivel: "AVISO", tipo: "LEGAL", codigo: "EXENTO_DESCANSO", articulo: "Art. 325", mensaje: `${nombre} (cargo de dirección o confianza): ${d.pausa} min de descanso el ${fechaCorta(d.fecha)}; le corresponde al menos 1 h 30 min (fraccionable en períodos de 30 min).` });
        }
      } else {
        if (d.efectivosMin > MAX_ORDINARIA_MAS_EXTRA_H * 60) {
          add({ nivel: "ERROR", tipo: "LEGAL", codigo: "MAS_DE_12H", articulo: "Art. 332", mensaje: `${nombre}: ${horas(d.efectivosMin)} h de trabajo el ${fechaCorta(d.fecha)}; la ordinaria más la extra no puede pasar de 12 h.` });
        }
        if (d.extraTotalMin > 0) {
          const detalle = (Object.keys(d.extra) as ClaseExtra[]).filter((k) => d.extra[k] > 0).map((k) => `${horas(d.extra[k])} h ${ETIQUETA_EXTRA[k]}`).join(", ");
          add({
            nivel: "AVISO", tipo: "LEGAL", codigo: "HORA_EXTRA", articulo: "Art. 330",
            mensaje: `${nombre}: ${horas(d.extraTotalMin)} h extra programadas el ${fechaCorta(d.fecha)} (jornada ${d.tipo?.toLowerCase()}): ${detalle}.`,
          });
        }
      }

      // Menores (Código del Trabajo, Art. 129; Código de la Niñez, Art. 125) y preferencias.
      const topeMenor = maxDiarioMenorH(p.edad);
      if (topeMenor !== null && d.efectivosMin > topeMenor * 60) {
        add({
          nivel: "ERROR", tipo: "LEGAL", codigo: "MENOR_JORNADA", articulo: "Código de la Niñez, Art. 125",
          mensaje: `${nombre} tiene ${p.edad} años y trabaja ${horas(d.efectivosMin)} h el ${fechaCorta(d.fecha)}: su jornada no puede pasar de ${topeMenor} h diarias.`,
        });
      }
      if (p.edad < 16 && d.nocturnosMin > 0) {
        add({ nivel: "ERROR", tipo: "LEGAL", codigo: "MENOR_NOCTURNO", articulo: "Art. 129 y Código de la Niñez, Art. 125", mensaje: `${nombre} es menor de 16 años y tiene trabajo nocturno el ${fechaCorta(d.fecha)}: está prohibido.` });
      } else if (topeMenor !== null && d.nocturnosMin > 0) {
        // Entre las 7:00 y las 8:00 p. m. es válido sólo con autorización de la Secretaría de Trabajo.
        const autorizable = d.entrada >= FIN_NOCHE && d.salida <= ADOLESCENTE_AUTORIZABLE_HASTA;
        add(autorizable
          ? {
            nivel: "AVISO", tipo: "LEGAL", codigo: "ADOLESCENTE_NOCTURNO", articulo: "Código de la Niñez, Art. 125",
            mensaje: `${nombre} tiene ${p.edad} años y sale a las ${horaDeMinutos(d.salida)} el ${fechaCorta(d.fecha)}: sólo es válido si la Secretaría de Trabajo lo autorizó a trabajar hasta las 8:00 p. m. y no afecta su asistencia a clases.`,
          }
          : {
            nivel: "ERROR", tipo: "LEGAL", codigo: "ADOLESCENTE_NOCTURNO", articulo: "Código de la Niñez, Art. 125",
            mensaje: `${nombre} tiene ${p.edad} años y trabaja de noche el ${fechaCorta(d.fecha)}: está prohibido (con autorización, a lo sumo hasta las 8:00 p. m.).`,
          });
      }
      if (p.edad < 16 && d.extraTotalMin > 0) {
        add({ nivel: "ERROR", tipo: "LEGAL", codigo: "MENOR_EXTRA", articulo: "Art. 129", mensaje: `${nombre} es menor de 16 años y tiene horas extra el ${fechaCorta(d.fecha)}: está prohibido.` });
      }
      if (p.edad < 16 && diaIso(d.fecha) === 7) {
        add({ nivel: "ERROR", tipo: "LEGAL", codigo: "MENOR_DOMINGO", articulo: "Art. 338", mensaje: `${nombre} es menor de 16 años: el descanso dominical no admite excepción y trabaja el ${fechaCorta(d.fecha)}.` });
      }
      const pref = p.preferencias;
      const iso = diaIso(d.fecha);
      if (pref.diasNoDisponible.includes(iso)) {
        add({ nivel: "AVISO", tipo: "OPERATIVA", codigo: "PREFERENCIA_DIA", mensaje: `${nombre} no está disponible los ${fechaCorta(d.fecha).split(" ")[0]} y tiene turno el ${fechaCorta(d.fecha)}${pref.motivo ? ` (${pref.motivo})` : ""}.` });
      }
      const rige = pref.diasRestriccion.length === 0 || pref.diasRestriccion.includes(iso);
      if (rige && pref.noAntesDe !== null && d.entrada < pref.noAntesDe) {
        add({ nivel: "AVISO", tipo: "OPERATIVA", codigo: "PREFERENCIA_HORA", mensaje: `${nombre} no puede entrar antes de las ${horaDeMinutos(pref.noAntesDe)} y entra a las ${horaDeMinutos(d.entrada)} el ${fechaCorta(d.fecha)}.` });
      }
      if (rige && pref.noDespuesDe !== null && d.salida > pref.noDespuesDe) {
        add({ nivel: "AVISO", tipo: "OPERATIVA", codigo: "PREFERENCIA_HORA", mensaje: `${nombre} no puede salir después de las ${horaDeMinutos(pref.noDespuesDe)} y sale a las ${horaDeMinutos(d.salida)} el ${fechaCorta(d.fecha)}${pref.motivo ? ` (${pref.motivo})` : ""}.` });
      }
      if (pref.soloDiurna && d.tipo !== "DIURNA") {
        add({ nivel: "AVISO", tipo: "OPERATIVA", codigo: "PREFERENCIA_DIURNA", mensaje: `${nombre} sólo puede hacer jornada diurna y el ${fechaCorta(d.fecha)} tiene jornada ${d.tipo?.toLowerCase()}.` });
      }
      if (d.esTraslado && !pref.permiteTraslado) {
        add({ nivel: "AVISO", tipo: "OPERATIVA", codigo: "TRASLADO_NO_AUTORIZADO", mensaje: `${nombre} no acepta traslados y está en ${nomSuc(d.sucursalId)} el ${fechaCorta(d.fecha)}.` });
      }
      if (d.feriado) {
        add({ nivel: "INFO", tipo: "LEGAL", codigo: "FERIADO", articulo: "Art. 340", mensaje: `${nombre} trabaja el feriado del ${fechaCorta(d.fecha)} (${d.feriado}): se paga con el doble.` });
      }

      // Víspera del descanso SEMANAL (Art. 341): el que no lleva motivo. Un
      // descanso adicional, una ausencia o un día no disponible no lo son.
      const siguiente = lista[i + 1];
      if (
        e.reglas.vispera !== "NO_APLICAR" && siguiente && siguiente.estado === "DESCANSO" && !siguiente.motivo &&
        diasEntre(d.fecha, siguiente.fecha) === 1 && d.salida > VISPERA_HORA_MAX
      ) {
        add({
          nivel: e.reglas.vispera === "EXIGIR" ? "ERROR" : "AVISO", tipo: "LEGAL", codigo: "VISPERA_DESCANSO", articulo: "Art. 341",
          mensaje: `${nombre}: sale a las ${horaDeMinutos(d.salida)} el ${fechaCorta(d.fecha)}, víspera de su descanso; el Código no permite ocuparlo después de la 1:00 p. m.`,
        });
      }

      ultimo = d;
    }
  }

  // ─── Semanas ─────────────────────────────────────────────────────────────
  const resumen: ResumenEmpleado[] = [];
  for (const p of e.empleados) {
    const lista = porEmpleado.get(p.id) ?? [];
    const semanas = new Map<string, DiaCalculado[]>();
    for (const d of lista) {
      const l = semanas.get(lunesDe(d.fecha)) ?? [];
      l.push(d);
      semanas.set(lunesDe(d.fecha), l);
    }
    const resSemanas: ResumenSemana[] = [];
    for (const [inicio, dias] of [...semanas].sort(([a], [b]) => a.localeCompare(b))) {
      if (sumarDias(inicio, 6) < e.desde || inicio > e.hasta) continue;
      const trabajados = dias.filter((d) => d.estado === "TURNO" && d.tipo);
      const ordinariasMin = trabajados.reduce((s, d) => s + d.ordinariosMin, 0);
      const tope = topeSemanalH(trabajados.map((d) => d.tipo!));
      const extraDiariaMin = trabajados.reduce((s, d) => s + d.extraTotalMin, 0);
      const extraSemanalH = p.exento ? 0 : Math.max(0, Math.round((ordinariasMin / 60 - tope) * 100) / 100);
      const diasConExtra = trabajados.filter((d) => d.extraTotalMin > 0).length + (extraSemanalH > 0 && trabajados.every((d) => d.extraTotalMin === 0) ? 1 : 0);
      resSemanas.push({
        inicio, diasTrabajados: trabajados.length, ordinariasH: horas(ordinariasMin), topeH: Math.round(tope * 100) / 100,
        extraDiariaH: horas(extraDiariaMin), extraSemanalH, diasConExtra,
      });
      if (extraSemanalH > 0) {
        alertas.push({
          nivel: "AVISO", tipo: "LEGAL", codigo: "TOPE_SEMANAL", articulo: "Art. 322", empleadoId: p.id, fecha: inicio,
          mensaje: `${p.nombre}: ${horas(ordinariasMin)} h ordinarias en la semana del ${fechaCorta(inicio)}; el tope es ${Math.round(tope * 100) / 100} h: ${extraSemanalH} h se pagan como extra.`,
        });
      }
      if (diasConExtra > MAX_DIAS_CON_EXTRA_SEMANA) {
        alertas.push({
          nivel: "ERROR", tipo: "LEGAL", codigo: "EXTRA_4_VECES", articulo: "Art. 333", empleadoId: p.id, fecha: inicio,
          mensaje: `${p.nombre}: horas extra ${diasConExtra} días en la semana del ${fechaCorta(inicio)}; el máximo son 4.`,
        });
      }
    }

    const delPlan = lista.filter((d) => enPlan(d.fecha));
    const trabajados = delPlan.filter((d) => d.estado === "TURNO");
    // Menores de 18: lo que el plan no puede comprobar por sí mismo.
    if (p.edad < 18 && trabajados.length) {
      alertas.push(p.edad < EDAD_MINIMA_TRABAJO
        ? {
          nivel: "ERROR", tipo: "LEGAL", codigo: "MENOR_DE_14", articulo: "Código de la Niñez, Art. 120", empleadoId: p.id, fecha: trabajados[0].fecha,
          mensaje: `${p.nombre} tiene ${p.edad} años: la ley no permite autorizar el trabajo de menores de 14.`,
        }
        : {
          nivel: "INFO", tipo: "LEGAL", codigo: "MENOR_REQUISITOS", articulo: "Código de la Niñez, Arts. 119, 126 y 127", empleadoId: p.id,
          mensaje: `${p.nombre} tiene ${p.edad} años: necesita autorización previa de la Secretaría de Trabajo, registro de sus horas y descansos y control médico cada 6 meses.` +
            (p.edad < 16 ? " Tampoco puede trabajar en cafés, cantinas ni expendios de bebidas alcohólicas de consumo inmediato (Código del Trabajo, Art. 129)." : ""),
        });
    }
    const extraPorClase = cero();
    for (const d of trabajados) for (const k of Object.keys(extraPorClase) as ClaseExtra[]) extraPorClase[k] += d.extra[k];
    let racha = 0;
    let maxRacha = 0;
    let anterior: string | null = null;
    for (const d of lista) {
      if (anterior && diasEntre(anterior, d.fecha) > 1) racha = 0;
      racha = d.estado === "TURNO" ? racha + 1 : 0;
      if (enPlan(d.fecha)) maxRacha = Math.max(maxRacha, racha);
      anterior = d.fecha;
    }
    const descansos = delPlan.filter((d) => d.estado === "DESCANSO");
    resumen.push({
      empleadoId: p.id,
      semanas: resSemanas,
      diasTrabajados: trabajados.length,
      ordinariasH: horas(trabajados.reduce((s, d) => s + d.ordinariosMin, 0)),
      extraH: horas(trabajados.reduce((s, d) => s + d.extraTotalMin, 0)) + resSemanas.reduce((s, x) => s + x.extraSemanalH, 0),
      extraPorClaseH: {
        DIURNA_25: horas(extraPorClase.DIURNA_25), NOCTURNA_50: horas(extraPorClase.NOCTURNA_50),
        PROLONGACION_NOCTURNA_75: horas(extraPorClase.PROLONGACION_NOCTURNA_75),
      },
      maxConsecutivos: maxRacha,
      descansos: descansos.length,
      descansosFinDeSemana: descansos.filter((d) => esFinDeSemana(d.fecha)).length,
      domingosLibres: descansos.filter((d) => diaIso(d.fecha) === 7).length,
      aperturas: trabajados.filter((d) => d.categoria === "APERTURA").length,
      cierres: trabajados.filter((d) => d.categoria === "CIERRE").length,
      feriadosTrabajados: trabajados.filter((d) => d.feriado).length,
      traslados: trabajados.filter((d) => d.esTraslado).length,
    });
  }

  // Equidad de fines de semana (Art. 338: «preferentemente el domingo»).
  const semanasPlan = Math.floor((diasEntre(e.desde, e.hasta) + 1) / 7);
  if (semanasPlan >= 4) {
    for (const r of resumen) {
      const p = emp.get(r.empleadoId)!;
      if (r.descansosFinDeSemana === 0 && r.descansos > 0) {
        alertas.push({
          nivel: "AVISO", tipo: "OPERATIVA", codigo: "SIN_FIN_DE_SEMANA", empleadoId: p.id,
          mensaje: `${p.nombre} no descansa ningún sábado ni domingo en el período.`,
        });
      }
    }
  }

  // ─── Cobertura ───────────────────────────────────────────────────────────
  const faltantes: Faltante[] = [];
  const todos = [...histCalc, ...planCalc].filter((d) => d.estado === "TURNO" && d.entrada !== null && d.salida !== null && d.sucursalId);
  const indice = new Map<string, DiaCalculado[]>();
  for (const d of todos) {
    const k = `${d.sucursalId}|${d.fecha}`;
    const l = indice.get(k) ?? [];
    l.push(d);
    indice.set(k, l);
  }
  /** Intervalos de presencia en una sucursal referidos a la medianoche de `fecha`, con los turnos de ayer y mañana. */
  const presencia = (sucursalId: string, fecha: string, puestoId: string | null): [number, number][] => {
    const r: [number, number][] = [];
    for (const [desplazamiento, f] of [[-1440, sumarDias(fecha, -1)], [0, fecha], [1440, sumarDias(fecha, 1)]] as const) {
      for (const d of indice.get(`${sucursalId}|${f}`) ?? []) {
        if (puestoId && emp.get(d.empleadoId)?.puestoId !== puestoId) continue;
        r.push([d.entrada! + desplazamiento, d.salida! + desplazamiento]);
      }
    }
    return r;
  };
  const cuenta = (iv: [number, number][], t: number) => iv.filter(([a, b]) => a <= t && b >= t + SLOT).length;
  const cerrada = (sucursalId: string, fecha: string) =>
    e.horarioAtencion.some((h) => h.sucursalId === sucursalId && h.dia === diaIso(fecha) && h.cerrado);

  for (const fecha of rango(e.desde, e.hasta)) {
    const iso = diaIso(fecha);
    const reqs = e.requisitos.filter((r) => r.dias.includes(iso));
    const grupos = new Map<string, Requisito[]>();
    for (const r of reqs) {
      if (cerrada(r.sucursalId, fecha)) continue;
      const k = `${r.sucursalId}|${r.puestoId}`;
      grupos.set(k, [...(grupos.get(k) ?? []), r]);
    }
    for (const [k, lista] of grupos) {
      const [sucursalId, puestoId] = k.split("|");
      const iv = presencia(sucursalId, fecha, puestoId);
      // Mínimo exigido por franja de 15 min (si dos franjas se pisan, manda la mayor).
      const exigido = new Map<number, number>();
      for (const r of lista) for (let t = r.desde; t < r.hasta; t += SLOT) exigido.set(t, Math.max(exigido.get(t) ?? 0, r.minimo));
      let actual: Faltante | null = null;
      for (const t of [...exigido.keys()].sort((a, b) => a - b)) {
        const req = exigido.get(t)!;
        const hay = cuenta(iv, t);
        if (hay < req) {
          if (actual && actual.hasta === t) {
            actual.hasta = t + SLOT;
            actual.requeridos = Math.max(actual.requeridos, req);
            actual.programados = Math.min(actual.programados, hay);
          } else {
            actual = { sucursalId, puestoId, fecha, desde: t, hasta: t + SLOT, requeridos: req, programados: hay };
            faltantes.push(actual);
          }
        } else {
          actual = null;
        }
      }
    }

    // Horario de atención sin nadie.
    for (const h of e.horarioAtencion.filter((x) => x.dia === iso && !x.cerrado && x.apertura !== null && x.cierre !== null)) {
      const fin = h.cierre! <= h.apertura! ? h.cierre! + 1440 : h.cierre!;
      const iv = presencia(h.sucursalId, fecha, null);
      let vacia: number | null = null;
      for (let t = h.apertura!; t <= fin; t += SLOT) {
        const sinNadie = t < fin && cuenta(iv, t) === 0;
        if (sinNadie && vacia === null) vacia = t;
        if (!sinNadie && vacia !== null) {
          alertas.push({
            nivel: "ERROR", tipo: "OPERATIVA", codigo: "SUCURSAL_SIN_PERSONAL", sucursalId: h.sucursalId, fecha,
            mensaje: `${nomSuc(h.sucursalId)} queda sin nadie de ${rangoHoras(vacia, t)} el ${fechaCorta(fecha)}, dentro del horario de atención.`,
          });
          vacia = null;
        }
      }
    }
  }
  for (const f of faltantes) {
    alertas.push({
      nivel: "AVISO", tipo: "OPERATIVA", codigo: "COBERTURA", sucursalId: f.sucursalId, puestoId: f.puestoId, fecha: f.fecha,
      mensaje: `${nomSuc(f.sucursalId)}, ${nomPue(f.puestoId)}: de ${rangoHoras(f.desde, f.hasta)} el ${fechaCorta(f.fecha)} hay ${f.programados} de ${f.requeridos} requeridos.`,
    });
  }

  const orden = { ERROR: 0, AVISO: 1, INFO: 2 } as const;
  alertas.sort((a, b) => orden[a.nivel] - orden[b.nivel] || (a.fecha ?? "").localeCompare(b.fecha ?? ""));
  return { dias: planCalc, resumen, alertas, faltantes };
}
