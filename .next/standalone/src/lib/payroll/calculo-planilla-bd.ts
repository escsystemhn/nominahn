/**
 * Calcular una planilla contra la base y escribir el resultado.
 *
 * Una planilla nace en BORRADOR: calcular no cobra nada. Los cobros (cuotas de
 * préstamos, bonos de evaluación) se aplican recién al confirmarla, para que revisar
 * y recalcular un borrador no toque el saldo de nadie.
 *
 *   generar   → calcularLineas + escribirLineas
 *   recalcular→ calcularLineas + escribirLineas
 *   confirmar → calcularLineas + escribirLineas + aplicarCobros
 *   volver a borrador o anular → devolverCobros
 */

import type { EstadoPlanilla as EstadoPlanillaBd, Prisma, TipoPlanilla } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  calcularPlanilla,
  calcularRAP,
  diasConDerechoASalario,
  totalHorasExtra,
  type EntradaCalculoPlanilla,
  type HorasExtraPorJornada,
} from "./calculos-hn";
import {
  calcularIsrPersonalizado,
  indicePeriodoDelAnio,
  type DetalleIsrPersonalizado,
  type PeriodoPagadoIsr,
} from "./isr-personalizado";
import { cargarHistorialIsr, leerConfigIsr } from "./isr-personalizado-bd";
import { CODIGO_VECINAL, leerCobroVecinal } from "./vecinal-anual";
import { resumirDeducciones } from "./deducciones-de-linea";
import { descuentoIncapacidades, fechasCubiertas, type IncapacidadParaPlanilla } from "@/lib/asistencia/incapacidades";
import { resolutorTurnos } from "@/lib/asistencia/tardanzas";
import { calcularDeduccionesAsistencia, lunesDe } from "@/lib/asistencia/deducciones/motor";
import { incidenciasDelPeriodo, perfilDesdeTurno, type MarcaParaAsistencia } from "@/lib/asistencia/deducciones/incidencias";
import { leerPoliticaAsistencia } from "@/lib/asistencia/deducciones/politica-bd";
import { CERO, money, sumar, type Money } from "./money";
import { horasDelPeriodo, sumarMarcajes } from "./horas-extra-periodo";
import { cargarHorasFijadas } from "./horas-extra-periodo-bd";
import { aplicarDeducciones, CODIGO_ISR_FIJO, conMontosDelPeriodo, cuotaDelPeriodo, esMontoDelPeriodo, registrosDeAmortizacion, topesDelPeriodo, type Amortizacion } from "./deducciones";
import { numeroDeQuincena, otraQuincena } from "./distribucion-quincenal";
import { mesDe, reglaDelMes } from "./rap-mes-vencido";
import { basesDelMesVencido, conRapEnLiquidacion, leerBaseRap } from "./rap-mes-vencido-bd";

/** Art. 371: sin salario mínimo configurado, lo inembargable literal son los primeros L 100 del mes. */
const MINIMO_INEMBARGABLE_LITERAL = 100;
import { ESTADOS_OCUPAN_PERIODO } from "./estado-planilla";
import { calcularAniosTrabajados, nombreCompleto, formatDate } from "@/lib/utils";
import { calcularBonosPorLote } from "@/lib/evaluaciones/bonus-engine";
import { cargarParametrosLegales } from "./parametros-bd";
import { filtroCobraEnPeriodo } from "./elegibles";
import { filtroEmpleadosOrg, type AlcanceOrg } from "@/lib/organizacion/estructura";

export interface PlanillaPorCalcular extends AlcanceOrg {
  tipo: TipoPlanilla;
  empresaId: string;
  fechaInicio: Date;
  fechaFin: Date;
  /** Al recalcular un borrador: no debe chocar contra sí mismo. */
  id?: string;
}

/** Línea ya calculada. `planillaId` se añade al escribirla. */
export type LineaCalculada = Omit<Prisma.PlanillaDetalleCreateManyInput, "planillaId"> & {
  totalBruto: Money;
  totalDeducciones: Money;
  salarioNeto: Money;
};

export interface CalculoPlanilla {
  detalles: LineaCalculada[];
  amortizaciones: Amortizacion[];
  bonos: { evaluacionId: string; bonoMonto: Money; bonoPorcentaje: number }[];
  totales: { totalBruto: Money; totalDeducciones: Money; totalNeto: Money; totalEmpleador: Money };
  metodoIsr: string;
}

