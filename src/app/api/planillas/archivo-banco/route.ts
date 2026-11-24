/**
 * Un solo archivo de pago para el banco con varias planillas (fase 2 de Planillas por
 * período, 2026-11-24): el de toda la quincena, por ejemplo, en vez de uno por sucursal.
 *
 *   GET ?ids=a,b,c&formatoId=…              → descarga el archivo
 *   GET ?ids=a,b,c&formatoId=…&resumen=1    → qué entra, qué queda fuera y el total
 *
 * Mismas reglas que el de una planilla (`/api/planillas/[id]/archivo-banco`): sólo entran
 * las aprobadas o pagadas, lo genera quien registra el pago y hay que alcanzar a todas
 * sus personas. Las marcadas que no están aprobadas se dicen en los avisos.
 */

import { NextRequest, NextResponse } from "next/server";
import { accesoAPlanilla } from "@/lib/payroll/alcance-planilla";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { nombreCompleto, hoyHN } from "@/lib/utils";
import { generarArchivoBanco } from "@/lib/payroll/archivo-banco";
import { aFormato } from "@/lib/payroll/archivo-banco-bd";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAXIMO = 300;

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("planillas.pagar");
  if (!g.ok) return g.response;
  const sp = new URL(req.url).searchParams;
  const ids = [...new Set((sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAXIMO || !ids.every((x) => ID.test(x))) {
    return NextResponse.json({ error: `Marque entre 1 y ${MAXIMO} planillas.` }, { status: 400 });
  }
  const formatoId = sp.get("formatoId");
  if (!formatoId) return NextResponse.json({ error: "Elija el formato del banco" }, { status: 400 });

  // El archivo paga a todas las personas de cada planilla: hay que alcanzarlas a todas.
  for (const id of ids) {
    const acceso = await accesoAPlanilla(prisma, g.usuario, id);
    if (acceso === "ninguno") return NextResponse.json({ error: "Una de las planillas marcadas no existe." }, { status: 404 });
    if (acceso === "parcial") return NextResponse.json({ error: "Una de las planillas marcadas incluye personal fuera del alcance de su cuenta." }, { status: 403 });
  }

  const [planillas, formato] = await Promise.all([
    prisma.planilla.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, tipo: true, estado: true, fechaFin: true, fechaPago: true,
        division: { select: { nombre: true } }, sucursal: { select: { nombre: true } },
        detalles: {
          select: {
            salarioNeto: true,
            empleado: { select: { codigo: true, identidad: true, banco: true, cuentaBancaria: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true } },
          },
          orderBy: { empleado: { primerApellido: "asc" } },
        },
      },
      orderBy: { fechaInicio: "asc" },
    }),
    prisma.formatoBanco.findUnique({ where: { id: formatoId } }),
  ]);
  if (!formato || !formato.activo) return NextResponse.json({ error: "Formato no encontrado o desactivado" }, { status: 404 });

  const pagables = planillas
    .filter((p) => p.estado === "APROBADA" || p.estado === "PAGADA")
    // Por sucursal, para que el archivo se pueda cotejar contra la planilla impresa.
    .sort((a, b) => a.fechaFin.getTime() - b.fechaFin.getTime() || (a.division?.nombre ?? a.sucursal?.nombre ?? "").localeCompare(b.division?.nombre ?? b.sucursal?.nombre ?? "", "es"));
  const sinAprobar = planillas.length - pagables.length;
  if (pagables.length === 0) {
    return NextResponse.json({ error: "Ninguna de las planillas marcadas está aprobada o pagada: no se paga un borrador." }, { status: 409 });
  }

  const ultima = pagables.reduce((a, b) => (b.fechaFin > a.fechaFin ? b : a));
  const ymd = ultima.fechaFin.toISOString().slice(0, 10).replace(/-/g, "");
  const tipos = [...new Set(pagables.map((p) => p.tipo))];
  const fechaPago = pagables.map((p) => p.fechaPago).filter((f): f is Date => !!f).sort((a, b) => b.getTime() - a.getTime())[0] ?? hoyHN();
  const r = generarArchivoBanco(
    aFormato(formato),
    pagables.flatMap((p) => p.detalles.map((d) => ({
      cuenta: d.empleado.cuentaBancaria,
      identidad: d.empleado.identidad,
      nombre: nombreCompleto(d.empleado),
      codigo: d.empleado.codigo,
      banco: d.empleado.banco,
      monto: Number(d.salarioNeto),
    }))),
    {
      fechaPago,
      referencia: tipos.length === 1 ? `NOM-${tipos[0]}-${ymd}` : `NOM-${ymd}`,
      concepto: tipos.length === 1 ? `Planilla ${tipos[0].toLowerCase()}` : "Planillas",
    },
  );
  const avisos = sinAprobar > 0
    ? [`${sinAprobar === 1 ? "Una planilla marcada no está aprobada y no entra" : `${sinAprobar} planillas marcadas no están aprobadas y no entran`}: no se paga un borrador.`, ...r.avisos]
    : r.avisos;

  if (sp.get("resumen") === "1") {
    return NextResponse.json({ incluidos: r.incluidos, total: r.total, excluidos: r.excluidos, avisos, errores: r.errores, planillas: pagables.length });
  }
  if (r.errores.length) return NextResponse.json({ error: r.errores.join(" ") }, { status: 422 });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "EXPORT",
    tabla: "Planilla",
    registroId: `banco-lote:${pagables.length}`,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { archivo: "banco", formato: formato.nombre, planillas: pagables.map((p) => p.id), incluidos: r.incluidos, total: r.total, excluidos: r.excluidos.length },
    ip,
    userAgent,
  });

  const buf = Buffer.from(r.contenido, formato.codificacion === "latin1" ? "latin1" : "utf8");
  const nombre = `pago-${tipos.length === 1 ? tipos[0].toLowerCase() : "planillas"}-${ymd}-${pagables.length}-planillas-${formato.nombre.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.${formato.extension}`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": formato.tipo === "DELIMITADO" && formato.delimitador === "," ? "text/csv; charset=" + (formato.codificacion === "latin1" ? "iso-8859-1" : "utf-8") : "text/plain",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
