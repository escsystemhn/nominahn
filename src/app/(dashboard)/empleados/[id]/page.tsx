import { prisma } from "@/lib/prisma";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { notFound } from "next/navigation";
import { formatCurrency, formatDate, hoyHN, nombreCompleto, calcularAniosTrabajados } from "@/lib/utils";
import { calcularDiasVacaciones } from "@/lib/payroll/calculos-hn";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import EstadoVacio from "@/components/ui/EstadoVacio";
import EstadoBadge, { etiquetaEstado, estadoDePlanilla } from "@/components/ui/EstadoBadge";
import SaludFamilia from "@/components/employees/SaludFamilia";
import ContratosEmpleado from "@/components/employees/ContratosEmpleado";


const TIPO_PERMISO: Record<string, string> = {
  VACACIONES: "Vacaciones",
  ENFERMEDAD: "Enfermedad",
  PERSONAL: "Personal",
  MATERNIDAD: "Maternidad",
  PATERNIDAD: "Paternidad",
  DUELO: "Duelo",
  SIN_GOCE: "Sin goce de sueldo",
  OTRO: "Otro",
};

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
      contratos: { orderBy: { fechaInicio: "desc" } },
      permisos: { orderBy: { fechaInicio: "desc" } },
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

  // Fuera de su alcance responde igual que si no existiera (ver `alcanzaEmpleado`).
  if (!emp || !alcanzaEmpleado(usuario, emp)) notFound();

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
    <div className="space-y-6">
      <PageHeader
        title={nombre}
        description={
          <>
            <EstadoBadge valor={emp.estado} className="mr-2 align-middle" />
            {emp.puesto ? `${emp.puesto.nombre}, ` : ""}
            {emp.departamento.nombre}, {emp.sucursal.nombre}
          </>
        }
        actions={
          <>
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
          </>
        }
      >
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
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
      </PageHeader>

      {tab === "salud" && <SaludFamilia endpoint={`/api/empleados/${id}/salud-familia`} />}

      {/* Tab: Personal */}
      {tab === "personal" && (
        <div className="panel p-6">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Información personal</h2>
          <div className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {[
                ["Tipo de contrato", etiquetaEstado(emp.tipoContrato)],
                ["Fecha de ingreso", formatDate(emp.fechaIngreso)],
                ["Tipo de planilla", etiquetaEstado(emp.tipoPlanilla)],
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
          <ContratosEmpleado
            empleadoId={id}
            contratos={emp.contratos.map((c) => ({
              id: c.id,
              tipoContrato: c.tipoContrato,
              fechaInicio: c.fechaInicio.toISOString(),
              fechaFin: c.fechaFin?.toISOString() ?? null,
              salario: Number(c.salario),
              cargo: c.cargo,
              jornada: c.jornada,
              horario: c.horario,
              observaciones: c.observaciones,
              activo: c.activo,
            }))}
            hoy={hoyHN().toISOString()}
            datosFicha={{
              tipoContrato: emp.tipoContrato,
              salario: Number(emp.salarioBase),
              cargo: emp.puesto?.nombre ?? "",
              fechaIngreso: emp.fechaIngreso.toISOString(),
            }}
            dadoDeBaja={emp.estado === "INACTIVO"}
            puedeEditar={puedeEditar}
          />
          {emp.historialSalarios.length > 0 && (
            <div className="panel overflow-hidden">
              <h2 className="px-6 pb-3 pt-5 text-base font-semibold text-gray-900">Historial de salarios</h2>
              <div className="overflow-x-auto">
                <table className="table-base tabla-tarjetas">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th className="num">Salario anterior</th>
                      <th className="num">Salario nuevo</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emp.historialSalarios.map((h) => (
                      <tr key={h.id}>
                        <td data-titulo className="whitespace-nowrap font-medium text-gray-900">{formatDate(h.fechaCambio)}</td>
                        <td data-etiqueta="Salario anterior" className="num whitespace-nowrap">{formatCurrency(Number(h.salarioAnterior))}</td>
                        <td data-etiqueta="Salario nuevo" className="num whitespace-nowrap font-medium text-gray-900">{formatCurrency(Number(h.salarioNuevo))}</td>
                        <td data-etiqueta="Motivo" className="text-gray-500">{h.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
            <div className="panel overflow-hidden">
              <h2 className="px-6 pb-3 pt-5 text-base font-semibold text-gray-900">Historial de permisos y vacaciones</h2>
              <div className="overflow-x-auto">
                <table className="table-base tabla-tarjetas">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Inicio</th>
                      <th>Fin</th>
                      <th className="num">Días</th>
                      <th>Estado</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emp.permisos.map((p) => (
                      <tr key={p.id}>
                        <td data-titulo className="font-medium text-gray-900">{TIPO_PERMISO[p.tipo] ?? p.tipo}</td>
                        <td data-etiqueta="Inicio" className="whitespace-nowrap">{formatDate(p.fechaInicio)}</td>
                        <td data-etiqueta="Fin" className="whitespace-nowrap">{formatDate(p.fechaFin)}</td>
                        <td data-etiqueta="Días" className="num">{p.diasSolicitados}</td>
                        <td data-etiqueta="Estado">
                          <EstadoBadge valor={p.estado} />
                        </td>
                        <td data-etiqueta="Motivo" className="text-gray-500">{p.motivo ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Historial de Pagos */}
      {tab === "historial" && (
        <div className="panel overflow-hidden">
          <h2 className="px-6 pb-3 pt-5 text-base font-semibold text-gray-900">Historial de pagos</h2>
          {emp.planillasDetalle.length === 0 ? (
            <EstadoVacio titulo="Este empleado aún no figura en ninguna planilla." detalle="Sus pagos aparecerán aquí cuando se apruebe la primera planilla que lo incluya." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base tabla-tarjetas">
                <thead>
                  <tr>
                    <th>Período</th>
                    <th>Tipo</th>
                    <th className="num">Bruto</th>
                    <th className="num">Deducciones</th>
                    <th className="num">Neto</th>
                    <th>Estado</th>
                    <th className="text-center">Comprobante</th>
                  </tr>
                </thead>
                <tbody>
                  {emp.planillasDetalle.map((d) => (
                    <tr key={d.id}>
                      <td data-titulo className="whitespace-nowrap font-medium text-gray-900">{formatDate(d.planilla.fechaFin)}</td>
                      <td data-etiqueta="Tipo">{etiquetaEstado(d.planilla.tipo)}</td>
                      <td data-etiqueta="Bruto" className="num whitespace-nowrap">{formatCurrency(Number(d.totalBruto))}</td>
                      <td data-etiqueta="Deducciones" className="num whitespace-nowrap text-gray-500">{formatCurrency(Number(d.totalDeducciones))}</td>
                      <td data-etiqueta="Neto" className="num whitespace-nowrap font-medium text-gray-900">{formatCurrency(Number(d.salarioNeto))}</td>
                      <td data-etiqueta="Estado">
                        <EstadoBadge valor={estadoDePlanilla(d.planilla.estado)} />
                      </td>
                      <td data-accion className="whitespace-nowrap text-center">
                        <a href={`/api/mis-boletas/${d.id}?modo=ver`} target="_blank" rel="noopener noreferrer"
                          className="mr-3 text-xs font-medium text-blue-600 hover:underline">Ver</a>
                        <a href={`/api/mis-boletas/${d.id}`} className="text-xs text-gray-500 hover:underline">Descargar PDF</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Evaluaciones */}
      {tab === "evaluaciones" && (
        <div className="panel p-6">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Evaluaciones</h2>
          {emp.evaluaciones.length === 0 ? (
            <EstadoVacio titulo="Aún no se le ha hecho ninguna evaluación." detalle="Las evaluaciones de desempeño y de competencias aparecerán aquí." />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {emp.evaluaciones.map((e) => (
                <div key={e.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-sm">{e.tipo === "DESEMPENO_MENSUAL" ? "Desempeño mensual" : "Competencia trimestral"}</p>
                      <p className="text-xs text-gray-500">{e.periodo}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${Number(e.calificacion) >= 70 ? "text-green-700" : "text-red-600"}`}>
                        {Number(e.calificacion).toFixed(1)}
                      </p>
                      <p className="text-xs text-gray-500">/100</p>
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
