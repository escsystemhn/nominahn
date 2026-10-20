import { NextRequest, NextResponse } from "next/server";
import { Prisma, EstadoEmpleado } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso, puede } from "@/lib/auth/guard";
import { redondear } from "@/lib/payroll/money";
import { audit, getClientInfo } from "@/lib/audit";
import { z } from "zod";
import { zCorreoOpcional, zMontoAnulable } from "@/lib/http/validar";

const createSchema = z.object({
  primerNombre: z.string().min(1),
  segundoNombre: z.string().optional(),
  primerApellido: z.string().min(1),
  segundoApellido: z.string().optional(),
  fechaNacimiento: z.string(),
  genero: z.string(),
  estadoCivil: z.string().optional(),
  identidad: z.string().optional(),
  rtn: z.string().optional(),
  ihssNro: z.string().optional(),
  rapNro: z.string().optional(),
  telefonoPersonal: z.string().optional(),
  telefonoEmergencia: z.string().optional(),
  contactoEmergencia: z.string().optional(),
  direccion: z.string().optional(),
  fechaIngreso: z.string(),
  tipoContrato: z.enum(["INDEFINIDO", "TEMPORAL", "PRUEBA", "SERVICIO"]),
  salarioBase: z.number().positive(),
  tipoPlanilla: z.enum(["SEMANAL", "QUINCENAL", "MENSUAL"]),
  cuentaBancaria: z.string().optional(),
  banco: z.string().optional(),
  sucursalId: z.string(),
  departamentoId: z.string(),
  puestoId: z.string().optional(),
  // Contacto: el personal es dato privado y es a donde van los comprobantes.
  emailPersonal: zCorreoOpcional,
  emailCorporativo: zCorreoOpcional,
  // IHSS mensual fijo pactado; vacío = cálculo por porcentaje.
  ihssMontoFijo: zMontoAnulable,
});

/**
 * Campos del directorio: quién es quién y dónde trabaja. Sin datos personales
 * ni financieros. Es lo que ve un GERENTE o un SUPERVISOR.
 */
const CAMPOS_BASICOS = {
  id: true,
  codigo: true,
  primerNombre: true,
  segundoNombre: true,
  primerApellido: true,
  segundoApellido: true,
  estado: true,
  fechaIngreso: true,
  tipoContrato: true,
  tipoPlanilla: true,
  fotoPerfil: true,
  sucursal: { select: { nombre: true } },
  departamento: { select: { nombre: true } },
  puesto: { select: { nombre: true } },
} as const;

/**
 * Directorio MÁS los campos protegidos: identidad, RTN, salario, cuenta
 * bancaria, dirección. Sólo para los roles que administran nómina o auditan.
 *
 * La lista es explícita a propósito: antes se devolvía el registro completo sin
 * `select`, de modo que cualquier columna nueva quedaba expuesta por omisión.
 */
const CAMPOS_SENSIBLES = {
  ...CAMPOS_BASICOS,
  identidad: true,
  rtn: true,
  ihssNro: true,
  rapNro: true,
  fechaNacimiento: true,
  genero: true,
  estadoCivil: true,
  salarioBase: true,
  salarioDiario: true,
  salarioHora: true,
  banco: true,
  cuentaBancaria: true,
  telefonoPersonal: true,
  emailPersonal: true,
  // Cambia lo que se le descuenta: dato de nómina, no de directorio.
  ihssMontoFijo: true,
  telefonoEmergencia: true,
  contactoEmergencia: true,
  direccion: true,
  fechaSalida: true,
} as const;

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("empleados.ver");
  if (!g.ok) return g.response;

  // Quien no administra nómina recibe el directorio, no el expediente.
  const vePII = puede(g.usuario, "empleados.pii");

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? "";
  const sucursalId = searchParams.get("sucursalId");
  const departamentoId = searchParams.get("departamentoId");
  const estado = searchParams.get("estado");
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "20");

  const where: Prisma.EmpleadoWhereInput = {
    AND: [
      search
        ? {
            OR: [
              { primerNombre: { contains: search, mode: "insensitive" } },
              { primerApellido: { contains: search, mode: "insensitive" } },
              { codigo: { contains: search, mode: "insensitive" } },
              // Buscar por identidad sólo si el rol puede verla: si no, el
              // resultado revelaría el número que no se le devuelve.
              ...(vePII ? [{ identidad: { contains: search, mode: "insensitive" as const } }] : []),
            ],
          }
        : {},
      sucursalId ? { sucursalId } : {},
      departamentoId ? { departamentoId } : {},
      estado ? { estado: estado as EstadoEmpleado } : {},
    ],
  };

  const [total, empleados] = await Promise.all([
    prisma.empleado.count({ where }),
    prisma.empleado.findMany({
      where,
      // Nunca el registro entero: la lista de columnas es explícita y depende
      // del rol de quien consulta.
      select: vePII ? CAMPOS_SENSIBLES : CAMPOS_BASICOS,
      orderBy: { primerApellido: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({ empleados, total, page, limit });
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("empleados.crear");
  if (!g.ok) return g.response;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const data = parsed.data;

  // Generar código único
  const count = await prisma.empleado.count();
  const codigo = `EMP-${String(count + 1).padStart(4, "0")}`;

  // Decimal exacto, igual que en el PUT: `salarioBase / 30 / 8` en float deja
  // residuo binario en una columna Decimal(12,2).
  const salario = redondear(data.salarioBase);
  const salarioDiario = redondear(salario.div(30));
  const salarioHora = redondear(salario.div(30).div(8));

  const empleado = await prisma.empleado.create({
    data: {
      codigo,
      primerNombre: data.primerNombre,
      segundoNombre: data.segundoNombre,
      primerApellido: data.primerApellido,
      segundoApellido: data.segundoApellido,
      fechaNacimiento: new Date(data.fechaNacimiento),
      genero: data.genero,
      estadoCivil: data.estadoCivil,
      identidad: data.identidad,
      rtn: data.rtn,
      ihssNro: data.ihssNro,
      rapNro: data.rapNro,
      telefonoPersonal: data.telefonoPersonal,
      telefonoEmergencia: data.telefonoEmergencia,
      contactoEmergencia: data.contactoEmergencia,
      direccion: data.direccion,
      fechaIngreso: new Date(data.fechaIngreso),
      tipoContrato: data.tipoContrato,
      salarioBase: salario,
      salarioDiario,
      salarioHora,
      tipoPlanilla: data.tipoPlanilla,
      cuentaBancaria: data.cuentaBancaria,
      banco: data.banco,
      sucursalId: data.sucursalId,
      departamentoId: data.departamentoId,
      puestoId: data.puestoId,
      emailPersonal: data.emailPersonal ?? null,
      emailCorporativo: data.emailCorporativo ?? null,
      ihssMontoFijo: data.ihssMontoFijo ?? null,
    },
  });

  // Registrar historial de salario inicial
  await prisma.historialSalario.create({
    data: {
      empleadoId: empleado.id,
      salarioAnterior: 0,
      salarioNuevo: salario,
      fechaCambio: new Date(data.fechaIngreso),
      motivo: "Salario inicial al ingreso",
      usuarioId: g.usuario.id,
      usuarioEmail: g.usuario.email ?? undefined,
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "Empleado",
    registroId: empleado.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      codigo, salarioBase: salario, tipoPlanilla: data.tipoPlanilla,
      tipoContrato: data.tipoContrato, sucursalId: data.sucursalId,
      departamentoId: data.departamentoId, fechaIngreso: data.fechaIngreso,
    },
    ip,
    userAgent,
  });

  return NextResponse.json(empleado, { status: 201 });
}
