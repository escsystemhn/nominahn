import { PrismaClient, Prisma, type Sucursal, type Departamento, type Puesto } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import {
  PERMISOS_POR_ROL,
  TODOS_LOS_PERMISOS,
  permisosNoVistos,
} from "../src/lib/auth/permisos";
import { generarPasswordTemporal, validarPassword } from "../src/lib/auth/password";
import { sembrarCatalogo } from "../src/lib/payroll/plan-cuentas";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

/**
 * MODO INSTALACIÓN (`SEED_INSTALACION=1`), el que usa el instalador de Windows.
 *
 * Un servidor en la red del cliente no puede arrancar con las cuentas de
 * demostración: todas comparten `Admin1234!`, que está publicada, y cualquiera en
 * la LAN entraría como RRHH o contador. En este modo se crea UNA sola cuenta, la
 * del administrador, con el correo y la contraseña que la persona eligió en el
 * asistente (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`). Como la eligió ella y no
 * otra persona, no arranca marcada como temporal. `SEED_EMPRESA_NOMBRE` pone el
 * nombre de la empresa en el login y en la barra superior desde el primer día.
 *
 * El resto (catálogo, ISR, vecinal, feriados, perfiles) se siembra igual.
 */
const INSTALACION = process.env.SEED_INSTALACION === "1";

/**
 * Contraseña de las cuentas de demostración.
 *
 * `Admin1234!` está publicada: sirve en el equipo de desarrollo y en una red
 * cerrada, no en una URL de internet como `*.seenode.app`, donde la primera
 * persona que la pruebe entra como RRHH. `SEED_DEMO_PASSWORD` la sustituye y
 * debe cumplir la misma política que cualquier otra cuenta.
 * scripts/preparar-bd-remota.mjs la exige para sembrar demostración fuera.
 */
function passwordDemo(): string {
  const propia = process.env.SEED_DEMO_PASSWORD ?? "";
  if (!propia) return "Admin1234!";
  const politica = validarPassword(propia);
  if (!politica.ok) throw new Error(`SEED_DEMO_PASSWORD no cumple la política: ${politica.errores.join(" ")}`);
  return propia;
}

/** Lo que se imprime en vez de la clave: la propia no debe quedar en ningún log. */
function avisoPasswordDemo(): string {
  return process.env.SEED_DEMO_PASSWORD ? "la de SEED_DEMO_PASSWORD" : "Admin1234!";
}

function datosAdminInstalacion() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("SEED_ADMIN_EMAIL no es un correo válido.");
  const politica = validarPassword(password, [email]);
  if (!politica.ok) throw new Error(`SEED_ADMIN_PASSWORD no cumple la política: ${politica.errores.join(" ")}`);
  return { email, password, nombre: (process.env.SEED_ADMIN_NOMBRE ?? "").trim() || "Administrador del sistema" };
}

/**
 * Perfiles de acceso. Va aparte porque el instalador, al ACTUALIZAR una
 * instalación, ejecuta sólo esto (`SEED_SOLO_PERFILES=1`): el perfil de sistema
 * sigue al catálogo y los editables reciben los permisos nuevos, sin tocar la
 * empresa, las tablas de ISR ni nada que el cliente ya haya ajustado.
 */
