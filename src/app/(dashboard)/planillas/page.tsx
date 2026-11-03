import { prisma } from "@/lib/prisma";
import { alcanceEsTotal } from "@/lib/auth/alcance";
import { filtroPlanillas, totalesVisibles } from "@/lib/payroll/alcance-planilla";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { Prisma } from "@prisma/client";
import PageHeader from "@/components/ui/PageHeader";
import EstadoVacio from "@/components/ui/EstadoVacio";
import FilaEnlace from "@/components/ui/FilaEnlace";
import FormFiltros from "@/components/ui/FormFiltros";
import FranjaCifras from "@/components/ui/FranjaCifras";
import Paginacion from "@/components/ui/Paginacion";
import ThOrden from "@/components/ui/ThOrden";
import { leerOrden, type Orden } from "@/lib/http/orden";
import EstadoBadge, { estadoDePlanilla, etiquetaEstado } from "@/components/ui/EstadoBadge";
import FiltroEstructura from "@/components/organizacion/FiltroEstructura";
import { describirAlcance, filtroDetallesOrg, normalizarAlcance } from "@/lib/organizacion/estructura";
import { cargarOpcionesEstructura } from "@/lib/organizacion/estructura-bd";

export const metadata = { title: "Planillas" };

const TIPOS = ["MENSUAL", "QUINCENAL", "SEMANAL"] as const;
const ESTADOS = ["BORRADOR", "CALCULADA", "APROBADA", "PAGADA", "ANULADA"] as const;
const POR_PAGINA = 25;

const COLUMNAS = ["creada", "tipo", "periodo", "bruto", "deducciones", "neto", "estado"] as const;
type Columna = (typeof COLUMNAS)[number];

function ordenDeConsulta({ campo, dir }: Orden<Columna>): Prisma.PlanillaOrderByWithRelationInput[] {
  const principal: Record<Columna, Prisma.PlanillaOrderByWithRelationInput> = {
    creada: { createdAt: dir },
    tipo: { tipo: dir },
    periodo: { fechaInicio: dir },
    bruto: { totalBruto: dir },
    deducciones: { totalDeducciones: dir },
    neto: { totalNeto: dir },
    estado: { estado: dir },
  };
  // El `id` desempata: sin él, dos filas iguales pueden saltar de una página a otra.
  return [principal[campo], { id: "desc" }];
}

