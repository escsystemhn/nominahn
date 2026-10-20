import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  calcularPlanilla,
  diasConDerechoASalario,
  totalHorasExtra,
  type HorasExtraPorJornada,
} from "@/lib/payroll/calculos-hn";
import { requerirPermiso } from "@/lib/auth/guard";
import { descuentoIncapacidades, fechasCubiertas, type IncapacidadParaPlanilla } from "@/lib/asistencia/incapacidades";
import { audit, getClientInfo } from "@/lib/audit";
import { CERO, sumar, type Money } from "@/lib/payroll/money";
import {
  aplicarDeducciones,
  registrosDeAmortizacion,
  type Amortizacion,
} from "@/lib/payroll/deducciones";
import {
  validarTransicion,
  ESTADOS_OCUPAN_PERIODO,
  type EstadoPlanilla,
} from "@/lib/payroll/estado-planilla";
import { Prisma, TipoPlanilla } from "@prisma/client";
import { calcularAniosTrabajados } from "@/lib/utils";
import { calcularBonosPorLote } from "@/lib/evaluaciones/bonus-engine";
import { z } from "zod";
import { parsearBody, zId, zFecha } from "@/lib/http/validar";
import { cargarParametrosLegales } from "@/lib/payroll/parametros-bd";

const schemaCrear = z
  .object({
    tipo: z.enum(TipoPlanilla),
    fechaInicio: zFecha,
    fechaFin: zFecha,
    empresaId: zId,
    sucursalId: zId.optional().nullable(),
  })
  .refine((d) => d.fechaFin > d.fechaInicio, {
    error: "La fecha fin debe ser posterior a la fecha inicio",
    path: ["fechaFin"],
  });

