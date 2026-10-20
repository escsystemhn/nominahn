/**
 * Exportación de deducciones asignadas a empleados.
 *
 * Mismo criterio que la exportación de empleados: permiso propio, alcance por
 * fila y rastro de auditoría. La diferencia es que el filtro de alcance se
 * aplica a través del empleado, no sobre la fila de deducción.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso, puede } from "@/lib/auth/guard";
import { filtroEmpleados } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { generarCsv, cabecerasDescarga, delimitadorPedido } from "@/lib/importacion/csv";
import {
  COLUMNAS_DEDUCCION,
  columnasVisibles,
  etiquetas,
  filaEjemplo,
} from "@/lib/importacion/columnas";
import { formatDate, nombreCompleto } from "@/lib/utils";

const MAX_FILAS = 20_000;

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("deducciones.exportar");
  if (!g.ok) return g.response;

  // Los importes de una deducción son dato salarial: se rigen por el mismo
  // permiso que el resto de la información económica del empleado.
  const vePII = puede(g.usuario, "empleados.pii");
  const columnas = columnasVisibles(COLUMNAS_DEDUCCION, vePII);
  const { searchParams } = new URL(req.url);
  const delimitador = delimitadorPedido(searchParams.get("delimitador"));

  if (searchParams.get("plantilla") === "1") {
    // La plantilla no incluye las columnas informativas: pedirle al usuario que
    // rellene un "Saldo" que el sistema va a ignorar sólo genera confusión.
    const paraLlenar = columnas.filter((c) => !c.soloLectura);
    const csv = generarCsv(etiquetas(paraLlenar), [filaEjemplo(paraLlenar)], delimitador);
    return new NextResponse(csv, { headers: cabecerasDescarga("plantilla_deducciones.csv") });
  }

  const tipoDeduccionId = searchParams.get("tipoDeduccionId");
  const sucursalId = searchParams.get("sucursalId");
  const soloActivas = searchParams.get("activo") !== "0";

  const alcance = filtroEmpleados(g.usuario);
  const filtroEmpleado: Prisma.EmpleadoWhereInput = {
    AND: [alcance, sucursalId ? { sucursalId } : {}],
  };

  const where: Prisma.DeduccionEmpleadoWhereInput = {
    ...(soloActivas ? { activo: true } : {}),
    ...(tipoDeduccionId ? { tipoDeduccionId } : {}),
    empleado: filtroEmpleado,
  };

  const total = await prisma.deduccionEmpleado.count({ where });
  if (total > MAX_FILAS) {
    return NextResponse.json(
      { error: `La selección tiene ${total} deducciones y el máximo por archivo es ${MAX_FILAS}.` },
      { status: 413 }
    );
  }

  const deducciones = await prisma.deduccionEmpleado.findMany({
    where,
    include: {
      empleado: {
        select: {
          codigo: true,
          primerNombre: true,
          segundoNombre: true,
          primerApellido: true,
          segundoApellido: true,
        },
      },
      tipoDeduccion: { select: { codigo: true, nombre: true } },
    },
    orderBy: [{ empleado: { primerApellido: "asc" } }, { createdAt: "desc" }],
  });

  const valorDe: Record<string, (d: (typeof deducciones)[number]) => string> = {
    empleado_codigo: (d) => d.empleado.codigo,
    empleado_nombre: (d) => nombreCompleto(d.empleado),
    tipo_deduccion_codigo: (d) => d.tipoDeduccion.codigo,
    tipo_deduccion_nombre: (d) => d.tipoDeduccion.nombre,
    monto: (d) => d.monto.toFixed(2),
    cuotas_meses: (d) => (d.cuotasMeses !== null ? String(d.cuotasMeses) : ""),
    fecha_inicio: (d) => formatDate(d.fechaInicio),
    fecha_fin: (d) => (d.fechaFin ? formatDate(d.fechaFin) : ""),
    activo: (d) => (d.activo ? "Si" : "No"),
    observacion: (d) => d.observacion ?? "",
    saldo: (d) => (d.saldo !== null ? d.saldo.toFixed(2) : ""),
    cuotas_pagadas: (d) => String(d.cuotasPagadas),
  };

  const filas = deducciones.map((d) => columnas.map((c) => valorDe[c.clave]?.(d) ?? ""));
  const csv = generarCsv(etiquetas(columnas), filas, delimitador);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "EXPORT",
    tabla: "DeduccionEmpleado",
    registroId: `export:${filas.length}`,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      filas: filas.length,
      incluyePII: vePII,
      filtros: { tipoDeduccionId, sucursalId, soloActivas },
      alcance: g.usuario.alcance ?? "TODO",
    },
    ip,
    userAgent,
  });

  const marca = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, { headers: cabecerasDescarga(`deducciones_${marca}.csv`) });
}