export default async function PlanillasPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursalId?: string; divisionId?: string; departamentoId?: string; estado?: string; orden?: string; dir?: string; page?: string }>;
}) {
  // Antes esta página no llamaba a auth() en absoluto: el menú lateral ocultaba
  // el enlace, pero escribir la URL mostraba la nómina completa a cualquiera.
  const usuario = await requerirPermisoPagina("planillas.ver");
  const puedeCrear = puede(usuario, "planillas.calcular");

  const sp = await searchParams;
  const opciones = await cargarOpcionesEstructura(prisma);
  const alcance = normalizarAlcance({ ...sp, divisionId: opciones.conDivisiones ? sp.divisionId : null });
  const hayFiltro = !!(alcance.sucursalId || alcance.divisionId || alcance.departamentoId);

  // Filtrar = planillas que INCLUYEN personal de esa unidad (según dónde estaba
  // cada quien al pagarse): una planilla de toda la empresa también paga a la
  // gente de cada sucursal, y por eso aparece.
  const unidad = { select: { nombre: true } } as const;
  // Con AND: el filtro de unidad y el de alcance miran la misma relación, y uno no debe pisar al otro.
  const whereUnidad: Prisma.PlanillaWhereInput = { AND: [hayFiltro ? { detalles: { some: filtroDetallesOrg(alcance) } } : {}, filtroPlanillas(usuario)] };
  const estado = ESTADOS.find((e) => e === sp.estado);
  const where: Prisma.PlanillaWhereInput = { ...whereUnidad, ...(estado ? { estado } : {}) };
  // Con alcance limitado, ordenar por monto revelaría el tamaño de cada planilla entera.
  const ordenaMontos = alcanceEsTotal(usuario);
  const orden = leerOrden(sp, ordenaMontos ? COLUMNAS : COLUMNAS.filter((c) => !["bruto", "deducciones", "neto"].includes(c)), { campo: "creada", dir: "desc" });
  const pagina = Math.max(1, parseInt(sp.page ?? "1") || 1);

  const [total, planillas, ultimas] = await Promise.all([
    prisma.planilla.count({ where }),
    prisma.planilla.findMany({
      where,
      include: { empresa: unidad, sucursal: unidad, division: unidad, departamento: unidad },
      orderBy: ordenDeConsulta(orden),
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
    }),
    // Va aparte: la franja no depende de cómo esté ordenada o paginada la lista.
    Promise.all(TIPOS.map((tipo) => prisma.planilla.findFirst({ where: { ...whereUnidad, tipo }, orderBy: { createdAt: "desc" } }))),
  ]);

  // Con alcance limitado, los montos son la suma de las personas que alcanza.
  const visibles = await totalesVisibles(prisma, usuario, [...planillas, ...ultimas].flatMap((p) => (p ? [p.id] : [])));
  const cifras = (p: { id: string; totalBruto: Prisma.Decimal; totalDeducciones: Prisma.Decimal; totalNeto: Prisma.Decimal }) => visibles?.get(p.id) ?? p;

  // Enlaces que conservan filtros y orden.
  const consulta = (cambios: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...cambios })) if (v) q.set(k, v);
    return `?${q.toString()}`;
  };
  const enlaceOrden = (o: Orden<Columna>) => consulta({ orden: o.campo, dir: o.dir, page: undefined });
  const enlacePagina = (n: number) => consulta({ page: String(n) });
  const th = { actual: orden, enlace: enlaceOrden };

  // En una sola empresa la columna repite lo mismo en todas las filas.
  const variasEmpresas = new Set(planillas.map((p) => p.empresaId)).size > 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planillas"
        description="Nóminas semanales, quincenales y mensuales: cálculo, aprobación, pago y comprobantes."
        actions={
          puedeCrear && (
            <Link href="/planillas/nueva" className="btn btn-primary">
              Nueva planilla
            </Link>
          )
        }
      >
        <FormFiltros campos={["sucursalId", "divisionId", "departamentoId", "estado"]} etiqueta="Filtrar planillas" className="flex flex-wrap gap-2">
          <FiltroEstructura {...opciones} inicial={sp} />
          <select name="estado" defaultValue={estado ?? ""} aria-label="Estado" className="input w-auto">
            <option value="">Todos los estados</option>
            {ESTADOS.map((e) => (
              <option key={e} value={e}>{etiquetaEstado(estadoDePlanilla(e))}</option>
            ))}
          </select>
        </FormFiltros>
      </PageHeader>

      {/* Última planilla de cada tipo, en una franja con divisores. */}
      <FranjaCifras
        etiqueta="Última planilla por tipo"
        cifras={TIPOS.map((tipo, i) => {
          const ultima = ultimas[i];
          return {
            label: `Última ${etiquetaEstado(tipo).toLowerCase()}`,
            valor: ultima ? formatCurrency(cifras(ultima).totalNeto) : <span className="text-sm font-normal text-gray-500">Sin planillas de este tipo</span>,
            detalle: ultima && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  {formatDate(ultima.fechaInicio)} al {formatDate(ultima.fechaFin)}
                </span>
                <EstadoBadge valor={estadoDePlanilla(ultima.estado)} />
              </div>
            ),
          };
        })}
      />

      <div className="panel overflow-hidden">
        <div className="tabla-fija overflow-x-auto">
          <table className="table-base tabla-tarjetas">
            <thead>
              <tr>
                <ThOrden campo="tipo" {...th}>Planilla</ThOrden>
                <ThOrden campo="periodo" dirInicial="desc" {...th}>Período</ThOrden>
                {variasEmpresas && <th>Empresa</th>}
                <th>Alcance</th>
                {ordenaMontos ? <ThOrden campo="bruto" dirInicial="desc" className="num" {...th}>Bruto</ThOrden> : <th className="num">Bruto</th>}
                {ordenaMontos ? <ThOrden campo="deducciones" dirInicial="desc" className="num" {...th}>Deducciones</ThOrden> : <th className="num">Deducciones</th>}
                {ordenaMontos ? <ThOrden campo="neto" dirInicial="desc" className="num" {...th}>Neto</ThOrden> : <th className="num">Neto</th>}
                <ThOrden campo="estado" {...th}>Estado</ThOrden>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {planillas.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EstadoVacio
                      titulo={estado ? "Ninguna planilla en ese estado." : hayFiltro ? "Ninguna planilla incluye personal de esa unidad." : "Todavía no hay planillas."}
                      detalle={
                        hayFiltro || estado
                          ? "Quite o cambie el filtro para ver las demás."
                          : puedeCrear
                            ? "Genere la primera: queda en borrador para revisarla antes de confirmarla."
                            : "Cuando Nómina genere una, aparecerá aquí."
                      }
                      accion={
                        puedeCrear && !hayFiltro && !estado && (
                          <Link href="/planillas/nueva" className="btn btn-primary">
                            Nueva planilla
                          </Link>
                        )
                      }
                    />
                  </td>
                </tr>
              ) : (
                planillas.map((p) => (
                  <FilaEnlace key={p.id} href={`/planillas/${p.id}`}>
                    <td data-titulo>
                      <Link href={`/planillas/${p.id}`} className="font-medium text-gray-900 hover:text-blue-700">
                        {etiquetaEstado(p.tipo)}
                      </Link>
                    </td>
                    <td data-etiqueta="Período" className="whitespace-nowrap">
                      {formatDate(p.fechaInicio)} al {formatDate(p.fechaFin)}
                    </td>
                    {variasEmpresas && <td data-etiqueta="Empresa">{p.empresa.nombre}</td>}
                    <td data-etiqueta="Alcance" className="text-gray-600">{describirAlcance(p)}</td>
                    <td data-etiqueta="Bruto" className="num whitespace-nowrap">{formatCurrency(cifras(p).totalBruto)}</td>
                    <td data-etiqueta="Deducciones" className="num whitespace-nowrap text-gray-500">{formatCurrency(cifras(p).totalDeducciones)}</td>
                    <td data-etiqueta="Neto" className="num whitespace-nowrap font-medium text-gray-900">{formatCurrency(cifras(p).totalNeto)}</td>
                    <td data-etiqueta="Estado">
                      <EstadoBadge valor={estadoDePlanilla(p.estado)} />
                    </td>
                    <td data-accion className="text-right">
                      <Link href={`/planillas/${p.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                        Ver detalle
                      </Link>
                    </td>
                  </FilaEnlace>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Paginacion pagina={pagina} totalPaginas={Math.ceil(total / POR_PAGINA)} enlace={enlacePagina} />
      </div>
    </div>
  );
}
