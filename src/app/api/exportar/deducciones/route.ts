/**
 * Exportación de deducciones POR EMPLEADO: una fila por empleado y una columna por
 * tipo de deducción, con lo que se le descuenta en un período de planilla. Es el
 * mismo archivo que se corrige y se vuelve a importar como «Montos del período»
 * (ver `lib/importacion/montos-periodo.ts`).
 *
 * Mismo criterio que la exportación de empleados: permiso propio, alcance por fila y
 * rastro de auditoría. Como todo el archivo son montos salariales, además pide el
 * permiso de datos personales.
 *
 *   GET  ?lista=1&tipoPlanilla=   empleados que se pueden marcar
 *   GET  ?tipoPlanilla=&desde=&hasta=&formato=xlsx|csv   todos los del alcance
 *   GET  ?plantilla=1             plantilla de la importación por filas (asignar con forma de cobro)
 *   POST { ids, tipoPlanilla, desde, hasta, formato | delimitador }   los marcados; sin ninguno, sólo encabezados
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso, puede, type Usuario } from "@/lib/auth/guard";
import { conAlcance } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { generarCsv, cabecerasDescarga, delimitadorPedido, type Delimitador } from "@/lib/importacion/csv";
import { cabecerasXlsx, plantillaXlsx } from "@/lib/importacion/xlsx";
import { COLUMNAS_DEDUCCION, columnasVisibles, etiquetas, filaEjemplo } from "@/lib/importacion/columnas";
import {
  armarMatriz,
  cargarContextoBaseRap,
  cargarDeduccionesDelPeriodo,
  cargarTiposMatriz,
  estadosDelPeriodo,
  notasMatriz,
} from "@/lib/importacion/montos-periodo";
import { ESTADOS_QUE_COBRAN } from "@/lib/payroll/elegibles";
import {
  TIPOS_PLANILLA,
  errorDePeriodo,
  nombreArchivoPeriodo,
  type PeriodoPlanilla,
  type TipoPlanillaPeriodo,
} from "@/lib/payroll/periodos-planilla";
import { nombreCompleto } from "@/lib/utils";

const MAX_EMPLEADOS = 5_000;

const zTipo = z.enum(TIPOS_PLANILLA as [TipoPlanillaPeriodo, ...TipoPlanillaPeriodo[]]);

const schemaSeleccion = z.object({
  ids: z.array(zId).max(MAX_EMPLEADOS),
  tipoPlanilla: zTipo,
  desde: z.string(),
  hasta: z.string(),
  delimitador: z.string().nullable().optional(),
  formato: z.enum(["csv", "xlsx"]).optional(),
});

const SIN_PII = "Este archivo lleva los montos que se descuentan a cada empleado: para exportarlo hace falta también el permiso de datos personales y salariales.";

/** Empleados del alcance que cobran en ese tipo de planilla. */
function dondeEmpleados(usuario: Usuario, tipo: TipoPlanillaPeriodo, ids?: readonly string[]): Prisma.EmpleadoWhereInput {
  return conAlcance({ estado: { in: [...ESTADOS_QUE_COBRAN] }, tipoPlanilla: tipo, ...(ids ? { id: { in: [...ids] } } : {}) }, usuario);
}

const ORDEN: Prisma.EmpleadoOrderByWithRelationInput[] = [{ primerApellido: "asc" }, { primerNombre: "asc" }];

async function responderMatriz(
  req: NextRequest,
  usuario: Usuario,
  periodo: PeriodoPlanilla,
  where: Prisma.EmpleadoWhereInput | null,
  salida: { delimitador: Delimitador; excel: boolean },
  filtrosAuditoria: Record<string, unknown>
) {
  const [tipos, empleados] = await Promise.all([
    cargarTiposMatriz(prisma),
    where
      ? prisma.empleado.findMany({
        where,
        select: {
          id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
          departamento: { select: { nombre: true } },
        },
        orderBy: ORDEN,
        take: MAX_EMPLEADOS + 1,
      })
      : Promise.resolve([]),
  ]);
  if (empleados.length > MAX_EMPLEADOS) {
    return NextResponse.json({ error: `Son más de ${MAX_EMPLEADOS} empleados: marque menos o expórtelos por partes.` }, { status: 413 });
  }

  const ids = empleados.map((e) => e.id);
  const [deducciones, baseRap] = await Promise.all([
    cargarDeduccionesDelPeriodo(prisma, ids, tipos.map((t) => t.id), periodo),
    // Con el RAP a mes vencido, la columna de la base del mes.
    cargarContextoBaseRap(prisma, ids, periodo),
  ]);
  const { columnas, filas } = armarMatriz(
    empleados.map((e) => ({ id: e.id, codigo: e.codigo, nombre: nombreCompleto(e), departamento: e.departamento.nombre })),
    tipos,
    estadosDelPeriodo(deducciones, periodo),
    baseRap
  );

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "EXPORT",
    tabla: "DeduccionEmpleado",
    registroId: `export:${filas.length}`,
    usuarioId: usuario.id,
    usuarioEmail: usuario.email ?? undefined,
    valorNuevo: {
      filas: filas.length,
      porEmpleado: true,
      periodo,
      incluyePII: filas.length > 0,
      formato: salida.excel ? "xlsx" : "csv",
      filtros: filtrosAuditoria,
      alcance: usuario.alcance ?? "TODO",
    },
    ip,
    userAgent,
  });

  const archivo = filas.length ? nombreArchivoPeriodo(periodo) : `plantilla_${nombreArchivoPeriodo(periodo)}`;
  if (salida.excel) {
    const xlsx = await plantillaXlsx(columnas, filas, { notas: notasMatriz(periodo, baseRap), fijarColumnas: 2 });
    return new NextResponse(new Uint8Array(xlsx), { headers: cabecerasXlsx(`${archivo}.xlsx`) });
  }
  return new NextResponse(generarCsv(etiquetas(columnas), filas, salida.delimitador), { headers: cabecerasDescarga(`${archivo}.csv`) });
}

