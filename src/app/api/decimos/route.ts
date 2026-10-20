import { NextRequest, NextResponse } from "next/server";
import { Prisma, TipoDecimo } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import {
  calcularDecimo,
  aplicarFiscalidadDecimo,
  ventanaDevengo,
  salarioPromedioPonderado,
} from "@/lib/payroll/decimos";
import { cargarParametrosLegales } from "@/lib/payroll/parametros-bd";
import { money, CERO, type Money } from "@/lib/payroll/money";
import { z } from "zod";
import { validarTransicionDecimo, type EstadoDecimo } from "@/lib/payroll/estado-prestaciones";
import { hoyHN } from "@/lib/utils";
import { zFecha } from "@/lib/http/validar";

const schemaCalcular = z.object({
  tipo: z.enum(TipoDecimo),
  anio: z.number().int().min(2000).max(2100),
  sucursalId: z.string().trim().min(1).optional().nullable(),
  /** Corte del devengo; por defecto el fin de la ventana. */
  hasta: z.coerce.date().optional(),
});

const MS_DIA = 24 * 60 * 60 * 1000;

// ─── GET: consulta del acumulado ───────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("prestaciones.ver");
  if (!g.ok) return g.response;

  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get("tipo") as TipoDecimo | null;
  const anio = Number(searchParams.get("anio")) || new Date().getUTCFullYear();

  const liquidaciones = await prisma.liquidacionDecimo.findMany({
    where: { anio, ...(tipo ? { tipo } : {}) },
    include: {
      empleado: {
        select: {
          codigo: true, primerNombre: true, segundoNombre: true,
          primerApellido: true, segundoApellido: true,
        },
      },
    },
    orderBy: { empleado: { primerApellido: "asc" } },
  });

  return NextResponse.json(liquidaciones);
}

// ─── POST: cálculo de la liquidación ───────────────────────────────────────────

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("prestaciones.generar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schemaCalcular);
  if (!parsed.ok) return parsed.response;
  const { tipo, anio, sucursalId, hasta } = parsed.data;

  const ventana = ventanaDevengo(tipo, anio);

  // Empleados con relación laboral vigente en algún momento de la ventana.
  const empleados = await prisma.empleado.findMany({
    where: {
      ...(sucursalId ? { sucursalId } : {}),
      fechaIngreso: { lte: ventana.hasta },
      OR: [{ fechaSalida: null }, { fechaSalida: { gte: ventana.desde } }],
    },
    select: {
      id: true, salarioBase: true, fechaIngreso: true, fechaSalida: true,
      historialSalarios: {
        where: { fechaCambio: { gte: ventana.desde, lte: ventana.hasta } },
        orderBy: { fechaCambio: "asc" },
        select: { salarioAnterior: true, salarioNuevo: true, fechaCambio: true },
      },
    },
  });

  if (empleados.length === 0) {
    return NextResponse.json({ error: "No hay empleados con servicio en el período" }, { status: 400 });
  }

  // Salario mínimo vigente: base del techo exento de ISR.
  const salMin = await prisma.salarioMinimo.findFirst({
    where: { activo: true },
    orderBy: { anio: "desc" },
    select: { monto: true },
  });
  if (!salMin) {
    return NextResponse.json(
      { error: "No hay salario mínimo configurado: es la base del techo exento de ISR" },
      { status: 409 }
    );
  }

  // Tabla ISR vigente, para gravar el excedente al tramo marginal correcto.
  // La tabla ISR vigente, del mismo cargador que la planilla y los reportes.
  const parametros = await cargarParametrosLegales();

  // El OTRO décimo del mismo año ya pudo consumir parte del techo exento, que es
  // conjunto para ambos (Art. 11 Ley del ISR).
  const otroTipo: TipoDecimo = tipo === "DECIMO_TERCERO" ? "DECIMO_CUARTO" : "DECIMO_TERCERO";
  const yaExentos = await prisma.liquidacionDecimo.findMany({
    where: {
      anio,
      tipo: otroTipo,
      estado: { in: ["CALCULADA", "PAGADA"] },
      empleadoId: { in: empleados.map((e) => e.id) },
    },
    select: { empleadoId: true, montoExento: true },
  });
  const exentoUsadoPorEmp = new Map(yaExentos.map((l) => [l.empleadoId, money(l.montoExento)]));

  const filas: Prisma.LiquidacionDecimoCreateManyInput[] = [];
  let totalDevengado = CERO;
  let totalIsr = CERO;

  for (const emp of empleados) {
    // Salario promedio PONDERADO por los días de vigencia de cada importe: un
    // aumento en el último mes no debe inflar el décimo entero.
    const salarioPromedio = promedioDelPeriodo(emp, ventana);

    const devengo = calcularDecimo({
      tipo,
      anio,
      fechaIngreso: emp.fechaIngreso,
      fechaSalida: emp.fechaSalida,
      salarioPromedio,
      hasta,
    });

    if (devengo.diasComputados <= 0) continue;

    const fiscal = aplicarFiscalidadDecimo({
      montoDevengado: devengo.montoDevengado,
      salarioMinimo: salMin.monto,
      exentoYaUsado: exentoUsadoPorEmp.get(emp.id) ?? 0,
      // Renta ordinaria anual estimada: doce veces el salario promedio.
      rentaOrdinariaAnual: money(salarioPromedio).times(12),
      parametros,
    });

    filas.push({
      empleadoId: emp.id,
      tipo,
      anio,
      periodoDesde: devengo.periodoDesde,
      periodoHasta: devengo.periodoHasta,
      diasComputados: devengo.diasComputados,
      salarioPromedio: devengo.salarioPromedio,
      montoDevengado: devengo.montoDevengado,
      montoExento: fiscal.montoExento,
      montoGravado: fiscal.montoGravado,
      isrRetenido: fiscal.isrRetenido,
      montoPagado: fiscal.montoNeto,
      estado: "CALCULADA",
      esProporcional: devengo.esProporcional,
      calculadoPor: g.usuario.id,
    });

    totalDevengado = totalDevengado.plus(devengo.montoDevengado);
    totalIsr = totalIsr.plus(fiscal.isrRetenido);
  }

  if (filas.length === 0) {
    return NextResponse.json({ error: "Ningún empleado devengó días en el período" }, { status: 400 });
  }

  // Recalcular sustituye la liquidación anterior del mismo año y tipo, salvo la
  // que ya se pagó: un pago ejecutado no se reescribe.
  const yaPagadas = await prisma.liquidacionDecimo.count({
    where: { anio, tipo, estado: "PAGADA", empleadoId: { in: filas.map((f) => f.empleadoId) } },
  });
  if (yaPagadas > 0) {
    return NextResponse.json(
      { error: `Hay ${yaPagadas} liquidación(es) de este décimo ya PAGADAS: anúlelas antes de recalcular` },
      { status: 409 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.liquidacionDecimo.deleteMany({
      where: { anio, tipo, estado: "CALCULADA", empleadoId: { in: filas.map((f) => f.empleadoId) } },
    });
    await tx.liquidacionDecimo.createMany({ data: filas });
  }, { timeout: 30000 });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "LiquidacionDecimo",
    registroId: `${tipo}-${anio}`,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      tipo, anio, sucursalId: sucursalId ?? null,
      empleados: filas.length,
      totalDevengado, totalIsr,
    },
    ip,
    userAgent,
  });

  return NextResponse.json(
    {
      tipo,
      anio,
      empleados: filas.length,
      totalDevengado: totalDevengado.toFixed(2),
      totalIsr: totalIsr.toFixed(2),
      periodoDesde: ventana.desde,
      periodoHasta: ventana.hasta,
    },
    { status: 201 }
  );
}