async function sembrarPerfiles(): Promise<Record<string, string>> {
  // ─── Perfiles de acceso ───────────────────────────────────────────────────
  /**
   * Perfiles iniciales. Sus permisos salen de PERMISOS_POR_ROL, de modo que cada
   * uno concede lo mismo que su rol equivalente y no hay dos fuentes de verdad.
   *
   * SÓLO UNO ES DE SISTEMA: el administrador. Es la red de seguridad para que la
   * instalación nunca se quede sin un perfil capaz de administrar accesos, y por
   * eso no se puede editar ni borrar.
   *
   * Los demás nacen EDITABLES a propósito. Marcarlos todos como de sistema —que
   * es lo que hacía este seed— dejaba una instalación nueva sin un solo perfil
   * modificable: el módulo de accesos granulares quedaba inservible hasta crear
   * uno desde cero.
   *
   * `refrescar` decide además si el seed sobrescribe lo que ya existe. Sólo el de
   * sistema se refresca en cada ejecución —para que siga al catálogo cuando este
   * crece—; los editables se crean si faltan y NO se tocan si están, porque una
   * vez que el administrador los ajusta, son suyos y un `db:seed` no debe
   * revertir su trabajo en silencio.
   */
  const perfilesData = [
    {
      codigo: "ADMIN_SISTEMA",
      nombre: "Administrador del Sistema",
      descripcion: "Acceso total, incluida la gestión de usuarios y perfiles.",
      permisos: [...PERMISOS_POR_ROL.SUPER_ADMIN],
      alcance: "TODO" as const,
      esSistema: true,
      refrescar: true,
    },
    {
      codigo: "RRHH",
      nombre: "Recursos Humanos",
      descripcion: "Expediente, nómina, talento y configuración. Sin gestión de usuarios.",
      permisos: [...PERMISOS_POR_ROL.ADMIN_RRHH],
      alcance: "TODO" as const,
      esSistema: false,
      refrescar: false,
    },
    {
      codigo: "CONTABILIDAD",
      nombre: "Contabilidad",
      descripcion: "Opera la nómina y ve datos salariales. No toca el expediente.",
      permisos: [...PERMISOS_POR_ROL.CONTADOR],
      alcance: "TODO" as const,
      esSistema: false,
      refrescar: false,
    },
    {
      codigo: "SUPERVISOR_SUCURSAL",
      nombre: "Supervisor de Sucursal",
      descripcion:
        "Asistencia y evaluaciones del personal de SUS sucursales. Sin datos salariales. Requiere asignar sucursales en la cuenta.",
      permisos: [...PERMISOS_POR_ROL.SUPERVISOR],
      alcance: "SUCURSAL" as const,
      esSistema: false,
      refrescar: false,
    },
    {
      codigo: "AUDITORIA",
      nombre: "Auditoría",
      descripcion: "Sólo lectura sobre toda la empresa, con acceso a datos sensibles y al registro de auditoría.",
      permisos: [...PERMISOS_POR_ROL.AUDITOR],
      alcance: "TODO" as const,
      esSistema: false,
      refrescar: false,
    },
  ];

  /**
   * PERMISOS NUEVOS EN PERFILES QUE YA EXISTEN.
   *
   * Los perfiles editables no se refrescan, para que un `db:seed` no revierta lo
   * que el administrador haya configurado. Pero eso deja un hueco: cuando el
   * catálogo gana un permiso, los perfiles ya creados se quedan sin él y la
   * función resulta invisible para todos salvo quien tenga comodín, sin ningún
   * error que lo delate.
   *
   * `permisosConocidos` guarda el catálogo que existía al guardar el perfil, de
   * modo que se distingue «no lo tiene porque se lo quitaron» de «no lo tiene
   * porque no existía». Sólo se añade lo segundo, y nunca se quita nada.
   *
   * Lo añadido se imprime en vez de aplicarse en silencio.
   */
  const perfiles: Record<string, string> = {};
  const añadidos: string[] = [];

  for (const { refrescar, ...p } of perfilesData) {
    const existente = await prisma.perfilAcceso.findUnique({
      where: { codigo: p.codigo },
      select: { permisos: true, permisosConocidos: true },
    });

    let permisosFinales = p.permisos;
    if (existente && !refrescar) {
      const nuevos = permisosNoVistos(existente.permisosConocidos, existente.permisos, p.permisos);
      permisosFinales = [...existente.permisos, ...nuevos];
      if (nuevos.length > 0) añadidos.push(`${p.codigo}: ${nuevos.join(", ")}`);
    }

    const perfil = await prisma.perfilAcceso.upsert({
      where: { codigo: p.codigo },
      update: refrescar
        ? {
            permisos: p.permisos,
            descripcion: p.descripcion,
            alcance: p.alcance,
            esSistema: true,
            permisosConocidos: [...TODOS_LOS_PERMISOS],
          }
        : // Sólo la marca de sistema y los permisos que el perfil nunca vio. El
          // alcance y el resto quedan como estén. Se sella el catálogo visto,
          // para que la próxima comparación sea exacta.
          {
            esSistema: false,
            permisos: permisosFinales,
            permisosConocidos: [...TODOS_LOS_PERMISOS],
          },
      create: { ...p, activo: true, permisosConocidos: [...TODOS_LOS_PERMISOS] },
    });
    perfiles[p.codigo] = perfil.id;
  }

  const editables = perfilesData.filter((p) => !p.esSistema).length;
  console.log(
    `✓ ${perfilesData.length} perfiles de acceso (1 de sistema, ${editables} editables)`
  );
  for (const linea of añadidos) {
    console.log(`   + permiso nuevo → ${linea}`);
  }

  return perfiles;
}

