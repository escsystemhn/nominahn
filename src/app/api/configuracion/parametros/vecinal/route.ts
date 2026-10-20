/**
 * Reemplaza la tabla del impuesto personal o vecinal de un municipio y año, y
 * fija ese municipio como el que rige para la empresa.
 *
 * Cada municipalidad aprueba su tabla en el Plan de Arbitrios anual (Art. 77 Ley
 * de Municipalidades). Igual que con el ISR: validación previa, reemplazo
 * atómico y la tabla anterior en la bitácora.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { parsearBody, zMonto } from "@/lib/http/validar";
import { audit, getClientInfo } from "@/lib/audit";
import { validarTramosVecinal } from "@/lib/payroll/tramos";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

const schema = z.object({
  /** Clave del municipio, p. ej. SAN_PEDRO_SULA. Se normaliza a mayúsculas. */
  municipio: z
    .string()
    .trim()
    .transform((s) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    )
    .pipe(z.string().min(2, "requerido").max(60)),
  anio: z.coerce.number().int().min(2000).max(2100),
  tramos: z
    .array(
      z.object({
        desde: zMonto,
        hasta: z.union([z.null(), zMonto]),
        porMillar: zMonto,
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
  const { municipio, anio } = parsed.data;

  const tramos = parsed.data.tramos
    .map((t) => ({ desde: r2(t.desde), hasta: t.hasta === null ? null : r2(t.hasta), porMillar: r4(t.porMillar) }))
    .sort((a, b) => a.desde - b.desde);

  const errores = validarTramosVecinal(tramos);
  if (errores.length > 0) {
    return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  }

  const [anteriores, municipioAnterior] = await Promise.all([
    prisma.tablaImpuestoVecinal.findMany({ where: { municipio, anio }, orderBy: { rangoDesde: "asc" } }),
    prisma.configuracionSistema.findUnique({ where: { clave: "MUNICIPIO_IMPUESTO_VECINAL" } }),
  ]);

  await prisma.$transaction([
    prisma.tablaImpuestoVecinal.deleteMany({ where: { municipio, anio } }),
    prisma.tablaImpuestoVecinal.createMany({
      data: tramos.map((t) => ({
        municipio,
        anio,
        rangoDesde: t.desde,
        rangoHasta: t.hasta,
        porMillar: t.porMillar,
        activa: true,
      })),
    }),
    prisma.configuracionSistema.upsert({
      where: { clave: "MUNICIPIO_IMPUESTO_VECINAL" },
      create: {
        clave: "MUNICIPIO_IMPUESTO_VECINAL",
        valor: municipio,
        descripcion: "Municipio cuyo Plan de Arbitrios rige el impuesto personal o vecinal",
      },
      update: { valor: municipio },
    }),
  ]);

  await audit({
    accion: anteriores.length > 0 ? "UPDATE" : "CREATE",
    tabla: "TablaImpuestoVecinal",
    registroId: `${municipio}-${anio}`,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: {
      municipioVigente: municipioAnterior?.valor ?? null,
      tramos: anteriores.map((f) => ({
        desde: Number(f.rangoDesde),
        hasta: f.rangoHasta === null ? null : Number(f.rangoHasta),
        porMillar: Number(f.porMillar),
      })),
    },
    valorNuevo: { municipioVigente: municipio, tramos },
    ...getClientInfo(req),
  });

  return NextResponse.json({ ok: true, municipio, tramos: tramos.length });
}
