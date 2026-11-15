import { NextRequest, NextResponse } from "next/server";
import { formasIdentidad, normalizarIdentidad } from "@/lib/empleados/identidad";
import { alcanzaUbicacion, conAlcance } from "@/lib/auth/alcance";
import { filtroBusquedaEmpleados } from "@/lib/empleados/busqueda";
import { Prisma, EstadoEmpleado } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso, puede } from "@/lib/auth/guard";
import { redondear } from "@/lib/payroll/money";
import { audit, getClientInfo } from "@/lib/audit";
import { z } from "zod";
import { parsearBody, zCorreoOpcional, zMontoAnulable } from "@/lib/http/validar";
import { validarUbicacionEmpleado } from "@/lib/organizacion/estructura-bd";
import { crearContratoInicial } from "@/lib/empleados/contratos-bd";

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
  // ¿Cotiza al IHSS / RAP en esta ficha? Por omisión sí; apagarlo es del administrador.
  aplicaIhss: z.boolean().optional(),
  aplicaRap: z.boolean().optional(),
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

  const filtros: Prisma.EmpleadoWhereInput = {
    AND: [
      await filtroBusquedaEmpleados(prisma, search, { conIdentidad: vePII }),
      sucursalId ? { sucursalId } : {},
      departamentoId ? { departamentoId } : {},
      estado ? { estado: estado as EstadoEmpleado } : {},
    ],
  };
  const where = conAlcance(filtros, g.usuario);

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

  const parsed = await parsearBody(req, createSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  const ubicacion = await validarUbicacionEmpleado(prisma, {
    sucursalId: data.sucursalId, departamentoId: data.departamentoId, puestoId: data.puestoId || null,
  });
  if (ubicacion) return NextResponse.json({ error: ubicacion }, { status: 400 });
  if (!alcanzaUbicacion(g.usuario, { sucursalId: data.sucursalId, departamentoId: data.departamentoId })) {
    return NextResponse.json({ error: "Esa ubicación está fuera del alcance de su cuenta." }, { status: 403 });
  }

  // `identidad` es UNIQUE: un campo en blanco debe guardarse como NULL, que no choca.
  // Como texto vacío, el segundo empleado sin identidad reventaba contra el primero.
  // Se guarda con sus 13 dígitos (sin guiones), igual que la importación: con y sin
  // guiones eran dos valores distintos para el índice único.
  // Crear la ficha sin IHSS o sin RAP cambia lo que se le deduce: sólo el administrador.
  if ((data.aplicaIhss === false || data.aplicaRap === false) && !puede(g.usuario, "configuracion.parametros")) {
    return NextResponse.json({ error: "Sólo el administrador puede apagar el IHSS o el RAP de una ficha." }, { status: 403 });
  }

  const dni = normalizarIdentidad(data.identidad);
  if (dni && !dni.ok) return NextResponse.json({ error: dni.error }, { status: 400 });
  const identidad = dni?.ok ? dni.valor : null;
  if (identidad && (await prisma.empleado.findFirst({ where: { identidad: { in: formasIdentidad(identidad) } }, select: { id: true } }))) {
    return NextResponse.json({ error: "Ya existe otro empleado con ese número de identidad." }, { status: 409 });
  }

  // El correlativo salta los códigos ocupados: una importación puede haber usado ese número.
  let correlativo = await prisma.empleado.count();
  let codigo: string;
  do {
    correlativo++;
    codigo = `EMP-${String(correlativo).padStart(4, "0")}`;
  } while (await prisma.empleado.findUnique({ where: { codigo }, select: { id: true } }));

  // Decimal exacto, igual que en el PUT: `salarioBase / 30 / 8` en float deja
  // residuo binario en una columna Decimal(12,2).
  const salario = redondear(data.salarioBase);
  const salarioDiario = redondear(salario.div(30));
  const salarioHora = redondear(salario.div(30).div(8));

  const empleado = await prisma.empleado.create({
    data: {
      codigo,
      identidad,
      primerNombre: data.primerNombre,
      segundoNombre: data.segundoNombre,
      primerApellido: data.primerApellido,
      segundoApellido: data.segundoApellido,
      fechaNacimiento: new Date(data.fechaNacimiento),
      genero: data.genero,
      estadoCivil: data.estadoCivil,
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
      puestoId: data.puestoId || null,
      emailPersonal: data.emailPersonal ?? null,
      emailCorporativo: data.emailCorporativo ?? null,
      ihssMontoFijo: data.ihssMontoFijo ?? null,
      aplicaIhss: data.aplicaIhss ?? true,
      aplicaRap: data.aplicaRap ?? true,
    },
  }).catch((e: unknown) => {
    // Dos altas simultáneas pueden pasar las comprobaciones de arriba.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  });
  if (!empleado) {
    return NextResponse.json({ error: "Otro registro acaba de usar esos datos. Revise el número de identidad e intente de nuevo." }, { status: 409 });
  }

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

  await crearContratoInicial(prisma, empleado.id);

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