export async function GET() {
  // Una planilla lleva los totales de nómina de la empresa: no es información
  // que corresponda a cualquier usuario con sesión.
  const g = await requerirPermiso("planillas.ver");
  if (!g.ok) return g.response;

  const planillas = await prisma.planilla.findMany({
    include: { empresa: { select: { nombre: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(planillas);
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("planillas.calcular");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schemaCrear);
  if (!parsed.ok) return parsed.response;
  const { tipo, fechaInicio: desde, fechaFin: hasta, empresaId, sucursalId } = parsed.data;

  const diasMes = tipo === "MENSUAL" ? 30 : tipo === "QUINCENAL" ? 15 : 7;

  // `null` = planilla de toda la empresa. El formulario manda "" cuando no se
  // elige sucursal; normalizarlo aquí evita guardar una cadena vacía como FK.
  const sucursal: string | null = sucursalId || null;

  // La planilla nace en BORRADOR y pasa a CALCULADA por la máquina de estados,
  // no por asignación directa. Se valida ANTES de calcular para no gastar el
  // trabajo pesado en una petición que va a rechazarse por rol.
  const transicion = validarTransicion("BORRADOR", "CALCULADA", g.usuario.permisos);
  if (!transicion.ok) {
    return NextResponse.json({ error: transicion.error }, { status: transicion.status });
  }

  // ─── Unicidad del período ───────────────────────────────────────────────────
  // Una planilla ANULADA no ocupa su período: el flujo de corrección es anular y
  // reemitir. El índice único parcial en BD replica esta misma condición y cubre
  // la carrera entre dos peticiones simultáneas.
  const yaExiste = await prisma.planilla.findFirst({
    where: {
      empresaId,
      sucursalId: sucursal,
      tipo,
      fechaInicio: desde,
      fechaFin: hasta,
      estado: { in: [...ESTADOS_OCUPAN_PERIODO] as EstadoPlanilla[] },
    },
    select: { id: true, estado: true },
  });
  if (yaExiste) {
    return NextResponse.json(
      {
        error: `Ya existe una planilla ${yaExiste.estado} para este período y sucursal. ` +
          `Anúlala antes de volver a calcularla.`,
        planillaId: yaExiste.id,
      },
      { status: 409 }
    );
  }

  // Obtener empleados activos con sus deducciones.
  // Se incluye a quien causó baja DENTRO del período: le corresponde el
  // proporcional de los días que sí trabajó. Excluirlo dejaba sin pagar el
  // último tramo de la relación laboral.
  const empleados = await prisma.empleado.findMany({
    where: {
      tipoPlanilla: tipo,
      ...(sucursal ? { sucursalId: sucursal } : {}),
      // Debe haber ingresado a más tardar al cierre del período.
      fechaIngreso: { lte: hasta },
      OR: [
        { estado: "ACTIVO" },
        // Baja ocurrida dentro del período: cobra sus días.
        { fechaSalida: { gte: desde, lte: hasta } },
      ],
    },
    include: {
      deducciones: {
        // Sólo las deducciones VIGENTES en el período: una que aún no arranca o
        // que ya venció no puede descontarse del salario (Art. 371 C.T.).
        where: {
          activo: true,
          fechaInicio: { lte: hasta },
          OR: [{ fechaFin: null }, { fechaFin: { gte: desde } }],
        },
        include: { tipoDeduccion: true },
      },
    },
  });

  if (empleados.length === 0) {
    return NextResponse.json({ error: "No hay empleados activos para esta planilla" }, { status: 400 });
  }

  // La AFP ya NO se resuelve aquí: es voluntaria e individual y viaja como
  // `DeduccionEmpleado` de tipo AFP, igual que la cooperativa. La búsqueda
  // global por `codigo: "AFP"` nunca encontraba nada —la fila configurada es
  // "AFP-ATL"— así que la deducción valía cero para toda la plantilla.

  // ─── Parámetros legales vigentes ───────────────────────────────────────────
  // Tasas o montos fijos de IHSS, IVM, RAP e INFOP, tablas de ISR y vecinal y
  // jornada. Un solo cargador compartido con los reportes: si cada uno leyera
  // por su cuenta, el reporte al IHSS podría decir otra cifra que la planilla.
  const parametros = await cargarParametrosLegales();

  // ─── FASE 1: lecturas y cálculo en memoria (sin N+1) ────────────────────────
  const empleadoIds = empleados.map((e) => e.id);

  // Pre-cargar TODOS los marcajes del período en una sola consulta, ya con el
  // desglose por jornada: cada tramo lleva su propio recargo (Art. 330) y sin
  // esta separación todas las horas extra se liquidaban como diurnas.
  const marcajes = await prisma.marcaje.findMany({
    where: { empleadoId: { in: empleadoIds }, fecha: { gte: desde, lte: hasta } },
    select: {
      empleadoId: true,
      fecha: true,
      esAusencia: true,
      horasExtra: true,
      horasExtraDiurna: true,
      horasExtraMixta: true,
      horasExtraNocturna: true,
      horasFeriado: true,
    },
  });

  // Incapacidades del IHSS que tocan el período. Un día cubierto por una
  // incapacidad NO es una ausencia aunque el reloj lo marque así: descontarlo
  // dos veces sería quitarle al trabajador un salario que nadie le debe.
  const incapacidades = await prisma.incapacidad.findMany({
    where: { empleadoId: { in: empleadoIds }, anulada: false, fechaInicio: { lte: hasta }, fechaFin: { gte: desde } },
    select: { empleadoId: true, fechaInicio: true, fechaFin: true, diasPatrono: true, porcentajeComplemento: true },
  });
  const incapacidadesPorEmp = new Map<string, IncapacidadParaPlanilla[]>();
  const fechasIncapacidad = new Set<string>();
  for (const inc of incapacidades) {
    const lista = incapacidadesPorEmp.get(inc.empleadoId) ?? [];
    lista.push({ ...inc, porcentajeComplemento: Number(inc.porcentajeComplemento) });
    incapacidadesPorEmp.set(inc.empleadoId, lista);
    for (const t of fechasCubiertas(inc, desde, hasta)) fechasIncapacidad.add(`${inc.empleadoId}|${t}`);
  }

  const ausenciasPorEmp = new Map<string, number>();
  const extraPorEmp = new Map<string, HorasExtraPorJornada>();

  for (const m of marcajes) {
    if (m.esAusencia && !fechasIncapacidad.has(`${m.empleadoId}|${m.fecha.getTime()}`)) {
      ausenciasPorEmp.set(m.empleadoId, (ausenciasPorEmp.get(m.empleadoId) ?? 0) + 1);
    }

    const acc = extraPorEmp.get(m.empleadoId) ?? { diurnas: 0, mixtas: 0, nocturnas: 0, feriado: 0 };
    const diurnas = Number(m.horasExtraDiurna);
    const mixtas = Number(m.horasExtraMixta);
    const nocturnas = Number(m.horasExtraNocturna);
    const feriado = Number(m.horasFeriado);

    // Marcajes anteriores al desglose (o importados del biométrico) sólo traen
    // el total: se imputan a jornada diurna, que es el criterio conservador y el
    // comportamiento que ya tenían.
    const desglosado = diurnas + mixtas + nocturnas + feriado;
    if (desglosado === 0 && Number(m.horasExtra) > 0) {
      acc.diurnas = (acc.diurnas ?? 0) + Number(m.horasExtra);
    } else {
      acc.diurnas = (acc.diurnas ?? 0) + diurnas;
      acc.mixtas = (acc.mixtas ?? 0) + mixtas;
      acc.nocturnas = (acc.nocturnas ?? 0) + nocturnas;
      acc.feriado = (acc.feriado ?? 0) + feriado;
    }
    extraPorEmp.set(m.empleadoId, acc);
  }

  // Bonos de evaluación de TODA la plantilla, en dos consultas. Antes se
  // resolvía dentro del bucle: hasta seis consultas secuenciales por empleado.
  const bonos = await calcularBonosPorLote(
    empleados.map((e) => ({ id: e.id, salarioBase: e.salarioBase }))
  );

  // Sin `planillaId`: se añade más abajo, cuando ya existe la planilla creada.
  const detallesData: Omit<Prisma.PlanillaDetalleCreateManyInput, "planillaId">[] = [];
  const bonosToMark: { evaluacionId: string; bonoMonto: Money; bonoPorcentaje: number }[] = [];
  /**
   * Amortización de deducciones a plazo (préstamos, adelantos y cualquier otra
   * con cuotas o saldo). Se acumula en memoria y se aplica dentro de la misma
   * transacción que crea la planilla, para que el descuento y su amortización
   * sean atómicos: nunca se cobra una cuota sin registrarla.
   *
   * Cada cobro deja además una fila en `AmortizacionPlanilla` con el importe
   * aplicado. Eso es lo que permite DESHACERLO al anular la planilla: el flujo
   * de corrección del sistema es anular y reemitir, y sin ese registro las
   * cuotas volvían a consumirse en el recálculo y el préstamo del trabajador se
   * amortizaba de más.
   */
  const amortizaciones: Amortizacion[] = [];
  // Totales en Decimal exacto: acumular 200 importes con `+=` sobre float
  // arrastra centavos y descuadra contra la suma de los detalles en BD.
  let totalBruto = CERO, totalDeducciones = CERO, totalNeto = CERO, totalEmpleador = CERO;

  for (const emp of empleados) {
    // El salario viaja como Decimal desde Prisma hasta el motor, sin Number().
    const salario = emp.salarioBase;
    const anios = calcularAniosTrabajados(emp.fechaIngreso);
    const diasAusentes = ausenciasPorEmp.get(emp.id) ?? 0;
    const horasExtra = extraPorEmp.get(emp.id) ?? {};

    // Días CON DERECHO A SALARIO. Antes se pasaba `diasMes` fijo, de modo que
    // un empleado contratado a mitad de período cobraba el período completo.
    const diasPagables = diasConDerechoASalario({
      fechaIngreso: emp.fechaIngreso,
      fechaSalida: emp.fechaSalida,
      desde,
      hasta,
      diasMes,
    });
    // Nadie con cero días entra en la planilla: generaría una línea en blanco.
    if (diasPagables <= 0) continue;

    const ded = aplicarDeducciones(
      emp.deducciones.map((d) => ({
        id: d.id,
        monto: d.monto,
        saldo: d.saldo,
        cuotasMeses: d.cuotasMeses,
        cuotasPagadas: d.cuotasPagadas,
        tipo: d.tipoDeduccion.tipo,
      }))
    );
    amortizaciones.push(...ded.amortizaciones);

    // Lectura de memoria: ninguna consulta dentro del bucle.
    const bonoEval = bonos.get(emp.id);
    const bonificaciones = bonoEval ? bonoEval.bonoMonto : CERO;
    if (bonoEval) {
      bonosToMark.push({
        evaluacionId: bonoEval.evaluacionId,
        bonoMonto: bonoEval.bonoMonto,
        bonoPorcentaje: bonoEval.bonoPorcentaje,
      });
    }

    // Días a cargo del IHSS en el período: el patrono no los paga (salvo el
    // complemento de maternidad); el IHSS paga el subsidio al trabajador.
    const inc = descuentoIncapacidades(Number(salario), incapacidadesPorEmp.get(emp.id) ?? [], desde, hasta);

    const result = calcularPlanilla({
      salarioMensual: salario,
      tipoPlanilla: tipo as "SEMANAL" | "QUINCENAL" | "MENSUAL",
      // Días con derecho a salario. NO restar ausencias: el motor las descuenta
      // en su propia línea (`result.ausencias`); restarlas aquí duplicaría.
      diasPagables,
      diasMes,
      horasExtra,
      bonificaciones,
      otrosIngresos: 0,
      diasAusentes,
      incapacidad: inc.descuento,
      otrosDeducciones: ded.total,
      // Importe real de la deducción AFP del empleado, no un porcentaje global.
      afpEmpleado: ded.afp,
      aniosTrabajados: anios,
      // IHSS mensual pactado en la ficha; null = por porcentaje.
      ihssMontoFijoMensual: emp.ihssMontoFijo,
    }, parametros);

    detallesData.push({
      empleadoId: emp.id,
      salarioBase: result.salarioBase,
      // Informativo para la boleta: días efectivamente laborados. El descuento
      // por ausencia NO se deriva de este campo, viaja en `ausencias`.
      diasTrabajados: Math.max(0, diasPagables - diasAusentes - inc.diasIhss),
      horasExtra: totalHorasExtra(horasExtra),
      montoHorasExtra: result.montoHorasExtra,
      bonificaciones,
      totalBruto: result.totalBruto,
      ihssEmpleado: result.ihssEmpleado,
      rapEmpleado: result.rapEmpleado,
      // Viene de la deducción individual, no de un porcentaje de planilla.
      afpEmpleado: result.afpEmpleado,
      isr: result.isr,
      impuestoVecinal: result.impuestoVecinal,
      cooperativa: ded.cooperativa,
      prestamos: ded.prestamos,
      adelantos: ded.adelantos,
      ausencias: result.ausencias,
      diasIncapacidadIhss: inc.diasIhss,
      incapacidad: result.incapacidad,
      otrosDeducciones: ded.otros,
      totalDeducciones: result.totalDeducciones,
      ihssEmpleador: result.ihssEmpleador,
      rapEmpleador: result.rapEmpleador,
      infop: result.infop,
      reservaLaboral: result.reservaLaboral,
      ivmEmpleado: result.ivmEmpleado,
      ivmEmpleador: result.ivmEmpleador,
      ivmEstado: result.ivmEstado,
      ihssFijo: result.ihssFijo,
      salarioNeto: result.salarioNeto,
      provision13vo: result.provision13vo,
      provision14vo: result.provision14vo,
      provisionVacaciones: result.provisionVacaciones,
    });

    totalBruto = totalBruto.plus(result.totalBruto);
    totalDeducciones = totalDeducciones.plus(result.totalDeducciones);
    totalNeto = totalNeto.plus(result.salarioNeto);
    totalEmpleador = totalEmpleador.plus(
      sumar(result.ihssEmpleador, result.rapEmpleador, result.infop, result.reservaLaboral)
    );
  }

  // ─── FASE 2: escrituras atómicas ────────────────────────────────────────────
  let planillaId: string;
  try {
    planillaId = await prisma.$transaction(async (tx) => {
      // Nace en BORRADOR: mientras se insertan los detalles la planilla aún no
      // está calculada, y los triggers de inmutabilidad admiten la escritura.
      const planilla = await tx.planilla.create({
        data: { empresaId, sucursalId: sucursal, tipo, estado: "BORRADOR",
          fechaInicio: desde, fechaFin: hasta,
          totalBruto, totalDeducciones, totalNeto, totalEmpleador },
      });
      await tx.planillaDetalle.createMany({
        data: detallesData.map((d) => ({ ...d, planillaId: planilla.id })),
      });

      // Amortizar las deducciones a plazo efectivamente cobradas en esta
      // planilla. Una sola sentencia en vez de N UPDATE secuenciales: con la
      // transacción abierta, cada viaje extra a la base consume el presupuesto
      // de 30 s y alarga los bloqueos.
      if (amortizaciones.length > 0) {
        await tx.$executeRaw`
          UPDATE "DeduccionEmpleado" d
             SET "cuotasPagadas" = v.cuotas,
                 "saldo"         = COALESCE(v.saldo, d."saldo"),
                 "activo"        = CASE WHEN v.desactivar THEN false ELSE d."activo" END,
                 "updatedAt"     = NOW()
            FROM (SELECT * FROM UNNEST(
                    ${amortizaciones.map((a) => a.id)}::text[],
                    ${amortizaciones.map((a) => a.cuotasPagadas)}::int[],
                    ${amortizaciones.map((a) => (a.saldo ? a.saldo.toFixed(2) : null))}::numeric[],
                    ${amortizaciones.map((a) => a.desactivar)}::boolean[]
                  ) AS t(id, cuotas, saldo, desactivar)) v
           WHERE d."id" = v.id`;
      }

      // Registro de lo cobrado, para poder devolverlo si la planilla se anula.
      if (amortizaciones.length > 0) {
        await tx.amortizacionPlanilla.createMany({
          data: registrosDeAmortizacion(amortizaciones).map((r) => ({
            planillaId: planilla.id,
            deduccionId: r.deduccionId,
            montoAplicado: r.montoAplicado,
            llevaSaldo: r.llevaSaldo,
            desactivo: r.desactivo,
          })),
        });
      }

      if (bonosToMark.length > 0) {
        await tx.$executeRaw`
          UPDATE "Evaluacion" e
             SET "bonoAplicado"   = true,
                 "bonoMonto"      = v.monto,
                 "bonoPorcentaje" = v.porcentaje,
                 "updatedAt"      = NOW()
            FROM (SELECT * FROM UNNEST(
                    ${bonosToMark.map((b) => b.evaluacionId)}::text[],
                    ${bonosToMark.map((b) => b.bonoMonto.toFixed(2))}::numeric[],
                    ${bonosToMark.map((b) => b.bonoPorcentaje)}::numeric[]
                  ) AS t(id, monto, porcentaje)) v
           WHERE e."id" = v.id`;
      }

      // Ya con los detalles escritos, la planilla queda CALCULADA.
      await tx.planilla.update({ where: { id: planilla.id }, data: { estado: "CALCULADA" } });

      return planilla.id;
    }, { timeout: 30000 });
  } catch (e) {
    // Carrera perdida contra otra petición simultánea: el índice único parcial
    // rechazó el duplicado que la verificación previa no llegó a ver.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Otra planilla para este período y sucursal acaba de crearse. Recarga la lista." },
        { status: 409 }
      );
    }
    throw e;
  }

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "Planilla",
    registroId: planillaId,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      tipo, empresaId, sucursalId: sucursal,
      fechaInicio: desde, fechaFin: hasta,
      empleados: detallesData.length,
      totalBruto, totalDeducciones, totalNeto, totalEmpleador,
    },
    ip,
    userAgent,
  });

  const planillaFinal = await prisma.planilla.findUnique({
    where: { id: planillaId },
    include: { detalles: { include: { empleado: true } } },
  });

  return NextResponse.json(planillaFinal, { status: 201 });
}
