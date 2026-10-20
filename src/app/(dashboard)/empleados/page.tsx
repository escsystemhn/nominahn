import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import BarraDatos from "@/components/importacion/BarraDatos";
import Link from "next/link";
import { formatCurrency, formatDate, nombreCompleto } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge from "@/components/ui/EstadoBadge";

export const metadata = { title: "Empleados" };

export default async function EmpleadosPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; sucursalId?: string; page?: string }>;
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

  const where: Prisma.EmpleadoWhereInput = {
    AND: [
      search
        ? {
            OR: [
              { primerNombre: { contains: search, mode: "insensitive" } },
              { primerApellido: { contains: search, mode: "insensitive" } },
              { codigo: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
      sucursalId ? { sucursalId } : {},
    ],
  };

  const [total, empleados, sucursales] = await Promise.all([
    prisma.empleado.count({ where }),
    prisma.empleado.findMany({
      where,
      include: {
        sucursal: { select: { nombre: true } },
        departamento: { select: { nombre: true } },
        puesto: { select: { nombre: true } },
      },
      orderBy: { primerApellido: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.sucursal.findMany({ select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
  ]);

  const totalPaginas = Math.ceil(total / limit);
  // La paginación conserva los filtros: antes perdía la sucursal al cambiar de página.
  const enlacePagina = (n: number) => {
    const q = new URLSearchParams();
    q.set("page", String(n));
    if (search) q.set("search", search);
    if (sucursalId) q.set("sucursalId", sucursalId);
    return `?${q.toString()}`;
  };

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
        <form className="flex flex-wrap gap-2">
          <input
            name="search"
            defaultValue={search}
            placeholder="Nombre, apellido o código"
            aria-label="Buscar empleados"
            className="input min-w-56 flex-1 sm:max-w-sm"
          />
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
          <button type="submit" className="btn btn-secondary">
            Buscar
          </button>
          {hayFiltro && (
            <Link href="/empleados" className="btn btn-ghost">
              Quitar filtros
            </Link>
          )}
        </form>
      </PageHeader>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Código</th>
                <th>Empleado</th>
                <th>Sucursal</th>
                <th>Departamento</th>
                <th>Puesto</th>
                {vePII && <th className="num">Salario base</th>}
                <th>Ingreso</th>
                <th>Estado</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {empleados.length === 0 ? (
                <tr>
                  <td colSpan={vePII ? 9 : 8} className="py-12 text-center">
                    <p className="text-sm font-medium text-gray-900">
                      {hayFiltro ? "Ningún empleado coincide con la búsqueda." : "Todavía no hay empleados registrados."}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      {hayFiltro
                        ? "Pruebe con otro nombre o quite el filtro de sucursal."
                        : canCreate
                          ? "Registre el primero o importe un archivo con la plantilla."
                          : "Recursos Humanos aún no ha dado de alta a nadie."}
                    </p>
                  </td>
                </tr>
              ) : (
                empleados.map((emp) => (
                  <tr key={emp.id}>
                    <td className="whitespace-nowrap font-mono text-xs text-gray-500">{emp.codigo}</td>
                    <td>
                      <Link href={`/empleados/${emp.id}`} className="font-medium text-gray-900 hover:text-blue-700">
                        {nombreCompleto(emp)}
                      </Link>
                      {vePII && <div className="tnum text-xs text-gray-500">{emp.identidad}</div>}
                    </td>
                    <td className="whitespace-nowrap">{emp.sucursal.nombre}</td>
                    <td>{emp.departamento.nombre}</td>
                    <td>{emp.puesto?.nombre ?? <span className="text-gray-400">Sin puesto</span>}</td>
                    {vePII && (
                      <td className="num whitespace-nowrap font-medium text-gray-900">
                        {formatCurrency(emp.salarioBase)}
                      </td>
                    )}
                    <td className="whitespace-nowrap text-gray-500">{formatDate(emp.fechaIngreso)}</td>
                    <td>
                      <EstadoBadge valor={emp.estado} />
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Link href={`/empleados/${emp.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                        Ver ficha
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPaginas > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm text-gray-500">
            <span>
              Página {page} de {totalPaginas}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={enlacePagina(page - 1)} className="btn btn-secondary btn-sm">
                  Anterior
                </Link>
              )}
              {page < totalPaginas && (
                <Link href={enlacePagina(page + 1)} className="btn btn-secondary btn-sm">
                  Siguiente
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
