import { Prisma } from "@prisma/client";
import { alcanceEsTotal, conAlcance, filtroSucursales } from "@/lib/auth/alcance";
import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import BarraDatos from "@/components/importacion/BarraDatos";
import Link from "next/link";
import { formatCurrency, formatDate, nombreCompleto } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";
import FilaEnlace from "@/components/ui/FilaEnlace";
import FormFiltros from "@/components/ui/FormFiltros";
import Paginacion from "@/components/ui/Paginacion";
import ThOrden from "@/components/ui/ThOrden";
import { leerOrden, type Orden } from "@/lib/http/orden";
import { filtroBusquedaEmpleados } from "@/lib/empleados/busqueda";

export const metadata = { title: "Empleados" };

const COLUMNAS = ["codigo", "empleado", "sucursal", "departamento", "puesto", "salario", "ingreso", "estado"] as const;
type Columna = (typeof COLUMNAS)[number];

function ordenDeConsulta({ campo, dir }: Orden<Columna>): Prisma.EmpleadoOrderByWithRelationInput[] {
  const principal: Record<Columna, Prisma.EmpleadoOrderByWithRelationInput[]> = {
    codigo: [{ codigo: dir }],
    empleado: [{ primerApellido: dir }, { primerNombre: dir }],
    sucursal: [{ sucursal: { nombre: dir } }],
    departamento: [{ departamento: { nombre: dir } }],
    puesto: [{ puesto: { nombre: dir } }],
    salario: [{ salarioBase: dir }],
    ingreso: [{ fechaIngreso: dir }],
    estado: [{ estado: dir }],
  };
  // El `id` desempata: sin él, dos filas iguales pueden saltar de una página a otra.
  return [...principal[campo], { id: "asc" }];
}

