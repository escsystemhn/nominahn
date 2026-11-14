/**
 * Alcance sobre planes de horarios. Un plan reúne a la gente de varias sucursales, así
 * que el sí/no de `alcanzaEmpleado` no basta. Es el mismo reparto de las planillas
 * (lib/payroll/alcance-planilla.ts): quien alcanza a parte de un plan consulta esa parte
 * y edita los días de esa gente; publicar, archivar o borrar actúan sobre todos a la vez
 * y sólo los hace quien los alcanza a todos.
 *
 * La validación se calcula SIEMPRE con el plan entero, porque la ley y la cobertura miran
 * a todos: lo que se recorta es lo que sale en la respuesta. Por eso `recortarPlan` se
 * aplica al final, después de guardar el resumen, que también es del plan entero.
 */

import { NextResponse } from "next/server";
import type { Prisma, PrismaClient } from "@prisma/client";
import { alcanceEsTotal, filtroPorEmpleado, filtroSucursales, type UsuarioConAlcance } from "@/lib/auth/alcance";
import type { planConValidacion } from "./bd";
import type { Alerta, ResultadoValidacion } from "./tipos";

type Db = Pick<PrismaClient, "planHorario" | "horarioDia" | "sucursal">;

export type PlanValidado = NonNullable<Awaited<ReturnType<typeof planConValidacion>>>;

export type VistaPlan =
  | { acceso: "ninguno" }
  | { acceso: "total" }
  | { acceso: "parcial"; empleados: Set<string>; sucursales: Set<string> };

/**
 * Notas del generador que puede leer quien alcanza sólo a parte del plan: hablan del
 * catálogo de turnos. Las demás nombran personas (hasta menores de edad) o cuentan sobre
 * el plan entero. Una nota nueva queda oculta hasta añadirla aquí: el error es recuperable.
 */
const NOTAS_SIN_PERSONAS = new Set(["GEN_TURNO_DESCARTADO", "GEN_SIN_TURNOS", "GEN_MEDIA_JORNADA_TEMPRANA"]);

const idsDeSucursales = async (db: Db, usuario: UsuarioConAlcance): Promise<string[]> =>
  (await db.sucursal.findMany({ where: filtroSucursales(usuario), select: { id: true } })).map((s) => s.id);

/** Los planes que esta cuenta puede ver: los de sus sucursales y los que programan a alguien de su alcance. */
export async function filtroPlanes(db: Db, usuario: UsuarioConAlcance): Promise<Prisma.PlanHorarioWhereInput> {
  if (alcanceEsTotal(usuario)) return {};
  return { OR: [{ sucursalesIds: { hasSome: await idsDeSucursales(db, usuario) } }, { dias: { some: filtroPorEmpleado(usuario) } }] };
}

/**
 * Sucursales para las que puede generar un plan. Generarlo programa a TODA la gente de la
 * sucursal, así que sólo vale quien la alcanza entera: alcance TODO o SUCURSAL.
 */
export function filtroSucursalesPlanificables(usuario: UsuarioConAlcance): Prisma.SucursalWhereInput {
  return alcanceEsTotal(usuario) || usuario.alcance === "SUCURSAL" ? filtroSucursales(usuario) : { id: { in: [] } };
}

/** De estos planes, cuáles alcanza enteros: todas sus sucursales y toda la gente programada. */
export async function planesCompletos(
  db: Pick<Db, "horarioDia">,
  usuario: UsuarioConAlcance,
  planes: { id: string; sucursalesIds: string[] }[]
): Promise<Set<string>> {
  if (alcanceEsTotal(usuario)) return new Set(planes.map((p) => p.id));
  if (usuario.alcance !== "SUCURSAL") return new Set();
  const suyas = new Set(usuario.sucursalesIds ?? []);
  const candidatos = planes.filter((p) => p.sucursalesIds.every((s) => suyas.has(s)));
  if (candidatos.length === 0) return new Set();
  const conAjenos = await db.horarioDia.findMany({
    where: { planId: { in: candidatos.map((p) => p.id) }, NOT: filtroPorEmpleado(usuario) },
    select: { planId: true },
    distinct: ["planId"],
  });
  const ajenos = new Set(conAjenos.map((d) => d.planId));
  return new Set(candidatos.filter((p) => !ajenos.has(p.id)).map((p) => p.id));
}

/**
 * Qué puede ver esta cuenta de este plan. Con alcance total no consulta: quien llama sigue
 * respondiendo por sí mismo si el plan no existe. Un id inexistente y un plan sin nada
 * suyo dan lo mismo, "ninguno", para que no se puedan distinguir.
 */