async function main() {
  if (process.env.SEED_SOLO_PERFILES === "1") {
    await sembrarPerfiles();
    console.log("✓ Perfiles de acceso al día");
    return;
  }

  console.log("🌱 Iniciando seed de NominaHN...");
  const adminInstalacion = INSTALACION ? datosAdminInstalacion() : null;
  // Antes de escribir nada: una clave que no cumple la política no debe dejar la
  // base a medio sembrar.
  passwordDemo();

  // ─── Empresa ──────────────────────────────────────────────────────────────
  const empresa = await prisma.empresa.upsert({
    where: { rtn: "0801-1990-000001" },
    update: {},
    create: {
      nombre: (INSTALACION && process.env.SEED_EMPRESA_NOMBRE?.trim()) || "Empresa Ejemplo S.A. de C.V.",
      rtn: "0801-1990-000001",
      direccion: "Tegucigalpa, Honduras",
      telefono: "+504 2200-0000",
      email: "info@empresa.hn",
    },
  });
  console.log("✓ Empresa creada:", empresa.nombre);

  // ─── Sucursales ───────────────────────────────────────────────────────────
  const sucursalesData = [
    { nombre: "Sede Central", codigo: "SC-001", direccion: "Tegucigalpa" },
    { nombre: "Sucursal San Pedro Sula", codigo: "SPS-001", direccion: "San Pedro Sula" },
    { nombre: "Sucursal La Ceiba", codigo: "LC-001", direccion: "La Ceiba" },
    { nombre: "Sucursal Choloma", codigo: "CHO-001", direccion: "Choloma" },
    { nombre: "Sucursal El Progreso", codigo: "EP-001", direccion: "El Progreso" },
  ];

  const sucursales: Sucursal[] = [];
  for (const s of sucursalesData) {
    const suc = await prisma.sucursal.upsert({
      where: { id: `seed-suc-${s.codigo}` },
      update: {},
      create: { id: `seed-suc-${s.codigo}`, empresaId: empresa.id, ...s },
    });
    sucursales.push(suc);
  }
  console.log(`✓ ${sucursales.length} sucursales creadas`);

  // ─── Departamentos ────────────────────────────────────────────────────────
  const deptosData = [
    { nombre: "Administración", codigo: "ADM" },
    { nombre: "Recursos Humanos", codigo: "RRHH" },
    { nombre: "Operaciones", codigo: "OPE" },
    { nombre: "Ventas", codigo: "VEN" },
    { nombre: "Contabilidad", codigo: "CONT" },
    { nombre: "Tecnología", codigo: "TI" },
  ];

  const departamentos: Departamento[] = [];
  for (const d of deptosData) {
    const dept = await prisma.departamento.upsert({
      where: { id: `seed-dept-${d.codigo}` },
      update: {},
      create: { id: `seed-dept-${d.codigo}`, sucursalId: sucursales[0].id, ...d },
    });
    departamentos.push(dept);
  }
  console.log(`✓ ${departamentos.length} departamentos creados`);

  // ─── Puestos ──────────────────────────────────────────────────────────────
  const puestosData = [
    { nombre: "Gerente General", departamentoId: departamentos[0].id, salarioMinimo: 40000, salarioMaximo: 80000 },
    { nombre: "Jefe de RRHH", departamentoId: departamentos[1].id, salarioMinimo: 25000, salarioMaximo: 45000 },
    { nombre: "Auxiliar Administrativo", departamentoId: departamentos[0].id, salarioMinimo: 12000, salarioMaximo: 18000 },
    { nombre: "Operador", departamentoId: departamentos[2].id, salarioMinimo: 10172, salarioMaximo: 15000 },
    { nombre: "Vendedor", departamentoId: departamentos[3].id, salarioMinimo: 10172, salarioMaximo: 20000 },
    { nombre: "Contador", departamentoId: departamentos[4].id, salarioMinimo: 18000, salarioMaximo: 35000 },
  ];

  const puestos: Puesto[] = [];
  for (const p of puestosData) {
    const puesto = await prisma.puesto.upsert({
      where: { id: `seed-puesto-${p.nombre.replace(/\s/g, "-")}` },
      update: {},
      create: { id: `seed-puesto-${p.nombre.replace(/\s/g, "-")}`, ...p },
    });
    puestos.push(puesto);
  }
  console.log(`✓ ${puestos.length} puestos creados`);

  // ─── Centros de costo ─────────────────────────────────────────────────────
  /**
   * Reparto por omisión: administración, ventas y producción.
   *
   * Se crean si faltan y NO se tocan si ya están: una vez que la contabilidad
   * ajusta su cuenta o su nombre, son suyos y un `db:seed` no debe revertirlo.
   * Quedan sin asignar a ningún departamento a propósito — esa decisión es del
   * contador, y hacerla aquí sería adivinar cómo reparte el gasto la empresa.
   */
  const centrosData = [
    { codigo: "ADM", nombre: "Administración", descripcion: "Gastos administrativos y de dirección." },
    { codigo: "VTA", nombre: "Ventas", descripcion: "Fuerza de ventas y actividad comercial." },
    { codigo: "PROD", nombre: "Producción", descripcion: "Personal de operaciones y producción." },
  ];
  for (const c of centrosData) {
    await prisma.centroCosto.upsert({ where: { codigo: c.codigo }, update: {}, create: c });
  }
  console.log(`✓ ${centrosData.length} centros de costo`);

  const perfiles = await sembrarPerfiles();

  // ─── Usuarios ─────────────────────────────────────────────────────────────
  /**
   * DOS CONTRASEÑAS DISTINTAS, a propósito.
   *
   * Las cuentas de DEMOSTRACIÓN comparten `Admin1234!` porque su razón de ser es
   * enseñar cómo se ve el sistema desde cada rol, y esa clave está publicada en
   * la documentación de despliegue.
   *
   * El ADMINISTRADOR no puede compartirla: es la única cuenta con acceso total, y
   * una contraseña que aparece en un README no protege nada. Se le genera una
   * aleatoria que se imprime UNA vez, y arranca marcada para cambiarse, de modo
   * que la clave definitiva no queda escrita en ningún sitio.
   *
   * En una instalación ya existente esto no cambia nada: el `upsert` de abajo no
   * toca la contraseña de quien ya está creado.
   */
  const passwordHash = await bcrypt.hash(passwordDemo(), 12);
  const passwordAdmin = adminInstalacion?.password ?? generarPasswordTemporal(16);
  const passwordAdminHash = await bcrypt.hash(passwordAdmin, 12);
  const usersData = adminInstalacion
    ? [{ email: adminInstalacion.email, name: adminInstalacion.nombre, role: "SUPER_ADMIN" as const, perfil: "ADMIN_SISTEMA" }]
    : [
    { email: "admin@nominahn.hn", name: "Administrador Sistema", role: "SUPER_ADMIN" as const, perfil: "ADMIN_SISTEMA" },
    { email: "rrhh@nominahn.hn", name: "Jefa de RRHH", role: "ADMIN_RRHH" as const, perfil: "RRHH" },
    { email: "contador@nominahn.hn", name: "Contador General", role: "CONTADOR" as const, perfil: "CONTABILIDAD" },
    // Sin perfil a propósito: demuestra el camino de compatibilidad, donde los
    // permisos se derivan del rol tal como funcionaba antes de los perfiles.
    { email: "gerente@nominahn.hn", name: "Gerente General", role: "GERENTE" as const, perfil: null },
    { email: "supervisor@nominahn.hn", name: "Supervisor Operaciones", role: "SUPERVISOR" as const, perfil: "SUPERVISOR_SUCURSAL" },
    { email: "auditor@nominahn.hn", name: "Auditor Interno", role: "AUDITOR" as const, perfil: "AUDITORIA" },
    { email: "empleado@nominahn.hn", name: "Empleado Ejemplo", role: "EMPLEADO" as const, perfil: null },
  ];

  let adminRecienCreado = false;
  for (const u of usersData) {
    const { perfil, ...datos } = u;
    const esAdmin = u.role === "SUPER_ADMIN";
    const existente = await prisma.user.findUnique({
      where: { email: u.email },
      select: { id: true },
    });
    if (esAdmin && !existente) adminRecienCreado = true;

    await prisma.user.upsert({
      where: { email: u.email },
      // La contraseña NUNCA se toca en el update: re-ejecutar el seed no debe
      // devolver una cuenta en uso a su clave inicial.
      update: { perfilId: perfil ? perfiles[perfil] : null },
      create: {
        ...datos,
        password: esAdmin ? passwordAdminHash : passwordHash,
        debeCambiarPassword: esAdmin && !INSTALACION,
        perfilId: perfil ? perfiles[perfil] : null,
        // El supervisor arranca con alcance de sucursal y NINGUNA asignada: así
        // se ve de entrada que sin sucursales no accede a personal, que es el
        // fallo seguro y no un descuido del seed.
        sucursalesIds: [],
      },
    });
  }
  console.log(INSTALACION ? `✓ Administrador: ${usersData[0].email}` : `✓ ${usersData.length} usuarios (demo: ${avisoPasswordDemo()})`);
  if (adminRecienCreado && !INSTALACION) {
    console.log("");
    console.log("  ┌─────────────────────────────────────────────────────────┐");
    console.log("  │  CONTRASEÑA DEL ADMINISTRADOR — se muestra UNA sola vez │");
    console.log("  └─────────────────────────────────────────────────────────┘");
    console.log(`     admin@nominahn.hn → ${passwordAdmin}`);
    console.log("     Deberá cambiarla al entrar. No queda guardada en claro.");
    console.log("");
  }

  // ─── Deducciones base Honduras ────────────────────────────────────────────
  const deduccionesData = [
    { nombre: "IHSS - EM", codigo: "IHSS", tipo: "LEGAL" as const, porcentaje: 0.025, aplicaEmpleado: true, aplicaEmpleador: true, porcentajeEmpleador: 0.05, topeMaximo: 11903.13, esLegal: true, descripcion: "IHSS Régimen EM (Enfermedad y Maternidad): 2.5% empleado / 5% patrono. Verificar techo vigente." },
    { nombre: "IHSS - IVM", codigo: "IVM", tipo: "LEGAL" as const, porcentaje: 0.025, aplicaEmpleado: true, aplicaEmpleador: true, porcentajeEmpleador: 0.035, topeMaximo: 11903.13, esLegal: true, descripcion: "IHSS Régimen IVM (Invalidez, Vejez y Muerte): 2.5% empleado / 3.5% patrono / 0.5% Estado." },
    { nombre: "RAP - Fondo de Vivienda (FOVIIF)", codigo: "RAP", tipo: "LEGAL" as const, porcentaje: 0.015, aplicaEmpleado: true, aplicaEmpleador: true, porcentajeEmpleador: 0.015, topeMinimo: 11903.13, topeMaximo: 57896.16, esLegal: true, descripcion: "Fondo de Vivienda e Inclusión Financiera del RAP. Base = excedente del salario sobre L11,903.13, hasta L57,896.16. Valores 2026: verificar vigencia." },
    { nombre: "Fondo de Reserva Laboral (RAP)", codigo: "RESERVA_LABORAL", tipo: "LEGAL" as const, aplicaEmpleado: false, aplicaEmpleador: true, porcentajeEmpleador: 0.04, topeMaximo: 57896.16, esLegal: true, descripcion: "Aporte patronal del 4% del salario ordinario al Fondo de Reserva Laboral de Capitalización Individual (Decreto 47-2024). Techo = 3 salarios mínimos. Al liquidar se descuenta del auxilio de cesantía." },
    { nombre: "AFP Atlántida", codigo: "AFP-ATL", tipo: "AFP" as const, porcentaje: 0.03, aplicaEmpleado: true, esLegal: false, descripcion: "Administradora de Fondos de Pensiones" },
    { nombre: "INFOP", codigo: "INFOP", tipo: "LEGAL" as const, porcentaje: 0.01, aplicaEmpleado: false, aplicaEmpleador: true, porcentajeEmpleador: 0.01, esLegal: true, descripcion: "Instituto Nacional de Formación Profesional (patronal)" },
    { nombre: "Cooperativa Empleados", codigo: "COOP1", tipo: "COOPERATIVA" as const, esLegal: false, descripcion: "Cuota mensual cooperativa" },
    { nombre: "Préstamo Empresa", codigo: "PREST", tipo: "PRESTAMO" as const, esLegal: false, descripcion: "Préstamos otorgados por la empresa" },
    { nombre: "Adelanto de Salario", codigo: "ADELANTO", tipo: "ADELANTO" as const, esLegal: false, descripcion: "Adelantos de quincena o salario" },
  ];

  for (const d of deduccionesData) {
    await prisma.tipoDeduccionConfig.upsert({
      where: { codigo: d.codigo },
      update: {},
      create: d,
    });
  }
  console.log("✓ Tipos de deducción creados (IHSS, RAP, Reserva Laboral, AFP, INFOP, Cooperativa, Préstamos)");

  // ─── Catálogo contable y mapeo de la nómina ────────────────────────────────
  // El catálogo de ejemplo sólo si está vacío; el mapeo sólo para los conceptos
  // que el contador no haya asignado. Nunca revierte lo configurado.
  const catalogo = await sembrarCatalogo(prisma);
  console.log(`✓ Catálogo contable: ${catalogo.cuentas} cuentas sembradas, ${catalogo.mapeos} conceptos mapeados`);

  // ─── Tabla ISR 2026 Honduras (renta neta gravable ANUAL, SAR 02-2026) ──────
  // La deducción de gastos médicos (L.40,000/año) la aplica el motor de cálculo.
  const isrData: Prisma.TablasISRCreateManyInput[] = [
    { anio: 2026, rangoDesde: 0,         rangoHasta: 228324.32, cuotaFija: 0,         porcentaje: 0,    excedenteDesde: 0 },
    { anio: 2026, rangoDesde: 228324.33, rangoHasta: 348154.10, cuotaFija: 0,         porcentaje: 0.15, excedenteDesde: 228324.32 },
    { anio: 2026, rangoDesde: 348154.11, rangoHasta: 809660.75, cuotaFija: 17974.47,  porcentaje: 0.20, excedenteDesde: 348154.10 },
    { anio: 2026, rangoDesde: 809660.76, rangoHasta: null,      cuotaFija: 110275.80, porcentaje: 0.25, excedenteDesde: 809660.75 },
  ];

  // Desactivar tablas de años anteriores y recargar la vigente.
  await prisma.tablasISR.updateMany({ where: { activa: true }, data: { activa: false } });
  await prisma.tablasISR.deleteMany({ where: { anio: 2026 } });
  await prisma.tablasISR.createMany({ data: isrData });
  console.log("✓ Tabla ISR 2026 cargada");

  // ─── Impuesto personal o vecinal — San Pedro Sula, Cortés ─────────────────
  // Art. 77 Ley de Municipalidades (Decreto 134-90) y Anexo No. 1 del Plan de
  // Arbitrios de la Municipalidad de San Pedro Sula.
  //
  // El impuesto se calcula POR TRAMOS y el total es la SUMA de lo que resulta
  // de cada uno: cada porción del ingreso anual tributa a la tarifa de su
  // tramo. No es una tarifa única aplicada al total.
  //
  // El Plan de Arbitrios se aprueba cada año: verificar estos valores contra el
  // Plan vigente antes de cada ejercicio.
  const MUNICIPIO = "SAN_PEDRO_SULA";
  const anioVecinal = 2026;
  const tramosVecinal: { desde: number; hasta: number | null; porMillar: number }[] = [
    { desde: 0,      hasta: 5000,   porMillar: 1.5 },
    { desde: 5000,   hasta: 10000,  porMillar: 2.0 },
    { desde: 10000,  hasta: 20000,  porMillar: 2.5 },
    { desde: 20000,  hasta: 30000,  porMillar: 3.0 },
    { desde: 30000,  hasta: 50000,  porMillar: 3.5 },
    { desde: 50000,  hasta: 75000,  porMillar: 3.75 },
    { desde: 75000,  hasta: 100000, porMillar: 4.0 },
    { desde: 100000, hasta: 150000, porMillar: 5.0 },
    { desde: 150000, hasta: null,   porMillar: 5.25 },
  ];

  await prisma.tablaImpuestoVecinal.deleteMany({ where: { municipio: MUNICIPIO, anio: anioVecinal } });
  await prisma.tablaImpuestoVecinal.createMany({
    data: tramosVecinal.map((t) => ({
      municipio: MUNICIPIO,
      anio: anioVecinal,
      rangoDesde: t.desde,
      rangoHasta: t.hasta,
      porMillar: t.porMillar,
    })),
  });
  console.log(`✓ Impuesto vecinal ${anioVecinal} cargado (${MUNICIPIO}, ${tramosVecinal.length} tramos)`);

  // ─── Salario Mínimo 2026 ──────────────────────────────────────────────────
  // NOTA: el salario mínimo HN varía por sector y tamaño de empresa. Este es un
  // valor de arranque de referencia; ajustar por sector según el acuerdo vigente.
  await prisma.salarioMinimo.upsert({
    where: { id: "seed-salmin-2026" },
    update: { fechaVigencia: new Date("2026-01-01") },
    create: {
      id: "seed-salmin-2026",
      anio: 2026,
      sector: "GENERAL",
      monto: 11903.13,
      fechaVigencia: new Date("2026-01-01"),
    },
  });
  console.log("✓ Salario mínimo 2026 (referencial — verificar por sector)");

  // ─── Contactos RRHH ───────────────────────────────────────────────────────
  await prisma.contactoRRHH.upsert({
    where: { id: "seed-contacto-rrhh-1" },
    update: {},
    create: {
      id: "seed-contacto-rrhh-1",
      nombre: "Departamento de RRHH",
      cargo: "Jefa de Recursos Humanos",
      email: "rrhh@empresa.hn",
      telefono: "+504 2200-0001",
      extension: "101",
    },
  });

  // ─── Configuraciones del sistema ──────────────────────────────────────────
  const configs = [
    { clave: "EMPRESA_NOMBRE", valor: "Empresa Ejemplo S.A. de C.V.", descripcion: "Nombre de la empresa" },
    { clave: "JORNADA_HORAS", valor: "8", descripcion: "Horas de jornada laboral diaria" },
    { clave: "DIAS_LABORALES_SEMANA", valor: "6", descripcion: "Días laborales por semana" },
    { clave: "AUSENCIA_DESCUENTO_DOBLE", valor: "true", descripcion: "Aplicar descuento doble por ausencia" },
    { clave: "HORA_ENTRADA_DEFAULT", valor: "08:00", descripcion: "Hora de entrada por defecto" },
    { clave: "HORA_SALIDA_DEFAULT", valor: "17:00", descripcion: "Hora de salida por defecto" },
    {
      clave: "MUNICIPIO_IMPUESTO_VECINAL",
      valor: "SAN_PEDRO_SULA",
      descripcion: "Municipio cuyo Plan de Arbitrios rige el impuesto personal o vecinal",
    },
  ];

  for (const c of configs) {
    await prisma.configuracionSistema.upsert({
      where: { clave: c.clave },
      update: { valor: c.valor },
      create: c,
    });
  }
  console.log("✓ Configuraciones del sistema creadas");

  // ─── Feriados nacionales ──────────────────────────────────────────────────
  // Sin calendario, el trabajo en día feriado se liquidaba como jornada
  // ordinaria: el recargo del Art. 339 no se aplicaba nunca.
  //
  // Los feriados FIJOS se generan para el año en curso y el siguiente. Los
  // MÓVILES (Semana Santa) dependen de la fecha de Pascua y se calculan.
  const anioBase = new Date().getUTCFullYear();
  const feriadosFijos = [
    { mes: 1, dia: 1, nombre: "Año Nuevo" },
    { mes: 4, dia: 14, nombre: "Día de las Américas" },
    { mes: 5, dia: 1, nombre: "Día del Trabajo" },
    { mes: 9, dia: 15, nombre: "Día de la Independencia" },
    { mes: 10, dia: 3, nombre: "Semana Morazánica" },
    { mes: 10, dia: 4, nombre: "Semana Morazánica" },
    { mes: 10, dia: 5, nombre: "Semana Morazánica" },
    { mes: 12, dia: 25, nombre: "Navidad" },
  ];

  const feriados: { fecha: Date; nombre: string }[] = [];
  for (const anio of [anioBase, anioBase + 1]) {
    for (const f of feriadosFijos) {
      feriados.push({
        // Medianoche UTC: es como Prisma almacena y compara una columna @db.Date.
        fecha: new Date(Date.UTC(anio, f.mes - 1, f.dia)),
        nombre: f.nombre,
      });
    }
    // Semana Santa: jueves, viernes y sábado previos al Domingo de Resurrección.
    const pascua = domingoDePascua(anio);
    const movil = (offsetDias: number, nombre: string) => {
      const d = new Date(pascua);
      d.setUTCDate(d.getUTCDate() + offsetDias);
      feriados.push({ fecha: d, nombre });
    };
    movil(-3, "Jueves Santo");
    movil(-2, "Viernes Santo");
    movil(-1, "Sábado de Gloria");
  }

  for (const f of feriados) {
    // Id determinista en vez de la clave compuesta: en SQL `NULL <> NULL`, así
    // que `@@unique([fecha, sucursalId])` no identifica un feriado NACIONAL
    // (sucursalId nulo) — es el mismo motivo por el que la unicidad de período
    // de Planilla vive en un índice parcial con COALESCE.
    const id = `feriado-nacional-${f.fecha.toISOString().slice(0, 10)}`;
    await prisma.feriado.upsert({
      where: { id },
      update: { nombre: f.nombre, activo: true },
      create: { id, fecha: f.fecha, nombre: f.nombre, esNacional: true },
    });
  }
  console.log(`✓ ${feriados.length} feriados nacionales cargados (${anioBase}-${anioBase + 1})`);

  console.log("\n✅ Seed completado exitosamente!");
  if (INSTALACION) return;
  console.log("📧 Usuarios disponibles:");
  usersData.forEach((u) => console.log(`   ${u.email} → ${u.role}`));
  console.log(`🔑 Contraseña de las cuentas de demostración: ${avisoPasswordDemo()}`);
  console.log("   El administrador tiene la suya propia (ver arriba si se acaba de crear).");
}

/**
 * Domingo de Resurrección (algoritmo de Meeus/Jones/Butcher, calendario
 * gregoriano). Del que penden Jueves Santo, Viernes Santo y Sábado de Gloria,
 * los tres feriados móviles de Honduras.
 */
function domingoDePascua(anio: number): Date {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(anio, mes - 1, dia));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
