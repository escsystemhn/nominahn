/**
 * Archivo de pago de una planilla para el banco, con el formato elegido.
 *
 *   GET ?formatoId=…              → descarga el archivo
 *   GET ?formatoId=…&resumen=1    → qué entra, qué queda fuera y el total, sin descargar
 *
 * Sólo de planillas aprobadas o pagadas: no se paga un borrador. Lo genera quien
 * registra el pago (`planillas.pagar`), porque el archivo lleva cuentas bancarias.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { nombreCompleto, hoyHN } from "@/lib/utils";
import { generarArchivoBanco } from "@/lib/payroll/archivo-banco";
import { aFormato } from "@/lib/payroll/archivo-banco-bd";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("planillas.pagar");
  if (!g.ok) return g.response;
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const formatoId = sp.get("formatoId");
  if (!formatoId) return NextResponse.json({ error: "Elija el formato del banco" }, { status: 400 });

  const [planilla, formato] = await Promise.all([
    prisma.planilla.findUnique({
      where: { id },
      select: {
        tipo: true, estado: true, fechaFin: true, fechaPago: true,
        detalles: {
          select: {
            salarioNeto: true,
            empleado: { select: { codigo: true, identidad: true, banco: true, cuentaBancaria: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true } },
          },
          orderBy: { empleado: { primerApellido: "asc" } },
        },
      },
    }),
    prisma.formatoBanco.findUnique({ where: { id: formatoId } }),
  ]);
  if (!planilla) return NextResponse.json({ error: "Planilla no encontrada" }, { status: 404 });
  if (!formato || !formato.activo) return NextResponse.json({ error: "Formato no encontrado o desactivado" }, { status: 404 });
  if (!["APROBADA", "PAGADA"].includes(planilla.estado)) {
    return NextResponse.json({ error: `La planilla está ${planilla.estado}: sólo se paga una planilla aprobada o pagada.` }, { status: 409 });
  }

  const ymd = planilla.fechaFin.toISOString().slice(0, 10).replace(/-/g, "");
  const r = generarArchivoBanco(
    aFormato(formato),
    planilla.detalles.map((d) => ({
      cuenta: d.empleado.cuentaBancaria,
      identidad: d.empleado.identidad,
      nombre: nombreCompleto(d.empleado),
      codigo: d.empleado.codigo,
      banco: d.empleado.banco,
      monto: Number(d.salarioNeto),
    })),
    { fechaPago: planilla.fechaPago ?? hoyHN(), referencia: `NOM-${planilla.tipo}-${ymd}`, concepto: `Planilla ${planilla.tipo.toLowerCase()}` }
  );

  if (sp.get("resumen") === "1") {
    return NextResponse.json({ incluidos: r.incluidos, total: r.total, excluidos: r.excluidos, avisos: r.avisos, errores: r.errores });
  }
  if (r.errores.length) return NextResponse.json({ error: r.errores.join(" ") }, { status: 422 });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "EXPORT",
    tabla: "Planilla",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { archivo: "banco", formato: formato.nombre, incluidos: r.incluidos, total: r.total, excluidos: r.excluidos.length },
    ip,
    userAgent,
  });

  const buf = Buffer.from(r.contenido, formato.codificacion === "latin1" ? "latin1" : "utf8");
  const nombre = `pago-${planilla.tipo.toLowerCase()}-${ymd}-${formato.nombre.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.${formato.extension}`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": formato.tipo === "DELIMITADO" && formato.delimitador === "," ? "text/csv; charset=" + (formato.codificacion === "latin1" ? "iso-8859-1" : "utf-8") : "text/plain",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
