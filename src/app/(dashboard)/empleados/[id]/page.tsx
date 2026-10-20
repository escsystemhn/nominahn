import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatCurrency, formatDate, nombreCompleto, calcularAniosTrabajados, iniciales } from "@/lib/utils";
import { calcularDiasVacaciones } from "@/lib/payroll/calculos-hn";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import Link from "next/link";
import EstadoBadge, { etiquetaEstado } from "@/components/ui/EstadoBadge";
import SaludFamilia from "@/components/employees/SaludFamilia";


export default async function FichaEmpleadoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  // El expediente muestra salario, identidad, RTN, cuenta bancaria e historial
  // salarial. Sólo lo ven los roles que administran nómina o auditan.
  const usuario = await requerirPermisoPagina("empleados.pii");

  // CONTADOR y AUDITOR leen el expediente pero no lo modifican: mostrarles
  // "Editar" los llevaba a una pantalla que les redirige.
  const puedeEditar = puede(usuario, "empleados.editar");
  const puedeDocumentos = puede(usuario, "documentos.emitir");

  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = tabParam ?? "personal";

  const emp = await prisma.empleado.findUnique({
    where: { id },
    include: {
      sucursal: true,
      departamento: true,
      puesto: true,
      contratos: { orderBy: { createdAt: "desc" } },
      permisos: { orderBy: { fechaInicio: "desc" } },
      deducciones: { include: { tipoDeduccion: true }, where: { activo: true } },
      historialSalarios: { orderBy: { fechaCambio: "desc" } },
      evaluaciones: { orderBy: { createdAt: "desc" }, take: 6 },
      documentos: { orderBy: { createdAt: "desc" } },
      planillasDetalle: {
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { planilla: { select: { tipo: true, fechaFin: true, estado: true } } },
      },
    },
  });

  if (!emp) notFound();

  const anios = calcularAniosTrabajados(emp.fechaIngreso);
  const diasVac = calcularDiasVacaciones(anios);
  const nombre = nombreCompleto(emp);

  const tabs = [
    { key: "personal", label: "Datos personales" },
    { key: "contrato", label: "Contrato laboral" },
    { key: "vacaciones", label: "Vacaciones y permisos" },
    { key: "historial", label: "Historial de pagos" },
    { key: "evaluaciones", label: "Evaluaciones" },
    { key: "salud", label: "Salud y familia" },
  ];

  return (
    <div className="max-w-5xl space-y-5">
      <header className="border-b border-gray-200 pb-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-blue-900 text-lg font-semibold text-white">
            {iniciales(nombre)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-2xl font-semibold leading-tight text-gray-900">{nombre}</h1>
              <EstadoBadge valor={emp.estado} className="text-sm" />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {emp.puesto ? `${emp.puesto.nombre}, ` : ""}
              {emp.departamento.nombre}, {emp.sucursal.nombre}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {puedeDocumentos && (
              <Link href={`/documentos?empleadoId=${id}`} className="btn btn-ghost">
                Emitir documento
              </Link>
            )}
            {puedeEditar && (
              <Link href={`/empleados/${id}/editar`} className="btn btn-secondary">
                Editar
              </Link>
            )}
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-gray-500">Código</dt>
            <dd className="mt-0.5 font-mono text-gray-900">{emp.codigo}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Ingreso</dt>
            <dd className="tnum mt-0.5 text-gray-900">{formatDate(emp.fechaIngreso)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Antigüedad</dt>
            <dd className="mt-0.5 text-gray-900">{anios === 1 ? "1 año" : `${anios} años`}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Salario base</dt>
            <dd className="tnum mt-0.5 font-medium text-gray-900">{formatCurrency(Number(emp.salarioBase))}</dd>
          </div>
        </dl>

        <nav aria-label="Secciones del expediente" className="-mb-5 mt-5 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/empleados/${id}?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
                tab === t.key
                  ? "border-blue-500 font-medium text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      {tab === "salud" && <SaludFamilia endpoint={`/api/empleados/${id}/salud-familia`} />}

      {/* Tab: Personal */}
      {tab === "personal" && (
        <div className="panel p-6">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Información personal</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            {[
              ["Identidad (DNI)", emp.identidad],
              ["RTN", emp.rtn],
              ["Número de IHSS", emp.ihssNro],
              ["Número de RAP", emp.rapNro],
              ["Fecha de nacimiento", emp.fechaNacimiento ? formatDate(emp.fechaNacimiento) : "—"],
              ["Género", emp.genero === "M" ? "Masculino" : "Femenino"],
              ["Estado civil", emp.estadoCivil],
              ["Nacionalidad", emp.nacionalidad],
              ["Teléfono", emp.telefonoPersonal],
              ["Contacto de emergencia", emp.contactoEmergencia],
              ["Teléfono de emergencia", emp.telefonoEmergencia],
              ["Banco", emp.banco],
              ["Número de cuenta", emp.cuentaBancaria],
            ].map(([k, v]) => (
              <div key={k as string} className="flex gap-2">
                <span className="text-gray-500 shrink-0">{k}:</span>
                <span className="font-medium text-gray-900">{(v as string) ?? "—"}</span>
              </div>
            ))}
          </div>
          {emp.direccion && (
            <div className="mt-3 text-sm">
              <span className="text-gray-500">Dirección: </span>
              <span className="font-medium">{emp.direccion}</span>
            </div>
          )}
        </div>
      )}

      {/* Tab: Contrato */}
      {tab === "contrato" && (
        <div className="space-y-4">
          <div className="panel p-6">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Datos del contrato actual</h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              {[
                ["Tipo de contrato", emp.tipoContrato],
                ["Fecha de ingreso", formatDate(emp.fechaIngreso)],
                ["Tipo de planilla", emp.tipoPlanilla],
                ["Salario base", formatCurrency(Number(emp.salarioBase))],
                ["Salario diario", formatCurrency(Number(emp.salarioDiario ?? 0))],
                ["Salario por hora", formatCurrency(Number(emp.salarioHora ?? 0))],
              ].map(([k, v]) => (
                <div key={k as string} className="flex gap-2">
                  <span className="text-gray-500 shrink-0">{k}:</span>
                  <span className="font-medium text-gray-900">{v as string}</span>
                </div>
              ))}
            </div>
          </div>
          {emp.historialSalarios.length > 0 && (
            <div className="panel p-6">
              <h2 className="mb-4 text-base font-semibold text-gray-900">Historial de salarios</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                    <th className="pb-2">Fecha</th>
                    <th className="pb-2">Salario anterior</th>
                    <th className="pb-2">Salario nuevo</th>
                    <th className="pb-2">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {emp.historialSalarios.map((h) => (
                    <tr key={h.id}>
                      <td className="py-2">{formatDate(h.fechaCambio)}</td>
                      <td className="py-2">{formatCurrency(Number(h.salarioAnterior))}</td>
                      <td className="py-2 font-medium">{formatCurrency(Number(h.salarioNuevo))}</td>
                      <td className="py-2 text-gray-500">{h.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Vacaciones */}
      {tab === "vacaciones" && (
        <div className="space-y-4">
          <div className="panel p-6">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Saldo de vacaciones</h2>
            <div className="flex gap-6 text-sm flex-wrap">
              <div>
                <p className="tnum text-3xl font-semibold leading-none text-gray-900">{diasVac}</p>
                <p className="mt-1.5 text-gray-700">días de vacaciones al año</p>
                <p className="mt-0.5 text-xs text-gray-500">según {anios === 1 ? "1 año" : `${anios} años`} de antigüedad</p>
              </div>
            </div>
          </div>
          {emp.permisos.length > 0 && (
            <div className="panel p-6">
              <h2 className="mb-4 text-base font-semibold text-gray-900">Historial de permisos y vacaciones</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                    <th className="pb-2">Tipo</th>
                    <th className="pb-2">Inicio</th>
                    <th className="pb-2">Fin</th>
                    <th className="pb-2">Días</th>
                    <th className="pb-2">Estado</th>
                    <th className="pb-2">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {emp.permisos.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 font-medium">{p.tipo}</td>
                      <td className="py-2">{formatDate(p.fechaInicio)}</td>
                      <td className="py-2">{formatDate(p.fechaFin)}</td>
                      <td className="py-2">{p.diasSolicitados}</td>
                      <td className="py-2">
                        <EstadoBadge valor={p.estado} />
                      </td>
                      <td className="py-2 text-gray-500">{p.motivo ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Historial de Pagos */}
      {tab === "historial" && (
        <div className="panel p-6">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Historial de pagos</h2>
          {emp.planillasDetalle.length === 0 ? (
            <p className="text-sm text-gray-500">Este empleado aún no figura en ninguna planilla.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="pb-2">Período</th>
                  <th className="pb-2">Tipo</th>
                  <th className="pb-2">Bruto</th>
                  <th className="pb-2">Deducciones</th>
                  <th className="pb-2">Neto</th>
                  <th className="pb-2">Estado</th>
                  <th className="pb-2 text-center">Comprobante</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {emp.planillasDetalle.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2">{formatDate(d.planilla.fechaFin)}</td>
                    <td className="py-2">{etiquetaEstado(d.planilla.tipo)}</td>
                    <td className="py-2">{formatCurrency(Number(d.totalBruto))}</td>
                    <td className="py-2 text-gray-500">{formatCurrency(Number(d.totalDeducciones))}</td>
                    <td className="py-2 font-semibold text-gray-900">{formatCurrency(Number(d.salarioNeto))}</td>
                    <td className="py-2">
                      <EstadoBadge valor={d.planilla.estado} />
                    </td>
                    <td className="py-2 text-center whitespace-nowrap">
                      <a href={`/api/mis-boletas/${d.id}?modo=ver`} target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-xs font-medium mr-3">Ver</a>
                      <a href={`/api/mis-boletas/${d.id}`} className="text-gray-500 hover:underline text-xs">Descargar</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab: Evaluaciones */}
      {tab === "evaluaciones" && (
        <div className="panel p-6">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Evaluaciones</h2>
          {emp.evaluaciones.length === 0 ? (
            <p className="text-sm text-gray-500">Aún no se le ha hecho ninguna evaluación.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {emp.evaluaciones.map((e) => (
                <div key={e.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-sm">{e.tipo === "DESEMPENO_MENSUAL" ? "Desempeño Mensual" : "Competencia Trimestral"}</p>
                      <p className="text-xs text-gray-500">{e.periodo}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${Number(e.calificacion) >= 70 ? "text-green-600" : "text-red-600"}`}>
                        {Number(e.calificacion).toFixed(1)}
                      </p>
                      <p className="text-xs text-gray-400">/100</p>
                    </div>
                  </div>
                  {e.comentarios && (
                    <p className="mt-2 text-xs text-gray-600 line-clamp-2">{e.comentarios}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
