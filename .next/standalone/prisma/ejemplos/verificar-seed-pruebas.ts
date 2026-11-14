/**
 * Verifica en la base lo que sembró `prisma/seed-pruebas.ts`: conteos, planillas
 * con su sello de integridad, amortización de deducciones, saldos de vacaciones
 * y un muestreo de los módulos de talento. Sólo lee.
 *
 *   npx tsx prisma/ejemplos/verificar-seed-pruebas.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { prisma } = await import("../../src/lib/prisma");
  const { verificarIntegridad } = await import("../../src/lib/payroll/estado-planilla");

  const emp = await prisma.empleado.findMany({
    where: { codigo: { startsWith: "SPS-" } },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, primerNombre: true, primerApellido: true, tipoPlanilla: true, salarioBase: true, estado: true, fechaIngreso: true, fechaSalida: true, puesto: { select: { nombre: true } }, supervisor: { select: { codigo: true } }, user: { select: { email: true } } },
  });
  console.log(`Empleados SPS-: ${emp.length}`);
  console.table(emp.map((e) => ({
    codigo: e.codigo, nombre: `${e.primerNombre} ${e.primerApellido}`, puesto: e.puesto?.nombre, planilla: e.tipoPlanilla,
    salario: Number(e.salarioBase), estado: e.estado, ingreso: e.fechaIngreso.toISOString().slice(0, 10),
    salida: e.fechaSalida?.toISOString().slice(0, 10) ?? "", jefe: e.supervisor?.codigo ?? "", usuario: e.user?.email ?? "",
  })));
  const ids = emp.map((e) => e.id);

  // ── Planillas de la sucursal de prueba, con verificación del hash ───────────
  const planillas = await prisma.planilla.findMany({
    where: { id: { startsWith: "prueba-" } },
    orderBy: [{ fechaInicio: "asc" }, { tipo: "asc" }],
    include: { detalles: { select: { empleadoId: true, totalBruto: true, totalDeducciones: true, salarioNeto: true } } },
  });
  console.log(`\nPlanillas sembradas: ${planillas.length}`);
  console.table(planillas.map((p) => {
    const integridad = ["APROBADA", "PAGADA"].includes(p.estado) ? verificarIntegridad(p.hashCalculo, p.detalles) : null;
    return {
      tipo: p.tipo, periodo: `${p.fechaInicio.toISOString().slice(0, 10)} al ${p.fechaFin.toISOString().slice(0, 10)}`, estado: p.estado,
      empleados: p.detalles.length, bruto: Number(p.totalBruto), deducciones: Number(p.totalDeducciones), neto: Number(p.totalNeto),
      patronal: Number(p.totalEmpleador), hash: p.hashCalculo ? "sí" : "no", integridad: integridad ? (integridad.intacta ? "intacta" : "ALTERADA") : "(abierta)",
      pagada: p.fechaPago?.toISOString().slice(0, 10) ?? "",
    };
  }));

  // Suma de detalles contra cabecera: deben coincidir al centavo.
  const sumas = await prisma.$queryRaw<{ planillaId: string; bruto: string; ded: string; neto: string }[]>`
    SELECT "planillaId", sum("totalBruto")::text AS bruto, sum("totalDeducciones")::text AS ded, sum("salarioNeto")::text AS neto
      FROM "PlanillaDetalle" WHERE "planillaId" LIKE 'prueba-%' GROUP BY "planillaId"`;
  let descuadres = 0;
  for (const s of sumas) {
    const p = planillas.find((x) => x.id === s.planillaId)!;
    if (Number(s.bruto) !== Number(p.totalBruto) || Number(s.ded) !== Number(p.totalDeducciones) || Number(s.neto) !== Number(p.totalNeto)) {
      descuadres++;
      console.log(`  DESCUADRE en ${p.id}: detalles ${s.bruto}/${s.ded}/${s.neto} vs cabecera ${p.totalBruto}/${p.totalDeducciones}/${p.totalNeto}`);
    }
  }
  console.log(`Cabecera vs suma de detalles: ${descuadres === 0 ? "cuadran todas" : `${descuadres} descuadre(s)`}`);

  // ── Deducciones a plazo tras las planillas ──────────────────────────────────
  const ded = await prisma.deduccionEmpleado.findMany({
    where: { id: { startsWith: "prueba-" } },
    include: { tipoDeduccion: { select: { codigo: true } }, empleado: { select: { codigo: true } }, amortizaciones: { select: { planillaId: true, montoAplicado: true } } },
  });
  console.log("\nDeducciones individuales:");
  console.table(ded.map((x) => ({
    empleado: x.empleado.codigo, tipo: x.tipoDeduccion.codigo, cuota: Number(x.monto), cuotas: x.cuotasMeses ?? "", pagadas: x.cuotasPagadas,
    saldo: x.saldo === null ? "" : Number(x.saldo), activa: x.activo, amortizaciones: x.amortizaciones.length,
    cobrado: x.amortizaciones.reduce((s, a) => s + Number(a.montoAplicado), 0),
  })));

  // ── Asistencia ──────────────────────────────────────────────────────────────
  const asis = await prisma.$queryRaw<{ n: bigint; ausencias: bigint; diurna: string; mixta: string; nocturna: string; feriado: string; descanso: string }[]>`
    SELECT count(*) AS n, count(*) FILTER (WHERE "esAusencia") AS ausencias,
           sum("horasExtraDiurna")::text AS diurna, sum("horasExtraMixta")::text AS mixta,
           sum("horasExtraNocturna")::text AS nocturna, sum("horasFeriado")::text AS feriado,
           sum("minutosDescanso")::text AS descanso
      FROM "Marcaje" WHERE "empleadoId" = ANY(${ids})`;
  const a = asis[0];
  console.log(`\nMarcajes: ${a.n} (ausencias ${a.ausencias}); horas extra diurnas ${a.diurna}, mixtas ${a.mixta}, nocturnas ${a.nocturna}, feriado ${a.feriado}; minutos de almuerzo descontados ${a.descanso}`);

  // ── Vacaciones, décimos y talento ───────────────────────────────────────────
  const saldos = await prisma.saldoVacaciones.findMany({ where: { empleadoId: { in: ids } } });
  const permisos = await prisma.permiso.groupBy({ by: ["estado"], where: { empleadoId: { in: ids } }, _count: true });
  console.log(`Saldos de vacaciones: ${saldos.length}; permisos por estado: ${permisos.map((p) => `${p.estado} ${p._count}`).join(", ")}`);
  const g = saldos.find((s) => s.empleadoId === emp.find((e) => e.codigo === "SPS-013")?.id);
  if (g) console.log(`  SPS-013: tomados ${g.diasTomados}, disponibles ${g.diasDisponibles}`);

  const dec = await prisma.liquidacionDecimo.aggregate({ where: { empleadoId: { in: ids } }, _count: true, _sum: { montoDevengado: true, isrRetenido: true } });
  console.log(`Décimo cuarto 2026: ${dec._count} liquidaciones, devengado L ${dec._sum.montoDevengado}, ISR L ${dec._sum.isrRetenido}`);

  const ev = await prisma.evaluacion.findMany({ where: { empleadoId: { in: ids } }, include: { empleado: { select: { codigo: true } }, _count: { select: { participantes: true, criterios: true } } }, orderBy: { periodo: "asc" } });
  console.log("\nEvaluaciones:");
  console.table(ev.map((e) => ({ empleado: e.empleado.codigo, tipo: e.tipo, periodo: e.periodo, estado: e.estado, calificacion: Number(e.calificacion), desempeno: e.desempeno === null ? "" : Number(e.desempeno), potencial: e.potencial === null ? "" : Number(e.potencial), participantes: e._count.participantes, criterios: e._count.criterios })));

  const cap = await prisma.capacitacion.findMany({ where: { id: { startsWith: "prueba-" } }, include: { _count: { select: { participantes: true } } } });
  const vac = await prisma.vacante.findMany({ where: { id: { startsWith: "prueba-" } }, include: { _count: { select: { candidatos: true } } } });
  const comp = await prisma.competenciaDefinicion.count({ where: { id: { startsWith: "prueba-" } } });
  const matriz = await prisma.puestoCompetencia.count({ where: { puestoId: { startsWith: "prueba-" } } });
  const dot = await prisma.asignacionDotacion.count({ where: { empleadoId: { in: ids } } });
  console.log(`Capacitaciones: ${cap.map((c) => `${c.nombre} (${c.estado}, ${c._count.participantes} participantes)`).join("; ")}`);
  console.log(`Vacantes: ${vac.map((v) => `${v.titulo} (${v.estado}, ${v._count.candidatos} candidatos)`).join("; ")}`);
  console.log(`Competencias: ${comp}; matriz por puesto: ${matriz}; dotaciones asignadas: ${dot}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
