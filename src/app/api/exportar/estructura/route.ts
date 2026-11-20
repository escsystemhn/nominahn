/**
 * «Exportar estructura»: la organización por grupos y sucursales en Excel o PDF, desde
 * Empleados y Jerarquía de nómina (ver lib/reportes/estructura-organizacional.ts).
 *
 * Mismas reglas que exportar empleados: permiso `empleados.exportar`, el alcance del
 * usuario, identidad y salario sólo con `empleados.pii`, y queda en la bitácora.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso, puede } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { aPdf, aXlsx, contarDetalles, type ReporteTabla } from "@/lib/reportes/salida";
import { leerDetalle } from "@/lib/reportes/estructura-organizacional";
import { cargarTablaEstructura } from "@/lib/reportes/estructura-organizacional-bd";

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("empleados.exportar");
  if (!g.ok) return g.response;

  const { searchParams } = new URL(req.url);
  const detalle = leerDetalle(searchParams.get("detalle"));
  const formato = searchParams.get("formato") === "pdf" ? "pdf" : "xlsx";
  const vePII = puede(g.usuario, "empleados.pii");
  const pedido = {
    detalle,
    sucursalId: searchParams.get("sucursalId") || null,
    divisionId: searchParams.get("divisionId") || null,
    incluirInactivos: searchParams.get("inactivos") === "1",
    vePII,
  };

  const tabla = await cargarTablaEstructura(prisma, g.usuario, pedido);
  const reporte: ReporteTabla = {
    titulo: tabla.titulo,
    cabeceras: tabla.cabeceras,
    datos: tabla.datos,
    filas: tabla.filas,
    ...(tabla.hojas ? { hojas: tabla.hojas } : {}),
    filtros: tabla.filtros,
    generado: new Date(),
  };

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "EXPORT",
    tabla: "Estructura",
    registroId: `estructura:${tabla.totales.empleados}`,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      detalle,
      formato,
      filas: contarDetalles(tabla.datos, tabla.filas),
      empleados: tabla.totales.empleados,
      incluyePII: vePII && detalle === "empleados",
      filtros: { sucursalId: pedido.sucursalId, divisionId: pedido.divisionId, inactivos: pedido.incluirInactivos },
      alcance: g.usuario.alcance ?? "TODO",
    },
    ip,
    userAgent,
  });

  const archivo = `estructura_${detalle}_${new Date().toISOString().slice(0, 10)}`;
  const comunes = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
  if (formato === "pdf") {
    return new NextResponse(new Uint8Array(await aPdf(reporte)), {
      headers: { ...comunes, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${archivo}.pdf"` },
    });
  }
  return new NextResponse(new Uint8Array(await aXlsx(reporte)), {
    headers: {
      ...comunes,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${archivo}.xlsx"`,
    },
  });
}
