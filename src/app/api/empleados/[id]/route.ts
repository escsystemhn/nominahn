import { NextRequest, NextResponse } from "next/server";
import { formasIdentidad, normalizarIdentidad } from "@/lib/empleados/identidad";
import { empleadoAlAlcance } from "@/lib/auth/alcance-bd";
import { alcanzaEmpleado, alcanzaUbicacion } from "@/lib/auth/alcance";
import { prisma } from "@/lib/prisma";
import { creariaCiclo } from "@/lib/organizacion/jerarquia";
import { validarUbicacionEmpleado } from "@/lib/organizacion/estructura-bd";
import { requerirPermiso, requerirSesion, puede } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { hoyHN } from "@/lib/utils";
import { z } from "zod";
import { parsearBody, zId, zFecha, zMontoPositivo, zMontoAnulable, zCorreoOpcional } from "@/lib/http/validar";
import { money, redondear } from "@/lib/payroll/money";
import { revisarCambioEstado } from "@/lib/empleados/baja";
import { cerrarContratoVigente } from "@/lib/empleados/contratos-bd";
import { EstadoEmpleado, Prisma, TipoContrato, TipoPlanilla } from "@prisma/client";

// ALLOWLIST de campos editables. Zod descarta cualquier clave que no esté aquí,
// de modo que sólo estas columnas llegan a Prisma. Antes se hacía `{ ...rest }`
// con el body entero (mass-assignment): el cliente podía escribir `codigo`,
// `userId`, `estado` u otras columnas a voluntad.
const opcionalTexto = z.string().trim().max(200).optional();

/**
 * Permite `null` EXPLÍCITO además del valor, para columnas anulables.
 *
 * Se escribe como unión y no como `.nullable()` porque `zFecha` es `z.coerce.date`
 * y la coerción convertiría `null` en 1970-01-01 en vez de dejarlo en `null`.
 * Con la unión, la rama `z.null()` gana primero y el `null` llega intacto a Prisma,
 * que es como el formulario de edición BORRA un puesto, un supervisor o la fecha
 * de salida (p. ej. al reincorporar a un empleado dado de baja).
 */
const anulable = <T extends z.ZodType>(schema: T) => z.union([z.null(), schema]);

