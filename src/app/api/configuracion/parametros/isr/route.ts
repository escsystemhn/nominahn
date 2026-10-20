/**
 * Reemplaza la tabla del ISR de un año por la que envía el administrador.
 *
 * Los tramos se validan antes de tocar la base (sin huecos, sin solapes, último
 * tramo abierto) y el reemplazo es atómico: nunca queda un año a medio escribir,
 * que el motor leería como una tabla incompleta. La tabla anterior queda en la
 * bitácora.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { parsearBody, zMonto, zPorcentaje } from "@/lib/http/validar";
import { audit, getClientInfo } from "@/lib/audit";
import { validarTramosISR } from "@/lib/payroll/tramos";
import { fraccionAPorcentaje, porcentajeAFraccion } from "@/lib/payroll/conceptos-ley";

const r2 = (n: number) => Math.round(n * 100) / 100;

const schema = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
  tramos: z
    .array(
      z.object({
        desde: zMonto,
        hasta: z.union([z.null(), zMonto]),
        cuotaFija: zMonto,
        /** Porcentaje (15 = 15 %). */
        porcentaje: zPorcentaje,
        excedenteDesde: zMonto,
      })
    )
    .min(1)
    .max(30),
});

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { anio } = parsed.data;

  const tramos = parsed.data.tramos
    .map((t) => ({
      desde: r2(t.desde),
      hasta: t.hasta === null ? null : r2(t.hasta),
      cuotaFija: r2(t.cuotaFija),
      porcentaje: porcentajeAFraccion(t.porcentaje),
      excedenteDesde: r2(t.excedenteDesde),
    }))
    .sort((a, b) => a.desde - b.desde);

  const errores = validarTramosISR(tramos);
  if (errores.length > 0) {
    return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  }

  const anteriores = await prisma.tablasISR.findMany({ where: { anio }, orderBy: { rangoDesde: "asc" } });

  await prisma.$transaction([
    prisma.tablasISR.deleteMany({ where: { anio } }),
    prisma.tablasISR.createMany({
      data: tramos.map((t) => ({
        anio,
        rangoDesde: t.desde,
        rangoHasta: t.hasta,
        cuotaFija: t.cuotaFija,
        porcentaje: t.porcentaje,
        excedenteDesde: t.excedenteDesde,
        activa: true,
      })),
    }),
  ]);

  await audit({
    accion: anteriores.length > 0 ? "UPDATE" : "CREATE",
    tabla: "TablasISR",
    registroId: String(anio),
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: anteriores.length > 0
      ? anteriores.map((f) => ({
          desde: Number(f.rangoDesde),
          hasta: f.rangoHasta === null ? null : Number(f.rangoHasta),
          cuotaFija: Number(f.cuotaFija),
          porcentaje: fraccionAPorcentaje(Number(f.porcentaje)),
          excedenteDesde: Number(f.excedenteDesde),
          activa: f.activa,
        }))
      : undefined,
    valorNuevo: tramos.map((t) => ({ ...t, porcentaje: fraccionAPorcentaje(t.porcentaje) })),
    ...getClientInfo(req),
  });

  return NextResponse.json({ ok: true, tramos: tramos.length });
}
