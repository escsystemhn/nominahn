import { prisma } from "@/lib/prisma";
import { alcanzaEmpleado, filtroSucursales } from "@/lib/auth/alcance";
import { divisionesHabilitadas, jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { notFound } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import EditarEmpleadoForm, { type EmpleadoEditable } from "@/components/employees/EditarEmpleadoForm";
import { puede, requerirPermisoPagina } from "@/lib/auth/guard";
import { leerLista, textoLista, vecinosEmpleado } from "@/lib/empleados/lista";
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lista?: string }>;
}) {
  // Editar el expediente toca salario, identidad y cuenta bancaria: mismo
  // conjunto de roles que exige `PUT /api/empleados/[id]`, para que la pantalla
  // no se abra a quien luego recibiría un 403 al guardar.
  const usuario = await requerirPermisoPagina("empleados.editar");

  const { id } = await params;
  // Las flechas ‹ › pasan a editar al anterior o al siguiente de la lista, con sus filtros.
  const filtros = leerLista((await searchParams).lista);
  const lista = textoLista(filtros);
  const conLista = lista ? `?lista=${encodeURIComponent(lista)}` : "";
  const vecinos = await vecinosEmpleado(prisma, usuario, id, filtros, puede(usuario, "empleados.pii"));

  const conDivisiones = await divisionesHabilitadas(prisma);
  const [emp, sucursales, divisiones, departamentos, puestos, centrosCosto, contratosVigentes] = await Promise.all([
    prisma.empleado.findUnique({ where: { id }, include: { foto: { select: { updatedAt: true } } } }),
    prisma.sucursal.findMany({ where: { activa: true, ...filtroSucursales(usuario) }, orderBy: { nombre: "asc" } }),
    conDivisiones
      ? prisma.division.findMany({ where: { activa: true }, select: { id: true, nombre: true, sucursalId: true }, orderBy: { nombre: "asc" } })
      : Promise.resolve([]),
    prisma.departamento.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, sucursalId: true, divisionId: true },
      orderBy: { nombre: "asc" },
    }),
    // También el que esta persona ya tiene, aunque esté inactivo: si no está entre
    // las opciones, la lista no puede mostrarlo y la ficha parece no tener puesto.
    prisma.puesto.findMany({
      where: { OR: [{ activo: true }, { empleados: { some: { id } } }] },
      select: { id: true, nombre: true, departamentoId: true, activo: true },
      orderBy: { nombre: "asc" },
    }),
    prisma.centroCosto.findMany({
      where: { activo: true },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { codigo: "asc" },
    }),
    prisma.contrato.count({ where: { empleadoId: id, activo: true } }),
  ]);

  // Fuera de su alcance responde igual que si no existiera (ver `alcanzaEmpleado`).
  if (!emp || !alcanzaEmpleado(usuario, emp)) notFound();

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
    // Sólo el id: el formulario trae sus datos y busca a otro en el servidor al escribir
    // (`/api/empleados/buscar?para=supervisor`), en vez de cargar aquí a todos los activos.
    supervisorId: emp.supervisorId ?? "",
    centroCostoId: emp.centroCostoId ?? "",
    emailCorporativo: emp.emailCorporativo ?? "",
    emailPersonal: emp.emailPersonal ?? "",
    // Texto para el input; vacío si se calcula por porcentaje.
    ihssMontoFijo: emp.ihssMontoFijo != null ? Number(emp.ihssMontoFijo).toFixed(2) : "",
    aplicaIhss: emp.aplicaIhss,
    aplicaRap: emp.aplicaRap,
    extension: emp.extension ?? "",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Editar empleado"
        description={<>{nombreCompleto(emp)}, código <strong>{emp.codigo}</strong></>}
        actions={
          <Link href={`/empleados/${id}${conLista}`} className="btn btn-secondary">
            Volver al expediente
          </Link>
        }
      />
      <div className="max-w-4xl">
      <EditarEmpleadoForm
        empleado={empleado}
        sucursales={sucursales}
        divisiones={divisiones}
        departamentos={departamentos.map((d) => ({ ...d, divisionId: conDivisiones ? d.divisionId : null }))}
        puestos={puestos}
        centrosCosto={centrosCosto}
        tieneContratoVigente={contratosVigentes > 0}
        puedeCambiarAportes={puede(usuario, "configuracion.parametros")}
        volverA={`/empleados/${id}${conLista}`}
        niveles={etiquetasNiveles(await jerarquiaNominaHabilitada(prisma))}
        fotoVersion={emp.foto?.updatedAt.getTime() ?? null}
        puedeCrear={puede(usuario, "empleados.crear")}
        navegacion={vecinos && vecinos.total > 1 ? {
          anterior: vecinos.anterior && { href: `/empleados/${vecinos.anterior.id}/editar${conLista}`, nombre: vecinos.anterior.nombre },
          siguiente: vecinos.siguiente && { href: `/empleados/${vecinos.siguiente.id}/editar${conLista}`, nombre: vecinos.siguiente.nombre },
          posicion: vecinos.posicion,
          total: vecinos.total,
        } : null}
      />
      </div>
    </div>
  );
}
