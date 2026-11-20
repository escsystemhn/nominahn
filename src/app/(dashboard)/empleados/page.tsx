import type { ReactNode } from "react";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { alcanceEsTotal, filtroSucursales } from "@/lib/auth/alcance";
import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import BarraDatos from "@/components/importacion/BarraDatos";
import Link from "next/link";
import { formatCurrency, formatDate, nombreCompleto } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import FotoAvatar from "@/components/employees/FotoAvatar";
import EstadoBadge, { etiquetaEstado } from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";
import FilaEnlace from "@/components/ui/FilaEnlace";
import FormFiltros from "@/components/ui/FormFiltros";
import Paginacion from "@/components/ui/Paginacion";
import ThOrden from "@/components/ui/ThOrden";
import OrdenMovil from "@/components/ui/OrdenMovil";
import SelectorColumnas from "@/components/employees/SelectorColumnas";
import ExportarEstructura from "@/components/organizacion/ExportarEstructura";
import type { Orden } from "@/lib/http/orden";
import { ESTADO_VIGENTES, filtroLista, ordenDeConsulta, ordenLista, textoLista, type ColumnaLista } from "@/lib/empleados/lista";
import { COLUMNAS, COOKIE_COLUMNAS, columnasDisponibles, columnasPorOmision, leerColumnas, type ClaveColumna } from "@/lib/empleados/columnas-lista";
import { formatoIdentidad } from "@/lib/empleados/identidad";
import { formatoRtn } from "@/lib/reportes/estructura-organizacional";
import { divisionesHabilitadas, jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";

export const metadata = { title: "Empleados" };

const INCLUIR = {
  sucursal: { select: { nombre: true } },
  departamento: { select: { nombre: true, division: { select: { nombre: true } }, centroCosto: { select: { codigo: true, nombre: true } } } },
  puesto: { select: { nombre: true } },
  supervisor: { select: { primerNombre: true, primerApellido: true } },
  centroCosto: { select: { codigo: true, nombre: true } },
  foto: { select: { updatedAt: true } },
} satisfies Prisma.EmpleadoInclude;
type Fila = Prisma.EmpleadoGetPayload<{ include: typeof INCLUIR }>;

const BANCOS: Record<string, string> = {
  BANCATLAN: "Bancatlán", BAC: "BAC Honduras", FICOHSA: "Ficohsa", BANPAIS: "Banpaís",
  BANHCAFE: "Banhcafé", LAFISE: "Lafise", BANCO_ATLANTIDA: "Banco Atlántida", OTRO: "Otro",
};
const ESTADOS_CIVILES: Record<string, string> = {
  SOLTERO: "Soltero/a", CASADO: "Casado/a", UNION_LIBRE: "Unión libre", DIVORCIADO: "Divorciado/a", VIUDO: "Viudo/a",
};
const ESTADOS_FILTRO = [
  [ESTADO_VIGENTES, "Sin los dados de baja"],
  ["ACTIVO", "Activo"], ["VACACIONES", "Vacaciones"], ["PERMISO", "Permiso"], ["SUSPENDIDO", "Suspendido"], ["INACTIVO", "Dados de baja"],
] as const;

/** «3 años», «8 meses»: hasta la salida si ya se fue. */
function antiguedad(desde: Date, hasta: Date | null): string {
  const fin = hasta ?? new Date();
  let meses = (fin.getFullYear() - desde.getFullYear()) * 12 + (fin.getMonth() - desde.getMonth());
  if (fin.getDate() < desde.getDate()) meses -= 1;
  if (meses < 1) return "Menos de 1 mes";
  if (meses < 12) return meses === 1 ? "1 mes" : `${meses} meses`;
  const anios = Math.floor(meses / 12);
  return anios === 1 ? "1 año" : `${anios} años`;
}

function edad(nacimiento: Date): number {
  const hoy = new Date();
  let n = hoy.getFullYear() - nacimiento.getFullYear();
  if (hoy.getMonth() < nacimiento.getMonth() || (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate())) n -= 1;
  return n;
}

const nada = <span className="text-gray-400">—</span>;

/** Cómo se dibuja cada columna. `className` va en la celda; `sinSalto` evita que se parta en dos líneas. */
const CELDAS: Record<ClaveColumna, { valor: (e: Fila) => ReactNode; className?: string }> = {
  codigo: { valor: (e) => e.codigo, className: "whitespace-nowrap font-mono text-xs text-gray-500" },
  identidad: { valor: (e) => (e.identidad ? formatoIdentidad(e.identidad) : nada), className: "tnum whitespace-nowrap" },
  rtn: { valor: (e) => (e.rtn ? formatoRtn(e.rtn) : nada), className: "tnum whitespace-nowrap" },
  ihss: { valor: (e) => e.ihssNro ?? nada, className: "tnum whitespace-nowrap" },
  rap: { valor: (e) => e.rapNro ?? nada, className: "tnum whitespace-nowrap" },
  sucursal: { valor: (e) => e.sucursal.nombre, className: "min-w-24" },
  division: { valor: (e) => e.departamento.division?.nombre ?? <span className="text-gray-500">Sin asignar</span>, className: "min-w-24" },
  departamento: { valor: (e) => e.departamento.nombre },
  puesto: { valor: (e) => e.puesto?.nombre ?? <span className="text-gray-500">Sin puesto</span> },
  jefe: { valor: (e) => (e.supervisor ? `${e.supervisor.primerNombre} ${e.supervisor.primerApellido}` : nada), className: "whitespace-nowrap" },
  centroCosto: {
    // El propio manda sobre el del departamento, como en la planilla.
    valor: (e) => {
      const cc = e.centroCosto ?? e.departamento.centroCosto;
      return cc ? <span title={cc.nombre}>{cc.codigo} · {cc.nombre}</span> : nada;
    },
  },
  frecuencia: { valor: (e) => etiquetaEstado(e.tipoPlanilla), className: "whitespace-nowrap" },
  contrato: { valor: (e) => etiquetaEstado(e.tipoContrato), className: "whitespace-nowrap" },
  ingreso: { valor: (e) => formatDate(e.fechaIngreso), className: "tnum whitespace-nowrap text-gray-500" },
  antiguedad: { valor: (e) => antiguedad(e.fechaIngreso, e.fechaSalida), className: "whitespace-nowrap" },
  salida: { valor: (e) => (e.fechaSalida ? formatDate(e.fechaSalida) : nada), className: "tnum whitespace-nowrap" },
  estado: { valor: (e) => <EstadoBadge valor={e.estado} /> },
  salario: { valor: (e) => formatCurrency(e.salarioBase), className: "num whitespace-nowrap font-medium text-gray-900" },
  banco: { valor: (e) => (e.banco ? BANCOS[e.banco] ?? e.banco : nada), className: "whitespace-nowrap" },
  cuenta: { valor: (e) => e.cuentaBancaria ?? nada, className: "tnum whitespace-nowrap" },
  correo: { valor: (e) => e.emailCorporativo ?? nada },
  extension: { valor: (e) => e.extension ?? nada, className: "tnum whitespace-nowrap" },
  telefono: { valor: (e) => e.telefonoPersonal ?? nada, className: "tnum whitespace-nowrap" },
  correoPersonal: { valor: (e) => e.emailPersonal ?? nada },
  genero: { valor: (e) => (e.genero === "M" ? "Masculino" : e.genero === "F" ? "Femenino" : e.genero || nada) },
  estadoCivil: { valor: (e) => (e.estadoCivil ? ESTADOS_CIVILES[e.estadoCivil] ?? e.estadoCivil : nada), className: "whitespace-nowrap" },
  nacimiento: {
    valor: (e) => (
      <>
        {formatDate(e.fechaNacimiento)} <span className="text-xs text-gray-500">· {edad(e.fechaNacimiento)} años</span>
      </>
    ),
    className: "tnum whitespace-nowrap",
  },
};

export default async function EmpleadosPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; sucursalId?: string; divisionId?: string; estado?: string; page?: string; orden?: string; dir?: string }>;
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
  // Sin permiso para ver datos personales, tampoco se puede deducir quién gana más ordenando.
  const orden = ordenLista(sp, vePII);
  // `conAlcance` combina con AND: quien sólo alcanza una sucursal no ve a nadie de otra,
  // aunque la pida en la dirección (ver lib/empleados/lista.ts).
  const where = await filtroLista(prisma, usuario, sp, vePII);
  // La ficha recibe los filtros de la lista: sus flechas ‹ › la recorren en este mismo orden.
  const lista = textoLista(sp);
  const aFicha = (id: string) => `/empleados/${id}${lista ? `?lista=${encodeURIComponent(lista)}` : ""}`;
  const sinSucursales = usuario.alcance === "SUCURSAL" && !usuario.sucursalesIds?.length;

  const [total, empleados, sucursales, conJerarquia, conDivisiones, galleta] = await Promise.all([
    prisma.empleado.count({ where }),
    prisma.empleado.findMany({
      where,
      include: INCLUIR,
      orderBy: ordenDeConsulta(orden),
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.sucursal.findMany({ where: filtroSucursales(usuario), select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    jerarquiaNominaHabilitada(prisma),
    divisionesHabilitadas(prisma),
    cookies(),
  ]);
  const niveles = etiquetasNiveles(conJerarquia);
  const divisiones = conDivisiones
    ? await prisma.division.findMany({
        where: { sucursalId: { in: sucursales.map((s) => s.id) } },
        select: { id: true, nombre: true, sucursalId: true },
        orderBy: { nombre: "asc" },
      })
    : [];
  const divisionId = conDivisiones ? sp.divisionId : undefined;
  const estado = sp.estado;

  // Las columnas que esta persona eligió (cookie), recortadas a lo que puede ver.
  const opcionesColumnas = { vePII, conDivisiones };
  const visibles = leerColumnas(galleta.get(COOKIE_COLUMNAS)?.value, opcionesColumnas);
  const defs = COLUMNAS.filter((c) => visibles.includes(c.clave));
  const antesDelNombre = defs.filter((c) => c.clave === "codigo");
  const despuesDelNombre = defs.filter((c) => c.clave !== "codigo");

  const totalPaginas = Math.ceil(total / limit);
  // Los enlaces conservan filtros y orden: antes se perdía la sucursal al cambiar de página.
  const consulta = (cambios: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...cambios })) if (v) q.set(k, v);
    return `?${q.toString()}`;
  };
  const enlacePagina = (n: number) => consulta({ page: String(n) });
  const th = { actual: orden, enlace: (o: Orden<ColumnaLista>) => consulta({ orden: o.campo, dir: o.dir, page: undefined }) };

  const hayFiltro = Boolean(search || sucursalId || divisionId || estado);
  const verGrupos = alcanceEsTotal(usuario) || sucursales.length > 1;
  const divisionesFiltro = divisiones.filter((v) => !sucursalId || v.sucursalId === sucursalId);
  const nombreGrupo = new Map(sucursales.map((s) => [s.id, s.nombre]));

  const encabezado = (c: (typeof COLUMNAS)[number]) => {
    const etiqueta = c.etiqueta(niveles);
    return c.orden ? (
      <ThOrden key={c.clave} campo={c.orden} dirInicial={c.desc ? "desc" : "asc"} className={c.num ? "num" : undefined} {...th}>
        {etiqueta}
      </ThOrden>
    ) : (
      <th key={c.clave} className={c.num ? "num" : undefined}>{etiqueta}</th>
    );
  };
  const celda = (c: (typeof COLUMNAS)[number], emp: Fila) => (
    <td key={c.clave} data-etiqueta={c.etiqueta(niveles)} className={CELDAS[c.clave].className}>
      {CELDAS[c.clave].valor(emp)}
    </td>
  );

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
              filtros={{ search, sucursalId, divisionId, estado }}
              tituloImportacion="Importar empleados"
              ayudaImportacion="El archivo se identifica por el Código del empleado: si ya existe se actualiza, y si la celda va vacía se da de alta con un código nuevo. Sólo se modifican las columnas que traiga el archivo; las que falten quedan como están. Un cambio de salario genera su registro en el historial salarial."
            />
            {puedeExportar && (
              <ExportarEstructura
                grupos={sucursales}
                divisiones={divisiones}
                etiquetas={{
                  sucursal: niveles.sucursal, todasSucursales: niveles.todasSucursales, sucursales: niveles.sucursales,
                  division: niveles.division, todasDivisiones: niveles.todasDivisiones, divisiones: niveles.divisiones,
                }}
                inicial={{ sucursalId, divisionId }}
              />
            )}
            {canCreate && (
              <Link href="/empleados/nuevo" className="btn btn-primary">
                Nuevo empleado
              </Link>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-start gap-2">
          <FormFiltros
            campos={["search", "sucursalId", "divisionId", "estado"]}
            dependientes={{ sucursalId: ["divisionId"] }}
            etiqueta="Buscar empleados"
            className="flex min-w-0 flex-1 flex-wrap gap-2"
          >
            <input
              name="search"
              defaultValue={search}
              autoComplete="off"
              placeholder="Nombre, apellido o código"
              aria-label="Buscar empleados"
              className="input min-w-56 flex-1 sm:max-w-sm"
            />
            {verGrupos && (
              <select name="sucursalId" defaultValue={sucursalId} aria-label={niveles.sucursal} className="input w-auto">
                <option value="">{niveles.todasSucursales}</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            )}
            {divisiones.length > 0 && (
              // Con un grupo elegido, sólo sus sucursales; sin él, todas, con su grupo al lado.
              <select key={sucursalId ?? ""} name="divisionId" defaultValue={divisionId} aria-label={niveles.division} className="input w-auto">
                <option value="">{niveles.todasDivisiones}</option>
                {divisionesFiltro.map((v) => (
                  <option key={v.id} value={v.id}>
                    {sucursalId || !verGrupos ? v.nombre : `${v.nombre} (${nombreGrupo.get(v.sucursalId) ?? ""})`}
                  </option>
                ))}
              </select>
            )}
            <select name="estado" defaultValue={estado} aria-label="Estado" className="input w-auto">
              <option value="">Todos los estados</option>
              {ESTADOS_FILTRO.map(([valor, texto]) => (
                <option key={valor} value={valor}>{texto}</option>
              ))}
            </select>
          </FormFiltros>
          <SelectorColumnas
            opciones={columnasDisponibles(opcionesColumnas).map((c) => ({ clave: c.clave, etiqueta: c.etiqueta(niveles), grupo: c.grupo }))}
            visibles={visibles}
            porOmision={columnasPorOmision(opcionesColumnas)}
          />
          <OrdenMovil
            actual={orden}
            opciones={[
              { campo: "empleado", etiqueta: "Empleado", tipo: "texto" },
              ...[...antesDelNombre, ...despuesDelNombre].flatMap((c) =>
                c.orden ? [{ campo: c.orden, etiqueta: c.etiqueta(niveles), tipo: c.num || c.clave === "antiguedad" ? "numero" as const : c.desc ? "fecha" as const : "texto" as const }] : []
              ),
            ]}
          />
        </div>
      </PageHeader>

      <div className="panel overflow-hidden">
        <div className="tabla-fija overflow-x-auto">
          {/* Celdas un poco más angostas que en otras tablas: aquí cada columna la elige la persona y a 1366 px cuenta cada píxel. */}
          <table className="table-base tabla-tarjetas sm:[&_td]:px-3 sm:[&_th]:px-3" data-columnas={visibles.join(",")}>
            <thead>
              <tr>
                {antesDelNombre.map(encabezado)}
                <ThOrden campo="empleado" className="col-fija" {...th}>Empleado</ThOrden>
                {despuesDelNombre.map(encabezado)}
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {empleados.length === 0 ? (
                <tr>
                  <td colSpan={defs.length + 2}>
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
                          ? "Pruebe con otro nombre o quite los filtros."
                          : canCreate
                            ? "Registre el primero o importe un archivo con la plantilla."
                            : "Recursos Humanos aún no ha dado de alta a nadie."
                      }
                    />
                  </td>
                </tr>
              ) : (
                empleados.map((emp) => (
                  <FilaEnlace key={emp.id} href={aFicha(emp.id)}>
                    {antesDelNombre.map((c) => celda(c, emp))}
                    <td data-titulo className="col-fija sm:min-w-48">
                      <div className="flex items-center gap-2.5">
                        <FotoAvatar empleadoId={emp.id} version={emp.foto?.updatedAt ?? null} nombre={nombreCompleto(emp)} tamano="sm" />
                        <div className="min-w-0">
                          <Link href={aFicha(emp.id)} className="font-medium text-gray-900 hover:text-blue-700">
                            {nombreCompleto(emp)}
                          </Link>
                          {/* La identidad bajo el nombre, salvo que ya tenga su propia columna. */}
                          {vePII && !visibles.includes("identidad") && emp.identidad && (
                            <div className="tnum text-xs text-gray-500">{formatoIdentidad(emp.identidad)}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    {despuesDelNombre.map((c) => celda(c, emp))}
                    <td data-accion className="whitespace-nowrap text-right">
                      {/* Entre 640 y 1536 px sólo la flecha: la fila entera y el nombre ya abren la ficha, y el texto no cabía a 1366 px. */}
                      <Link href={aFicha(emp.id)} aria-label={`Ver ficha de ${nombreCompleto(emp)}`} className="inline-flex items-center text-sm font-medium text-blue-600 hover:underline">
                        <span className="sm:hidden 2xl:inline">Ver ficha</span>
                        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="hidden h-4 w-4 sm:inline 2xl:hidden">
                          <path d="M7.5 4.5 13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
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
