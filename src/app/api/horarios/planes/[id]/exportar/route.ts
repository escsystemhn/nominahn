/** Exporta un plan de horarios: ?formato=xlsx | pdf | json */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { planConValidacion, ymd } from "@/lib/horarios/bd";
import { aJson, aPdfPlan, aXlsxPlan, type DatosExportacion } from "@/lib/horarios/exportar";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso(["asistencia.turnos", "asistencia.ver"]);
  if (!g.ok) return g.response;
  const { id } = await params;
  const formato = (new URL(req.url).searchParams.get("formato") ?? "xlsx").toLowerCase();
  const r = await planConValidacion(prisma, id);
  if (!r) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  const datos: DatosExportacion = {
    plan: { nombre: r.plan.nombre, desde: ymd(r.plan.desde), hasta: ymd(r.plan.hasta), estado: r.plan.estado },
    empleados: r.ctx.empleados,
    sucursales: r.ctx.sucursales,
    turnos: r.ctx.turnos,
    validacion: r.validacion,
    generado: new Date(),
  };
  const base = `horario-${ymd(r.plan.desde)}-${ymd(r.plan.hasta)}`;
  const comun = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "EXPORT", tabla: "PlanHorario", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorNuevo: { formato }, ip, userAgent });

  if (formato === "json") {
    return new NextResponse(JSON.stringify(aJson(datos), null, 2), {
      headers: { ...comun, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.json"` },
    });
  }
  if (formato === "pdf") {
    const pdf = await aPdfPlan(datos);
    return new NextResponse(new Uint8Array(pdf), {
      headers: { ...comun, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` },
    });
  }
  const xlsx = await aXlsxPlan(datos);
  return new NextResponse(new Uint8Array(xlsx), {
    headers: { ...comun, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` },
  });
}
