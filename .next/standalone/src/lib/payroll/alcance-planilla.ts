/**
 * Alcance sobre planillas. Una planilla reúne a muchas personas, así que el sí/no de
 * `alcanzaEmpleado` no basta: quien alcanza a algunas puede CONSULTAR a esas, pero
 * aprobar, pagar, anular o sacar el archivo del banco actúan sobre todas a la vez, y
 * sólo los puede hacer quien las alcanza a todas.
 *
 * Tampoco ve los totales de la planilla: el total de toda la empresa es justo lo que el
 * alcance intenta no revelar. Ve la suma de las personas que alcanza.
 */

import { NextResponse } from "next/server";
import type { Prisma, PrismaClient } from "@prisma/client";
import { alcanceEsTotal, filtroPorEmpleado, type UsuarioConAlcance } from "@/lib/auth/alcance";
import { CERO, type Money } from "./money";

export type AccesoPlanilla = "ninguno" | "parcial" | "total";

/** Las planillas que esta cuenta puede ver: las que pagan a alguien de su alcance. */
export function filtroPlanillas(usuario: UsuarioConAlcance): Prisma.PlanillaWhereInput {
  return alcanceEsTotal(usuario) ? {} : { detalles: { some: filtroPorEmpleado(usuario) } };
}

/** Las planillas sobre las que puede actuar: todas sus personas están en su alcance. */
export function filtroPlanillasCompletas(usuario: UsuarioConAlcance): Prisma.PlanillaWhereInput {
  if (alcanceEsTotal(usuario)) return {};
  const filtro = filtroPorEmpleado(usuario);
  return { AND: [{ detalles: { some: filtro } }, { detalles: { none: { NOT: filtro } } }] };
}

/**
 * Qué puede hacer esta cuenta con esta planilla. Con alcance total no consulta: quien
 * llama sigue respondiendo por sí mismo si la planilla no existe.
 */
export async function accesoAPlanilla(
  db: Pick<PrismaClient, "planillaDetalle">,
  usuario: UsuarioConAlcance,
  planillaId: string
): Promise<AccesoPlanilla> {
  if (alcanceEsTotal(usuario)) return "total";
  const filtro = filtroPorEmpleado(usuario);
  const [dentro, fuera] = await Promise.all([
    db.planillaDetalle.count({ where: { planillaId, ...filtro } }),
    db.planillaDetalle.count({ where: { planillaId, NOT: filtro } }),
  ]);
  if (dentro === 0) return "ninguno";
  return fuera === 0 ? "total" : "parcial";
}

/**
 * La respuesta para una acción sobre la planilla entera, o `null` si puede hacerla.
 * Sin nadie de su alcance responde que no existe, para no revelar que existe.
 */
export function rechazoDeAcceso(acceso: AccesoPlanilla): NextResponse | null {
  if (acceso === "total") return null;
  if (acceso === "ninguno") return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ error: "Esta planilla incluye personal fuera del alcance de su cuenta: sólo puede consultarla." }, { status: 403 });
}

/** ¿Puede generar una planilla de esta unidad? Quien no alcanza a toda la empresa, sólo de lo suyo. */
export function alcanceCubreUnidad(usuario: UsuarioConAlcance, unidad: { sucursalId: string | null; departamentoId: string | null }): boolean {
  switch (usuario.alcance ?? "TODO") {
    case "TODO":
      return true;
    case "SUCURSAL":
      return !!unidad.sucursalId && (usuario.sucursalesIds ?? []).includes(unidad.sucursalId);
    case "DEPARTAMENTO":
      return !!unidad.departamentoId && unidad.departamentoId === usuario.departamentoId;
    default:
      return false;
  }
}

export interface TotalesPlanilla {
  totalBruto: Money;
  totalDeducciones: Money;
  totalNeto: Money;
}

/**
 * Los totales que esta cuenta puede ver de cada planilla: la suma de las personas que
 * alcanza. `null` con alcance total, porque ahí valen los de la propia planilla.
 */
export async function totalesVisibles(
  db: Pick<PrismaClient, "planillaDetalle">,
  usuario: UsuarioConAlcance,
  planillaIds: string[]
): Promise<Map<string, TotalesPlanilla> | null> {
  if (alcanceEsTotal(usuario)) return null;
  const filas = await db.planillaDetalle.groupBy({
    by: ["planillaId"],
    where: { planillaId: { in: planillaIds }, ...filtroPorEmpleado(usuario) },
    _sum: { totalBruto: true, totalDeducciones: true, salarioNeto: true },
  });
  return new Map(
    filas.map((f) => [
      f.planillaId,
      { totalBruto: f._sum.totalBruto ?? CERO, totalDeducciones: f._sum.totalDeducciones ?? CERO, totalNeto: f._sum.salarioNeto ?? CERO },
    ])
  );
}
