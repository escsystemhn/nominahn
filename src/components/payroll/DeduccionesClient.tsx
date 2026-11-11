"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, nombreCompleto } from "@/lib/utils";
import BarraDatos from "@/components/importacion/BarraDatos";
import AsignarVarios from "@/components/payroll/AsignarVarios";
import TipoDeduccionModal, { type TipoEditable } from "@/components/payroll/TipoDeduccionModal";
import type { TipoPlanillaPeriodo } from "@/lib/payroll/periodos-planilla";
import { etiquetaCategoria } from "@/lib/deducciones/tipos";
import { leerMonto } from "@/lib/formato/monto-texto";
import { useAvisos } from "@/components/ui/Avisos";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";

interface TipoDeduccion {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  porcentaje: number | null;
  montoFijo: number | null;
  esLegal: boolean;
  activo: boolean;
  descripcion: string | null;
}

// Date cuando lo pasa el server component; string ISO si llegara por JSON.
type FechaSerializable = Date | string;

interface DeduccionEmpleado {
  id: string;
  monto: number;
  saldo: number | null;
  cuotasMeses: number | null;
  cuotasPagadas: number;
  /** Lo que se descontará en la próxima planilla (`cuotaDelPeriodo`). */
  cuotaPeriodo: number;
  fechaInicio: FechaSerializable;
  observacion: string | null;
  /** «del 01/11/2026 al 15/11/2026» si es un monto del período (sólo vale entre esas fechas). */
  soloPeriodo: string | null;
  empleado: { id: string; codigo: string; primerNombre: string; primerApellido: string; sucursal: { nombre: string } };
  tipoDeduccion: TipoDeduccion;
}

interface Props {
  tipos: TipoDeduccion[];
  deduccionesEmpleados: DeduccionEmpleado[];
  empleados: Array<{ id: string; codigo: string; primerNombre: string; segundoNombre?: string | null; primerApellido: string; segundoApellido?: string | null }>;
  /** Permisos ya resueltos en el servidor: aquí sólo deciden qué se dibuja. */
  puedeExportar: boolean;
  puedeImportar: boolean;
  puedeAsignar: boolean;
  /** Crear y editar tipos (`deducciones.configurar`). */
  puedeConfigurar: boolean;
  /** Bajar el catálogo de tipos en archivo. */
  puedeExportarTipos: boolean;
  /** «Sucursal» o «Grupo de nómina», según la jerarquía. */
  etiquetaSucursal: string;
  /** El tipo de planilla de la mayoría: con él arrancan los selectores de período. */
  tipoPlanilla: TipoPlanillaPeriodo;
  /** Solicitudes de préstamo por atender: van bajo el título, no encima. */
  solicitudes?: React.ReactNode;
}

/** Los de ley y la retención fija de ISR: se configuran en Parámetros de ley. */
const esDelSistema = (t: Pick<TipoDeduccion, "esLegal" | "codigo">) => t.esLegal || t.codigo === "ISR-FIJO";

type FormaCobro = "UNA_VEZ" | "CUOTAS" | "SIEMPRE";

const ETIQUETA_MONTO: Record<FormaCobro, string> = {
  UNA_VEZ: "Monto (L.)",
  CUOTAS: "Monto total (L.)",
  SIEMPRE: "Monto por planilla (L.)",
};

