/**
 * Tablero ejecutivo: lo que se consulta. Todo dentro del alcance de quien mira y de los
 * filtros (fechas, sucursal, departamento). Los cálculos están en ./indicadores.ts.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { conAlcance, filtroPorEmpleado, type UsuarioConAlcance } from "@/lib/auth/alcance";
import { reportePuntualidad } from "@/lib/asistencia/tardanzas";
import { MAX_EMPLEADOS_MICROEMPRESA } from "@/lib/payroll/liquidacion";
import { ADELANTO_DE, anioDecimoEnCurso } from "@/lib/prestaciones/anticipos";
import { hoyHN } from "@/lib/utils";
import {
  asistencia,
  cesantiaAcumulada,
  fuerzaLaboral,
  proyectarDecimo,
  redondear1,
  redondear2,
  variacion,
  type PersonaTablero,
  type ProyeccionDecimo,
} from "./indicadores";

export interface FiltroTablero {
  desde: Date;
  hasta: Date;
  sucursalId?: string;
  departamentoId?: string;
}

const DIA = 86_400_000;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/**
 * Suma de las líneas de las planillas confirmadas que EMPIEZAN en el rango: «este mes» incluye
 * la quincena del 1 al 15 aunque termine después de hoy (con «terminan en el rango», el mes
 * en curso salía en cero).
 */
async function masaSalarial(usuario: UsuarioConAlcance, f: FiltroTablero, desde: Date, hasta: Date) {
  const r = await prisma.planillaDetalle.aggregate({
    where: {
      AND: [
        { planilla: { estado: { in: ["CALCULADA", "APROBADA", "PAGADA"] }, fechaInicio: { gte: desde, lte: hasta } } },
        f.sucursalId ? { sucursalId: f.sucursalId } : {},
        f.departamentoId ? { departamentoId: f.departamentoId } : {},
        filtroPorEmpleado(usuario),
      ],
    },
    _count: { _all: true },
    _sum: {
      totalBruto: true, salarioNeto: true, totalDeducciones: true,
      ihssEmpleado: true, rapEmpleado: true, afpEmpleado: true, isr: true, impuestoVecinal: true,
      prestamos: true, adelantos: true, cooperativa: true, otrosDeducciones: true, ausencias: true, incapacidad: true,
      ihssEmpleador: true, rapEmpleador: true, infop: true, reservaLaboral: true,
      provision13vo: true, provision14vo: true, provisionVacaciones: true,
    },
  });
  const s = r._sum;
  const aportes = n(s.ihssEmpleador) + n(s.rapEmpleador) + n(s.infop) + n(s.reservaLaboral);
  const provisiones = n(s.provision13vo) + n(s.provision14vo) + n(s.provisionVacaciones);
  return {
    lineas: r._count._all,
    bruto: redondear2(n(s.totalBruto)),
    neto: redondear2(n(s.salarioNeto)),
    aportes: redondear2(aportes),
    provisiones: redondear2(provisiones),
    costo: redondear2(n(s.totalBruto) + aportes + provisiones),
    deducciones: [
      { concepto: "IHSS", monto: n(s.ihssEmpleado) },
      { concepto: "RAP", monto: n(s.rapEmpleado) },
      { concepto: "ISR", monto: n(s.isr) },
      { concepto: "Impuesto vecinal", monto: n(s.impuestoVecinal) },
      { concepto: "AFP", monto: n(s.afpEmpleado) },
      { concepto: "Préstamos", monto: n(s.prestamos) },
      { concepto: "Adelantos", monto: n(s.adelantos) },
      { concepto: "Cooperativa", monto: n(s.cooperativa) },
      { concepto: "Ausencias", monto: n(s.ausencias) },
      { concepto: "Incapacidad IHSS", monto: n(s.incapacidad) },
      { concepto: "Otras", monto: n(s.otrosDeducciones) },
    ]
      .map((d) => ({ ...d, monto: redondear2(d.monto) }))
      .filter((d) => d.monto > 0)
      .sort((a, b) => b.monto - a.monto),
  };
}