export type ResultadoCalculo =
  | ({ ok: true } & CalculoPlanilla)
  | { ok: false; status: number; cuerpo: { error: string } & Record<string, unknown> };

export async function calcularLineas(p: PlanillaPorCalcular): Promise<ResultadoCalculo> {
  const { tipo, empresaId, fechaInicio: desde, fechaFin: hasta } = p;
  const diasMes = tipo === "MENSUAL" ? 30 : tipo === "QUINCENAL" ? 15 : 7;

  // Obtener a quienes cobran en este período, con sus deducciones (ver
  // `filtroCobraEnPeriodo`: incluye vacaciones, permiso y la baja de este período).
  const empleados = await prisma.empleado.findMany({
    where: {
      AND: [
        {
          tipoPlanilla: tipo,
          // Sólo personal de ESTA empresa: sin este filtro, una planilla de toda
          // la empresa tomaba también a los empleados de las demás.
          sucursal: { empresaId },
          // Debe haber ingresado a más tardar al cierre del período.
          fechaIngreso: { lte: hasta },
          ...filtroCobraEnPeriodo(desde),
        },
        filtroEmpleadosOrg(p),
      ],
    },
    include: {
      // Para guardar en la línea dónde estaba la persona al pagarse.
      departamento: { select: { divisionId: true } },
      puesto: { select: { nombre: true } },
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
    return { ok: false, status: 400, cuerpo: { error: "No hay empleados activos para esta planilla" } };
  }

  // ─── Nadie cobra dos veces el mismo día ─────────────────────────────────────
  // La unicidad de arriba sólo compara planillas del MISMO alcance. Una de toda
  // la sucursal y otra de una de sus divisiones, o dos de tipos distintos tras
  // un cambio de tipo de planilla, tienen claves distintas y pagarían dos veces
  // a las mismas personas. Por eso se mira a la persona, no a la planilla.
  const yaPagados = await prisma.planillaDetalle.findMany({
    where: {
      empleadoId: { in: empleados.map((e) => e.id) },
      planilla: {
        ...(p.id ? { id: { not: p.id } } : {}),
        empresaId,
        estado: { in: [...ESTADOS_OCUPAN_PERIODO] as EstadoPlanillaBd[] },
        fechaInicio: { lte: hasta },
        fechaFin: { gte: desde },
      },
    },
    select: {
      empleado: { select: { primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true } },
      planilla: { select: { id: true, estado: true, fechaInicio: true, fechaFin: true } },
    },
    take: 200,
  });
  if (yaPagados.length > 0) {
    const planillas = [...new Map(yaPagados.map((x) => [x.planilla.id, x.planilla])).values()];
    const nombres = yaPagados.slice(0, 5).map((x) => nombreCompleto(x.empleado));
    const resto = yaPagados.length > 5 ? ` y ${yaPagados.length - 5} más` : "";
    const otra = planillas[0];
    return {
      ok: false,
      status: 409,
      cuerpo: {
        error: `${yaPagados.length} persona(s) de este alcance ya están en otra planilla vigente que cubre parte de estas fechas ` +
          `(${formatDate(otra.fechaInicio)} a ${formatDate(otra.fechaFin)}, ${otra.estado.toLowerCase()}): ${nombres.join(", ")}${resto}. ` +
          "Elija un alcance que no las incluya o anule esa planilla antes de volver a calcular.",
        planillaId: otra.id,
        planillasEnConflicto: planillas.map((x) => x.id),
      },
    };
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

  // ─── Lecturas y cálculo en memoria (sin N+1) ────────────────────────────────
  const empleadoIds = empleados.map((e) => e.id);

  // Método del ISR. El CÁLCULO PERSONALIZADO (Parámetros de ley) proyecta el año
  // con lo pagado y lo retenido antes de este período, como la hoja de retención
  // del cliente; necesita ese historial, que se lee una sola vez para todos.
  const configIsr = await leerConfigIsr(prisma);
  // ISR MANUAL: no se calcula; se retiene lo importado para el período o lo fijo de la ficha.
  const isrManual = configIsr.modo === "MANUAL";
  // Vecinal: con el cobro ANUAL no se calcula; se descuenta sólo lo confirmado para el período.
  const cobroVecinal = await leerCobroVecinal(prisma);
  const isrPersonalizado = !isrManual && configIsr.metodo === "PERSONALIZADO";
  const periodoIsr = indicePeriodoDelAnio(tipo as "SEMANAL" | "QUINCENAL" | "MENSUAL", hasta);
  const historialIsr = isrPersonalizado
    ? await cargarHistorialIsr(prisma, empleadoIds, hasta.getUTCFullYear(), desde)
    : new Map<string, PeriodoPagadoIsr[]>();

  // Pre-cargar TODOS los marcajes del período en una sola consulta, ya con el
  // desglose por jornada: cada tramo lleva su propio recargo (Art. 330) y sin
  // esta separación todas las horas extra se liquidaban como diurnas.
  const marcajes = await prisma.marcaje.findMany({
    where: { empleadoId: { in: empleadoIds }, fecha: { gte: desde, lte: hasta } },
    select: {
      empleadoId: true,
      fecha: true,
      esAusencia: true,
      horaEntrada: true,
      horaSalida: true,
      horasNormales: true,
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
    select: { empleadoId: true, fechaInicio: true, fechaFin: true, diasPatrono: true, porcentajeSubsidio: true },
  });
  const incapacidadesPorEmp = new Map<string, IncapacidadParaPlanilla[]>();
  for (const inc of incapacidades) {
    const lista = incapacidadesPorEmp.get(inc.empleadoId) ?? [];
    lista.push({ ...inc, porcentajeSubsidio: Number(inc.porcentajeSubsidio) });
    incapacidadesPorEmp.set(inc.empleadoId, lista);
  }

  // ─── Deducciones por asistencia (lib/asistencia/deducciones) ───────────────
  // Una política para toda la instalación. Sin guardar, rige la de omisión, que descuenta
  // igual que antes: día + séptimo por semana, sin llegadas tarde.
  const { politica: politicaAsistencia } = await leerPoliticaAsistencia(prisma);
  const texto = (d: Date) => d.toISOString().slice(0, 10);
  const lunesDelPeriodo = lunesDe(texto(desde));
  const MS_DIA = 86_400_000;
  const [turnoDe, permisosAprobados, feriadosCercanos, ausenciasPrevias] = await Promise.all([
    resolutorTurnos(empleadoIds, desde, hasta),
    prisma.permiso.findMany({
      where: { empleadoId: { in: empleadoIds }, estado: "APROBADO", fechaInicio: { lte: hasta }, fechaFin: { gte: desde } },
      select: { empleadoId: true, tipo: true, fechaInicio: true, fechaFin: true, diasAprobados: true, diasSolicitados: true },
    }),
    // Una semana a cada lado: la falta junto a un feriado puede caer fuera del período.
    prisma.feriado.findMany({
      where: { activo: true, fecha: { gte: new Date(desde.getTime() - 7 * MS_DIA), lte: new Date(hasta.getTime() + 7 * MS_DIA) } },
      select: { fecha: true, sucursalId: true },
    }),
    // Faltas de la misma semana ANTES del período: su séptimo ya lo descontó el anterior.
    lunesDelPeriodo < texto(desde)
      ? prisma.marcaje.findMany({
          where: { empleadoId: { in: empleadoIds }, esAusencia: true, fecha: { gte: new Date(`${lunesDelPeriodo}T00:00:00Z`), lt: desde } },
          select: { empleadoId: true },
        })
      : Promise.resolve([] as { empleadoId: string }[]),
  ]);
  const conSeptimoPrevio = new Set(ausenciasPrevias.map((a) => a.empleadoId));
  const marcasPorEmp = new Map<string, MarcaParaAsistencia[]>();
  for (const m of marcajes) {
    const lista = marcasPorEmp.get(m.empleadoId) ?? [];
    lista.push({ fecha: texto(m.fecha), esAusencia: m.esAusencia, horaEntrada: m.horaEntrada, horaSalida: m.horaSalida, horasNormales: Number(m.horasNormales) });
    marcasPorEmp.set(m.empleadoId, lista);
  }
  const fechasIncapacidadPorEmp = new Map<string, Set<string>>();
  for (const inc of incapacidades) {
    const s = fechasIncapacidadPorEmp.get(inc.empleadoId) ?? new Set<string>();
    for (const t of fechasCubiertas(inc, desde, hasta)) s.add(texto(new Date(t)));
    fechasIncapacidadPorEmp.set(inc.empleadoId, s);
  }

  // Salario mínimo vigente: lo inembargable para el tope de deducciones (Art. 371).
  const salarioMinimo = await prisma.salarioMinimo.findFirst({
    where: { activo: true },
    orderBy: { anio: "desc" },
    select: { monto: true },
  });
  const minimoMensual = salarioMinimo ? money(salarioMinimo.monto) : money(MINIMO_INEMBARGABLE_LITERAL);
  const factorPeriodo = tipo === "SEMANAL" ? money(12).div(52) : tipo === "QUINCENAL" ? money(0.5) : money(1);
  // Mes de la quincena (para los aportes que se deducen completos en una sola).
  const numeroQuincena = numeroDeQuincena(desde);
  const laOtra = otraQuincena(desde);
  const inicioMes = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), 1));
  const finMes = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth() + 1, 0));

  // RAP y Reserva a mes vencido (Parámetros de ley): la base de este mes es lo
  // devengado el anterior. Sin la opción no se toca la tabla de bases.
  const reglaRap = reglaDelMes(await leerBaseRap(prisma), mesDe(desde));
  const basesRap = reglaRap === "EN_CURSO" ? null : await basesDelMesVencido(prisma, empleadoIds, mesDe(desde), reglaRap);
  // Quien ya tiene liquidación de este mes con su RAP pendiente: lo cotizó ahí.
  const rapEnLiquidacion = basesRap ? await conRapEnLiquidacion(prisma, empleadoIds, mesDe(desde)) : new Set<string>();

  // Las ausencias ya no se cuentan aquí: las clasifica y descuenta el motor de asistencia.
  // Horas extra por recargo: lo que suman los marcajes y, encima, lo fijado para el período
  // en el formato de captura (cada recargo con valor reemplaza al de los marcajes).
  const marcajesPorEmp = new Map<string, (typeof marcajes)[number][]>();
  for (const m of marcajes) {
    const lista = marcajesPorEmp.get(m.empleadoId) ?? [];
    lista.push(m);
    marcajesPorEmp.set(m.empleadoId, lista);
  }
  const horasFijadas = await cargarHorasFijadas(prisma, empleadoIds, desde, hasta);
  const extraPorEmp = new Map<string, HorasExtraPorJornada>();
  for (const id of new Set([...marcajesPorEmp.keys(), ...horasFijadas.keys()])) {
    extraPorEmp.set(id, horasDelPeriodo(sumarMarcajes(marcajesPorEmp.get(id) ?? []), horasFijadas.get(id)));
  }

  // Bonos de evaluación de TODA la plantilla, en dos consultas. Antes se
  // resolvía dentro del bucle: hasta seis consultas secuenciales por empleado.
  const bonos = await calcularBonosPorLote(
    empleados.map((e) => ({ id: e.id, salarioBase: e.salarioBase }))
  );

  const detalles: LineaCalculada[] = [];
  const bonosAMarcar: CalculoPlanilla["bonos"] = [];
  /**
   * Amortización de deducciones a plazo (préstamos, adelantos y cualquier otra
   * con cuotas o saldo). Se acumula en memoria y se aplica en `aplicarCobros`,
   * dentro de la misma transacción que confirma la planilla, para que el descuento
   * y su amortización sean atómicos: nunca se cobra una cuota sin registrarla.
   */
  const amortizaciones: Amortizacion[] = [];
  // Totales en Decimal exacto: acumular 200 importes con `+=` sobre float
  // arrastra centavos y descuadra contra la suma de los detalles en BD.
  let totalBruto = CERO, totalDeducciones = CERO, totalNeto = CERO, totalEmpleador = CERO;

  for (const emp of empleados) {
    // El salario viaja como Decimal desde Prisma hasta el motor, sin Number().
    const salario = emp.salarioBase;
    // Años de servicio al cierre del PERÍODO, no a hoy: recalcular un mes pasado
    // o calcular uno futuro no debe cambiar la antigüedad con que se provisiona.
    const anios = calcularAniosTrabajados(emp.fechaIngreso, hasta);
    const horasExtra = extraPorEmp.get(emp.id) ?? {};

    // Ausencias, séptimo, permisos sin goce y (si la política lo enciende) tardanzas.
    const feriadosEmp = feriadosCercanos.filter((f) => f.sucursalId === null || f.sucursalId === emp.sucursalId).map((f) => texto(f.fecha));
    const asistencia = calcularDeduccionesAsistencia({
      perfil: perfilDesdeTurno(turnoDe(emp.id, desde), salario, tipo as "SEMANAL" | "QUINCENAL" | "MENSUAL"),
      politica: politicaAsistencia,
      periodo: { desde: texto(desde), hasta: texto(hasta) },
      incidencias: incidenciasDelPeriodo({
        desde: texto(desde),
        hasta: texto(hasta),
        marcas: marcasPorEmp.get(emp.id) ?? [],
        turnoDe: (f) => turnoDe(emp.id, new Date(`${f}T00:00:00Z`)),
        permisos: permisosAprobados
          .filter((x) => x.empleadoId === emp.id)
          .map((x) => ({ tipo: x.tipo, desde: texto(x.fechaInicio), hasta: texto(x.fechaFin), dias: x.diasAprobados ?? x.diasSolicitados })),
        fechasIncapacidad: fechasIncapacidadPorEmp.get(emp.id) ?? new Set(),
        feriados: new Set(feriadosEmp),
      }),
      feriados: feriadosEmp,
      septimosYaDescontados: conSeptimoPrevio.has(emp.id) ? [lunesDelPeriodo] : [],
    });
    const diasAusentes = asistencia.totales.diasAusencia;

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

    // Un monto del período reemplaza, en este período, a la deducción de cada planilla del mismo tipo.
    // El ISR importado para el período sólo vale con el ISR en manual: en automático lo
    // calcula el sistema y sólo manda la retención fija de la ficha.
    const deEsteModo = isrManual
      ? emp.deducciones
      : emp.deducciones.filter((d) => !(d.tipoDeduccion.codigo === CODIGO_ISR_FIJO && esMontoDelPeriodo(d)));
    const todas = conMontosDelPeriodo(deEsteModo).map((d) => ({
      id: d.id,
      monto: d.monto,
      saldo: d.saldo,
      cuotasMeses: d.cuotasMeses,
      cuotasPagadas: d.cuotasPagadas,
      tipo: d.tipoDeduccion.tipo,
      codigo: d.tipoDeduccion.codigo,
      nombre: d.tipoDeduccion.nombre,
    }));
    // La retención fija de ISR no es una deducción más: reemplaza el ISR calculado.
    const isrFijo = todas.filter((d) => d.codigo === CODIGO_ISR_FIJO);
    // Lo confirmado del vecinal va en su columna; sin nada confirmado, en el cobro anual no se descuenta.
    const vecinalConfirmado = todas.filter((d) => d.codigo === CODIGO_VECINAL);
    const vecinalDelPeriodo = vecinalConfirmado.length
      ? sumar(...vecinalConfirmado.map((d) => cuotaDelPeriodo(d)))
      : cobroVecinal === "ANUAL" ? CERO : null;
    const vigentes = todas.filter((d) => d.codigo !== CODIGO_ISR_FIJO && d.codigo !== CODIGO_VECINAL);
    // La AFP no lleva tope: se resuelve antes, porque baja la base del ISR.
    const afp = aplicarDeducciones(vigentes.filter((d) => d.tipo === "AFP")).afp;

    // Planilla quincenal: qué quincena es, cuánto del mes tiene derecho a salario y
    // si también está en la otra quincena, para los aportes que se deducen
    // completos en una sola quincena.
    const quincena = tipo === "QUINCENAL"
      ? {
          numero: numeroQuincena,
          diasPagablesMes: diasConDerechoASalario({
            fechaIngreso: emp.fechaIngreso, fechaSalida: emp.fechaSalida, desde: inicioMes, hasta: finMes, diasMes: 30,
          }),
          enOtraQuincena: diasConDerechoASalario({
            fechaIngreso: emp.fechaIngreso, fechaSalida: emp.fechaSalida, desde: laOtra.desde, hasta: laOtra.hasta, diasMes: 15,
          }) > 0,
        }
      : null;

    // A mes vencido: la base del mes anterior. Lo del mes de salida lo toma la
    // liquidación; si ya la hay con el RAP pendiente, aquí no se descuenta nada.
    const rapMesVencido = basesRap
      ? { base: rapEnLiquidacion.has(emp.id) ? CERO : basesRap.porEmpleado.get(emp.id)?.base ?? CERO }
      : null;

    // Lectura de memoria: ninguna consulta dentro del bucle.
    const bonoEval = bonos.get(emp.id);
    const bonificaciones = bonoEval ? bonoEval.bonoMonto : CERO;
    if (bonoEval) {
      bonosAMarcar.push({
        evaluacionId: bonoEval.evaluacionId,
        bonoMonto: bonoEval.bonoMonto,
        bonoPorcentaje: bonoEval.bonoPorcentaje,
      });
    }

    // Días a cargo del IHSS en el período: se descuenta sólo el subsidio que el
    // IHSS paga directo; la diferencia hasta el salario la paga el patrono (Art. 73).
    const inc = descuentoIncapacidades(Number(salario), incapacidadesPorEmp.get(emp.id) ?? [], desde, hasta, parametros.ihssTope);

    const entradaCalculo: EntradaCalculoPlanilla = {
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
      descuentoAsistencia: asistencia.totales.monto,
      incapacidad: inc.descuento,
      // Primero sin las demás deducciones: lo que queda después de las de ley
      // fija los topes de los Arts. 371 y 372.
      otrosDeducciones: 0,
      // Importe real de la deducción AFP del empleado, no un porcentaje global.
      afpEmpleado: afp,
      aniosTrabajados: anios,
      // IHSS mensual pactado en la ficha; null = por porcentaje.
      ihssMontoFijoMensual: emp.ihssMontoFijo,
      // Apagados en la ficha de quien ya cotiza en otra nómina.
      aplicaIhss: emp.aplicaIhss,
      aplicaRap: emp.aplicaRap,
      quincena,
      rapMesVencido,
      vecinalDelPeriodo,
    };
    let result = calcularPlanilla(entradaCalculo, parametros);

    // Cálculo personalizado: el ISR sale de la proyección anual y la línea se
    // rehace con él, para que deducciones y neto cuadren. Una retención fija de
    // ISR asignada al empleado manda sobre los dos métodos.
    let isrDetalle: DetalleIsrPersonalizado | null = null;
    let isrDelPeriodo: Money | null = null;
    if (isrFijo.length > 0) {
      isrDelPeriodo = sumar(...isrFijo.map((d) => cuotaDelPeriodo(d)));
      result = calcularPlanilla({ ...entradaCalculo, isrDelPeriodo }, parametros);
    } else if (isrManual) {
      // Sin retención importada ni fija: en manual no se retiene nada.
      isrDelPeriodo = CERO;
      result = calcularPlanilla({ ...entradaCalculo, isrDelPeriodo }, parametros);
    } else if (isrPersonalizado) {
      const x = calcularIsrPersonalizado({
        periodosAnio: periodoIsr.periodosAnio,
        indicePeriodo: periodoIsr.indice,
        historial: historialIsr.get(emp.id) ?? [],
        actual: {
          // Lo efectivamente pagado: las ausencias y la incapacidad no se pagan.
          sueldo: result.salarioBase.minus(result.ausencias).minus(result.incapacidad),
          variables: result.montoHorasExtra.plus(bonificaciones),
          rap: result.rapEmpleado,
          afp: result.afpEmpleado,
        },
        salarioMensual: salario,
        // Quien deja la empresa en este período no tiene más meses que proyectar.
        proyectar: !(emp.fechaSalida && emp.fechaSalida <= hasta),
        // Como la hoja: año de la planilla menos año de nacimiento.
        edad: hasta.getUTCFullYear() - emp.fechaNacimiento.getUTCFullYear(),
        ivmTope: parametros.ivmTope,
        // Lo que esta ficha no le deduce tampoco se resta de su base.
        ivmEmpleado: emp.aplicaIhss ? parametros.ivmEmpleado : 0,
        rapMensual: emp.aplicaRap ? calcularRAP(salario, parametros).empleado : 0,
        tabla: parametros.tablaISRAnual,
        config: configIsr.personalizado,
      });
      isrDelPeriodo = x.retencion;
      result = calcularPlanilla({ ...entradaCalculo, isrDelPeriodo }, parametros);
      isrDetalle = x.detalle;
    }

    // Préstamos, adelantos, cooperativa y demás, en orden y completos mientras el neto no
    // quede negativo; lo que no alcanza de un préstamo sigue en el saldo. Lo que pasa del
    // tope de los Arts. 371 y 372 se cobra igual y queda en la línea para avisarlo.
    const minimoPeriodo = minimoMensual.times(factorPeriodo).times(diasPagables).div(diasMes);
    const ded = aplicarDeducciones(vigentes, topesDelPeriodo(result.salarioNeto, minimoPeriodo));
    amortizaciones.push(...ded.amortizaciones);
    // Lo cobrado de cada tipo, para revisar la planilla columna por columna, con lo que
    // no alcanzó y lo que pasa del tope de ley (los avisos del borrador).
    const porId = new Map(vigentes.map((d) => [d.id, d]));
    const deduccionesPorTipo = resumirDeducciones(ded.cobradas.map((c) => ({
      codigo: porId.get(c.id)!.codigo, nombre: porId.get(c.id)!.nombre, monto: c.monto, asignado: c.cuota, tope: c.tope,
    })));
    if (!ded.total.isZero()) {
      result = calcularPlanilla({ ...entradaCalculo, otrosDeducciones: ded.total, isrDelPeriodo }, parametros);
    }

    detalles.push({
      empleadoId: emp.id,
      // Ubicación al pagarse: los reportes agrupan por aquí, no por la actual.
      sucursalId: emp.sucursalId,
      divisionId: emp.departamento.divisionId,
      departamentoId: emp.departamentoId,
      // Para el comprobante: el puesto de ese período, aunque después cambie.
      puesto: emp.puesto?.nombre ?? null,
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
      ...(isrDetalle ? { isrDetalle: { ...isrDetalle } } : {}),
      impuestoVecinal: result.impuestoVecinal,
      cooperativa: ded.cooperativa,
      prestamos: ded.prestamos,
      adelantos: ded.adelantos,
      ausencias: result.ausencias,
      diasIncapacidadIhss: inc.diasIhss,
      incapacidad: result.incapacidad,
      otrosDeducciones: ded.otros,
      deducciones: deduccionesPorTipo as unknown as Prisma.InputJsonValue,
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

  if (detalles.length === 0) {
    return { ok: false, status: 400, cuerpo: { error: "Ningún empleado tiene días con derecho a salario en este período." } };
  }

  return {
    ok: true,
    detalles,
    amortizaciones,
    bonos: bonosAMarcar,
    totales: { totalBruto, totalDeducciones, totalNeto, totalEmpleador },
    metodoIsr: configIsr.metodo,
  };
}

/** Reemplaza las líneas y los totales. Sólo mientras esté en borrador: los triggers cierran el resto. */
export async function escribirLineas(tx: Prisma.TransactionClient, planillaId: string, c: CalculoPlanilla): Promise<void> {
  await tx.planillaDetalle.deleteMany({ where: { planillaId } });
  await tx.planillaDetalle.createMany({ data: c.detalles.map((d) => ({ ...d, planillaId })) });
  await tx.planilla.update({ where: { id: planillaId }, data: c.totales });
}

/**
 * Cobra lo que esta planilla descuenta: amortiza las deducciones a plazo y marca los
 * bonos como aplicados. Cada cobro deja una fila en `AmortizacionPlanilla`, que es lo
 * que permite deshacerlo después.
 */
export async function aplicarCobros(tx: Prisma.TransactionClient, planillaId: string, c: CalculoPlanilla): Promise<void> {
  const { amortizaciones, bonos } = c;

  // Una sola sentencia en vez de N UPDATE secuenciales: con la transacción abierta,
  // cada viaje extra a la base consume su presupuesto y alarga los bloqueos.
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

    await tx.amortizacionPlanilla.createMany({
      data: registrosDeAmortizacion(amortizaciones).map((r) => ({
        planillaId,
        deduccionId: r.deduccionId,
        montoAplicado: r.montoAplicado,
        llevaSaldo: r.llevaSaldo,
        desactivo: r.desactivo,
      })),
    });
  }

  if (bonos.length > 0) {
    await tx.$executeRaw`
      UPDATE "Evaluacion" e
         SET "bonoAplicado"   = true,
             "bonoMonto"      = v.monto,
             "bonoPorcentaje" = v.porcentaje,
             "updatedAt"      = NOW()
        FROM (SELECT * FROM UNNEST(
                ${bonos.map((b) => b.evaluacionId)}::text[],
                ${bonos.map((b) => b.bonoMonto.toFixed(2))}::numeric[],
                ${bonos.map((b) => b.bonoPorcentaje)}::numeric[]
              ) AS t(id, monto, porcentaje)) v
       WHERE e."id" = v.id`;
  }
}

/**
 * Deshace los cobros de la planilla. Devuelve cuántas deducciones se revirtieron.
 *
 * Se devuelve el DELTA, no se restaura un estado previo: así la reversión es correcta
 * aunque otra planilla posterior haya cobrado cuotas del mismo préstamo. Espeja
 * `revertirAmortizacion()` de lib/payroll/deducciones.ts, donde esta aritmética está
 * probada.
 *
 * `conservarRegistro`: al anular, la fila queda sellada como rastro (la planilla ya no
 * cambia). Al volver a borrador se borra: la planilla se confirmará de nuevo y sólo
 * puede amortizar cada deducción una vez (índice único).
 *
 * El bono no guarda de qué planilla salió: se busca la evaluación de esa persona
 * marcada con ese mismo importe. Si dos coincidieran, da igual cuál se libere: la
 * siguiente planilla pagaría el mismo monto.
 */
export async function devolverCobros(
  tx: Prisma.TransactionClient,
  planillaId: string,
  { conservarRegistro }: { conservarRegistro: boolean }
): Promise<number> {
  const pendientes = await tx.amortizacionPlanilla.findMany({
    where: { planillaId, revertidaAt: null },
    select: { id: true, deduccionId: true, montoAplicado: true, llevaSaldo: true, desactivo: true },
  });

  if (pendientes.length > 0) {
    await tx.$executeRaw`
      UPDATE "DeduccionEmpleado" d
         SET "cuotasPagadas" = GREATEST(0, d."cuotasPagadas" - 1),
             "saldo"         = CASE WHEN v.lleva_saldo
                                    THEN COALESCE(d."saldo", 0) + v.monto
                                    ELSE d."saldo" END,
             "activo"        = CASE WHEN v.desactivo THEN true ELSE d."activo" END,
             "updatedAt"     = NOW()
        FROM (SELECT * FROM UNNEST(
                ${pendientes.map((a) => a.deduccionId)}::text[],
                ${pendientes.map((a) => a.montoAplicado.toFixed(2))}::numeric[],
                ${pendientes.map((a) => a.llevaSaldo)}::boolean[],
                ${pendientes.map((a) => a.desactivo)}::boolean[]
              ) AS t(id, monto, lleva_saldo, desactivo)) v
       WHERE d."id" = v.id`;
  }

  // Sellar impide devolver dos veces el mismo importe.
  if (conservarRegistro) {
    await tx.amortizacionPlanilla.updateMany({
      where: { id: { in: pendientes.map((a) => a.id) } },
      data: { revertidaAt: new Date() },
    });
  } else {
    await tx.amortizacionPlanilla.deleteMany({ where: { planillaId } });
  }

  const conBono = await tx.planillaDetalle.findMany({
    where: { planillaId, bonificaciones: { gt: 0 } },
    select: { empleadoId: true, bonificaciones: true },
  });
  for (const linea of conBono) {
    const evaluacion = await tx.evaluacion.findFirst({
      where: { empleadoId: linea.empleadoId, bonoAplicado: true, bonoMonto: linea.bonificaciones },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (evaluacion) {
      await tx.evaluacion.update({
        where: { id: evaluacion.id },
        data: { bonoAplicado: false, bonoMonto: null, bonoPorcentaje: null },
      });
    }
  }

  return pendientes.length;
}
