import { prisma } from "@/lib/prisma";
import { divisionesHabilitadas } from "@/lib/organizacion/estructura-bd";
import { notFound } from "next/navigation";
import Link from "next/link";
import EditarEmpleadoForm, { type EmpleadoEditable } from "@/components/employees/EditarEmpleadoForm";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { nombreCompleto } from "@/lib/utils";

/**
 * Las columnas de fecha se guardan como medianoche UTC (ver `fechaCalendario`
 * en `lib/utils`). Un `toISOString().slice(0,10)` devuelve por tanto el mismo
 * día de calendario que se registró; formatear en horario local restaría 6 horas
 * en Honduras y el input mostraría el día anterior.
 */
function aValorInput(fecha: Date | null): string {
  return fecha ? fecha.toISOString().slice(0, 10) : "";
}

export default async function EditarEmpleadoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Editar el expediente toca salario, identidad y cuenta bancaria: mismo
  // conjunto de roles que exige `PUT /api/empleados/[id]`, para que la pantalla
  // no se abra a quien luego recibiría un 403 al guardar.
  await requerirPermisoPagina("empleados.editar");

  const { id } = await params;

  const conDivisiones = await divisionesHabilitadas(prisma);
  const [emp, sucursales, divisiones, departamentos, puestos, centrosCosto] = await Promise.all([
    prisma.empleado.findUnique({ where: { id } }),
    prisma.sucursal.findMany({ where: { activa: true }, orderBy: { nombre: "asc" } }),
    conDivisiones
      ? prisma.division.findMany({ where: { activa: true }, select: { id: true, nombre: true, sucursalId: true }, orderBy: { nombre: "asc" } })
      : Promise.resolve([]),
    prisma.departamento.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, sucursalId: true, divisionId: true },
      orderBy: { nombre: "asc" },
    }),
    prisma.puesto.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, departamentoId: true },
      orderBy: { nombre: "asc" },
    }),
    prisma.centroCosto.findMany({
      where: { activo: true },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { codigo: "asc" },
    }),
  ]);

  if (!emp) notFound();

  // Un empleado no puede supervisarse a sí mismo, así que se excluye de la lista
  // (el API lo rechaza igualmente).
  const supervisoresRaw = await prisma.empleado.findMany({
    where: { estado: "ACTIVO", id: { not: id } },
    select: { id: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true },
    orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
  });
  const supervisores = supervisoresRaw.map((s) => ({ id: s.id, nombre: nombreCompleto(s) }));

  const empleado: EmpleadoEditable = {
    id: emp.id,
    primerNombre: emp.primerNombre,
    segundoNombre: emp.segundoNombre ?? "",
    primerApellido: emp.primerApellido,
    segundoApellido: emp.segundoApellido ?? "",
    fechaNacimiento: aValorInput(emp.fechaNacimiento),
    genero: emp.genero,
    estadoCivil: emp.estadoCivil ?? "",
    nacionalidad: emp.nacionalidad ?? "",
    identidad: emp.identidad ?? "",
    rtn: emp.rtn ?? "",
    ihssNro: emp.ihssNro ?? "",
    rapNro: emp.rapNro ?? "",
    telefonoPersonal: emp.telefonoPersonal ?? "",
    telefonoEmergencia: emp.telefonoEmergencia ?? "",
    contactoEmergencia: emp.contactoEmergencia ?? "",
    direccion: emp.direccion ?? "",
    fechaIngreso: aValorInput(emp.fechaIngreso),
    fechaSalida: aValorInput(emp.fechaSalida),
    estado: emp.estado,
    tipoContrato: emp.tipoContrato,
    // `Decimal` de Prisma no cruza el límite servidor→cliente: se envía number,
    // que es lo que el input numérico y el API esperan.
    salarioBase: Number(emp.salarioBase),
    motivo: "",
    tipoPlanilla: emp.tipoPlanilla,
    cuentaBancaria: emp.cuentaBancaria ?? "",
    banco: emp.banco ?? "",
    sucursalId: emp.sucursalId,
    departamentoId: emp.departamentoId,
    puestoId: emp.puestoId ?? "",
    supervisorId: emp.supervisorId ?? "",
    centroCostoId: emp.centroCostoId ?? "",
    emailCorporativo: emp.emailCorporativo ?? "",
    emailPersonal: emp.emailPersonal ?? "",
    // Texto para el input; vacío si se calcula por porcentaje.
    ihssMontoFijo: emp.ihssMontoFijo != null ? Number(emp.ihssMontoFijo).toFixed(2) : "",
    extension: emp.extension ?? "",
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-5">
        <Link href={`/empleados/${id}`} className="text-sm text-blue-700 hover:underline">
          Volver al expediente
        </Link>
        <h1 className="text-xl font-bold text-gray-900 mt-1">Editar empleado</h1>
        <p className="text-sm text-gray-500">
          {nombreCompleto(emp)} &middot; Código <strong>{emp.codigo}</strong>
        </p>
      </div>
      <EditarEmpleadoForm
        empleado={empleado}
        sucursales={sucursales}
        divisiones={divisiones}
        departamentos={departamentos.map((d) => ({ ...d, divisionId: conDivisiones ? d.divisionId : null }))}
        puestos={puestos}
        supervisores={supervisores}
        centrosCosto={centrosCosto}
      />
    </div>
  );
}
