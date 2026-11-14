/**
 * Horarios rotativos: lado de la base de datos. Convierte filas de Prisma en
 * las estructuras puras del planificador (`tipos.ts`) y guarda los planes.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { generarPlan, type Ausencia } from "./generar";
import { validarPlan } from "./validar";
import { normalizarReglas } from "./reglas";
import { minutosDeHora, jornadaDeHoras } from "./ley";
import { rango, sumarDias, edadEn } from "./fechas";
import { unificarPuestosPorNombre } from "@/lib/organizacion/puestos";
import { destinoEn, type TrasladoPlan } from "./traslados";
import {
  PREFERENCIAS_VACIAS,
  type Alerta,
  type DiaPlan,
  type EmpleadoPlan,
  type FeriadoPlan,
  type HorarioAtencionDia,
  type Preferencias,
  type ReglasHorario,
  type Requisito,
  type ResultadoValidacion,
  type TurnoCatalogo,
} from "./tipos";

type Db = PrismaClient | Prisma.TransactionClient;

export const CLAVE_REGLAS = "HORARIOS_REGLAS";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const aFecha = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dias = (s: string | null | undefined) =>
  [...new Set((s ?? "").split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x >= 1 && x <= 7))];

export async function leerReglas(db: Db): Promise<ReglasHorario> {
  const fila = await db.configuracionSistema.findUnique({ where: { clave: CLAVE_REGLAS } });
  try {
    return normalizarReglas(fila ? JSON.parse(fila.valor) : null);
  } catch {
    return normalizarReglas(null);
  }
}

export async function guardarReglas(db: Db, reglas: ReglasHorario): Promise<void> {
  const valor = JSON.stringify(normalizarReglas(reglas));
  await db.configuracionSistema.upsert({
    where: { clave: CLAVE_REGLAS },
    update: { valor },
    create: { clave: CLAVE_REGLAS, valor, descripcion: "Reglas del planificador de horarios rotativos (descanso entre jornadas, víspera del descanso, rotación, horas extra, cargos de confianza)" },
  });
}

export function aPreferencias(f: {
  permiteTraslado: boolean; sucursalesTraslado: string[]; noAntesDe: string | null; noDespuesDe: string | null;
  diasRestriccion: string; soloDiurna: boolean; diasNoDisponible: string; diaDescansoPreferido: number | null; motivo: string | null;
} | null | undefined): Preferencias {
  if (!f) return PREFERENCIAS_VACIAS;
  return {
    permiteTraslado: f.permiteTraslado,
    sucursalesTraslado: f.sucursalesTraslado,
    noAntesDe: minutosDeHora(f.noAntesDe),
    noDespuesDe: minutosDeHora(f.noDespuesDe),
    diasRestriccion: dias(f.diasRestriccion),
    soloDiurna: f.soloDiurna,
    diasNoDisponible: dias(f.diasNoDisponible),
    diaDescansoPreferido: f.diaDescansoPreferido,
    motivo: f.motivo,
  };
}

type FilaDia = {
  empleadoId: string; fecha: Date; estado: DiaPlan["estado"]; sucursalId: string | null; turnoId: string | null;
  entrada: number | null; salida: number | null; pausa: number; esTraslado: boolean; manual: boolean; motivo: string | null;
};

export const diaDeFila = (f: FilaDia): DiaPlan => ({
  empleadoId: f.empleadoId, fecha: ymd(f.fecha), estado: f.estado, sucursalId: f.sucursalId, turnoId: f.turnoId,
  entrada: f.entrada, salida: f.salida, pausa: f.pausa, esTraslado: f.esTraslado, manual: f.manual, motivo: f.motivo,
});

const filaDeDia = (planId: string, d: DiaPlan): Prisma.HorarioDiaCreateManyInput => ({
  planId, empleadoId: d.empleadoId, fecha: aFecha(d.fecha), estado: d.estado, sucursalId: d.sucursalId, turnoId: d.turnoId,
  entrada: d.entrada, salida: d.salida, pausa: d.pausa, esTraslado: d.esTraslado, manual: d.manual ?? false, motivo: d.motivo ?? null,
});

/** Turnos activos del catálogo como los ve el planificador (la pausa es el almuerzo si el lapso lo alcanza). */
export async function turnosCatalogo(db: Db): Promise<(TurnoCatalogo & { tipoDeclarado: string })[]> {
  const filas = await db.turno.findMany({ where: { activo: true }, orderBy: [{ horaEntrada: "asc" }, { codigo: "asc" }] });
  const r: (TurnoCatalogo & { tipoDeclarado: string })[] = [];
  for (const t of filas) {
    const j = jornadaDeHoras(t.horaEntrada, t.horaSalida, 0);
    if (!j) continue;
    const pausa = j.salida - j.entrada >= Number(t.almuerzoDesdeHoras) * 60 ? t.almuerzoMinutos : 0;
    r.push({
      id: t.id, codigo: t.codigo, nombre: t.nombre, entrada: j.entrada, salida: j.salida, pausa,
      ordinariasPactadasH: Number(t.jornadaHoras), tipoDeclarado: t.tipoJornada,
    });
  }
  return r;
}