export default function DeduccionesClient({
  tipos,
  deduccionesEmpleados,
  empleados,
  puedeExportar,
  puedeImportar,
  puedeAsignar: permiteAsignar,
  puedeConfigurar,
  puedeExportarTipos,
  etiquetaSucursal,
  tipoPlanilla,
  solicitudes,
}: Props) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [tab, setTab] = useState<"tipos" | "empleados">("tipos");
  const [loading, setLoading] = useState(false);
  /** `undefined`: cerrada; `null`: uno nuevo. */
  const [editando, setEditando] = useState<TipoEditable | null | undefined>(undefined);
  const [modalEmp, setModalEmp] = useState(false);
  const [modalVarios, setModalVarios] = useState(false);

  const asignables = tipos.filter((t) => t.activo && !t.esLegal);

  const [formEmp, setFormEmp] = useState({
    empleadoId: "",
    tipoDeduccionId: "",
    forma: "UNA_VEZ" as FormaCobro,
    monto: "",
    cuotasMeses: "",
    fechaInicio: new Date().toISOString().split("T")[0],
    observacion: "",
  });
  const lecturaMonto = leerMonto(formEmp.monto);
  const montoAsignar = lecturaMonto.ok && lecturaMonto.valor !== null ? lecturaMonto.valor : 0;
  const cuotasAsignar = Number(formEmp.cuotasMeses);
  const puedeAsignar =
    !!formEmp.empleadoId &&
    !!formEmp.tipoDeduccionId &&
    montoAsignar > 0 &&
    (formEmp.forma !== "CUOTAS" || (Number.isInteger(cuotasAsignar) && cuotasAsignar >= 1));

  /** Al elegir el tipo se propone su monto habitual, si el campo está vacío. */
  function elegirTipoEmp(id: string) {
    const habitual = tipos.find((t) => t.id === id)?.montoFijo;
    setFormEmp((f) => ({ ...f, tipoDeduccionId: id, monto: f.monto.trim() === "" && habitual ? habitual.toFixed(2) : f.monto }));
  }

  async function asignarEmpleado() {
    setLoading(true);
    try {
      const res = await fetch("/api/empleados/" + formEmp.empleadoId + "/deducciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipoDeduccionId: formEmp.tipoDeduccionId,
          monto: montoAsignar,
          ...(formEmp.forma === "CUOTAS" ? { cuotasMeses: cuotasAsignar } : formEmp.forma === "SIEMPRE" ? { cuotasMeses: 0 } : {}),
          fechaInicio: formEmp.fechaInicio,
          observacion: formEmp.observacion || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error);
      }
      setModalEmp(false);
      avisar.exito("Deducción asignada.");
      router.refresh();
    } catch (e) {
      avisar.error((e instanceof Error && e.message) || "No se pudo asignar la deducción.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deducciones"
        description="Tipos de deducción y su asignación a cada empleado."
        actions={
          <>
            <BarraDatos
              recurso="deducciones"
              elegirFilas
              periodoPlanilla={tipoPlanilla}
              puedeCrearTipos={puedeConfigurar}
              puedeExportar={puedeExportar}
              puedeImportar={puedeImportar}
              incluyePII
              tituloImportacion="Importar deducciones de empleados"
              ayudaImportacion="Cada fila asigna una deducción a un empleado, identificada por el código del empleado, el código del tipo de deducción y la fecha de inicio. Reimportar el mismo archivo actualiza esas mismas deducciones en vez de duplicar el descuento. Las deducciones legales (IHSS, RAP, INFOP) las calcula la planilla y no se asignan por aquí."
            />
            {permiteAsignar && (
              <>
                <button onClick={() => setModalEmp(true)} className="btn btn-secondary">
                  Asignar a empleado
                </button>
                <button onClick={() => setModalVarios(true)} className="btn btn-secondary">
                  Asignar a varios
                </button>
              </>
            )}
            {puedeConfigurar && (
              <button onClick={() => setEditando(null)} className="btn btn-primary">
                Nuevo tipo
              </button>
            )}
          </>
        }
      />

      {solicitudes}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["tipos", "empleados"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "tipos" ? "Tipos de deducción" : "Asignaciones por empleado"}
          </button>
        ))}
      </div>

      {tab === "tipos" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-gray-600">
              El catálogo de descuentos de la empresa. La categoría decide hasta cuánto se cobra; cada tipo es una columna en el archivo de montos del período.
            </p>
            <BarraDatos
              recurso="tipos-deduccion"
              exportaXlsx
              textoExportar="Exportar tipos"
              textoImportar="Importar tipos"
              puedeExportar={puedeExportarTipos}
              puedeImportar={puedeConfigurar}
              tituloImportacion="Importar tipos de deducción"
              ayudaImportacion="Una fila por tipo de deducción: código, nombre, categoría y, si quiere, un monto habitual. El código es la clave: si ya existe se actualiza, si no se crea. Úselo para cargar de una vez los descuentos de una empresa nueva o para corregir varios nombres. La plantilla de Excel trae la categoría en una lista para elegir."
            />
          </div>
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base tabla-tarjetas">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Código</th>
                    <th>Categoría</th>
                    <th>Valor</th>
                    <th>Estado</th>
                    {puedeConfigurar && <th><span className="sr-only">Acciones</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {tipos.length === 0 ? (
                    <tr>
                      <td colSpan={puedeConfigurar ? 6 : 5}>
                        <EstadoVacio titulo="Todavía no hay tipos de deducción." detalle="Cree el primero con Nuevo tipo, o cárguelos todos con Importar tipos." />
                      </td>
                    </tr>
                  ) : tipos.map((t) => (
                    <tr key={t.id} data-tipo={t.codigo}>
                      <td data-titulo>
                        <div className="font-medium text-gray-900">{t.nombre}</div>
                        {t.descripcion && <div className="text-xs text-gray-500">{t.descripcion}</div>}
                      </td>
                      <td data-etiqueta="Código" className="font-mono text-xs">{t.codigo}</td>
                      <td data-etiqueta="Categoría" className="text-gray-600">{etiquetaCategoria(t.tipo)}</td>
                      <td data-etiqueta="Valor" className="whitespace-nowrap">
                        {esDelSistema(t)
                          ? (t.porcentaje ? `${(Number(t.porcentaje) * 100).toFixed(2)}%` : "Lo calcula la planilla")
                          : t.montoFijo ? <>{formatCurrency(Number(t.montoFijo))} <span className="text-xs text-gray-500">habitual</span></> : "Variable"}
                      </td>
                      <td data-etiqueta="Estado">
                        <EstadoBadge valor={t.activo ? "ACTIVO" : "INACTIVO"} />
                      </td>
                      {puedeConfigurar && (
                        <td data-etiqueta="Acciones" className="text-right">
                          {esDelSistema(t)
                            ? <span className="text-xs text-gray-500">En Parámetros de ley</span>
                            : (
                              <button type="button" className="text-sm font-medium text-blue-700 hover:underline" aria-label={`Editar ${t.nombre}`}
                                onClick={() => setEditando({ id: t.id, nombre: t.nombre, codigo: t.codigo, tipo: t.tipo, montoFijo: t.montoFijo, descripcion: t.descripcion, activo: t.activo })}>
                                Editar
                              </button>
                            )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "empleados" && (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base tabla-tarjetas">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Deducción</th>
                  <th className="num">Monto</th>
                  <th className="num">Por planilla</th>
                  <th>Cuotas</th>
                  <th>Observación</th>
                </tr>
              </thead>
              <tbody>
                {deduccionesEmpleados.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EstadoVacio titulo="Ningún empleado tiene deducciones asignadas." detalle="Use el botón Asignar a empleado para descontar un préstamo, un adelanto u otro monto." />
                    </td>
                  </tr>
                ) : deduccionesEmpleados.map((d) => (
                  <tr key={d.id}>
                    <td data-titulo>
                      <div className="font-medium text-gray-900">{d.empleado.primerNombre} {d.empleado.primerApellido}</div>
                      <div className="text-xs text-gray-500">{d.empleado.sucursal.nombre}</div>
                    </td>
                    <td data-etiqueta="Deducción">{d.tipoDeduccion.nombre}</td>
                    <td data-etiqueta="Monto" className="num whitespace-nowrap font-medium text-gray-900">{formatCurrency(Number(d.monto))}</td>
                    <td data-etiqueta="Por planilla" className="num whitespace-nowrap">{formatCurrency(d.cuotaPeriodo)}</td>
                    <td data-etiqueta="Cuotas" className="text-xs text-gray-500">
                      {d.soloPeriodo ? `Sólo ${d.soloPeriodo}` : d.cuotasMeses ? `${d.cuotasPagadas}/${d.cuotasMeses}` : d.saldo === null ? "Cada planilla" : "Una vez"}
                    </td>
                    <td data-etiqueta="Observación" className="text-xs text-gray-500">{d.observacion ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editando !== undefined && (
        <TipoDeduccionModal tipo={editando} codigosOcupados={tipos.map((t) => t.codigo)} onCerrar={() => setEditando(undefined)} />
      )}

      {modalVarios && <AsignarVarios tipos={asignables} etiquetaSucursal={etiquetaSucursal} onCerrar={() => setModalVarios(false)} />}

      {/* Modal asignar empleado */}
      {modalEmp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="panel w-full max-w-md space-y-4 p-6 shadow-2xl">
            <h3 className="font-semibold text-gray-900">Asignar deducción a empleado</h3>
            <div>
              <label htmlFor="ded-7" className="mb-1 block text-sm font-medium text-gray-800">Empleado</label>
              <select id="ded-7" value={formEmp.empleadoId} onChange={(e) => setFormEmp((f) => ({ ...f, empleadoId: e.target.value }))} className="input">
                <option value="">Seleccione…</option>
                {empleados.map((emp) => (
                  <option key={emp.id} value={emp.id}>{nombreCompleto(emp)} ({emp.codigo})</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ded-8" className="mb-1 block text-sm font-medium text-gray-800">Tipo de deducción</label>
              <select id="ded-8" value={formEmp.tipoDeduccionId} onChange={(e) => elegirTipoEmp(e.target.value)} className="input">
                <option value="">Seleccione…</option>
                {asignables.map((t) => (
                  <option key={t.id} value={t.id}>{t.nombre} ({t.codigo})</option>
                ))}
              </select>
              {puedeConfigurar && (
                <button type="button" className="mt-1 text-xs font-medium text-blue-700 hover:underline" onClick={() => { setModalEmp(false); setEditando(null); }}>
                  ¿No está en la lista? Crear un tipo nuevo
                </button>
              )}
            </div>
            <div>
              <label htmlFor="forma-cobro" className="mb-1 block text-sm font-medium text-gray-800">Forma de cobro</label>
              <select id="forma-cobro" value={formEmp.forma} onChange={(e) => setFormEmp((f) => ({ ...f, forma: e.target.value as FormaCobro }))} className="input">
                <option value="UNA_VEZ">Una sola vez</option>
                <option value="CUOTAS">En cuotas</option>
                <option value="SIEMPRE">Cada planilla, sin fin</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="monto-asignar" className="mb-1 block text-sm font-medium text-gray-800">{ETIQUETA_MONTO[formEmp.forma]}</label>
                <input id="monto-asignar" inputMode="decimal" value={formEmp.monto} onChange={(e) => setFormEmp((f) => ({ ...f, monto: e.target.value }))} className="input" placeholder="Ej: 1000.00" />
                {!lecturaMonto.ok && <p className="mt-1 text-xs text-red-700">{lecturaMonto.error}</p>}
              </div>
              {formEmp.forma === "CUOTAS" && (
                <div>
                  <label htmlFor="cuotas-asignar" className="mb-1 block text-sm font-medium text-gray-800">Número de cuotas</label>
                  <input id="cuotas-asignar" inputMode="numeric" value={formEmp.cuotasMeses} onChange={(e) => setFormEmp((f) => ({ ...f, cuotasMeses: e.target.value }))} className="input" />
                </div>
              )}
              <div>
                <label htmlFor="ded-9" className="mb-1 block text-sm font-medium text-gray-800">Fecha de inicio</label>
                <input id="ded-9" type="date" value={formEmp.fechaInicio} onChange={(e) => setFormEmp((f) => ({ ...f, fechaInicio: e.target.value }))} className="input" />
              </div>
            </div>
            {formEmp.forma === "CUOTAS" && puedeAsignar && (
              <p className="text-sm text-gray-500">Se descontarán {formatCurrency(montoAsignar / cuotasAsignar)} en cada una de las {cuotasAsignar} planillas.</p>
            )}
            {formEmp.forma === "SIEMPRE" && (
              <p className="text-sm text-gray-500">Se descontará este monto en cada planilla, hasta que alguien desactive la deducción.</p>
            )}
            <div>
              <label htmlFor="ded-10" className="mb-1 block text-sm font-medium text-gray-800">Observación</label>
              <input id="ded-10" value={formEmp.observacion} onChange={(e) => setFormEmp((f) => ({ ...f, observacion: e.target.value }))} className="input" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setModalEmp(false)} className="btn btn-secondary flex-1">Cancelar</button>
              <button onClick={asignarEmpleado} disabled={loading || !puedeAsignar} className="btn btn-primary flex-1">
                {loading ? "Guardando…" : "Asignar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