export async function calcularTablero(usuario: UsuarioConAlcance, f: FiltroTablero) {
  const hoy = hoyHN();
  const filtroEmp: Prisma.EmpleadoWhereInput = {
    ...(f.sucursalId ? { sucursalId: f.sucursalId } : {}),
    ...(f.departamentoId ? { departamentoId: f.departamentoId } : {}),
  };
  const enAlcance = conAlcance(filtroEmp, usuario);

  // ─── Personas ──────────────────────────────────────────────────────────────
  const filas = await prisma.empleado.findMany({
    where: conAlcance({ ...filtroEmp, fechaIngreso: { lte: f.hasta > hoy ? f.hasta : hoy } }, usuario),
    select: {
      id: true, fechaIngreso: true, fechaSalida: true, estado: true, salarioBase: true,
      sucursal: { select: { nombre: true } }, departamento: { select: { nombre: true } },
    },
  });
  const personas: PersonaTablero[] = filas.map((e) => ({
    id: e.id,
    fechaIngreso: e.fechaIngreso,
    // Inactivo sin fecha de salida: no cuenta como activo en ninguna fecha.
    fechaSalida: e.fechaSalida ?? (e.estado === "INACTIVO" ? new Date(0) : null),
    salarioBase: n(e.salarioBase),
    sucursal: e.sucursal.nombre,
    departamento: e.departamento.nombre,
  }));
  const fuerza = fuerzaLaboral(personas, f.desde, f.hasta);

  // ─── Asistencia ────────────────────────────────────────────────────────────
  const enRango = { fecha: { gte: f.desde, lte: f.hasta }, empleado: enAlcance };
  const [totalDias, ausencias, horas] = await Promise.all([
    prisma.marcaje.count({ where: enRango }),
    prisma.marcaje.count({ where: { ...enRango, esAusencia: true } }),
    prisma.marcaje.aggregate({ where: enRango, _sum: { horasNormales: true, horasExtra: true, horasFeriado: true } }),
  ]);
  // La puntualidad se mide sobre los últimos 92 días del rango (el reporte no da más).
  const desdeP = new Date(Math.max(f.desde.getTime(), f.hasta.getTime() - 91 * DIA));
  const punt = (await reportePuntualidad(desdeP, f.hasta, enAlcance)).reduce(
    (a, r) => ({ diasConMarca: a.diasConMarca + r.diasConMarca, llegadasTarde: a.llegadasTarde + r.llegadasTarde }),
    { diasConMarca: 0, llegadasTarde: 0 }
  );
  const asis = asistencia(
    {
      diasConRegistro: totalDias,
      ausencias,
      horasOrdinarias: n(horas._sum.horasNormales),
      horasExtra: n(horas._sum.horasExtra) + n(horas._sum.horasFeriado),
    },
    punt
  );

  // ─── Desempeño y capacitación ──────────────────────────────────────────────
  const [evaluaciones, participantes] = await Promise.all([
    prisma.evaluacion.aggregate({
      where: { estado: "FINALIZADA", fechaFirma: { gte: f.desde, lte: new Date(f.hasta.getTime() + DIA - 1) }, empleado: enAlcance },
      _avg: { calificacion: true },
      _count: { _all: true },
    }),
    prisma.participanteCapacitacion.findMany({
      where: { capacitacion: { estado: { not: "CANCELADA" }, fechaInicio: { gte: f.desde, lte: f.hasta } }, empleado: enAlcance },
      select: { empleadoId: true, asistio: true, aprobado: true, capacitacionId: true, capacitacion: { select: { _count: { select: { materiales: true } } } } },
    }),
  ]);
  const materialesPorVer = participantes.reduce((s, p) => s + p.capacitacion._count.materiales, 0);
  const vistas = materialesPorVer
    ? await prisma.vistaMaterial.count({
        where: { OR: participantes.map((p) => ({ empleadoId: p.empleadoId, material: { capacitacionId: p.capacitacionId } })) },
      })
    : 0;
  const calificados = participantes.filter((p) => p.aprobado !== null);
  const pct = (a: number, b: number) => (b > 0 ? redondear1((a / b) * 100) : null);

  // ─── Masa salarial: el período y el anterior del mismo largo ───────────────
  const largo = f.hasta.getTime() - f.desde.getTime() + DIA;
  const antHasta = new Date(f.desde.getTime() - DIA);
  const antDesde = new Date(f.desde.getTime() - largo);
  const [masa, masaAnterior] = await Promise.all([masaSalarial(usuario, f, f.desde, f.hasta), masaSalarial(usuario, f, antDesde, antHasta)]);

  // ─── Décimos y pasivo laboral (a hoy) ──────────────────────────────────────
  const activosHoy = personas.filter((p) => p.fechaIngreso <= hoy && (!p.fechaSalida || p.fechaSalida >= hoy));
  const decimos: ProyeccionDecimo[] = [];
  for (const tipo of ["DECIMO_TERCERO", "DECIMO_CUARTO"] as const) {
    const anio = anioDecimoEnCurso(tipo, hoy);
    const [pagados, adelantos] = await Promise.all([
      prisma.liquidacionDecimo.findMany({ where: { tipo, anio, estado: "PAGADA", empleadoId: { in: activosHoy.map((p) => p.id) } }, select: { empleadoId: true } }),
      prisma.anticipoPrestacion.groupBy({
        by: ["empleadoId"],
        where: { tipo: ADELANTO_DE[tipo], anioDecimo: anio, estado: "VIGENTE", empleadoId: { in: activosHoy.map((p) => p.id) } },
        _sum: { monto: true },
      }),
    ]);
    const yaPagados = new Set(pagados.map((p) => p.empleadoId));
    decimos.push(
      proyectarDecimo(
        tipo,
        hoy,
        activosHoy.filter((p) => !yaPagados.has(p.id)),
        new Map(adelantos.map((a) => [a.empleadoId, n(a._sum.monto)]))
      )
    );
  }
  // Tamaño de la EMPRESA (sin alcance), como en la liquidación: decide el tope de cesantía.
  const esMicroempresa = (await prisma.empleado.count({ where: { estado: "ACTIVO" } })) <= MAX_EMPLEADOS_MICROEMPRESA;
  const cesantia = redondear2(activosHoy.reduce((s, p) => s + cesantiaAcumulada(p, hoy, esMicroempresa), 0));
  const decimosAcumulados = redondear2(decimos.reduce((s, d) => s + d.acumulado, 0));

  return {
    filtro: { desde: f.desde.toISOString().slice(0, 10), hasta: f.hasta.toISOString().slice(0, 10), sucursalId: f.sucursalId ?? null, departamentoId: f.departamentoId ?? null },
    hoy: hoy.toISOString().slice(0, 10),
    fuerza,
    asistencia: { ...asis, puntualidadDesde: desdeP.toISOString().slice(0, 10) },
    desempeno: {
      evaluaciones: evaluaciones._count._all,
      promedio: evaluaciones._avg.calificacion === null ? null : redondear1(n(evaluaciones._avg.calificacion)),
    },
    capacitacion: {
      participantes: participantes.length,
      asistencia: pct(participantes.filter((p) => p.asistio).length, participantes.length),
      aprobados: pct(calificados.filter((p) => p.aprobado).length, calificados.length),
      materialVisto: pct(vistas, materialesPorVer),
    },
    masa: {
      actual: masa,
      anterior: { ...masaAnterior, desde: antDesde.toISOString().slice(0, 10), hasta: antHasta.toISOString().slice(0, 10) },
      // Sin planillas en alguno de los dos períodos no hay comparación (no es un −100 %).
      variacionCosto: masa.lineas > 0 && masaAnterior.lineas > 0 ? variacion(masa.costo, masaAnterior.costo) : null,
    },
    pasivo: { cesantia, decimosAcumulados, total: redondear2(cesantia + decimosAcumulados), esMicroempresa },
    decimos,
  };
}

export type Tablero = Awaited<ReturnType<typeof calcularTablero>>;