// ─── PATCH: registrar el pago o anular, en lote ────────────────────────────────

const schemaEstado = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(2000),
  estado: z.enum(["PAGADA", "ANULADA"]),
  motivo: z.string().trim().max(500).optional(),
  fechaPago: zFecha.optional(),
});

export async function PATCH(req: NextRequest) {
  const g = await requerirPermiso(["prestaciones.generar", "prestaciones.pagar", "prestaciones.anular_pagada"]);
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schemaEstado);
  if (!parsed.ok) return parsed.response;
  const { ids, estado, motivo, fechaPago } = parsed.data;

  const filas = await prisma.liquidacionDecimo.findMany({
    where: { id: { in: ids } },
    select: { id: true, estado: true, observaciones: true },
  });
  if (filas.length !== ids.length) {
    return NextResponse.json({ error: "Alguna de las liquidaciones no existe" }, { status: 404 });
  }

  // Todas o ninguna: un lote a medias es lo que después no cuadra con el banco.
  for (const f of filas) {
    const v = validarTransicionDecimo(f.estado as EstadoDecimo, estado, g.usuario.permisos, motivo);
    if (!v.ok) return NextResponse.json({ error: v.error, id: f.id }, { status: v.status });
  }

  const fecha = fechaPago ?? hoyHN();
  await prisma.$transaction(async (tx) => {
    if (estado === "PAGADA") {
      await tx.liquidacionDecimo.updateMany({
        where: { id: { in: ids } },
        data: { estado: "PAGADA", fechaPago: fecha, pagadoPor: g.usuario.id ?? null },
      });
    } else {
      const nota = `Anulada el ${new Date().toISOString().slice(0, 10)}${motivo ? `: ${motivo}` : ""}`;
      for (const f of filas) {
        await tx.liquidacionDecimo.update({
          where: { id: f.id },
          data: { estado: "ANULADA", observaciones: f.observaciones ? `${f.observaciones}\n${nota}` : nota },
        });
      }
    }
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "LiquidacionDecimo",
    registroId: ids.length === 1 ? ids[0] : `lote-${ids.length}`,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { estado, ids, motivo: motivo ?? undefined, fechaPago: estado === "PAGADA" ? fecha : undefined },
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true, actualizadas: ids.length });
}

/**
 * Salario promedio del período, ponderado por los días de vigencia de cada
 * importe según el historial de cambios salariales.
 *
 * Sin historial en la ventana, el salario actual estuvo vigente todo el tiempo.
 */
function promedioDelPeriodo(
  emp: {
    salarioBase: Prisma.Decimal;
    historialSalarios: { salarioAnterior: Prisma.Decimal; salarioNuevo: Prisma.Decimal; fechaCambio: Date }[];
  },
  ventana: { desde: Date; hasta: Date }
): Money {
  if (emp.historialSalarios.length === 0) return money(emp.salarioBase);

  const tramos: { salario: Prisma.Decimal; dias: number }[] = [];
  let cursor = ventana.desde;

  for (const h of emp.historialSalarios) {
    const dias = Math.max(0, Math.floor((h.fechaCambio.getTime() - cursor.getTime()) / MS_DIA));
    if (dias > 0) tramos.push({ salario: h.salarioAnterior, dias });
    cursor = h.fechaCambio;
  }

  // Último tramo: del último cambio al fin de la ventana.
  const diasFinales = Math.max(
    0,
    Math.floor((ventana.hasta.getTime() - cursor.getTime()) / MS_DIA) + 1
  );
  if (diasFinales > 0) tramos.push({ salario: emp.salarioBase, dias: diasFinales });

  const promedio = salarioPromedioPonderado(tramos);
  return promedio.isZero() ? money(emp.salarioBase) : promedio;
}