const schemaEditar = z.object({
  primerNombre: z.string().trim().min(1).max(100).optional(),
  segundoNombre: opcionalTexto,
  primerApellido: z.string().trim().min(1).max(100).optional(),
  segundoApellido: opcionalTexto,
  fechaNacimiento: zFecha.optional(),
  genero: opcionalTexto,
  estadoCivil: opcionalTexto,
  nacionalidad: opcionalTexto,
  // Es UNIQUE: en blanco se guarda NULL, o dos personas sin identidad chocarían.
  identidad: z.string().trim().max(200).transform((v) => v || null).optional(),
  rtn: opcionalTexto,
  ihssNro: opcionalTexto,
  rapNro: opcionalTexto,
  telefonoPersonal: opcionalTexto,
  telefonoEmergencia: opcionalTexto,
  contactoEmergencia: opcionalTexto,
  direccion: z.string().trim().max(500).optional(),
  fechaIngreso: zFecha.optional(),
  fechaSalida: anulable(zFecha).optional(),
  estado: z.enum(EstadoEmpleado).optional(),
  tipoContrato: z.enum(TipoContrato).optional(),
  tipoPlanilla: z.enum(TipoPlanilla).optional(),
  salarioBase: zMontoPositivo.optional(),
  cuentaBancaria: opcionalTexto,
  banco: opcionalTexto,
  sucursalId: zId.optional(),
  departamentoId: zId.optional(),
  puestoId: anulable(zId).optional(),
  supervisorId: anulable(zId).optional(),
  // Vacío = hereda el centro de costo de su departamento.
  centroCostoId: anulable(zId).optional(),
  // Datos de DIRECTORIO: contacto laboral, no dato personal protegido.
  emailCorporativo: opcionalTexto,
  extension: opcionalTexto,
  // Dato PERSONAL: a él se envían los comprobantes de pago.
  emailPersonal: zCorreoOpcional,
  // IHSS mensual fijo; null = volver al cálculo por porcentaje.
  ihssMontoFijo: zMontoAnulable,
  // No es columna: sólo alimenta el motivo del historial de salario.
  motivo: z.string().trim().max(500).optional(),
});

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { id } = await params;

  // El expediente trae historial salarial, deducciones, documentos y las
  // últimas boletas. Sólo lo ve quien administra nómina o audita — y el propio
  // empleado, el suyo. Antes bastaba con tener sesión de cualquier rol.
  const esPropio = !!g.usuario.empleadoId && g.usuario.empleadoId === id;
  if (!esPropio && !puede(g.usuario, "empleados.pii")) {
    return NextResponse.json({ error: "Permiso insuficiente" }, { status: 403 });
  }
  if (!esPropio && !(await empleadoAlAlcance(g.usuario, id))) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const empleado = await prisma.empleado.findUnique({
    where: { id },
    include: {
      sucursal: true,
      departamento: true,
      puesto: true,
      contratos: { orderBy: { createdAt: "desc" } },
      permisos: { orderBy: { createdAt: "desc" }, take: 10 },
      deducciones: { include: { tipoDeduccion: true }, where: { activo: true } },
      historialSalarios: { orderBy: { fechaCambio: "desc" } },
      evaluaciones: { orderBy: { createdAt: "desc" }, take: 6 },
      documentos: { orderBy: { createdAt: "desc" } },
      planillasDetalle: {
        // Un borrador no es un pago, y sus líneas se rehacen al recalcular.
        where: { planilla: { estado: { not: "BORRADOR" } } },
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { planilla: { select: { tipo: true, fechaFin: true, estado: true } } },
      },
    },
  });

  if (!empleado) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json(empleado);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("empleados.editar");
  if (!g.ok) return g.response;

  const { id } = await params;

  const empleadoActual = await prisma.empleado.findUnique({
    where: { id },
    select: {
      id: true, salarioBase: true, estado: true, sucursalId: true, departamentoId: true, puestoId: true, ihssMontoFijo: true,
      fechaIngreso: true, fechaSalida: true, tipoContrato: true,
      contratos: { where: { activo: true }, select: { id: true }, take: 1 },
    },
  });
  // Fuera de su alcance responde igual que si no existiera (ver `alcanzaEmpleado`).
  if (!empleadoActual || !alcanzaEmpleado(g.usuario, empleadoActual)) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const parsed = await parsearBody(req, schemaEditar);
  if (!parsed.ok) return parsed.response;
  // `motivo` no es columna; el resto (`data`) ya está acotado por el allowlist.
  const { salarioBase, motivo, ...data } = parsed.data;

  // DNI: 13 dígitos, guardado sin guiones; otro empleado con el mismo número en
  // cualquiera de las dos formas es el mismo DNI.
  if (data.identidad !== undefined && data.identidad !== null) {
    const dni = normalizarIdentidad(data.identidad);
    if (dni && !dni.ok) return NextResponse.json({ error: dni.error }, { status: 400 });
    data.identidad = dni?.ok ? dni.valor : null;
    if (data.identidad && (await prisma.empleado.findFirst({ where: { identidad: { in: formasIdentidad(data.identidad) }, id: { not: id } }, select: { id: true } }))) {
      return NextResponse.json({ error: "Ya existe otro empleado con ese número de identidad" }, { status: 409 });
    }
  }

  const revision = revisarCambioEstado({
    estadoActual: empleadoActual.estado,
    estadoNuevo: data.estado,
    salidaActual: empleadoActual.fechaSalida,
    salidaNueva: data.fechaSalida,
    ingreso: data.fechaIngreso ?? empleadoActual.fechaIngreso,
  });
  if (revision.error) return NextResponse.json({ error: revision.error }, { status: 400 });
  if (revision.limpiarSalida) data.fechaSalida = null;

  // Con un contrato vigente, cambiar el tipo aquí lo contradiría: el cambio se
  // registra como un contrato nuevo, que deja el anterior en el historial.
  if (data.tipoContrato !== undefined && data.tipoContrato !== empleadoActual.tipoContrato && empleadoActual.contratos.length > 0) {
    return NextResponse.json(
      { error: "Este empleado tiene un contrato vigente. Para cambiar el tipo, registre un contrato nuevo en la pestaña Contrato laboral." },
      { status: 409 }
    );
  }

  // Sucursal, departamento y puesto deben encajar. Sólo se comprueba si alguno
  // CAMBIA: el formulario reenvía los tres en cada guardado, y un registro
  // antiguo que no encaje no debe impedir corregirle, por ejemplo, el teléfono.
  const ubicacion = {
    sucursalId: data.sucursalId ?? empleadoActual.sucursalId,
    departamentoId: data.departamentoId ?? empleadoActual.departamentoId,
    puestoId: data.puestoId !== undefined ? data.puestoId : empleadoActual.puestoId,
  };
  if (
    ubicacion.sucursalId !== empleadoActual.sucursalId ||
    ubicacion.departamentoId !== empleadoActual.departamentoId ||
    ubicacion.puestoId !== empleadoActual.puestoId
  ) {
    const error = await validarUbicacionEmpleado(prisma, ubicacion);
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (!alcanzaUbicacion(g.usuario, ubicacion)) {
      return NextResponse.json({ error: "Esa ubicación está fuera del alcance de su cuenta." }, { status: 403 });
    }
  }

  /**
   * Ciclos en la línea de reporte.
   *
   * Antes sólo se impedía que alguien fuera su propio jefe. `A → B → A` pasaba
   * sin más, y cualquier recorrido hacia arriba —el organigrama, el conteo de
   * subordinados, la cadena de aprobación de permisos— dejaba de terminar.
   *
   * Se comprueba subiendo desde el supervisor propuesto. La consulta trae sólo
   * dos columnas de la plantilla: es una lectura barata frente a un bucle
   * infinito en producción.
   */
  if (data.supervisorId !== undefined && data.supervisorId !== null) {
    if (data.supervisorId === id) {
      return NextResponse.json(
        { error: "Un empleado no puede ser su propio supervisor" },
        { status: 400 }
      );
    }

    const plantilla = await prisma.empleado.findMany({ select: { id: true, supervisorId: true } });
    const padreDe = new Map(plantilla.map((e) => [e.id, e.supervisorId]));

    if (creariaCiclo(padreDe, id, data.supervisorId)) {
      const jefe = await prisma.empleado.findUnique({
        where: { id: data.supervisorId },
        select: { codigo: true, primerNombre: true, primerApellido: true },
      });
      const quien = jefe ? `${jefe.codigo} (${jefe.primerNombre} ${jefe.primerApellido})` : "ese empleado";
      return NextResponse.json(
        {
          error: `${quien} ya depende de este empleado, directa o indirectamente. Asignarlo como su jefe cerraría un ciclo en la jerarquía.`,
        },
        { status: 409 }
      );
    }
  }

  // El cambio de salario se registra en el historial y recalcula diario/hora en
  // Decimal exacto (nunca float). El registro se PREPARA aquí y se escribe
  // dentro de la transacción de abajo: crearlo antes del `update` dejaba un
  // historial huérfano —un aumento que consta pero nunca se aplicó— cuando el
  // update fallaba, por ejemplo al chocar `identidad` contra el índice único.
  let historial: Prisma.HistorialSalarioUncheckedCreateInput | null = null;
  if (salarioBase !== undefined && !money(salarioBase).equals(money(empleadoActual.salarioBase))) {
    const nuevo = redondear(salarioBase);
    (data as Record<string, unknown>).salarioBase = nuevo;
    (data as Record<string, unknown>).salarioDiario = redondear(nuevo.div(30));
    (data as Record<string, unknown>).salarioHora = redondear(nuevo.div(30).div(8));
    historial = {
      empleadoId: id,
      salarioAnterior: empleadoActual.salarioBase,
      salarioNuevo: nuevo,
      fechaCambio: new Date(),
      motivo: motivo ?? "Actualización de salario",
      // Atribución: el historial registraba qué cambió y cuándo, nunca quién.
      usuarioId: g.usuario.id,
      usuarioEmail: g.usuario.email ?? undefined,
    };
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
  }

  let empleado;
  try {
    empleado = await prisma.$transaction(async (tx) => {
      if (historial) await tx.historialSalario.create({ data: historial });
      if (revision.seDaDeBaja && revision.salida) await cerrarContratoVigente(tx, id, revision.salida);
      return tx.empleado.update({ where: { id }, data });
    });
  } catch (e) {
    // `identidad` es UNIQUE: sin esto, editar el DNI a uno ya registrado
    // reventaba con un 500 sin explicar nada al usuario.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Ya existe otro empleado con ese número de identidad" },
        { status: 409 }
      );
    }
    throw e;
  }

  // Un cambio de salario no autorizado era indistinguible de uno legítimo: esta
  // ruta no escribía nada en AuditLog.
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "Empleado",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: {
      salarioBase: empleadoActual.salarioBase,
      estado: empleadoActual.estado,
      sucursalId: empleadoActual.sucursalId,
      departamentoId: empleadoActual.departamentoId,
      // Cambia lo que se le descuenta al trabajador: tiene que poder rastrearse.
      ihssMontoFijo: empleadoActual.ihssMontoFijo,
    },
    valorNuevo: { ...data, motivo: motivo ?? undefined },
    ip,
    userAgent,
  });

  return NextResponse.json(empleado);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("empleados.eliminar");
  if (!g.ok) return g.response;

  const { id } = await params;

  const actual = await prisma.empleado.findUnique({
    where: { id },
    select: { id: true, sucursalId: true, departamentoId: true, estado: true, fechaSalida: true },
  });
  if (!actual || !alcanzaEmpleado(g.usuario, actual)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // Baja lógica con la fecha del día en Honduras: `fechaSalida` es una columna
  // de calendario y se compara contra los períodos de planilla.
  const fechaSalida = hoyHN();
  await prisma.$transaction(async (tx) => {
    await tx.empleado.update({ where: { id }, data: { estado: "INACTIVO", fechaSalida } });
    if (actual.estado !== "INACTIVO") await cerrarContratoVigente(tx, id, fechaSalida);
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE",
    tabla: "Empleado",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { estado: actual.estado, fechaSalida: actual.fechaSalida },
    valorNuevo: { estado: "INACTIVO", fechaSalida },
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true, fechaSalida });
}