export default async function EmpleadosPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; sucursalId?: string; page?: string; orden?: string; dir?: string }>;
}) {
  const usuario = await requerirPermisoPagina("empleados.ver");
  const canCreate = puede(usuario, "empleados.crear");
  // La tabla mostraba identidad y salario a cualquiera que llegara a la URL.
  const vePII = puede(usuario, "empleados.pii");
  const puedeExportar = puede(usuario, "empleados.exportar");
  const puedeImportar = puede(usuario, "empleados.importar");

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const limit = 20;
  const search = sp.search ?? "";
  const sucursalId = sp.sucursalId;
  // Sin permiso para ver salarios, tampoco se puede deducir quién gana más ordenando.
  const orden = leerOrden(sp, vePII ? COLUMNAS : COLUMNAS.filter((c) => c !== "salario"), { campo: "empleado", dir: "asc" });

  // `conAlcance` combina con AND: quien sólo alcanza una sucursal no ve a nadie de otra,
  // aunque la pida en la dirección.
  const where = conAlcance(
    { AND: [await filtroBusquedaEmpleados(prisma, search, { conIdentidad: vePII }), sucursalId ? { sucursalId } : {}] },
    usuario
  );
  const sinSucursales = usuario.alcance === "SUCURSAL" && !usuario.sucursalesIds?.length;

  const [total, empleados, sucursales] = await Promise.all([
    prisma.empleado.count({ where }),
    prisma.empleado.findMany({
      where,
      include: {
        sucursal: { select: { nombre: true } },
        departamento: { select: { nombre: true } },
        puesto: { select: { nombre: true } },
      },
      orderBy: ordenDeConsulta(orden),
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.sucursal.findMany({ where: filtroSucursales(usuario), select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
  ]);

  const totalPaginas = Math.ceil(total / limit);
  // Los enlaces conservan filtros y orden: antes se perdía la sucursal al cambiar de página.
  const consulta = (cambios: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...cambios })) if (v) q.set(k, v);
    return `?${q.toString()}`;
  };
  const enlacePagina = (n: number) => consulta({ page: String(n) });
  const th = { actual: orden, enlace: (o: Orden<Columna>) => consulta({ orden: o.campo, dir: o.dir, page: undefined }) };

  const hayFiltro = Boolean(search || sucursalId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Empleados"
        description={
          total === 1
            ? "1 empleado registrado"
            : `${total} empleados registrados${hayFiltro ? " con este filtro" : ""}`
        }
        actions={
          <>
            <BarraDatos
              recurso="empleados"
              elegirFilas
              puedeExportar={puedeExportar}
              puedeImportar={puedeImportar}
              incluyePII={vePII}
              filtros={{ search, sucursalId }}
              tituloImportacion="Importar empleados"
              ayudaImportacion="El archivo se identifica por el Código del empleado: si ya existe se actualiza, y si la celda va vacía se da de alta con un código nuevo. Sólo se modifican las columnas que traiga el archivo; las que falten quedan como están. Un cambio de salario genera su registro en el historial salarial."
            />
            {canCreate && (
              <Link href="/empleados/nuevo" className="btn btn-primary">
                Nuevo empleado
              </Link>
            )}
          </>
        }
      >
        <FormFiltros campos={["search", "sucursalId"]} etiqueta="Buscar empleados" className="flex flex-wrap gap-2">
          <input
            name="search"
            defaultValue={search}
            autoComplete="off"
            placeholder="Nombre, apellido o código"
            aria-label="Buscar empleados"
            className="input min-w-56 flex-1 sm:max-w-sm"
          />
          {(alcanceEsTotal(usuario) || sucursales.length > 1) && (
            <select
              name="sucursalId"
              defaultValue={sucursalId}
              aria-label="Sucursal"
              className="input w-auto"
            >
              <option value="">Todas las sucursales</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          )}
        </FormFiltros>
      </PageHeader>

      <div className="panel overflow-hidden">
        <div className="tabla-fija overflow-x-auto">
          <table className="table-base tabla-tarjetas">
            <thead>
              <tr>
                <ThOrden campo="codigo" {...th}>Código</ThOrden>
                <ThOrden campo="empleado" {...th}>Empleado</ThOrden>
                <ThOrden campo="sucursal" {...th}>Sucursal</ThOrden>
                <ThOrden campo="departamento" {...th}>Departamento</ThOrden>
                <ThOrden campo="puesto" {...th}>Puesto</ThOrden>
                {vePII && <ThOrden campo="salario" dirInicial="desc" className="num" {...th}>Salario base</ThOrden>}
                <ThOrden campo="ingreso" dirInicial="desc" {...th}>Ingreso</ThOrden>
                <ThOrden campo="estado" {...th}>Estado</ThOrden>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {empleados.length === 0 ? (
                <tr>
                  <td colSpan={vePII ? 9 : 8}>
                    <EstadoVacio
                      titulo={
                        sinSucursales
                          ? "Su cuenta todavía no tiene sucursales asignadas."
                          : hayFiltro
                            ? "Ningún empleado coincide con la búsqueda."
                            : "Todavía no hay empleados registrados."
                      }
                      detalle={
                        sinSucursales
                          ? "Un administrador puede asignárselas en Usuarios."
                          : hayFiltro
                          ? "Pruebe con otro nombre o quite el filtro de sucursal."
                          : canCreate
                            ? "Registre el primero o importe un archivo con la plantilla."
                            : "Recursos Humanos aún no ha dado de alta a nadie."
                      }
                    />
                  </td>
                </tr>
              ) : (
                empleados.map((emp) => (
                  <FilaEnlace key={emp.id} href={`/empleados/${emp.id}`}>
                    <td data-etiqueta="Código" className="whitespace-nowrap font-mono text-xs text-gray-500">{emp.codigo}</td>
                    <td data-titulo>
                      <Link href={`/empleados/${emp.id}`} className="font-medium text-gray-900 hover:text-blue-700">
                        {nombreCompleto(emp)}
                      </Link>
                      {vePII && <div className="tnum text-xs text-gray-500">{emp.identidad}</div>}
                    </td>
                    <td data-etiqueta="Sucursal" className="whitespace-nowrap">{emp.sucursal.nombre}</td>
                    <td data-etiqueta="Departamento">{emp.departamento.nombre}</td>
                    <td data-etiqueta="Puesto">{emp.puesto?.nombre ?? <span className="text-gray-500">Sin puesto</span>}</td>
                    {vePII && (
                      <td data-etiqueta="Salario base" className="num whitespace-nowrap font-medium text-gray-900">
                        {formatCurrency(emp.salarioBase)}
                      </td>
                    )}
                    <td data-etiqueta="Ingreso" className="whitespace-nowrap text-gray-500">{formatDate(emp.fechaIngreso)}</td>
                    <td data-etiqueta="Estado">
                      <EstadoBadge valor={emp.estado} />
                    </td>
                    <td data-accion className="whitespace-nowrap text-right">
                      <Link href={`/empleados/${emp.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                        Ver ficha
                      </Link>
                    </td>
                  </FilaEnlace>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Paginacion pagina={page} totalPaginas={totalPaginas} enlace={enlacePagina} />
      </div>
    </div>
  );
}
