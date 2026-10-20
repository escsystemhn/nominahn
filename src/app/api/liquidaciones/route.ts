import { NextRequest, NextResponse } from "next/server";
import { CausaTerminacion } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import {
  calcularLiquidacion,
  salarioOrdinarioPromedio,
  MESES_PROMEDIO_SALARIO,
  MAX_EMPLEADOS_MICROEMPRESA,
} from "@/lib/payroll/liquidacion";
import { calcularDecimo } from "@/lib/payroll/decimos";
import { money, aNumero, CERO } from "@/lib/payroll/money";
import { z } from "zod";

const schemaCalcular = z.object({
  empleadoId: zId,
  causa: z.enum(CausaTerminacion),
  fechaSalida: z.coerce.date(),
  /** Días de vacaciones ya gozados; si se omite se leen del saldo registrado. */
  diasVacacionesGozados: z.number().min(0).optional(),
  /** El patrono dio el preaviso por escrito y el trabajador lo laboró. */
  preavisoOtorgado: z.boolean().optional(),
  salariosPendientes: z.number().min(0).optional(),
  otrosAdeudos: z.number().min(0).optional(),
  /** Anticipos o préstamos a descontar del finiquito. */
  deducciones: z.number().min(0).optional(),
  /** Guardar el finiquito. Sin esto sólo se devuelve la simulación. */
  guardar: z.boolean().optional(),
  /**
   * Al guardar, dar por saldados los préstamos y anticipos vigentes del
   * empleado: su saldo se descuenta en `deducciones` (Art. 372 C.T. permite
   * liquidar la deuda al terminar el contrato).
   */
  liquidarPrestamos: z.boolean().optional(),
});

// ─── GET: finiquitos emitidos ─────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("prestaciones.ver");
  if (!g.ok) return g.response;

  const { searchParams } = new URL(req.url);
  const empleadoId = searchParams.get("empleadoId") || undefined;

  const liquidaciones = await prisma.liquidacionFinal.findMany({
    where: { ...(empleadoId ? { empleadoId } : {}) },
    include: {
      empleado: {
        select: {
          codigo: true, identidad: true, primerNombre: true, segundoNombre: true,
          primerApellido: true, segundoApellido: true,
        },
      },
    },
    orderBy: { fechaSalida: "desc" },
    take: 100,
  });

  return NextResponse.json(liquidaciones);
}