const TIPO_PERMISO: Record<string, string> = {
  VACACIONES: "Vacaciones", ENFERMEDAD: "Permiso por enfermedad", PERSONAL: "Permiso personal",
  MATERNIDAD: "Licencia de maternidad", PATERNIDAD: "Licencia de paternidad", DUELO: "Permiso por duelo",
  SIN_GOCE: "Permiso sin goce de sueldo", OTRO: "Permiso",
};

/** Un traslado temporal con los nombres que muestra la pantalla. */
export type TrasladoConNombres = TrasladoPlan & { empleadoNombre: string; origenNombre: string; destinoNombre: string };

/** De dónde viene quien está en el plan por un traslado temporal. */
export interface TrasladoDe {
  sucursalNombre: string;
  desde: string;
  hasta: string;
}

/** Traslados (no anulados) que tocan el período en esas sucursales, de ida o de vuelta. */
export async function trasladosDelPeriodo(
  db: Db,
  o: { desde: string; hasta: string; sucursalesIds?: string[]; empleadoIds?: string[] }
): Promise<TrasladoConNombres[]> {
  const donde: Prisma.TrasladoTemporalWhereInput[] = [];
  if (o.sucursalesIds) donde.push({ sucursalDestinoId: { in: o.sucursalesIds } }, { empleado: { sucursalId: { in: o.sucursalesIds } } });
  if (o.empleadoIds) donde.push({ empleadoId: { in: o.empleadoIds } });
  const filas = await db.trasladoTemporal.findMany({
    where: { anulado: false, desde: { lte: aFecha(o.hasta) }, hasta: { gte: aFecha(o.desde) }, ...(donde.length ? { OR: donde } : {}) },
    select: {
      id: true, empleadoId: true, sucursalOrigenId: true, sucursalDestinoId: true, desde: true, hasta: true, motivo: true,
      sucursalDestino: { select: { nombre: true } },
      empleado: { select: { primerNombre: true, primerApellido: true, sucursal: { select: { id: true, nombre: true } } } },
    },
    orderBy: [{ desde: "asc" }],
  });
  return filas.map((t) => ({
    id: t.id,
    empleadoId: t.empleadoId,
    // La sucursal de HOY: si lo cambiaron de sucursal después, el traslado se lee desde la nueva.
    sucursalOrigenId: t.empleado.sucursal.id,
    sucursalDestinoId: t.sucursalDestinoId,
    desde: ymd(t.desde),
    hasta: ymd(t.hasta),
    motivo: t.motivo,
    empleadoNombre: `${t.empleado.primerNombre} ${t.empleado.primerApellido}`,
    origenNombre: t.empleado.sucursal.nombre,
    destinoNombre: t.sucursalDestino.nombre,
  }));
}

