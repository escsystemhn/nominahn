/**
 * Archivo de pago de un décimo para el banco (neto después de ISR).
 *   GET ?tipo=&anio=&formatoId=[&sucursalId=][&resumen=1]
 * Incluye las liquidaciones calculadas o pagadas, no las anuladas.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { nombreCompleto, hoyHN } from "@/lib/utils";
import { generarArchivoBanco } from "@/lib/payroll/archivo-banco";
import { aFormato } from "@/lib/payroll/archivo-banco-bd";

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("prestaciones.pagar");
  if (!g.ok) return g.response;
  const sp = new URL(req.url).searchParams;
  const tipo = sp.get("tipo");
  const anio = Number(sp.get("anio"));
  const formatoId = sp.get("formatoId");
  const sucursalId = sp.get("sucursalId");
  if ((tipo !== "DECIMO_TERCERO" && tipo !== "DECIMO_CUARTO") || !Number.isInteger(anio) || !formatoId) {
    return NextResponse.json({ error: "Indique el décimo, el año y el formato" }, { status: 400 });
  }

  const [filas, formato] = await Promise.all([
    prisma.liquidacionDecimo.findMany({
      where: { tipo, anio, estado: { in: ["CALCULADA", "PAGADA"] }, ...(sucursalId ? { empleado: { sucursalId } } : {}) },
      select: {
        montoPagado: true,
        empleado: { select: { codigo: true, identidad: true, banco: true, cuentaBancaria: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true } },
      },
      orderBy: { empleado: { primerApellido: "asc" } },
    }),
    prisma.formatoBanco.findUnique({ where: { id: formatoId } }),
  ]);
  if (!formato || !formato.activo) return NextResponse.json({ error: "Formato no encontrado o desactivado" }, { status: 404 });
  if (filas.length === 0) return NextResponse.json({ error: "No hay décimos calculados para ese año" }, { status: 404 });

  const etiqueta = tipo === "DECIMO_TERCERO" ? "13" : "14";
  const r = generarArchivoBanco(
    aFormato(formato),
    filas.map((d) => ({
      cuenta: d.empleado.cuentaBancaria,
      identidad: d.empleado.identidad,
      nombre: nombreCompleto(d.empleado),
      codigo: d.empleado.codigo,
      banco: d.empleado.banco,
      monto: Number(d.montoPagado),
    })),
    { fechaPago: hoyHN(), referencia: `DECIMO${etiqueta}-${anio}`, concepto: `Décimo ${tipo === "DECIMO_TERCERO" ? "tercer" : "cuarto"} mes ${anio}` }
  );

  if (sp.get("resumen") === "1") return NextResponse.json({ incluidos: r.incluidos, total: r.total, excluidos: r.excluidos, avisos: r.avisos, errores: r.errores });
  if (r.errores.length) return NextResponse.json({ error: r.errores.join(" ") }, { status: 422 });

  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "EXPORT", tabla: "LiquidacionDecimo", registroId: `${tipo}-${anio}`, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorNuevo: { archivo: "banco", formato: formato.nombre, incluidos: r.incluidos, total: r.total }, ip, userAgent });

  const buf = Buffer.from(r.contenido, formato.codificacion === "latin1" ? "latin1" : "utf8");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "text/plain; charset=" + (formato.codificacion === "latin1" ? "iso-8859-1" : "utf-8"),
      "Content-Disposition": `attachment; filename="pago-decimo${etiqueta}-${anio}.${formato.extension}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
