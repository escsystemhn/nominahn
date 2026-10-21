/**
 * Datos de PRUEBA para los módulos de Planilla y Gestión de Talento.
 *
 * Crea una plantilla ficticia en la sucursal «Sucursal San Pedro Sula» de la
 * empresa ya sembrada, con departamentos y puestos propios, y sobre ella:
 *
 *   · 16 empleados en planilla mensual, quincenal y semanal, desde salario
 *     mínimo hasta gerencia con retención de ISR, con casos límite (ingreso y
 *     baja a mitad de período, IHSS fijo pactado, AFP, préstamo, adelanto,
 *     cooperativa, ausencias injustificadas, vacaciones).
 *   · Marcajes de asistencia del 1 de septiembre al 15 de octubre de 2026 con
 *     horas extra diurnas, nocturnas, mixtas y de feriado.
 *   · Cuatro planillas calculadas CON EL MOTOR REAL (`calcularPlanilla` y el
 *     mismo cargador de parámetros que usa /api/planillas): dos pagadas, una
 *     aprobada y una calculada.
 *   · Liquidación del décimo cuarto mes 2026, pagada.
 *   · Expedientes: contratos, historial salarial, saldos y permisos de
 *     vacaciones, evaluaciones 360° con criterios, competencias por puesto,
 *     capacitaciones, dotaciones, una vacante con candidatos y dos usuarios.
 *
 * REGLAS
 *   · ADITIVO: no borra ni modifica nada que ya exista. Todos los ids son
 *     deterministas con prefijo `prueba-` y los códigos de empleado `SPS-nnn`.
 *   · IDEMPOTENTE: si ya hay empleados `SPS-`, se detiene sin tocar nada.
 *   · ATÓMICO: todo va en una transacción. Con `--dry` se calcula, se imprime
 *     el resumen y se REVIERTE: sirve para revisar cifras sin escribir.
 *
 * USO (desde nominahn/):
 *   npx tsx prisma/seed-pruebas.ts --dry
 *   npx tsx prisma/seed-pruebas.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
// `repartirJornada` clasifica la franja con la hora LOCAL del proceso.
process.env.TZ = process.env.TZ || "America/Tegucigalpa";

import { Prisma } from "@prisma/client";

const DRY = process.argv.includes("--dry");

// ─── Utilidades de fecha ──────────────────────────────────────────────────────

/** Fecha de CALENDARIO: medianoche UTC, como manda lib/utils.ts para @db.Date. */
const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
/** Instante en hora de Honduras (UTC−6, sin horario de verano). */
const hn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00-06:00`);
const ymdDe = (f: Date) => f.toISOString().slice(0, 10);
const sumarDias = (f: Date, n: number) => new Date(f.getTime() + n * 86_400_000);

class EnsayoRevertido extends Error {}

// ─── Catálogo de prueba ───────────────────────────────────────────────────────

const SUCURSAL_ID = "seed-suc-SPS-001"; // ya existe: «Sucursal San Pedro Sula»
const P = "prueba-";

const DEPARTAMENTOS = [
  { id: `${P}dept-SPS-ADM`, nombre: "Administración SPS", codigo: "SPS-ADM", centro: "ADM" },
  { id: `${P}dept-SPS-VEN`, nombre: "Ventas SPS", codigo: "SPS-VEN", centro: "VTA" },
  { id: `${P}dept-SPS-PROD`, nombre: "Producción SPS", codigo: "SPS-PROD", centro: "PROD" },
  { id: `${P}dept-SPS-MNT`, nombre: "Mantenimiento SPS", codigo: "SPS-MNT", centro: "PROD" },
] as const;

type DeptKey = (typeof DEPARTAMENTOS)[number]["codigo"];

const PUESTOS: { id: string; nombre: string; dept: DeptKey; min: number; max: number }[] = [
  { id: `${P}puesto-gerente-sucursal`, nombre: "Gerente de Sucursal", dept: "SPS-ADM", min: 60000, max: 120000 },
  { id: `${P}puesto-contador-sucursal`, nombre: "Contador de Sucursal", dept: "SPS-ADM", min: 30000, max: 50000 },
  { id: `${P}puesto-asistente-admin`, nombre: "Asistente Administrativo", dept: "SPS-ADM", min: 14000, max: 22000 },
  { id: `${P}puesto-conserje`, nombre: "Conserje", dept: "SPS-ADM", min: 11500, max: 14000 },
  { id: `${P}puesto-jefe-ventas`, nombre: "Jefe de Ventas", dept: "SPS-VEN", min: 30000, max: 45000 },
  { id: `${P}puesto-vendedor`, nombre: "Vendedor", dept: "SPS-VEN", min: 14000, max: 22000 },
  { id: `${P}puesto-supervisor-produccion`, nombre: "Supervisor de Producción", dept: "SPS-PROD", min: 22000, max: 32000 },
  { id: `${P}puesto-operario`, nombre: "Operario de Producción", dept: "SPS-PROD", min: 12000, max: 16000 },
  { id: `${P}puesto-tecnico-mantenimiento`, nombre: "Técnico de Mantenimiento", dept: "SPS-MNT", min: 18000, max: 26000 },
];

type Planilla = "MENSUAL" | "QUINCENAL" | "SEMANAL";

interface EmpleadoPrueba {
  codigo: string;
  nombres: [string, string | null, string, string | null];
  nacimiento: string;
  genero: "M" | "F";
  estadoCivil: string;
  identidad: string;
  puesto: string; // id de PUESTOS
  planilla: Planilla;
  salario: number;
  ingreso: string;
  salida?: string;
  estado?: "ACTIVO" | "INACTIVO" | "VACACIONES";
  supervisor?: string; // código
  banco?: string;
  cuenta?: string;
  emailPersonal?: string;
  ihssFijo?: number;
  /** Sábados laborables (operarios y mantenimiento). */
  sabados?: boolean;
  horario?: [string, string];
}

/**
 * Identidades y cuentas: ficticias y con formato verosímil. Salarios de
 * referencia 2026 para una empresa mediana de San Pedro Sula; el mínimo legal
 * depende del sector y tamaño, así que los valores bajos son ILUSTRATIVOS.
 */
const EMPLEADOS: EmpleadoPrueba[] = [
  { codigo: "SPS-001", nombres: ["Ana", "Lucía", "Mejía", "Castellanos"], nacimiento: "1981-04-19", genero: "F", estadoCivil: "CASADO", identidad: "0501-1981-04512", puesto: `${P}puesto-gerente-sucursal`, planilla: "MENSUAL", salario: 95000, ingreso: "2018-03-05", banco: "BAC Credomatic", cuenta: "730012345671", emailPersonal: "ana.mejia.prueba@example.com" },
  { codigo: "SPS-002", nombres: ["Roberto", "Carlos", "Pineda", "Lagos"], nacimiento: "1986-11-02", genero: "M", estadoCivil: "CASADO", identidad: "0501-1986-09877", puesto: `${P}puesto-contador-sucursal`, planilla: "MENSUAL", salario: 42000, ingreso: "2020-09-01", supervisor: "SPS-001", banco: "Banco Atlántida", cuenta: "011020034561" },
  { codigo: "SPS-003", nombres: ["Diana", "Patricia", "Castro", "Ordóñez"], nacimiento: "1989-07-23", genero: "F", estadoCivil: "SOLTERO", identidad: "0501-1989-02314", puesto: `${P}puesto-jefe-ventas`, planilla: "MENSUAL", salario: 38500, ingreso: "2021-02-15", supervisor: "SPS-001", banco: "Banco Ficohsa", cuenta: "200501234578" },
  { codigo: "SPS-004", nombres: ["Kevin", "Josué", "Rivera", "Paz"], nacimiento: "1998-01-30", genero: "M", estadoCivil: "SOLTERO", identidad: "0501-1998-05566", puesto: `${P}puesto-asistente-admin`, planilla: "QUINCENAL", salario: 16800, ingreso: "2023-05-02", supervisor: "SPS-002", banco: "BAC Credomatic", cuenta: "730098765432" },
  { codigo: "SPS-005", nombres: ["María", "José", "Fúnez", "Aguilar"], nacimiento: "1995-09-12", genero: "F", estadoCivil: "UNION_LIBRE", identidad: "0501-1995-07788", puesto: `${P}puesto-vendedor`, planilla: "QUINCENAL", salario: 19200, ingreso: "2022-08-01", supervisor: "SPS-003", banco: "Banco Atlántida", cuenta: "011055512348" },
  { codigo: "SPS-006", nombres: ["Elmer", "Antonio", "Zúniga", "Reyes"], nacimiento: "1993-03-08", genero: "M", estadoCivil: "CASADO", identidad: "0501-1993-01122", puesto: `${P}puesto-vendedor`, planilla: "QUINCENAL", salario: 18000, ingreso: "2024-01-08", supervisor: "SPS-003", banco: "Banco de Occidente", cuenta: "140077889912" },
  { codigo: "SPS-007", nombres: ["Walter", "Noé", "Sabillón", "Cruz"], nacimiento: "1984-12-01", genero: "M", estadoCivil: "CASADO", identidad: "0501-1984-03399", puesto: `${P}puesto-supervisor-produccion`, planilla: "QUINCENAL", salario: 26500, ingreso: "2019-11-04", supervisor: "SPS-001", banco: "BAC Credomatic", cuenta: "730045671230", emailPersonal: "walter.sabillon.prueba@example.com" },
  { codigo: "SPS-008", nombres: ["José", "Armando", "Martínez", "Cáceres"], nacimiento: "1990-05-27", genero: "M", estadoCivil: "CASADO", identidad: "0501-1990-06655", puesto: `${P}puesto-operario`, planilla: "SEMANAL", salario: 13200, ingreso: "2021-06-14", supervisor: "SPS-007", banco: "Banco Atlántida", cuenta: "011066677788", sabados: true },
  { codigo: "SPS-009", nombres: ["Brenda", "Yaneth", "Orellana", "Flores"], nacimiento: "1997-10-15", genero: "F", estadoCivil: "SOLTERO", identidad: "0501-1997-08800", puesto: `${P}puesto-operario`, planilla: "SEMANAL", salario: 13200, ingreso: "2022-03-01", supervisor: "SPS-007", banco: "Banco Atlántida", cuenta: "011066677799", sabados: true },
  { codigo: "SPS-010", nombres: ["Luis", "Alberto", "Hernández", "Ponce"], nacimiento: "2001-02-20", genero: "M", estadoCivil: "SOLTERO", identidad: "0501-2001-01010", puesto: `${P}puesto-operario`, planilla: "SEMANAL", salario: 12480, ingreso: "2025-10-01", supervisor: "SPS-007", banco: "Banco de Occidente", cuenta: "140011223344", sabados: true },
  { codigo: "SPS-011", nombres: ["Carla", "Michelle", "Paz", "Zelaya"], nacimiento: "1999-08-05", genero: "F", estadoCivil: "SOLTERO", identidad: "0501-1999-04433", puesto: `${P}puesto-vendedor`, planilla: "QUINCENAL", salario: 15500, ingreso: "2026-09-21", supervisor: "SPS-003", banco: "BAC Credomatic", cuenta: "730011122233" },
  { codigo: "SPS-012", nombres: ["Óscar", "Rolando", "Díaz", "Mejía"], nacimiento: "1987-06-14", genero: "M", estadoCivil: "CASADO", identidad: "0501-1987-05544", puesto: `${P}puesto-tecnico-mantenimiento`, planilla: "QUINCENAL", salario: 21000, ingreso: "2020-04-20", supervisor: "SPS-001", banco: "Banco Ficohsa", cuenta: "200509988776", ihssFijo: 400, sabados: true },
  { codigo: "SPS-013", nombres: ["Gloria", "Esperanza", "Torres", "Vallecillo"], nacimiento: "1975-01-09", genero: "F", estadoCivil: "VIUDO", identidad: "0501-1975-02200", puesto: `${P}puesto-conserje`, planilla: "SEMANAL", salario: 11950, ingreso: "2017-07-03", supervisor: "SPS-001", banco: "Banco Atlántida", cuenta: "011099988877" },
  { codigo: "SPS-014", nombres: ["Héctor", "Manuel", "Varela", "Núñez"], nacimiento: "1994-11-11", genero: "M", estadoCivil: "SOLTERO", identidad: "0501-1994-07700", puesto: `${P}puesto-operario`, planilla: "QUINCENAL", salario: 14500, ingreso: "2023-02-06", salida: "2026-09-25", estado: "INACTIVO", supervisor: "SPS-007", banco: "Banco de Occidente", cuenta: "140055566677", sabados: true },
  { codigo: "SPS-015", nombres: ["Jennifer", "Alejandra", "Ávila", "Montoya"], nacimiento: "1996-04-02", genero: "F", estadoCivil: "SOLTERO", identidad: "0501-1996-03322", puesto: `${P}puesto-asistente-admin`, planilla: "MENSUAL", salario: 18500, ingreso: "2024-06-03", supervisor: "SPS-001", banco: "BAC Credomatic", cuenta: "730022233344", emailPersonal: "jennifer.avila.prueba@example.com" },
  { codigo: "SPS-016", nombres: ["Marvin", "Enrique", "Castellanos", "Ruiz"], nacimiento: "1992-09-30", genero: "M", estadoCivil: "CASADO", identidad: "0501-1992-06611", puesto: `${P}puesto-operario`, planilla: "SEMANAL", salario: 13200, ingreso: "2025-03-10", supervisor: "SPS-007", banco: "Banco Atlántida", cuenta: "011044455566", sabados: true },
];

/** Días sin marcaje por permiso aprobado (vacaciones, enfermedad): se pagan igual. */
const DIAS_SIN_MARCAJE: Record<string, string[]> = {
  "SPS-013": rango("2026-09-21", "2026-09-30"),
  "SPS-009": ["2026-09-08", "2026-09-09"],
  "SPS-005": ["2026-10-02"],
};

/** Ausencias injustificadas: se registran y se descuentan al doble (Art. 338/339). */
const AUSENCIAS: Record<string, string[]> = {
  "SPS-010": ["2026-09-22", "2026-09-23"],
};

/** Jornadas fuera del horario normal: horas extra por franja y feriados trabajados. */
const JORNADAS_ESPECIALES: Record<string, Record<string, [string, string]>> = {
  "SPS-008": {
    "2026-09-15": ["08:00", "16:00"], // feriado trabajado → 7 h al 200 %
    "2026-09-22": ["08:00", "19:00"], // 2 h extra diurnas
    "2026-09-23": ["08:00", "19:00"],
    "2026-09-24": ["08:00", "19:00"],
    "2026-10-05": ["08:00", "16:00"], // feriado (Semana Morazánica)
    "2026-10-07": ["08:00", "18:30"], // 1.5 h extra diurnas
  },
  "SPS-009": {
    "2026-09-28": ["08:00", "20:00"], // bloque 17:00–20:00: cruza las 19:00 → el motor lo clasifica MIXTA
    "2026-09-29": ["08:00", "20:00"],
    "2026-09-30": ["08:00", "20:00"],
    "2026-10-06": ["08:00", "20:00"],
  },
  "SPS-016": {
    "2026-09-29": ["11:00", "23:00"], // jornada termina 20:00; extra 20:00–23:00 → NOCTURNA
    "2026-10-08": ["11:00", "23:00"],
  },
  "SPS-012": {
    "2026-10-05": ["09:00", "15:00"], // feriado trabajado, 6 h de lapso → 5 h con almuerzo
    "2026-10-10": ["08:00", "12:00"], // sábado medio día: 4 h normales, sin almuerzo
  },
  "SPS-007": {
    "2026-10-01": ["08:00", "19:00"], // 2 h extra diurnas
  },
};

function rango(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let f = d(desde); f <= d(hasta); f = sumarDias(f, 1)) out.push(ymdDe(f));
  return out;
}

// ─── Programa ─────────────────────────────────────────────────────────────────

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { calcularPlanilla, diasConDerechoASalario, totalHorasExtra, calcularVacacionesDevengadas } =
    await import("../src/lib/payroll/calculos-hn");
  const { aplicarDeducciones, registrosDeAmortizacion } = await import("../src/lib/payroll/deducciones");
  const { cargarParametrosLegales } = await import("../src/lib/payroll/parametros-bd");
  const { calcularHashPlanilla } = await import("../src/lib/payroll/estado-planilla");
  const { liquidarDecimo } = await import("../src/lib/payroll/decimos");
  const { registrarMarcaje } = await import("../src/lib/asistencia/registrar-marcaje");
  const { CERO, sumar, money, redondear } = await import("../src/lib/payroll/money");
  const { calcularAniosTrabajados } = await import("../src/lib/utils");
  const bcrypt = (await import("bcryptjs")).default;
  const { validarPassword } = await import("../src/lib/auth/password");
  const passwordDemo = process.env.SEED_DEMO_PASSWORD || "Admin1234!";
  if (process.env.SEED_DEMO_PASSWORD) {
    const politica = validarPassword(passwordDemo);
    if (!politica.ok) throw new Error(`SEED_DEMO_PASSWORD no cumple la política: ${politica.errores.join(" ")}`);
  }

  console.log(DRY ? "MODO ENSAYO: se calcula y se revierte, no se escribe.\n" : "Sembrando datos de prueba…\n");

  // ── Guardas ────────────────────────────────────────────────────────────────
  const yaSembrado = await prisma.empleado.count({ where: { codigo: { startsWith: "SPS-" } } });
  if (yaSembrado > 0) {
    console.log(`Ya existen ${yaSembrado} empleados SPS-: no se vuelve a sembrar.`);
    return;
  }
  const sucursal = await prisma.sucursal.findUnique({ where: { id: SUCURSAL_ID } });
  if (!sucursal) throw new Error(`No existe la sucursal ${SUCURSAL_ID}: ejecute primero npm run db:seed`);
  const empresaId = sucursal.empresaId;

  const TABLAS = [
    "Departamento", "Puesto", "Empleado", "Contrato", "HistorialSalario", "User", "Marcaje",
    "Permiso", "SaldoVacaciones", "DeduccionEmpleado", "Planilla", "PlanillaDetalle",
    "AmortizacionPlanilla", "LiquidacionDecimo", "CompetenciaDefinicion", "PuestoCompetencia",
    "EvaluacionCampana", "Evaluacion", "EvaluacionParticipante", "CriterioEvaluacion",
    "Capacitacion", "ParticipanteCapacitacion", "ArticuloDotacion", "AsignacionDotacion",
    "Vacante", "Candidato",
  ];
  const contar = async () => {
    const out: Record<string, number> = {};
    for (const t of TABLAS) {
      const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${t}"`);
      out[t] = Number(r[0].n);
    }
    return out;
  };
  const antes = await contar();

  // Parámetros de ley vigentes: el MISMO cargador que usa la API de planillas.
  const parametros = await cargarParametrosLegales();
  console.log("Parámetros de ley cargados de la base:");
  const pct = (f: number) => (f * 100).toFixed(2).replace(/\.?0+$/, "");
  console.log(`  IHSS EM ${pct(parametros.ihssEmpleado)} % / ${pct(parametros.ihssEmpleador)} %, techo L ${parametros.ihssTope}`);
  console.log(`  IVM ${pct(parametros.ivmEmpleado)} % / ${pct(parametros.ivmEmpleador)} %, techo L ${parametros.ivmTope}`);
  console.log(`  RAP ${pct(parametros.rapEmpleado)} % / ${pct(parametros.rapEmpleador)} %, piso L ${parametros.rapPiso}, techo L ${parametros.rapTope}`);
  console.log(`  Reserva laboral ${pct(parametros.reservaLaboralEmpleador)} %, INFOP ${pct(parametros.infopEmpleador)} %, ISR ${parametros.tablaISRAnual.length} tramos, vecinal ${parametros.tablaVecinalAnual.length} tramos\n`);

  const salMin = await prisma.salarioMinimo.findFirst({ where: { activo: true }, orderBy: { anio: "desc" } });
  if (!salMin) throw new Error("No hay salario mínimo activo");

  const centros = Object.fromEntries(
    (await prisma.centroCosto.findMany({ select: { id: true, codigo: true } })).map((c) => [c.codigo, c.id])
  );
  const perfilSupervisor = await prisma.perfilAcceso.findUnique({ where: { codigo: "SUPERVISOR_SUCURSAL" } });
  const usuarioRRHH = await prisma.user.findUnique({ where: { email: "rrhh@nominahn.hn" } });
  const tipoDed = Object.fromEntries(
    (await prisma.tipoDeduccionConfig.findMany({ select: { id: true, codigo: true } })).map((t) => [t.codigo, t.id])
  );
  for (const c of ["PREST", "ADELANTO", "COOP1", "AFP-ATL"]) {
    if (!tipoDed[c]) throw new Error(`Falta el tipo de deducción ${c} del seed base`);
  }

  const resumen: string[] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        // ── Departamentos y puestos ─────────────────────────────────────────
        for (const dep of DEPARTAMENTOS) {
          await tx.departamento.create({
            data: { id: dep.id, nombre: dep.nombre, codigo: dep.codigo, sucursalId: SUCURSAL_ID, centroCostoId: centros[dep.centro] ?? null },
          });
        }
        const deptPorCodigo = Object.fromEntries(DEPARTAMENTOS.map((x) => [x.codigo, x.id]));
        for (const p of PUESTOS) {
          await tx.puesto.create({
            data: { id: p.id, nombre: p.nombre, departamentoId: deptPorCodigo[p.dept], salarioMinimo: p.min, salarioMaximo: p.max },
          });
        }
        const puestoPorId = Object.fromEntries(PUESTOS.map((p) => [p.id, p]));

        // ── Empleados, contratos e historial ────────────────────────────────
        const idDe: Record<string, string> = {};
        for (const e of EMPLEADOS) {
          const puesto = puestoPorId[e.puesto];
          const salario = redondear(e.salario);
          const emp = await tx.empleado.create({
            data: {
              id: `${P}emp-${e.codigo}`,
              codigo: e.codigo,
              primerNombre: e.nombres[0],
              segundoNombre: e.nombres[1],
              primerApellido: e.nombres[2],
              segundoApellido: e.nombres[3],
              fechaNacimiento: d(e.nacimiento),
              genero: e.genero,
              estadoCivil: e.estadoCivil,
              identidad: e.identidad,
              rtn: e.identidad.replace(/-/g, "") + "1",
              ihssNro: "SPS" + e.identidad.slice(-5) + "7",
              rapNro: "R" + e.identidad.replace(/-/g, "").slice(0, 9),
              telefonoPersonal: "+504 9" + e.identidad.slice(-7).replace(/-/g, "").padStart(7, "0"),
              contactoEmergencia: "Contacto de " + e.nombres[0],
              telefonoEmergencia: "+504 3" + e.identidad.slice(-7).replace(/-/g, "").padStart(7, "0"),
              direccion: "Col. Jardines del Valle, San Pedro Sula, Cortés",
              fechaIngreso: d(e.ingreso),
              fechaSalida: e.salida ? d(e.salida) : null,
              estado: e.estado ?? "ACTIVO",
              tipoContrato: e.codigo === "SPS-011" ? "PRUEBA" : "INDEFINIDO",
              salarioBase: salario,
              salarioDiario: redondear(salario.div(30)),
              salarioHora: redondear(salario.div(30).div(8)),
              tipoPlanilla: e.planilla,
              banco: e.banco,
              cuentaBancaria: e.cuenta,
              emailPersonal: e.emailPersonal ?? null,
              emailCorporativo: `${e.nombres[0].toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}.${e.nombres[2].toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}@empresa.hn`,
              ihssMontoFijo: e.ihssFijo ?? null,
              sucursalId: SUCURSAL_ID,
              departamentoId: deptPorCodigo[puesto.dept],
              puestoId: puesto.id,
            },
          });
          idDe[e.codigo] = emp.id;

          await tx.contrato.create({
            data: {
              id: `${P}contrato-${e.codigo}`,
              empleadoId: emp.id,
              tipoContrato: e.codigo === "SPS-011" ? "PRUEBA" : "INDEFINIDO",
              fechaInicio: d(e.ingreso),
              fechaFin: e.codigo === "SPS-011" ? d("2026-11-20") : e.salida ? d(e.salida) : null,
              salario,
              cargo: puesto.nombre,
              jornada: e.sabados ? "Diurna, 44 horas semanales (lunes a sábado)" : "Diurna, 40 horas semanales (lunes a viernes)",
              horario: "08:00 a 17:00 con una hora de almuerzo",
              activo: !e.salida,
            },
          });

          // Salario inicial, como hace POST /api/empleados.
          await tx.historialSalario.create({
            data: {
              id: `${P}hist-${e.codigo}-inicial`,
              empleadoId: emp.id,
              salarioAnterior: 0,
              salarioNuevo: e.codigo === "SPS-003" ? 35000 : salario,
              fechaCambio: d(e.ingreso),
              motivo: "Salario inicial al ingreso",
              usuarioEmail: "seed-pruebas",
            },
          });
        }
        // Aumento del 1 de julio para la jefa de ventas (pondera el décimo tercero 2026).
        await tx.historialSalario.create({
          data: {
            id: `${P}hist-SPS-003-aumento`,
            empleadoId: idDe["SPS-003"],
            salarioAnterior: 35000,
            salarioNuevo: 38500,
            fechaCambio: d("2026-07-01"),
            motivo: "Aumento por evaluación de desempeño del primer semestre",
            tipo: "INDIVIDUAL",
            usuarioEmail: "seed-pruebas",
          },
        });

        // Jefes directos (organigrama y aprobación de permisos).
        for (const e of EMPLEADOS) {
          if (e.supervisor) {
            await tx.empleado.update({ where: { id: idDe[e.codigo] }, data: { supervisorId: idDe[e.supervisor] } });
          }
        }

        // ── Usuarios vinculados ─────────────────────────────────────────────
        // Misma clave que las demás cuentas de demostración: ver passwordDemo en seed.ts.
        const hash = await bcrypt.hash(passwordDemo, 12);
        const uEmp = await tx.user.create({
          data: {
            id: `${P}user-empleado-sps`,
            email: "empleado.sps@nominahn.hn",
            name: "Jennifer Ávila",
            role: "EMPLEADO",
            password: hash,
            debeCambiarPassword: false,
          },
        });
        await tx.empleado.update({ where: { id: idDe["SPS-015"] }, data: { userId: uEmp.id } });
        const uSup = await tx.user.create({
          data: {
            id: `${P}user-supervisor-sps`,
            email: "supervisor.sps@nominahn.hn",
            name: "Walter Sabillón",
            role: "SUPERVISOR",
            password: hash,
            debeCambiarPassword: false,
            perfilId: perfilSupervisor?.id ?? null,
            sucursalesIds: [SUCURSAL_ID],
          },
        });
        await tx.empleado.update({ where: { id: idDe["SPS-007"] }, data: { userId: uSup.id } });

        // ── Deducciones individuales ────────────────────────────────────────
        const deducciones = [
          { id: `${P}ded-SPS-004-prestamo`, emp: "SPS-004", tipo: "PREST", monto: 1500, cuotas: 6, saldo: 9000, inicio: "2026-09-16", obs: "Préstamo personal de L 9,000.00 en 6 cuotas quincenales" },
          { id: `${P}ded-SPS-006-adelanto`, emp: "SPS-006", tipo: "ADELANTO", monto: 2000, cuotas: 1, saldo: 2000, inicio: "2026-09-18", obs: "Adelanto de quincena" },
          { id: `${P}ded-SPS-002-coop`, emp: "SPS-002", tipo: "COOP1", monto: 500, cuotas: null, saldo: null, inicio: "2024-01-01", obs: "Aportación mensual a la cooperativa" },
          { id: `${P}ded-SPS-001-afp`, emp: "SPS-001", tipo: "AFP-ATL", monto: 2850, cuotas: null, saldo: null, inicio: "2023-01-01", obs: "AFP voluntaria, 3 % del salario (deducible del ISR)" },
        ];
        for (const x of deducciones) {
          await tx.deduccionEmpleado.create({
            data: {
              id: x.id,
              empleadoId: idDe[x.emp],
              tipoDeduccionId: tipoDed[x.tipo],
              monto: x.monto,
              cuotasMeses: x.cuotas,
              saldo: x.saldo,
              fechaInicio: d(x.inicio),
              observacion: x.obs,
            },
          });
        }

        // ── Marcajes de asistencia ──────────────────────────────────────────
        let marcajes = 0;
        for (const e of EMPLEADOS) {
          const desde = d(e.ingreso) > d("2026-09-01") ? d(e.ingreso) : d("2026-09-01");
          const hasta = e.salida && d(e.salida) < d("2026-10-15") ? d(e.salida) : d("2026-10-15");
          const sinMarcaje = new Set(DIAS_SIN_MARCAJE[e.codigo] ?? []);
          const ausencias = new Set(AUSENCIAS[e.codigo] ?? []);
          const especiales = JORNADAS_ESPECIALES[e.codigo] ?? {};

          for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
            const ymd = ymdDe(f);
            const dow = f.getUTCDay(); // 0 = domingo
            const esFeriado = feriadosNacionales.has(ymd);
            const especial = especiales[ymd];

            if (ausencias.has(ymd)) {
              const r = await registrarMarcaje(
                { empleadoId: idDe[e.codigo], fecha: f, esAusencia: true, fuente: "MANUAL", observacion: "Ausencia injustificada: permiso rechazado" },
                tx
              );
              if (!r.ok) throw new Error(`${e.codigo} ${ymd}: ${r.error}`);
              marcajes++;
              continue;
            }
            if (sinMarcaje.has(ymd)) continue;
            if (!especial) {
              if (dow === 0) continue;
              if (dow === 6 && !e.sabados) continue;
              if (esFeriado) continue;
            }

            const [ent, sal] = especial ?? (dow === 6 ? ["08:00", "12:00"] : ["08:00", "17:00"]);
            const entrada = hn(ymd, ent);
            const salida = hn(ymd, sal);
            const lapsoHoras = (salida.getTime() - entrada.getTime()) / 3_600_000;
            // Regla FIJA de descanso.ts: 60 min si el lapso llega a 6 h.
            const minutosDescanso = lapsoHoras >= 6 ? 60 : 0;

            const r = await registrarMarcaje(
              {
                empleadoId: idDe[e.codigo],
                fecha: f,
                horaEntrada: entrada,
                horaSalida: salida,
                minutosDescanso,
                fuente: "BIOMETRICO",
                jornadaHoras: parametros.jornadaHoras,
                esDiaLibre: dow === 0,
              },
              tx
            );
            if (!r.ok) throw new Error(`${e.codigo} ${ymd}: ${r.error}`);
            marcajes++;
          }
        }
        resumen.push(`Marcajes registrados: ${marcajes}`);

        // ── Planillas (misma mecánica que POST /api/planillas) ─────────────
        type TipoP = "SEMANAL" | "QUINCENAL" | "MENSUAL";
        async function generarPlanilla(opts: {
          id: string; tipo: TipoP; desde: string; hasta: string;
          estadoFinal: "CALCULADA" | "APROBADA" | "PAGADA"; fechaPago?: string;
        }) {
          const desde = d(opts.desde), hasta = d(opts.hasta);
          const diasMes = opts.tipo === "MENSUAL" ? 30 : opts.tipo === "QUINCENAL" ? 15 : 7;

          const empleados = await tx.empleado.findMany({
            where: {
              tipoPlanilla: opts.tipo,
              sucursalId: SUCURSAL_ID,
              fechaIngreso: { lte: hasta },
              // Mismo filtro que POST /api/planillas (ver hallazgo: VACACIONES y PERMISO quedan fuera).
              OR: [{ estado: "ACTIVO" }, { fechaSalida: { gte: desde, lte: hasta } }],
            },
            include: {
              deducciones: {
                where: { activo: true, fechaInicio: { lte: hasta }, OR: [{ fechaFin: null }, { fechaFin: { gte: desde } }] },
                include: { tipoDeduccion: true },
              },
            },
          });
          if (empleados.length === 0) throw new Error(`Sin empleados para ${opts.tipo} ${opts.desde}`);

          const marcajesPeriodo = await tx.marcaje.findMany({
            where: { empleadoId: { in: empleados.map((e) => e.id) }, fecha: { gte: desde, lte: hasta } },
            select: { empleadoId: true, esAusencia: true, horasExtra: true, horasExtraDiurna: true, horasExtraMixta: true, horasExtraNocturna: true, horasFeriado: true },
          });
          const ausPorEmp = new Map<string, number>();
          const extraPorEmp = new Map<string, { diurnas: number; mixtas: number; nocturnas: number; feriado: number }>();
          for (const m of marcajesPeriodo) {
            if (m.esAusencia) ausPorEmp.set(m.empleadoId, (ausPorEmp.get(m.empleadoId) ?? 0) + 1);
            const acc = extraPorEmp.get(m.empleadoId) ?? { diurnas: 0, mixtas: 0, nocturnas: 0, feriado: 0 };
            acc.diurnas += Number(m.horasExtraDiurna);
            acc.mixtas += Number(m.horasExtraMixta);
            acc.nocturnas += Number(m.horasExtraNocturna);
            acc.feriado += Number(m.horasFeriado);
            extraPorEmp.set(m.empleadoId, acc);
          }

          const detalles: Omit<Prisma.PlanillaDetalleCreateManyInput, "planillaId">[] = [];
          const amortizaciones: ReturnType<typeof aplicarDeducciones>["amortizaciones"] = [];
          let totalBruto = CERO, totalDeducciones = CERO, totalNeto = CERO, totalEmpleador = CERO;
          const lineas: string[] = [];

          for (const emp of empleados) {
            const diasPagables = diasConDerechoASalario({ fechaIngreso: emp.fechaIngreso, fechaSalida: emp.fechaSalida, desde, hasta, diasMes });
            if (diasPagables <= 0) continue;
            const diasAusentes = ausPorEmp.get(emp.id) ?? 0;
            const horasExtra = extraPorEmp.get(emp.id) ?? {};
            const ded = aplicarDeducciones(
              emp.deducciones.map((x) => ({ id: x.id, monto: x.monto, saldo: x.saldo, cuotasMeses: x.cuotasMeses, cuotasPagadas: x.cuotasPagadas, tipo: x.tipoDeduccion.tipo }))
            );
            amortizaciones.push(...ded.amortizaciones);

            const r = calcularPlanilla(
              {
                salarioMensual: emp.salarioBase,
                tipoPlanilla: opts.tipo,
                diasPagables,
                diasMes,
                horasExtra,
                bonificaciones: 0,
                otrosIngresos: 0,
                diasAusentes,
                otrosDeducciones: ded.total,
                afpEmpleado: ded.afp,
                aniosTrabajados: calcularAniosTrabajados(emp.fechaIngreso),
                ihssMontoFijoMensual: emp.ihssMontoFijo,
              },
              parametros
            );

            detalles.push({
              empleadoId: emp.id,
              salarioBase: r.salarioBase,
              diasTrabajados: Math.max(0, diasPagables - diasAusentes),
              horasExtra: totalHorasExtra(horasExtra),
              montoHorasExtra: r.montoHorasExtra,
              bonificaciones: 0,
              totalBruto: r.totalBruto,
              ihssEmpleado: r.ihssEmpleado,
              rapEmpleado: r.rapEmpleado,
              afpEmpleado: r.afpEmpleado,
              isr: r.isr,
              impuestoVecinal: r.impuestoVecinal,
              cooperativa: ded.cooperativa,
              prestamos: ded.prestamos,
              adelantos: ded.adelantos,
              ausencias: r.ausencias,
              otrosDeducciones: ded.otros,
              totalDeducciones: r.totalDeducciones,
              ihssEmpleador: r.ihssEmpleador,
              rapEmpleador: r.rapEmpleador,
              infop: r.infop,
              reservaLaboral: r.reservaLaboral,
              ivmEmpleado: r.ivmEmpleado,
              ivmEmpleador: r.ivmEmpleador,
              ivmEstado: r.ivmEstado,
              ihssFijo: r.ihssFijo,
              salarioNeto: r.salarioNeto,
              provision13vo: r.provision13vo,
              provision14vo: r.provision14vo,
              provisionVacaciones: r.provisionVacaciones,
            });
            totalBruto = totalBruto.plus(r.totalBruto);
            totalDeducciones = totalDeducciones.plus(r.totalDeducciones);
            totalNeto = totalNeto.plus(r.salarioNeto);
            totalEmpleador = totalEmpleador.plus(sumar(r.ihssEmpleador, r.rapEmpleador, r.infop, r.reservaLaboral));

            const he = totalHorasExtra(horasExtra);
            lineas.push(
              `    ${emp.codigo}  días ${String(diasPagables).padStart(2)}  HE ${he.toFixed(1).padStart(4)}h L ${r.montoHorasExtra.toFixed(2).padStart(9)}  bruto ${r.totalBruto.toFixed(2).padStart(10)}  IHSS ${r.ihssEmpleado.toFixed(2).padStart(7)}${r.ihssFijo ? "*" : " "} RAP ${r.rapEmpleado.toFixed(2).padStart(7)}  ISR ${r.isr.toFixed(2).padStart(8)}  vec ${r.impuestoVecinal.toFixed(2).padStart(6)}  aus ${r.ausencias.toFixed(2).padStart(8)}  otras ${money(ded.total).plus(ded.afp).toFixed(2).padStart(8)}  neto ${r.salarioNeto.toFixed(2).padStart(10)}`
            );
          }

          const planilla = await tx.planilla.create({
            data: { id: opts.id, empresaId, sucursalId: SUCURSAL_ID, tipo: opts.tipo, estado: "BORRADOR", fechaInicio: desde, fechaFin: hasta, totalBruto, totalDeducciones, totalNeto, totalEmpleador },
          });
          await tx.planillaDetalle.createMany({ data: detalles.map((x) => ({ ...x, planillaId: planilla.id })) });

          // Amortización de préstamos y adelantos, con su registro para poder revertirla.
          for (const a of amortizaciones) {
            await tx.deduccionEmpleado.update({
              where: { id: a.id },
              data: { cuotasPagadas: a.cuotasPagadas, ...(a.saldo !== null ? { saldo: a.saldo } : {}), ...(a.desactivar ? { activo: false } : {}) },
            });
          }
          if (amortizaciones.length > 0) {
            await tx.amortizacionPlanilla.createMany({
              data: registrosDeAmortizacion(amortizaciones).map((x) => ({ planillaId: planilla.id, deduccionId: x.deduccionId, montoAplicado: x.montoAplicado, llevaSaldo: x.llevaSaldo, desactivo: x.desactivo })),
            });
          }

          // Máquina de estados: BORRADOR → CALCULADA → APROBADA → PAGADA. Cada
          // paso cambia sólo los campos que el trigger de inmutabilidad permite.
          await tx.planilla.update({ where: { id: planilla.id }, data: { estado: "CALCULADA" } });
          if (opts.estadoFinal === "APROBADA" || opts.estadoFinal === "PAGADA") {
            const hashCalculo = calcularHashPlanilla(detalles.map((x) => ({ empleadoId: x.empleadoId, totalBruto: x.totalBruto, totalDeducciones: x.totalDeducciones, salarioNeto: x.salarioNeto })));
            await tx.planilla.update({
              where: { id: planilla.id },
              data: { estado: "APROBADA", aprobadoPor: usuarioRRHH?.id ?? null, cerradaAt: hn(opts.hasta, "17:00"), hashCalculo },
            });
          }
          if (opts.estadoFinal === "PAGADA") {
            await tx.planilla.update({
              where: { id: planilla.id },
              data: { estado: "PAGADA", pagadoPor: usuarioRRHH?.id ?? null, fechaPago: d(opts.fechaPago ?? opts.hasta) },
            });
          }

          resumen.push(
            `Planilla ${opts.tipo} ${opts.desde} al ${opts.hasta} → ${opts.estadoFinal}: ${detalles.length} empleados, bruto L ${totalBruto.toFixed(2)}, deducciones L ${totalDeducciones.toFixed(2)}, neto L ${totalNeto.toFixed(2)}, aportes patronales L ${totalEmpleador.toFixed(2)}`,
            ...lineas
          );
        }

        // En orden cronológico: las cuotas de préstamos y adelantos se amortizan
        // planilla a planilla, como ocurre en la operación real.
        await generarPlanilla({ id: `${P}planilla-s-2026-09-14`, tipo: "SEMANAL", desde: "2026-09-14", hasta: "2026-09-20", estadoFinal: "PAGADA", fechaPago: "2026-09-19" });
        await generarPlanilla({ id: `${P}planilla-s-2026-09-21`, tipo: "SEMANAL", desde: "2026-09-21", hasta: "2026-09-27", estadoFinal: "PAGADA", fechaPago: "2026-09-26" });
        await generarPlanilla({ id: `${P}planilla-q-2026-09-16`, tipo: "QUINCENAL", desde: "2026-09-16", hasta: "2026-09-30", estadoFinal: "PAGADA", fechaPago: "2026-09-30" });
        await generarPlanilla({ id: `${P}planilla-m-2026-09`, tipo: "MENSUAL", desde: "2026-09-01", hasta: "2026-09-30", estadoFinal: "PAGADA", fechaPago: "2026-09-30" });
        await generarPlanilla({ id: `${P}planilla-s-2026-09-28`, tipo: "SEMANAL", desde: "2026-09-28", hasta: "2026-10-04", estadoFinal: "PAGADA", fechaPago: "2026-10-02" });
        await generarPlanilla({ id: `${P}planilla-s-2026-10-05`, tipo: "SEMANAL", desde: "2026-10-05", hasta: "2026-10-11", estadoFinal: "CALCULADA" });
        await generarPlanilla({ id: `${P}planilla-q-2026-10-01`, tipo: "QUINCENAL", desde: "2026-10-01", hasta: "2026-10-15", estadoFinal: "APROBADA" });

        // ── Décimo cuarto mes 2026 (devengo jul-2025 a jun-2026, pagado en junio) ──
        let decimos = 0;
        for (const e of EMPLEADOS) {
          const liq = liquidarDecimo(
            { tipo: "DECIMO_CUARTO", anio: 2026, fechaIngreso: d(e.ingreso), fechaSalida: e.salida ? d(e.salida) : null, salarioPromedio: e.codigo === "SPS-003" ? 35000 : e.salario },
            { salarioMinimo: salMin.monto, rentaOrdinariaAnual: money(e.salario).times(12), parametros }
          );
          if (liq.diasComputados <= 0) continue;
          await tx.liquidacionDecimo.create({
            data: {
              id: `${P}decimo14-2026-${e.codigo}`,
              empleadoId: idDe[e.codigo],
              tipo: "DECIMO_CUARTO",
              anio: 2026,
              periodoDesde: liq.periodoDesde,
              periodoHasta: liq.periodoHasta,
              diasComputados: liq.diasComputados,
              salarioPromedio: liq.salarioPromedio,
              montoDevengado: liq.montoDevengado,
              montoExento: liq.montoExento,
              montoGravado: liq.montoGravado,
              isrRetenido: liq.isrRetenido,
              montoPagado: liq.montoNeto,
              estado: "PAGADA",
              esProporcional: liq.esProporcional,
              fechaPago: d("2026-06-30"),
              calculadoPor: usuarioRRHH?.id ?? null,
              pagadoPor: usuarioRRHH?.id ?? null,
            },
          });
          decimos++;
          resumen.push(`    14.º ${e.codigo}: ${liq.diasComputados} días, devengado L ${liq.montoDevengado.toFixed(2)}, exento L ${liq.montoExento.toFixed(2)}, ISR L ${liq.isrRetenido.toFixed(2)}${liq.esProporcional ? " (proporcional)" : ""}`);
        }
        resumen.splice(resumen.length - decimos, 0, `Décimo cuarto 2026 liquidado: ${decimos} empleados`);

        // ── Vacaciones y permisos ───────────────────────────────────────────
        const permisos: { id: string; emp: string; tipo: Prisma.PermisoCreateInput["tipo"]; desde: string; hasta: string; estado: "APROBADO" | "RECHAZADO" | "PENDIENTE"; motivo: string; obs?: string }[] = [
          { id: `${P}permiso-SPS-013-vac-2025`, emp: "SPS-013", tipo: "VACACIONES", desde: "2025-12-15", hasta: "2025-12-24", estado: "APROBADO", motivo: "Vacaciones de fin de año" },
          { id: `${P}permiso-SPS-013-vac-2026`, emp: "SPS-013", tipo: "VACACIONES", desde: "2026-09-21", hasta: "2026-09-30", estado: "APROBADO", motivo: "Vacaciones anuales" },
          { id: `${P}permiso-SPS-001-vac-2026`, emp: "SPS-001", tipo: "VACACIONES", desde: "2026-04-06", hasta: "2026-04-10", estado: "APROBADO", motivo: "Semana Santa con la familia" },
          { id: `${P}permiso-SPS-009-enf`, emp: "SPS-009", tipo: "ENFERMEDAD", desde: "2026-09-08", hasta: "2026-09-09", estado: "APROBADO", motivo: "Incapacidad médica del IHSS por dos días", obs: "Constancia del IHSS en el expediente" },
          { id: `${P}permiso-SPS-005-personal`, emp: "SPS-005", tipo: "PERSONAL", desde: "2026-10-02", hasta: "2026-10-02", estado: "APROBADO", motivo: "Trámite personal" },
          { id: `${P}permiso-SPS-008-pat`, emp: "SPS-008", tipo: "PATERNIDAD", desde: "2026-08-10", hasta: "2026-08-12", estado: "APROBADO", motivo: "Nacimiento de su hija" },
          { id: `${P}permiso-SPS-015-vac-nov`, emp: "SPS-015", tipo: "VACACIONES", desde: "2026-11-02", hasta: "2026-11-06", estado: "PENDIENTE", motivo: "Viaje familiar" },
          { id: `${P}permiso-SPS-006-singoce`, emp: "SPS-006", tipo: "SIN_GOCE", desde: "2026-09-14", hasta: "2026-09-14", estado: "RECHAZADO", motivo: "Asunto personal", obs: "Cierre de mes comercial: no se autoriza" },
          { id: `${P}permiso-SPS-010-personal`, emp: "SPS-010", tipo: "PERSONAL", desde: "2026-09-22", hasta: "2026-09-23", estado: "RECHAZADO", motivo: "Viaje", obs: "Solicitado el mismo día; no se autoriza. Los días se registran como ausencia injustificada." },
        ];
        const tomadosPorEmp = new Map<string, number>();
        for (const x of permisos) {
          const dias = rango(x.desde, x.hasta).length;
          await tx.permiso.create({
            data: {
              id: x.id,
              empleadoId: idDe[x.emp],
              tipo: x.tipo,
              fechaInicio: d(x.desde),
              fechaFin: d(x.hasta),
              diasSolicitados: dias,
              diasAprobados: x.estado === "APROBADO" ? dias : null,
              estado: x.estado,
              motivo: x.motivo,
              observacion: x.obs ?? null,
              aprobadoPor: x.estado === "PENDIENTE" ? null : usuarioRRHH?.id ?? null,
            },
          });
          if (x.estado === "APROBADO" && x.tipo === "VACACIONES") {
            tomadosPorEmp.set(x.emp, (tomadosPorEmp.get(x.emp) ?? 0) + dias);
          }
        }
        for (const e of EMPLEADOS) {
          const tomados = tomadosPorEmp.get(e.codigo) ?? 0;
          const devengado = calcularVacacionesDevengadas(d(e.ingreso), e.salida ? d(e.salida) : new Date());
          await tx.saldoVacaciones.create({
            data: { id: `${P}saldo-${e.codigo}`, empleadoId: idDe[e.codigo], anio: 2026, diasTomados: tomados, diasDisponibles: Math.round((devengado - tomados) * 100) / 100 },
          });
        }
        resumen.push(`Permisos: ${permisos.length} (${permisos.filter((x) => x.estado === "APROBADO").length} aprobados); saldos de vacaciones: ${EMPLEADOS.length}`);

        // ── Competencias y matriz por puesto ────────────────────────────────
        const competencias = [
          { id: `${P}comp-equipo`, nombre: "Trabajo en equipo", categoria: "CORE", descripcion: "Coopera, comparte información y apoya a sus compañeros para lograr los objetivos del área." },
          { id: `${P}comp-cliente`, nombre: "Orientación al cliente", categoria: "CORE", descripcion: "Entiende las necesidades del cliente interno y externo y responde con oportunidad." },
          { id: `${P}comp-seguridad`, nombre: "Seguridad industrial", categoria: "TECNICA", descripcion: "Aplica las normas de seguridad, usa el EPP y reporta condiciones inseguras." },
          { id: `${P}comp-liderazgo`, nombre: "Liderazgo", categoria: "LIDERAZGO", descripcion: "Dirige, delega y desarrolla a su equipo con criterios claros." },
          { id: `${P}comp-comunicacion`, nombre: "Comunicación", categoria: "COMPORTAMIENTO", descripcion: "Se expresa con claridad por escrito y de forma verbal; escucha activamente." },
          { id: `${P}comp-excel`, nombre: "Hojas de cálculo", categoria: "TECNICA", descripcion: "Maneja Excel para controles, conciliaciones y reportes." },
        ];
        for (const c of competencias) await tx.competenciaDefinicion.create({ data: c });
        const matriz: [string, string, Prisma.PuestoCompetenciaCreateInput["nivelRequerido"], number][] = [
          [`${P}puesto-operario`, `${P}comp-seguridad`, "AVANZADO", 2],
          [`${P}puesto-operario`, `${P}comp-equipo`, "INTERMEDIO", 1],
          [`${P}puesto-supervisor-produccion`, `${P}comp-liderazgo`, "AVANZADO", 2],
          [`${P}puesto-supervisor-produccion`, `${P}comp-seguridad`, "EXPERTO", 2],
          [`${P}puesto-supervisor-produccion`, `${P}comp-comunicacion`, "INTERMEDIO", 1],
          [`${P}puesto-vendedor`, `${P}comp-cliente`, "AVANZADO", 2],
          [`${P}puesto-vendedor`, `${P}comp-comunicacion`, "AVANZADO", 1.5],
          [`${P}puesto-jefe-ventas`, `${P}comp-liderazgo`, "AVANZADO", 2],
          [`${P}puesto-jefe-ventas`, `${P}comp-cliente`, "EXPERTO", 2],
          [`${P}puesto-contador-sucursal`, `${P}comp-excel`, "EXPERTO", 2],
          [`${P}puesto-asistente-admin`, `${P}comp-excel`, "INTERMEDIO", 1],
          [`${P}puesto-asistente-admin`, `${P}comp-comunicacion`, "INTERMEDIO", 1],
        ];
        for (const [puestoId, competenciaId, nivel, peso] of matriz) {
          await tx.puestoCompetencia.create({ data: { puestoId, competenciaId, nivelRequerido: nivel, peso } });
        }

        // ── Evaluaciones de desempeño ───────────────────────────────────────
        const campana = await tx.evaluacionCampana.create({
          data: {
            id: `${P}campana-2026-09`,
            nombre: "Evaluación de desempeño de septiembre 2026",
            tipo: "DESEMPENO_MENSUAL",
            estado: "FINALIZADA",
            periodo: "2026-09",
            fechaInicio: d("2026-09-25"),
            fechaFin: d("2026-10-05"),
            incluirAuto: true,
            incluirJefe: true,
            sucursalId: SUCURSAL_ID,
            emailEnviado: true,
            createdBy: usuarioRRHH?.id ?? "seed-pruebas",
          },
        });

        type Eval = {
          emp: string; tipo: "DESEMPENO_MENSUAL" | "COMPETENCIA_TRIMESTRAL"; periodo: string;
          estado: "FINALIZADA" | "EN_PROGRESO" | "PENDIENTE_FIRMA"; auto: number; jefe: number;
          desempeno?: number; potencial?: number; fortalezas?: string; mejoras?: string; objetivos?: string;
          criterios?: [string, number][];
        };
        const evaluaciones: Eval[] = [
          { emp: "SPS-004", tipo: "DESEMPENO_MENSUAL", periodo: "2026-09", estado: "FINALIZADA", auto: 85, jefe: 79, desempeno: 82, potencial: 70, fortalezas: "Orden y puntualidad en los cierres.", mejoras: "Dominio de tablas dinámicas.", objetivos: "Conciliar bancos sin apoyo en noviembre.", criterios: [[`${P}comp-excel`, 78], [`${P}comp-comunicacion`, 86]] },
          { emp: "SPS-005", tipo: "DESEMPENO_MENSUAL", periodo: "2026-09", estado: "FINALIZADA", auto: 92, jefe: 90, desempeno: 91, potencial: 85, fortalezas: "Supera la cuota tres meses seguidos.", mejoras: "Seguimiento posventa.", objetivos: "Abrir diez cuentas nuevas en el trimestre.", criterios: [[`${P}comp-cliente`, 94], [`${P}comp-comunicacion`, 88]] },
          { emp: "SPS-008", tipo: "DESEMPENO_MENSUAL", periodo: "2026-09", estado: "FINALIZADA", auto: 80, jefe: 72, desempeno: 76, potencial: 60, fortalezas: "Disponibilidad para horas extra y feriados.", mejoras: "Uso constante del EPP.", objetivos: "Cero observaciones de seguridad en octubre.", criterios: [[`${P}comp-seguridad`, 70], [`${P}comp-equipo`, 82]] },
          { emp: "SPS-012", tipo: "DESEMPENO_MENSUAL", periodo: "2026-09", estado: "FINALIZADA", auto: 90, jefe: 86, desempeno: 88, potencial: 78, fortalezas: "Resuelve paros de línea en menos de una hora.", mejoras: "Documentar el mantenimiento preventivo.", objetivos: "Plan preventivo trimestral entregado.", criterios: [[`${P}comp-seguridad`, 90], [`${P}comp-equipo`, 86]] },
          { emp: "SPS-002", tipo: "DESEMPENO_MENSUAL", periodo: "2026-09", estado: "FINALIZADA", auto: 88, jefe: 82, desempeno: 85, potencial: 80, fortalezas: "Cierres contables a tiempo.", mejoras: "Delegar tareas operativas.", objetivos: "Automatizar la partida de nómina.", criterios: [[`${P}comp-excel`, 92], [`${P}comp-comunicacion`, 78]] },
          { emp: "SPS-007", tipo: "COMPETENCIA_TRIMESTRAL", periodo: "2026-T3", estado: "FINALIZADA", auto: 82, jefe: 76, desempeno: 79, potencial: 82, fortalezas: "Conoce la línea y a su gente.", mejoras: "Retroalimentación formal a su equipo.", objetivos: "Una reunión de seguridad semanal.", criterios: [[`${P}comp-liderazgo`, 76], [`${P}comp-seguridad`, 84], [`${P}comp-comunicacion`, 74]] },
          { emp: "SPS-003", tipo: "COMPETENCIA_TRIMESTRAL", periodo: "2026-T3", estado: "FINALIZADA", auto: 94, jefe: 92, desempeno: 93, potencial: 90, fortalezas: "Resultados y desarrollo de su equipo.", mejoras: "Planificación de inventario.", objetivos: "Plan comercial 2027 en noviembre.", criterios: [[`${P}comp-liderazgo`, 93], [`${P}comp-cliente`, 95]] },
          { emp: "SPS-009", tipo: "DESEMPENO_MENSUAL", periodo: "2026-10", estado: "EN_PROGRESO", auto: 0, jefe: 0 },
          { emp: "SPS-006", tipo: "DESEMPENO_MENSUAL", periodo: "2026-09", estado: "PENDIENTE_FIRMA", auto: 78, jefe: 74 },
        ];
        let participantes = 0, criterios = 0;
        for (const ev of evaluaciones) {
          const sup = EMPLEADOS.find((x) => x.codigo === ev.emp)?.supervisor;
          const completada = ev.estado !== "EN_PROGRESO";
          const final = completada ? Math.round(((ev.auto + ev.jefe) / 2) * 100) / 100 : 0;
          const e = await tx.evaluacion.create({
            data: {
              id: `${P}eval-${ev.emp}-${ev.periodo}`,
              empleadoId: idDe[ev.emp],
              tipo: ev.tipo,
              periodo: ev.periodo,
              estado: ev.estado,
              campanaId: ev.periodo === "2026-09" && ev.tipo === "DESEMPENO_MENSUAL" ? campana.id : null,
              calificacion: ev.estado === "FINALIZADA" ? final : 0,
              desempeno: ev.desempeno ?? null,
              potencial: ev.potencial ?? null,
              fortalezas: ev.fortalezas ?? null,
              mejoras: ev.mejoras ?? null,
              objetivos: ev.objetivos ?? null,
              fechaFirma: ev.estado === "FINALIZADA" ? hn("2026-10-05", "10:00") : null,
            },
          });
          const partes: { rol: "AUTOEVALUACION" | "JEFE_DIRECTO"; evaluador: string; nota: number }[] = [
            { rol: "AUTOEVALUACION", evaluador: ev.emp, nota: ev.auto },
          ];
          if (sup) partes.push({ rol: "JEFE_DIRECTO", evaluador: sup, nota: ev.jefe });
          for (const pt of partes) {
            const participante = await tx.evaluacionParticipante.create({
              data: {
                id: `${P}part-${ev.emp}-${ev.periodo}-${pt.rol}`,
                evaluacionId: e.id,
                evaluadorId: idDe[pt.evaluador],
                rol: pt.rol,
                estado: completada ? "COMPLETADO" : "PENDIENTE",
                calificacion: completada ? pt.nota : null,
                fechaCompletado: completada ? hn("2026-10-02", "16:00") : null,
                tokenAcceso: `${P}token-${ev.emp}-${ev.periodo}-${pt.rol}`.toLowerCase(),
              },
            });
            participantes++;
            if (completada && ev.criterios) {
              for (const [competenciaId, nota] of ev.criterios) {
                const comp = competencias.find((c) => c.id === competenciaId)!;
                await tx.criterioEvaluacion.create({
                  data: { evaluacionId: e.id, participanteId: participante.id, competenciaId, criterio: comp.nombre, nivelRequerido: 3, calificacion: Math.min(100, nota + (pt.rol === "AUTOEVALUACION" ? 3 : -3)), peso: 1 },
                });
                criterios++;
              }
            }
          }
          if (ev.estado === "FINALIZADA" && ev.criterios) {
            for (const [competenciaId, nota] of ev.criterios) {
              const comp = competencias.find((c) => c.id === competenciaId)!;
              await tx.criterioEvaluacion.create({ data: { evaluacionId: e.id, competenciaId, criterio: comp.nombre, nivelRequerido: 3, calificacion: nota, peso: 1 } });
              criterios++;
            }
          }
        }
        resumen.push(`Evaluaciones: ${evaluaciones.length} (${evaluaciones.filter((x) => x.estado === "FINALIZADA").length} finalizadas), participantes ${participantes}, criterios ${criterios}; competencias ${competencias.length}, matriz por puesto ${matriz.length}`);

        // ── Capacitaciones ──────────────────────────────────────────────────
        const cap1 = await tx.capacitacion.create({
          data: { id: `${P}cap-seguridad`, nombre: "Inducción en seguridad industrial y uso de EPP", descripcion: "Normas de seguridad en planta, uso correcto del equipo de protección y reporte de incidentes.", tipo: "INTERNA", proveedor: "Supervisión de producción", fechaInicio: d("2026-08-17"), fechaFin: d("2026-08-18"), costoPresupuestado: 3500, costoReal: 3120, estado: "FINALIZADA", creadoPor: usuarioRRHH?.id ?? null },
        });
        const cap2 = await tx.capacitacion.create({
          data: { id: `${P}cap-excel`, nombre: "Excel para control de inventarios y conciliaciones", descripcion: "Tablas dinámicas, BUSCARX y validación de datos aplicados a los controles de la sucursal.", tipo: "EXTERNA", proveedor: "INFOP San Pedro Sula", fechaInicio: d("2026-10-12"), fechaFin: d("2026-10-23"), costoPresupuestado: 9800, estado: "EN_CURSO", creadoPor: usuarioRRHH?.id ?? null },
        });
        const asistentes1: [string, boolean, number | null][] = [["SPS-007", true, 95], ["SPS-008", true, 78], ["SPS-009", true, 88], ["SPS-010", true, 72], ["SPS-012", true, 91], ["SPS-016", false, null], ["SPS-014", true, 80]];
        for (const [emp, asistio, nota] of asistentes1) {
          await tx.participanteCapacitacion.create({ data: { capacitacionId: cap1.id, empleadoId: idDe[emp], asistio, aprobado: nota === null ? false : nota >= 75, calificacion: nota, observacion: nota === null ? "No se presentó; reprogramar." : null } });
        }
        for (const emp of ["SPS-002", "SPS-004", "SPS-015", "SPS-005"]) {
          await tx.participanteCapacitacion.create({ data: { capacitacionId: cap2.id, empleadoId: idDe[emp], asistio: emp !== "SPS-005" } });
        }
        resumen.push(`Capacitaciones: 2 (participantes ${asistentes1.length + 4})`);

        // ── Dotaciones (EPP) ────────────────────────────────────────────────
        const casco = await tx.articuloDotacion.create({ data: { id: `${P}art-casco`, nombre: "Casco de seguridad", categoria: "EPP", vidaUtilMeses: 24 } });
        const botas = await tx.articuloDotacion.create({ data: { id: `${P}art-botas`, nombre: "Botas de seguridad con punta de acero", categoria: "EPP", requiereTalla: true, vidaUtilMeses: 12 } });
        let dotaciones = 0;
        for (const emp of ["SPS-008", "SPS-009", "SPS-010", "SPS-012", "SPS-016"]) {
          await tx.asignacionDotacion.create({ data: { empleadoId: idDe[emp], articuloId: casco.id, fechaEntrega: d("2026-08-18"), fechaVencimiento: d("2028-08-18"), entregadoPor: "Supervisión de producción" } });
          await tx.asignacionDotacion.create({ data: { empleadoId: idDe[emp], articuloId: botas.id, talla: emp === "SPS-009" ? "37" : "42", fechaEntrega: d("2026-08-18"), fechaVencimiento: d("2027-08-18"), entregadoPor: "Supervisión de producción" } });
          dotaciones += 2;
        }
        resumen.push(`Dotaciones: 2 artículos, ${dotaciones} asignaciones`);

        // ── Reclutamiento ───────────────────────────────────────────────────
        const vac1 = await tx.vacante.create({
          data: { id: `${P}vacante-operario`, titulo: "Operario de producción (turno diurno)", descripcion: "Operación de línea de empaque, control de calidad básico y orden del área.", requisitos: "Educación media; experiencia de un año en planta; disponibilidad para horas extra.", departamentoId: `${P}dept-SPS-PROD`, tipoContrato: "INDEFINIDO", salarioMin: 12480, salarioMax: 14000, plazas: 2, estado: "ABIERTA", fechaApertura: d("2026-09-28"), creadoPor: usuarioRRHH?.id ?? null },
        });
        const vac2 = await tx.vacante.create({
          data: { id: `${P}vacante-vendedor`, titulo: "Vendedor de mostrador", descripcion: "Atención al cliente en sala de ventas y seguimiento de pedidos.", requisitos: "Experiencia en ventas; manejo básico de Excel.", departamentoId: `${P}dept-SPS-VEN`, tipoContrato: "PRUEBA", salarioMin: 15000, salarioMax: 17000, plazas: 1, estado: "CERRADA", fechaApertura: d("2026-08-24"), fechaCierre: d("2026-09-18"), creadoPor: usuarioRRHH?.id ?? null },
        });
        const candidatos: Prisma.CandidatoCreateManyInput[] = [
          { vacanteId: vac1.id, nombre: "Josué David Amador", email: "josue.amador.prueba@example.com", telefono: "+504 9444-1001", fuente: "Referido", etapa: "ENTREVISTA", notas: "Dos años en empacadora; entrevista técnica el 20 de octubre." },
          { vacanteId: vac1.id, nombre: "Karen Lizeth Maldonado", email: "karen.maldonado.prueba@example.com", telefono: "+504 9444-1002", fuente: "Bolsa de empleo", etapa: "PRESELECCION" },
          { vacanteId: vac1.id, nombre: "Edwin Alexander Núñez", telefono: "+504 9444-1003", fuente: "Bolsa de empleo", etapa: "RECIBIDO" },
          { vacanteId: vac1.id, nombre: "Marlon Ortiz", telefono: "+504 9444-1004", fuente: "Redes sociales", etapa: "RECHAZADO", notas: "Sin disponibilidad para sábados." },
          { vacanteId: vac2.id, nombre: "Carla Michelle Paz Zelaya", email: "carla.paz.prueba@example.com", telefono: "+504 9444-2001", fuente: "Referido", etapa: "CONTRATADO", notas: "Contratada el 21 de septiembre con período de prueba de 60 días (SPS-011)." },
          { vacanteId: vac2.id, nombre: "Daniel Figueroa", telefono: "+504 9444-2002", fuente: "Bolsa de empleo", etapa: "RECHAZADO" },
        ];
        await tx.candidato.createMany({ data: candidatos });
        resumen.push(`Reclutamiento: 2 vacantes, ${candidatos.length} candidatos`);

        if (DRY) throw new EnsayoRevertido();
      },
      // Una hora: contra la base de Seenode (Frankfurt, ~0,4 s por consulta)
      // los miles de consultas no caben en diez minutos y se revertía todo.
      { timeout: 3_600_000, maxWait: 20_000 }
    );
  } catch (e) {
    if (!(e instanceof EnsayoRevertido)) throw e;
  }

  console.log(resumen.join("\n"));

  const despues = await contar();
  console.log("\nFilas por tabla (antes → después):");
  for (const t of TABLAS) {
    const delta = despues[t] - antes[t];
    console.log(`  ${t.padEnd(26)} ${String(antes[t]).padStart(5)} → ${String(despues[t]).padStart(5)}  ${delta ? `(+${delta})` : ""}`);
  }
  console.log(DRY ? "\nENSAYO revertido: la base no cambió." : "\nDatos de prueba guardados.");
  await prisma.$disconnect();
}

// Feriados nacionales 2026 (los que el seed base carga): se usan para no generar
// marcajes ordinarios en esos días; el recargo lo decide `registrarMarcaje`
// consultando la tabla Feriado.
const feriadosNacionales = new Set([
  "2026-01-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-14", "2026-05-01",
  "2026-09-15", "2026-10-03", "2026-10-04", "2026-10-05", "2026-12-25",
]);

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