function leerPeriodo(tipo: unknown, desde: unknown, hasta: unknown): { ok: true; periodo: PeriodoPlanilla } | { ok: false; error: string } {
  const t = zTipo.safeParse(tipo);
  if (!t.success) return { ok: false, error: "Elija el tipo de planilla." };
  const error = errorDePeriodo({ desde, hasta });
  if (error) return { ok: false, error };
  return { ok: true, periodo: { tipo: t.data, desde: desde as string, hasta: hasta as string } };
}

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("deducciones.exportar");
  if (!g.ok) return g.response;
  const { searchParams } = new URL(req.url);
  const delimitador = delimitadorPedido(searchParams.get("delimitador"));

  if (searchParams.get("plantilla") === "1") {
    // Plantilla de la importación por filas. No incluye las columnas informativas:
    // pedirle al usuario que rellene un "Saldo" que el sistema va a ignorar sólo confunde.
    const paraLlenar = columnasVisibles(COLUMNAS_DEDUCCION, puede(g.usuario, "empleados.pii")).filter((c) => !c.soloLectura);
    if (searchParams.get("formato") === "xlsx") {
      return new NextResponse(new Uint8Array(await plantillaXlsx(paraLlenar)), { headers: cabecerasXlsx("plantilla_deducciones.xlsx") });
    }
    const csv = generarCsv(etiquetas(paraLlenar), [filaEjemplo(paraLlenar)], delimitador);
    return new NextResponse(csv, { headers: cabecerasDescarga("plantilla_deducciones.csv") });
  }

  if (!puede(g.usuario, "empleados.pii")) return NextResponse.json({ error: SIN_PII }, { status: 403 });
  const tipo = zTipo.safeParse(searchParams.get("tipoPlanilla"));

  if (searchParams.get("lista") === "1") {
    if (!tipo.success) return NextResponse.json({ error: "Elija el tipo de planilla." }, { status: 400 });
    const empleados = await prisma.empleado.findMany({
      where: dondeEmpleados(g.usuario, tipo.data),
      select: {
        id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
        sucursal: { select: { nombre: true } },
        departamento: { select: { nombre: true } },
      },
      orderBy: ORDEN,
      take: MAX_EMPLEADOS,
    });
    return NextResponse.json({
      filas: empleados.map((e) => ({ id: e.id, titulo: nombreCompleto(e), detalle: `${e.codigo}, ${e.departamento.nombre}, ${e.sucursal.nombre}` })),
    });
  }

  const p = leerPeriodo(searchParams.get("tipoPlanilla"), searchParams.get("desde"), searchParams.get("hasta"));
  if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 });
  return responderMatriz(
    req, g.usuario, p.periodo, dondeEmpleados(g.usuario, p.periodo.tipo),
    { delimitador, excel: searchParams.get("formato") === "xlsx" },
    { todos: true }
  );
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("deducciones.exportar");
  if (!g.ok) return g.response;
  if (!puede(g.usuario, "empleados.pii")) return NextResponse.json({ error: SIN_PII }, { status: 403 });

  const parsed = await parsearBody(req, schemaSeleccion);
  if (!parsed.ok) return parsed.response;
  const { ids, tipoPlanilla, desde, hasta, delimitador, formato } = parsed.data;
  const p = leerPeriodo(tipoPlanilla, desde, hasta);
  if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 });

  // Con AND el alcance manda: un empleado de otra sucursal simplemente no sale.
  return responderMatriz(
    req, g.usuario, p.periodo, ids.length ? dondeEmpleados(g.usuario, p.periodo.tipo, ids) : null,
    { delimitador: delimitadorPedido(delimitador ?? null), excel: formato === "xlsx" },
    { seleccionados: ids.length }
  );
}