export interface Contexto {
  desde: string;
  hasta: string;
  empleados: (EmpleadoPlan & { puestoNombre: string; trasladoDe?: TrasladoDe })[];
  /** Traslados temporales que entran a o salen de las sucursales del plan. */
  traslados: TrasladoConNombres[];
  turnos: (TurnoCatalogo & { tipoDeclarado: string })[];
  requisitos: Requisito[];
  horarioAtencion: HorarioAtencionDia[];
  feriados: FeriadoPlan[];
  ausencias: Ausencia[];
  historial: DiaPlan[];
  reglas: ReglasHorario;
  sucursales: { id: string; nombre: string }[];
  nombres: { sucursales: Record<string, string>; puestos: Record<string, string> };
}

/** Todo lo que necesitan el generador y el validador para un período y unas sucursales. */
export async function cargarContexto(
  db: Db,
  o: { desde: string; hasta: string; sucursalesIds: string[]; reglas?: ReglasHorario; excluirPlanId?: string }
): Promise<Contexto> {
  const reglas = o.reglas ?? (await leerReglas(db));
  const desde = aFecha(o.desde);
  const hasta = aFecha(o.hasta);

  // Traslados temporales: quien viene de otra sucursal entra al plan como personal de la
  // de destino (ausente fuera de esas fechas); quien se va, queda ausente esos días.
  const traslados = await trasladosDelPeriodo(db, { desde: o.desde, hasta: o.hasta, sucursalesIds: o.sucursalesIds });
  const enPlanSuc = new Set(o.sucursalesIds);
  const vienen = traslados.filter((t) => enPlanSuc.has(t.sucursalDestinoId) && !enPlanSuc.has(t.sucursalOrigenId));

  const [sucursales, filasEmp, turnos, coberturas, horarios, feriados] = await Promise.all([
    db.sucursal.findMany({ where: { id: { in: o.sucursalesIds } }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    db.empleado.findMany({
      where: {
        OR: [{ sucursalId: { in: o.sucursalesIds } }, { id: { in: [...new Set(vienen.map((t) => t.empleadoId))] } }],
        estado: { notIn: ["INACTIVO", "SUSPENDIDO"] },
        puestoId: { not: null },
        fechaIngreso: { lte: hasta },
      },
      select: {
        id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
        fechaNacimiento: true, fechaIngreso: true, puestoId: true, sucursalId: true, puesto: { select: { nombre: true } },
        preferenciaHorario: true,
      },
      orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
    }),
    turnosCatalogo(db),
    db.coberturaSucursal.findMany({ where: { sucursalId: { in: o.sucursalesIds }, activo: true }, include: { puesto: { select: { nombre: true } } } }),
    db.horarioAtencion.findMany({ where: { sucursalId: { in: o.sucursalesIds } } }),
    db.feriado.findMany({ where: { activo: true, fecha: { gte: desde, lte: hasta }, OR: [{ sucursalId: null }, { sucursalId: { in: o.sucursalesIds } }] } }),
  ]);
  // Por persona y no por sucursal: así entran también los permisos de quien viene trasladado.
  const idsEmp = filasEmp.map((e) => e.id);
  const [permisos, incapacidades] = await Promise.all([
    db.permiso.findMany({ where: { estado: "APROBADO", fechaInicio: { lte: hasta }, fechaFin: { gte: desde }, empleadoId: { in: idsEmp } } }),
    db.incapacidad.findMany({ where: { anulada: false, fechaInicio: { lte: hasta }, fechaFin: { gte: desde }, empleadoId: { in: idsEmp } } }),
  ]);

  // Lo que usan el generador y el validador es el puesto común a todos los de su
  // nombre; los días guardados no llevan puesto, así que esto no deja rastro en un
  // plan. Puestos exentos sigue mirando el puesto propio de la persona.
  const unificados = unificarPuestosPorNombre([
    ...filasEmp.map((e) => ({ id: e.puestoId!, nombre: e.puesto?.nombre ?? "" })),
    ...coberturas.map((c) => ({ id: c.puestoId, nombre: c.puesto.nombre })),
  ]);
  const puestoComun = (id: string) => unificados.get(id) ?? id;

  const empleados = filasEmp.map((e) => {
    // Quien viene de otra sucursal cuenta, en este plan, como personal de la de destino.
    const viene = enPlanSuc.has(e.sucursalId) ? undefined : vienen.find((t) => t.empleadoId === e.id);
    return {
      id: e.id,
      codigo: e.codigo,
      nombre: [e.primerNombre, e.segundoNombre, e.primerApellido, e.segundoApellido].filter(Boolean).join(" "),
      puestoId: puestoComun(e.puestoId!),
      puestoNombre: e.puesto?.nombre ?? "",
      sucursalId: viene ? viene.sucursalDestinoId : e.sucursalId,
      edad: edadEn(ymd(e.fechaNacimiento), o.desde),
      exento: reglas.puestosExentos.includes(e.puestoId!),
      preferencias: aPreferencias(e.preferenciaHorario),
      ...(viene ? { trasladoDe: { sucursalNombre: viene.origenNombre, desde: viene.desde, hasta: viene.hasta } } : {}),
    };
  });

  const ausencias: Ausencia[] = [];
  const dentro = (f: string) => f >= o.desde && f <= o.hasta;
  for (const p of permisos) {
    for (const f of rango(ymd(p.fechaInicio), ymd(p.fechaFin))) if (dentro(f)) ausencias.push({ empleadoId: p.empleadoId, fecha: f, motivo: TIPO_PERMISO[p.tipo] ?? "Permiso" });
  }
  for (const i of incapacidades) {
    for (const f of rango(ymd(i.fechaInicio), ymd(i.fechaFin))) if (dentro(f)) ausencias.push({ empleadoId: i.empleadoId, fecha: f, motivo: "Incapacidad" });
  }
  for (const e of filasEmp) {
    const ingreso = ymd(e.fechaIngreso);
    if (ingreso > o.desde) for (const f of rango(o.desde, sumarDias(ingreso, -1))) ausencias.push({ empleadoId: e.id, fecha: f, motivo: "Aún no ingresa" });
    for (const f of rango(o.desde, o.hasta)) {
      const destino = destinoEn(traslados, e.id, f);
      if (enPlanSuc.has(e.sucursalId)) {
        // Prestado a una sucursal que no está en este plan: ese día no se cuenta con él.
        if (destino && !enPlanSuc.has(destino)) {
          ausencias.push({ empleadoId: e.id, fecha: f, motivo: `Trasladado a ${traslados.find((t) => t.sucursalDestinoId === destino)?.destinoNombre ?? "otra sucursal"}` });
        }
      } else if (!destino || !enPlanSuc.has(destino)) {
        // Viene trasladado: fuera de sus fechas no está en estas sucursales.
        ausencias.push({ empleadoId: e.id, fecha: f, motivo: "Fuera de su traslado" });
      }
    }
  }

  // Últimos 7 días ya publicados: continuidad de rachas, descansos y horas de la semana.
  const filasHist = await db.horarioDia.findMany({
    where: {
      empleadoId: { in: empleados.map((e) => e.id) },
      fecha: { gte: aFecha(sumarDias(o.desde, -7)), lt: desde },
      plan: { estado: "PUBLICADO", ...(o.excluirPlanId ? { id: { not: o.excluirPlanId } } : {}) },
    },
  });

  const requisitos: Requisito[] = [];
  for (const c of coberturas) {
    const j = jornadaDeHoras(c.desde, c.hasta, 0);
    if (j) requisitos.push({ sucursalId: c.sucursalId, puestoId: puestoComun(c.puestoId), dias: dias(c.dias), desde: j.entrada, hasta: j.salida, minimo: c.minimo, etiqueta: c.etiqueta });
  }
  const nombresPuestos: Record<string, string> = {};
  for (const e of filasEmp) nombresPuestos[e.puestoId!] = e.puesto?.nombre ?? "";
  for (const c of coberturas) nombresPuestos[c.puestoId] = c.puesto.nombre;

  return {
    desde: o.desde,
    hasta: o.hasta,
    empleados,
    turnos,
    requisitos,
    horarioAtencion: horarios.map((h) => ({ sucursalId: h.sucursalId, dia: h.dia, apertura: minutosDeHora(h.apertura), cierre: minutosDeHora(h.cierre), cerrado: h.cerrado })),
    feriados: feriados.map((f) => ({ fecha: ymd(f.fecha), sucursalId: f.sucursalId, nombre: f.nombre })),
    ausencias,
    historial: filasHist.map(diaDeFila),
    reglas,
    sucursales,
    nombres: { sucursales: Object.fromEntries(sucursales.map((s) => [s.id, s.nombre])), puestos: nombresPuestos },
    traslados,
  };
}

export interface ResumenGuardado {
  errores: number;
  avisos: number;
  faltantes: number;
  notas: Alerta[];
}

const contar = (v: ResultadoValidacion, notas: Alerta[]): ResumenGuardado => ({
  errores: v.alertas.filter((a) => a.nivel === "ERROR").length,
  avisos: v.alertas.filter((a) => a.nivel === "AVISO").length,
  faltantes: v.faltantes.length,
  notas,
});

/** Genera un plan nuevo y lo guarda como BORRADOR. */
export async function crearPlan(
  db: PrismaClient,
  o: { nombre: string; desde: string; hasta: string; sucursalesIds: string[]; creadoPor: string | null }
): Promise<{ id: string; resumen: ResumenGuardado }> {
  const ctx = await cargarContexto(db, o);
  const r = generarPlan({ ...ctx, empleados: ctx.empleados });
  const resumen = contar(r, r.notas);
  const plan = await db.$transaction(async (tx) => {
    const p = await tx.planHorario.create({
      data: {
        nombre: o.nombre, desde: aFecha(o.desde), hasta: aFecha(o.hasta), sucursalesIds: o.sucursalesIds,
        reglas: ctx.reglas as unknown as Prisma.InputJsonValue, resumen: resumen as unknown as Prisma.InputJsonValue, creadoPor: o.creadoPor,
      },
    });
    if (r.plan.length) await tx.horarioDia.createMany({ data: r.plan.map((d) => filaDeDia(p.id, d)) });
    return p;
  });
  return { id: plan.id, resumen };
}

/** Un plan guardado con su validación al día (con las reglas con que se generó). */
export async function planConValidacion(db: Db, planId: string) {
  const plan = await db.planHorario.findUnique({ where: { id: planId }, include: { dias: true } });
  if (!plan) return null;
  const reglas = normalizarReglas(plan.reglas);
  const ctx = await cargarContexto(db, { desde: ymd(plan.desde), hasta: ymd(plan.hasta), sucursalesIds: plan.sucursalesIds, reglas, excluirPlanId: plan.id });
  const dias = plan.dias.map(diaDeFila);
  // Sólo las personas que están en el plan (alguien pudo darse de baja después), y quien
  // viene trasladado aunque todavía no tenga días: así aparece para asignarle turnos.
  const enPlan = new Set(dias.map((d) => d.empleadoId));
  const empleados = ctx.empleados.filter((e) => enPlan.has(e.id) || e.trasladoDe);
  const validacion = validarPlan({ ...ctx, empleados, dias });
  const resumenGuardado = (plan.resumen ?? {}) as Partial<ResumenGuardado>;
  return { plan, ctx: { ...ctx, empleados }, dias, validacion, notas: resumenGuardado.notas ?? [] };
}

export async function actualizarResumen(db: Db, planId: string, v: ResultadoValidacion, notas: Alerta[]): Promise<ResumenGuardado> {
  const resumen = contar(v, notas);
  await db.planHorario.update({ where: { id: planId }, data: { resumen: resumen as unknown as Prisma.InputJsonValue } });
  return resumen;
}

export { aFecha, ymd };
