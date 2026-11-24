/**
 * Lo que falta generar en un período (fase 2 de Planillas por período, 2026-11-24).
 *
 *   GET ?tipo=QUINCENAL&desde=2026-11-16&hasta=2026-11-30[&sucursalId=…&divisionId=…&departamentoId=…]
 *
 * Responde las sucursales sin planilla (con cuántas personas cobran ahí), las que ya la
 * tienen y las que la tienen pero con gente que no entró en ella. Generar no tiene ruta
 * propia: el navegador llama a `POST /api/planillas` una vez por sucursal, para que cada
 * una pase por la misma validación que una planilla hecha a mano.
 */

import { NextRequest, NextResponse } from "next/server";
import { TipoPlanilla } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanceCubreUnidad } from "@/lib/payroll/alcance-planilla";
import { faltantesDelPeriodo } from "@/lib/payroll/faltantes-periodo-bd";
import { nombresDeUnidades } from "@/lib/payroll/lote-planillas";
import { esFechaIso, etiquetaPeriodo, type TipoPlanillaPeriodo } from "@/lib/payroll/periodos-planilla";
import { divisionesHabilitadas } from "@/lib/organizacion/estructura-bd";
import { filtroDetallesOrg, filtroEmpleadosOrg, normalizarAlcance } from "@/lib/organizacion/estructura";

const DIA = 86_400_000;

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("planillas.calcular");
  if (!g.ok) return g.response;

  const sp = new URL(req.url).searchParams;
  const tipo = sp.get("tipo") ?? "";
  const desde = sp.get("desde");
  const hasta = sp.get("hasta");
  if (!(Object.values(TipoPlanilla) as string[]).includes(tipo)) return NextResponse.json({ error: "Tipo de planilla desconocido." }, { status: 400 });
  if (!esFechaIso(desde) || !esFechaIso(hasta) || hasta <= desde) return NextResponse.json({ error: "Revise las fechas del período: la final debe ser posterior a la inicial." }, { status: 400 });
  const d = new Date(`${desde}T00:00:00.000Z`);
  const h = new Date(`${hasta}T00:00:00.000Z`);
  if (h.getTime() - d.getTime() > 31 * DIA) return NextResponse.json({ error: "Un período de planilla no pasa de un mes." }, { status: 400 });

  // El filtro de la lista (grupo, sucursal, departamento): «Falta generar» y esta ventana cuentan lo mismo.
  const alcance = normalizarAlcance({ sucursalId: sp.get("sucursalId"), divisionId: sp.get("divisionId"), departamentoId: sp.get("departamentoId") });
  const conFiltro = !!(alcance.sucursalId || alcance.divisionId || alcance.departamentoId);
  const r = await faltantesDelPeriodo(prisma, { tipo: tipo as TipoPlanilla, desde: d, hasta: h }, g.usuario, {
    conDivisiones: await divisionesHabilitadas(prisma),
    filtroOrg: filtroEmpleadosOrg(alcance),
    filtroPlanillasOrg: conFiltro ? { detalles: { some: filtroDetallesOrg(alcance) } } : undefined,
  });

  const nombresFaltan = nombresDeUnidades(r.faltan);
  const nombresFuera = nombresDeUnidades(r.fuera);
  const unGrupo = new Set(r.planillas.map((p) => p.sucursalId)).size <= 1;
  const nombrePlanilla = (p: (typeof r.planillas)[number]) => {
    if (!p.sucursal) return "Toda la empresa";
    const partes = [p.sucursal, p.division, p.departamento].filter(Boolean) as string[];
    return unGrupo && partes.length > 1 ? partes.slice(1).join(" / ") : partes.join(" / ");
  };

  return NextResponse.json({
    nombre: etiquetaPeriodo({ tipo: tipo as TipoPlanillaPeriodo, desde, hasta }),
    faltan: r.faltan.map((u, i) => ({
      clave: u.clave, empresaId: u.empresaId, sucursalId: u.sucursalId, divisionId: u.divisionId,
      nombre: nombresFaltan[i], empleados: u.empleados,
      puedeGenerar: alcanceCubreUnidad(g.usuario, { sucursalId: u.sucursalId, departamentoId: null }),
    })),
    fuera: r.fuera.map((u, i) => ({ nombre: nombresFuera[i], empleados: u.empleados, planillaId: u.planilla!.id, estado: u.planilla!.estado })),
    generadas: r.planillas
      .map((p) => ({ id: p.id, nombre: nombrePlanilla(p), estado: p.estado }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
  });
}