// ─── POST: cálculo del finiquito ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("prestaciones.generar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schemaCalcular);
  if (!parsed.ok) return parsed.response;
  const {
    empleadoId, causa, fechaSalida, diasVacacionesGozados,
    preavisoOtorgado, salariosPendientes, otrosAdeudos, deducciones, guardar, liquidarPrestamos,
  } = parsed.data;

  const empleado = await prisma.empleado.findUnique({
    where: { id: empleadoId },
    select: { id: true, salarioBase: true, fechaIngreso: true, estado: true },
  });
  if (!empleado) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  if (fechaSalida < empleado.fechaIngreso) {
    return NextResponse.json(
      { error: "La fecha de salida no puede ser anterior a la de ingreso" },
      { status: 400 }
    );
  }

  // Un finiquito ya pagado no se recalcula en silencio.
  const yaPagada = await prisma.liquidacionFinal.findFirst({
    where: { empleadoId, estado: { in: ["APROBADA", "PAGADA"] } },
    select: { id: true, estado: true },
  });
  if (yaPagada && guardar) {
    return NextResponse.json(
      {
        error: `Este empleado ya tiene una liquidación ${yaPagada.estado}. Anúlela antes de recalcular.`,
        liquidacionId: yaPagada.id,
      },
      { status: 409 }
    );
  }

  // ─── Salario ordinario promedio de los últimos seis meses ──────────────────
  // Es la base legal de preaviso y cesantía. Tomar el último salario a secas
  // sobrevalora la liquidación de quien acaba de recibir un aumento.
  const periodos = await prisma.planillaDetalle.findMany({
    where: {
      empleadoId,
      planilla: { estado: { in: ["APROBADA", "PAGADA"] }, fechaFin: { lte: fechaSalida } },
    },
    orderBy: { planilla: { fechaFin: "desc" } },
    take: MESES_PROMEDIO_SALARIO,
    select: { totalBruto: true },
  });

  const promedio = salarioOrdinarioPromedio(periodos);
  // Sin planillas registradas —empleado reciente o migración— se cae al salario
  // base, que es el único dato disponible.
  const salarioPromedio = promedio.isZero() ? money(empleado.salarioBase) : promedio;

  // ─── Décimos proporcionales pendientes ─────────────────────────────────────
  const anio = fechaSalida.getUTCFullYear();
  const decimo13 = calcularDecimo({
    tipo: "DECIMO_TERCERO", anio,
    fechaIngreso: empleado.fechaIngreso, fechaSalida,
    salarioPromedio, hasta: fechaSalida,
  });
  const decimo14 = calcularDecimo({
    tipo: "DECIMO_CUARTO", anio,
    fechaIngreso: empleado.fechaIngreso, fechaSalida,
    salarioPromedio, hasta: fechaSalida,
  });

  // Lo ya liquidado del año no se paga dos veces.
  const yaLiquidados = await prisma.liquidacionDecimo.findMany({
    where: { empleadoId, anio, estado: { in: ["CALCULADA", "PAGADA"] } },
    select: { tipo: true, montoDevengado: true },
  });
  const pagado = (tipo: "DECIMO_TERCERO" | "DECIMO_CUARTO") =>
    money(yaLiquidados.find((l) => l.tipo === tipo)?.montoDevengado ?? 0);

  const pendiente13 = money(decimo13.montoDevengado).minus(pagado("DECIMO_TERCERO"));
  const pendiente14 = money(decimo14.montoDevengado).minus(pagado("DECIMO_CUARTO"));

  // ─── Vacaciones ya gozadas ─────────────────────────────────────────────────
  let gozados = diasVacacionesGozados;
  if (gozados === undefined) {
    const saldo = await prisma.saldoVacaciones.findUnique({
      where: { empleadoId },
      select: { diasTomados: true },
    });
    gozados = saldo ? Number(saldo.diasTomados) : 0;
  }

  // ─── Tamaño de la empresa ──────────────────────────────────────────────────
  // Hasta diez trabajadores: tope de cesantía reducido y sin 35 % por renuncia
  // (Art. 120-A). Es la razón por la que el formulario de la Secretaría de
  // Trabajo pregunta «Más de 10 Empleados».
  const totalActivos = await prisma.empleado.count({ where: { estado: "ACTIVO" } });
  const esMicroempresa = totalActivos <= MAX_EMPLEADOS_MICROEMPRESA;

  const resultado = calcularLiquidacion({
    fechaIngreso: empleado.fechaIngreso,
    fechaSalida,
    causa,
    salarioPromedio,
    esMicroempresa,
    diasVacacionesGozados: gozados,
    preavisoOtorgado,
    decimoTerceroDevengado: pendiente13.greaterThan(0) ? pendiente13 : CERO,
    decimoCuartoDevengado: pendiente14.greaterThan(0) ? pendiente14 : CERO,
    salariosPendientes,
    otrosAdeudos,
    deducciones,
  });

  // Préstamos y anticipos vigentes: se sugieren como deducción del finiquito.
  const deudasVigentes = await prisma.deduccionEmpleado.findMany({
    where: { empleadoId, activo: true, saldo: { gt: 0 }, tipoDeduccion: { tipo: { in: ["PRESTAMO", "ADELANTO"] } } },
    select: { id: true, saldo: true, tipoDeduccion: { select: { nombre: true } } },
  });
  const saldoDeduccionesPendientes = deudasVigentes.reduce((acc, d) => acc.plus(money(d.saldo ?? 0)), CERO);

  const importe = (prefijo: string) =>
    resultado.conceptos.find((c) => c.concepto.startsWith(prefijo))?.monto ?? CERO;

  const respuesta = {
    empleadoId,
    causa,
    fechaIngreso: empleado.fechaIngreso,
    fechaSalida,
    esMicroempresa,
    salarioPromedio: aNumero(salarioPromedio),
    salarioDiario: aNumero(resultado.salarioDiario),
    tiempoServicio: resultado.tiempoServicio,
    conceptos: resultado.conceptos.map((c) => ({ ...c, monto: aNumero(c.monto) })),
    totalPrestaciones: aNumero(resultado.totalPrestaciones),
    deducciones: aNumero(resultado.deducciones),
    totalAPagar: aNumero(resultado.totalAPagar),
    observaciones: resultado.observaciones,
    saldoDeduccionesPendientes: aNumero(saldoDeduccionesPendientes),
    deudasVigentes: deudasVigentes.map((d) => ({ id: d.id, nombre: d.tipoDeduccion.nombre, saldo: aNumero(d.saldo ?? 0) })),
  };

  if (!guardar) {
    // Simulación: es lo que la interfaz muestra antes de confirmar.
    return NextResponse.json({ ...respuesta, guardada: false });
  }

  const liquidacion = await prisma.$transaction(async (tx) => {
    const creada = await tx.liquidacionFinal.create({
      data: {
        empleadoId,
        causa,
        fechaIngreso: empleado.fechaIngreso,
        fechaSalida,
        esMicroempresa,
        salarioPromedio,
        salarioDiario: resultado.salarioDiario,
        diasServicio: resultado.tiempoServicio.dias,
        mesesServicio: resultado.tiempoServicio.mesesCompletos,
        aniosServicio: resultado.tiempoServicio.aniosCompletos,
        preaviso: importe("Preaviso"),
        auxilioCesantia: importe("Auxilio de cesantía"),
        vacaciones: importe("Vacaciones no gozadas"),
        decimoTercero: importe("Décimo tercer"),
        decimoCuarto: importe("Décimo cuarto"),
        salariosPendientes: importe("Salarios pendientes"),
        otrosAdeudos: importe("Otros adeudos"),
        totalPrestaciones: resultado.totalPrestaciones,
        deducciones: resultado.deducciones,
        totalAPagar: resultado.totalAPagar,
        // El desglose se congela: el finiquito debe poder reproducirse aunque
        // después cambien las tablas legales o el salario del puesto.
        conceptos: JSON.parse(JSON.stringify(respuesta.conceptos)),
        observaciones: resultado.observaciones.join("\n") || null,
        calculadoPor: g.usuario.id,
      },
    });

    // Préstamos saldados con el finiquito: dejan de descontarse.
    if (liquidarPrestamos && deudasVigentes.length > 0) {
      await tx.deduccionEmpleado.updateMany({
        where: { id: { in: deudasVigentes.map((d) => d.id) } },
        data: { saldo: 0, activo: false, observacion: `Saldada en la liquidación final ${creada.id}` },
      });
    }

    // La liquidación cierra la relación laboral: el empleado queda inactivo y
    // deja de entrar en las planillas siguientes.
    await tx.empleado.update({
      where: { id: empleadoId },
      data: { estado: "INACTIVO", fechaSalida },
    });

    return creada;
  }, { timeout: 30000 });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "LiquidacionFinal",
    registroId: liquidacion.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      empleadoId, causa, fechaSalida, esMicroempresa,
      salarioPromedio: aNumero(salarioPromedio),
      totalPrestaciones: respuesta.totalPrestaciones,
      totalAPagar: respuesta.totalAPagar,
    },
    ip,
    userAgent,
  });

  return NextResponse.json({ ...respuesta, id: liquidacion.id, guardada: true }, { status: 201 });
}
