/**
 * Exportación de horas extra, y su plantilla.
 *
 * Exporta el mes de la fecha que se está viendo en Asistencia, con las mismas
 * columnas que se importan: se puede corregir en Excel y volver a subir.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { filtroEmpleados } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { generarCsv, cabecerasDescarga, delimitadorPedido } from "@/lib/importacion/csv";
import { COLUMNAS_HORAS_EXTRA, etiquetas } from "@/lib/importacion/columnas";
import { cabecerasXlsx, plantillaXlsx } from "@/lib/importacion/xlsx";
import { fechaCalendario, formatDate, hoyHN, nombreCompleto } from "@/lib/utils";

const MAX_FILAS = 20_000;

export async function GET(req: NextRequest) {
  const g = await requerirPermiso(["asistencia.ver", "asistencia.gestionar"]);
  if (!g.ok) return g.response;

  const { searchParams } = new URL(req.url);
  const delimitador = delimitadorPedido(searchParams.get("delimitador"));

  if (searchParams.get("plantilla") === "1") {
    const paraLlenar = COLUMNAS_HORAS_EXTRA.filter((c) => !c.soloLectura);
    if (searchParams.get("formato") === "xlsx") {
      return new NextResponse(new Uint8Array(await plantillaXlsx(paraLlenar)), { headers: cabecerasXlsx("plantilla_horas_extra.xlsx") });
    }
    // Sin fila de ejemplo: su código podría ser el de un empleado real, con horas que se pagarían.
    const csv = generarCsv(etiquetas(paraLlenar), [], delimitador);
    return new NextResponse(csv, { headers: cabecerasDescarga("plantilla_horas_extra.csv") });
  }

  const fechaPedida = searchParams.get("fecha") ?? "";
  const pedida = /^\d{4}-\d{2}-\d{2}$/.test(fechaPedida) ? fechaCalendario(fechaPedida) : hoyHN();
  const base = Number.isNaN(pedida.getTime()) ? hoyHN() : pedida;
  const desde = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const hasta = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
  const sucursalId = searchParams.get("sucursalId");

  const where: Prisma.MarcajeWhereInput = {
    fecha: { gte: desde, lte: hasta },
    OR: [{ horasExtra: { gt: 0 } }, { horasFeriado: { gt: 0 } }],
    empleado: { AND: [filtroEmpleados(g.usuario), sucursalId ? { sucursalId } : {}] },
  };

  const total = await prisma.marcaje.count({ where });
  if (total > MAX_FILAS) {
    return NextResponse.json({ error: `La selección tiene ${total} filas y el máximo por archivo es ${MAX_FILAS}.` }, { status: 413 });
  }

  const marcajes = await prisma.marcaje.findMany({
    where,
    select: {
      fecha: true, horasExtraDiurna: true, horasExtraMixta: true, horasExtraNocturna: true, horasFeriado: true, observacion: true,
      empleado: { select: { codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true } },
    },
    orderBy: [{ fecha: "asc" }, { empleado: { primerApellido: "asc" } }],
  });

  const valorDe: Record<string, (m: (typeof marcajes)[number]) => string> = {
    empleado_codigo: (m) => m.empleado.codigo,
    empleado_nombre: (m) => nombreCompleto(m.empleado),
    fecha: (m) => formatDate(m.fecha),
    diurnas: (m) => m.horasExtraDiurna.toFixed(2),
    mixtas: (m) => m.horasExtraMixta.toFixed(2),
    nocturnas: (m) => m.horasExtraNocturna.toFixed(2),
    feriado: (m) => m.horasFeriado.toFixed(2),
    observacion: (m) => m.observacion ?? "",
  };

  const filas = marcajes.map((m) => COLUMNAS_HORAS_EXTRA.map((c) => valorDe[c.clave]?.(m) ?? ""));
  const csv = generarCsv(etiquetas(COLUMNAS_HORAS_EXTRA), filas, delimitador);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "EXPORT",
    tabla: "Marcaje",
    registroId: `export:${filas.length}`,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { filas: filas.length, filtros: { desde, hasta, sucursalId }, alcance: g.usuario.alcance ?? "TODO" },
    ip,
    userAgent,
  });

  const mes = desde.toISOString().slice(0, 7);
  return new NextResponse(csv, { headers: cabecerasDescarga(`horas_extra_${mes}.csv`) });
}