export async function vistaDePlan(db: Db, usuario: UsuarioConAlcance, planId: string): Promise<VistaPlan> {
  if (alcanceEsTotal(usuario)) return { acceso: "total" };
  const plan = await db.planHorario.findUnique({ where: { id: planId }, select: { id: true, sucursalesIds: true } });
  if (!plan) return { acceso: "ninguno" };
  const [suyas, filas, completos] = await Promise.all([
    idsDeSucursales(db, usuario),
    db.horarioDia.findMany({ where: { AND: [{ planId }, filtroPorEmpleado(usuario)] }, select: { empleadoId: true }, distinct: ["empleadoId"] }),
    planesCompletos(db, usuario, [plan]),
  ]);
  if (completos.has(plan.id)) return { acceso: "total" };
  const empleados = new Set(filas.map((f) => f.empleadoId));
  const sucursales = new Set(suyas);
  if (empleados.size === 0 && !plan.sucursalesIds.some((s) => sucursales.has(s))) return { acceso: "ninguno" };
  return { acceso: "parcial", empleados, sucursales };
}

/** La respuesta para una acción sobre el plan entero, o `null` si puede hacerla. */
export function rechazoDeAccion(vista: VistaPlan): NextResponse | null {
  if (vista.acceso === "total") return null;
  if (vista.acceso === "ninguno") return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  return NextResponse.json({ error: "Este plan incluye personal fuera del alcance de su cuenta: sólo puede consultarlo." }, { status: 403 });
}

function recortarValidacion(v: ResultadoValidacion, empleados: Set<string>, sucursales: Set<string>): ResultadoValidacion {
  // Toda alerta trae persona o sucursal; la que no traiga ninguna no se sabe de quién es.
  const alertaVisible = (a: Alerta) => (a.empleadoId ? empleados.has(a.empleadoId) : !!a.sucursalId && sucursales.has(a.sucursalId));
  return {
    dias: v.dias.filter((d) => empleados.has(d.empleadoId)),
    resumen: v.resumen.filter((r) => empleados.has(r.empleadoId)),
    alertas: v.alertas.filter(alertaVisible),
    faltantes: v.faltantes.filter((f) => sucursales.has(f.sucursalId)),
  };
}

/**
 * El plan con sólo lo que esta vista puede ver. Recorta también lo que hoy no se serializa
 * (ausencias, historial, filas crudas), para que usarlo mañana no abra un hueco.
 */
export function recortarPlan(r: PlanValidado, vista: VistaPlan): PlanValidado {
  if (vista.acceso === "total") return r;
  // "ninguno" no debería llegar aquí; si llega, se queda en cero filas, no en todas.
  const empleados = vista.acceso === "parcial" ? vista.empleados : new Set<string>();
  const sucursales = vista.acceso === "parcial" ? vista.sucursales : new Set<string>();
  const deSuGente = <T extends { empleadoId: string }>(filas: T[]) => filas.filter((f) => empleados.has(f.empleadoId));
  const deSusSucursales = <T extends { sucursalId: string }>(filas: T[]) => filas.filter((f) => sucursales.has(f.sucursalId));

  const personas = r.ctx.empleados.filter((e) => empleados.has(e.id));
  const validacion = recortarValidacion(r.validacion, empleados, sucursales);
  const puestos = new Set([...personas.map((e) => e.puestoId), ...validacion.faltantes.map((f) => f.puestoId)]);

  return {
    ...r,
    plan: { ...r.plan, sucursalesIds: r.plan.sucursalesIds.filter((s) => sucursales.has(s)), dias: deSuGente(r.plan.dias), resumen: null },
    ctx: {
      ...r.ctx,
      empleados: personas,
      sucursales: r.ctx.sucursales.filter((s) => sucursales.has(s.id)),
      requisitos: deSusSucursales(r.ctx.requisitos),
      horarioAtencion: deSusSucursales(r.ctx.horarioAtencion),
      feriados: r.ctx.feriados.filter((f) => f.sucursalId === null || sucursales.has(f.sucursalId)),
      ausencias: deSuGente(r.ctx.ausencias),
      historial: deSuGente(r.ctx.historial),
      nombres: {
        sucursales: Object.fromEntries(Object.entries(r.ctx.nombres.sucursales).filter(([id]) => sucursales.has(id))),
        puestos: Object.fromEntries(Object.entries(r.ctx.nombres.puestos).filter(([id]) => puestos.has(id))),
      },
    },
    dias: deSuGente(r.dias),
    validacion,
    notas: r.notas.filter((n) => NOTAS_SIN_PERSONAS.has(n.codigo)),
  };
}
