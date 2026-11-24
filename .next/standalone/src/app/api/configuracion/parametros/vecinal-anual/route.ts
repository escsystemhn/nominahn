/**
 * Impuesto vecinal: cuándo se cobra y lo confirmado de cada año (ver `lib/payroll/vecinal-anual.ts`).
 *   GET    ?anio=2026&fechaCobro=2027-01-01 → el modo de cobro y la propuesta del año
 *   PUT    { cobro: "ANUAL" | "CADA_PLANILLA" }
 *   POST   { anio, fechaCobro, montos: [{ empleadoId, monto }] } → confirma lo del año
 *   DELETE ?anio=2026 → quita lo confirmado, si su planilla no se cerró
 * Sólo quien edita los parámetros de ley: cambia lo que se descuenta a todos.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { cargarParametrosLegales } from "@/lib/payroll/parametros-bd";
import { money } from "@/lib/payroll/money";
import { esFechaIso } from "@/lib/payroll/periodos-planilla";
import {
  CLAVE_COBRO_VECINAL, ErrorVecinal, confirmarVecinal, guardarCobroVecinal, leerCobroVecinal, propuestaVecinal, quitarVecinal,
} from "@/lib/payroll/vecinal-anual";

const zAnio = z.coerce.number().int().min(2020).max(2100);

/** En enero y febrero el año que se cierra es el anterior; después, el actual. */
function anioPorOmision(ahora = new Date()): number {
  const hn = new Date(ahora.getTime() - 6 * 3_600_000);
  return hn.getUTCMonth() <= 1 ? hn.getUTCFullYear() - 1 : hn.getUTCFullYear();
}

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;
  const sp = new URL(req.url).searchParams;
  const anio = zAnio.safeParse(sp.get("anio") ?? anioPorOmision());
  if (!anio.success) return NextResponse.json({ error: "Año no válido." }, { status: 400 });
  const fechaCobro = sp.get("fechaCobro") || `${anio.data + 1}-01-01`;
  if (!esFechaIso(fechaCobro)) return NextResponse.json({ error: "Fecha de cobro no válida." }, { status: 400 });
  const [cobro, parametros] = await Promise.all([leerCobroVecinal(prisma), cargarParametrosLegales()]);
  const propuesta = await propuestaVecinal(prisma, anio.data, fechaCobro, parametros.tablaVecinalAnual);
  return NextResponse.json({ cobro, ...propuesta });
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, z.object({ cobro: z.enum(["ANUAL", "CADA_PLANILLA"]) }));
  if (!parsed.ok) return parsed.response;
  const antes = await leerCobroVecinal(prisma);
  await guardarCobroVecinal(prisma, parsed.data.cobro);
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "ConfiguracionSistema", registroId: CLAVE_COBRO_VECINAL,
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorAnterior: { cobro: antes }, valorNuevo: parsed.data, ip, userAgent,
  });
  return NextResponse.json(parsed.data);
}

const schemaConfirmar = z.object({
  anio: zAnio,
  fechaCobro: z.string().refine(esFechaIso, "Fecha de cobro no válida."),
  montos: z.array(z.object({ empleadoId: zId, monto: z.coerce.number().min(0).max(1_000_000) })).max(5000),
});

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schemaConfirmar);
  if (!parsed.ok) return parsed.response;
  const { anio, fechaCobro, montos } = parsed.data;
  if (fechaCobro <= `${anio}-12-31`) {
    return NextResponse.json({ error: `El vecinal de ${anio} se cobra en ${anio + 1}: elija una fecha de ese año.` }, { status: 400 });
  }
  try {
    const r = await prisma.$transaction((tx) => confirmarVecinal(tx, {
      anio, fechaCobro, montos: montos.map((m) => ({ empleadoId: m.empleadoId, monto: money(m.monto) })), usuario: g.usuario.email ?? g.usuario.id ?? "",
    }), { timeout: 60_000 });
    const { ip, userAgent } = getClientInfo(req);
    await audit({
      accion: "UPDATE", tabla: "DeduccionEmpleado", registroId: `vecinal:${anio}`,
      usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
      valorNuevo: { motivo: "Impuesto vecinal confirmado", anio, fechaCobro, empleados: r.empleados, total: r.total.toFixed(2) }, ip, userAgent,
    });
    return NextResponse.json({ empleados: r.empleados, total: r.total.toFixed(2) });
  } catch (e) {
    if (e instanceof ErrorVecinal) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;
  const anio = zAnio.safeParse(new URL(req.url).searchParams.get("anio"));
  if (!anio.success) return NextResponse.json({ error: "Año no válido." }, { status: 400 });
  // Lo que ya descontó una planilla cerrada queda: es parte de un documento.
  const fila = await prisma.configuracionSistema.findUnique({ where: { clave: `VECINAL_CONFIRMADO_${anio.data}` }, select: { valor: true } });
  let fechaCobro: string | null = null;
  try { fechaCobro = fila ? (JSON.parse(fila.valor).fechaCobro as string) : null; } catch { fechaCobro = null; }
  const dia = fechaCobro && esFechaIso(fechaCobro) ? new Date(`${fechaCobro}T00:00:00Z`) : null;
  const cerrada = dia && await prisma.planillaDetalle.findFirst({
    where: { impuestoVecinal: { gt: 0 }, planilla: { estado: { in: ["APROBADA", "PAGADA"] }, fechaInicio: { lte: dia }, fechaFin: { gte: dia } } },
    select: { id: true },
  });
  if (cerrada) {
    return NextResponse.json({ error: "Ya hay una planilla aprobada o pagada que lo descontó: lo confirmado no se puede quitar." }, { status: 409 });
  }
  const n = await prisma.$transaction((tx) => quitarVecinal(tx, anio.data));
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE", tabla: "DeduccionEmpleado", registroId: `vecinal:${anio.data}`,
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorAnterior: { motivo: "Impuesto vecinal confirmado", anio: anio.data, quitadas: n }, ip, userAgent,
  });
  return NextResponse.json({ quitadas: n });
}
