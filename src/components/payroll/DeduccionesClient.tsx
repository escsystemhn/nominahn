"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, nombreCompleto } from "@/lib/utils";
import BarraDatos from "@/components/importacion/BarraDatos";
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
  /** Solicitudes de préstamo por atender: van bajo el título, no encima. */
  solicitudes?: React.ReactNode;
}

/** El tipo de deducción en palabras, no el nombre del enum. */
const TIPO_TEXTO: Record<string, string> = {
  LEGAL: "Legal",
  PRESTAMO: "Préstamo",
  ADELANTO: "Adelanto",
  COOPERATIVA: "Cooperativa",
  AFP: "AFP",
  IMPUESTO: "Impuesto",
  VOLUNTARIA: "Voluntaria",
  OTRO: "Otro",
};

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
  solicitudes,
}: Props) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [tab, setTab] = useState<"tipos" | "empleados">("tipos");
  const [loading, setLoading] = useState(false);
  const [modalTipo, setModalTipo] = useState(false);
  const [modalEmp, setModalEmp] = useState(false);

  const [formTipo, setFormTipo] = useState({
    nombre: "",
    codigo: "",
    tipo: "VOLUNTARIA",
    porcentaje: "",
    montoFijo: "",
    esLegal: false,
    descripcion: "",
  });

  const [formEmp, setFormEmp] = useState({
    empleadoId: "",
    tipoDeduccionId: "",
    forma: "UNA_VEZ" as FormaCobro,
    monto: "",
    cuotasMeses: "",
    fechaInicio: new Date().toISOString().split("T")[0],
    observacion: "",
  });
  const montoAsignar = Number(formEmp.monto);
  const cuotasAsignar = Number(formEmp.cuotasMeses);
  const puedeAsignar =
    !!formEmp.empleadoId &&
    !!formEmp.tipoDeduccionId &&
    montoAsignar > 0 &&
    (formEmp.forma !== "CUOTAS" || (Number.isInteger(cuotasAsignar) && cuotasAsignar >= 1));

  async function crearTipo() {
    setLoading(true);
    try {
      const res = await fetch("/api/deducciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formTipo,
          porcentaje: formTipo.porcentaje ? parseFloat(formTipo.porcentaje) / 100 : null,
          montoFijo: formTipo.montoFijo ? parseFloat(formTipo.montoFijo) : null,
        }),
      });
      if (!res.ok) throw new Error();
      setModalTipo(false);
      avisar.exito("Tipo de deducción creado.");
      router.refresh();
    } catch {
      avisar.error("No se pudo crear el tipo de deducción. Revise los datos e intente de nuevo.");
    } finally {
      setLoading(false);
    }
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
              puedeExportar={puedeExportar}
              puedeImportar={puedeImportar}
              incluyePII
              tituloImportacion="Importar deducciones de empleados"
              ayudaImportacion="Cada fila asigna una deducción a un empleado, identificada por el código del empleado, el código del tipo de deducción y la fecha de inicio. Reimportar el mismo archivo actualiza esas mismas deducciones en vez de duplicar el descuento. Las deducciones legales (IHSS, RAP, INFOP) las calcula la planilla y no se asignan por aquí."
            />
            <button onClick={() => setModalEmp(true)} className="btn btn-secondary">
              Asignar a empleado
            </button>
            <button onClick={() => setModalTipo(true)} className="btn btn-primary">
              Nuevo tipo
            </button>
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
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base tabla-tarjetas">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Código</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Legal</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {tipos.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EstadoVacio titulo="Todavía no hay tipos de deducción." detalle="Cree el primero con el botón Nuevo tipo." />
                    </td>
                  </tr>
                ) : tipos.map((t) => (
                  <tr key={t.id}>
                    <td data-titulo className="font-medium text-gray-900">{t.nombre}</td>
                    <td data-etiqueta="Código" className="font-mono text-xs">{t.codigo}</td>
                    <td data-etiqueta="Tipo" className="text-gray-600">{TIPO_TEXTO[t.tipo] ?? t.tipo}</td>
                    <td data-etiqueta="Valor">
                      {t.porcentaje ? `${(Number(t.porcentaje) * 100).toFixed(2)}%` : t.montoFijo ? formatCurrency(Number(t.montoFijo)) : "Variable"}
                    </td>
                    <td data-etiqueta="Legal">{t.esLegal ? "Sí" : "No"}</td>
                    <td data-etiqueta="Estado">
                      <EstadoBadge valor={t.activo ? "ACTIVO" : "INACTIVO"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                      {d.cuotasMeses ? `${d.cuotasPagadas}/${d.cuotasMeses}` : d.saldo === null ? "Cada planilla" : "Una vez"}
                    </td>
                    <td data-etiqueta="Observación" className="text-xs text-gray-500">{d.observacion ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal nuevo tipo */}
      {modalTipo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="panel w-full max-w-md space-y-4 p-6 shadow-2xl">
            <h3 className="font-semibold text-gray-900">Nuevo tipo de deducción</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ded-1" className="mb-1 block text-sm font-medium text-gray-800">Nombre</label>
                <input id="ded-1" value={formTipo.nombre} onChange={(e) => setFormTipo((f) => ({ ...f, nombre: e.target.value }))} className="input" />
              </div>
              <div>
                <label htmlFor="ded-2" className="mb-1 block text-sm font-medium text-gray-800">Código</label>
                <input id="ded-2" value={formTipo.codigo} onChange={(e) => setFormTipo((f) => ({ ...f, codigo: e.target.value }))} className="input" placeholder="EJ: COOP1" />
              </div>
              <div>
                <label htmlFor="ded-3" className="mb-1 block text-sm font-medium text-gray-800">Tipo</label>
                <select id="ded-3" value={formTipo.tipo} onChange={(e) => setFormTipo((f) => ({ ...f, tipo: e.target.value }))} className="input">
                  {["LEGAL","VOLUNTARIA","PRESTAMO","ADELANTO","COOPERATIVA","IMPUESTO","AFP","OTRO"].map((t) => (
                    <option key={t} value={t}>{TIPO_TEXTO[t]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ded-4" className="mb-1 block text-sm font-medium text-gray-800">% (si aplica)</label>
                <input id="ded-4" type="number" step="0.01" value={formTipo.porcentaje} onChange={(e) => setFormTipo((f) => ({ ...f, porcentaje: e.target.value }))} className="input" placeholder="Ej: 2.5" />
              </div>
              <div>
                <label htmlFor="ded-5" className="mb-1 block text-sm font-medium text-gray-800">Monto fijo (si aplica)</label>
                <input id="ded-5" type="number" step="0.01" value={formTipo.montoFijo} onChange={(e) => setFormTipo((f) => ({ ...f, montoFijo: e.target.value }))} className="input" />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input type="checkbox" id="esLegal" checked={formTipo.esLegal} onChange={(e) => setFormTipo((f) => ({ ...f, esLegal: e.target.checked }))} />
                <label htmlFor="esLegal" className="text-sm text-gray-800">Es deducción legal</label>
              </div>
            </div>
            <div>
              <label htmlFor="ded-6" className="mb-1 block text-sm font-medium text-gray-800">Descripción</label>
              <input id="ded-6" value={formTipo.descripcion} onChange={(e) => setFormTipo((f) => ({ ...f, descripcion: e.target.value }))} className="input" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setModalTipo(false)} className="btn btn-secondary flex-1">Cancelar</button>
              <button onClick={crearTipo} disabled={loading} className="btn btn-primary flex-1">
                {loading ? "Guardando…" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <select id="ded-8" value={formEmp.tipoDeduccionId} onChange={(e) => setFormEmp((f) => ({ ...f, tipoDeduccionId: e.target.value }))} className="input">
                <option value="">Seleccione…</option>
                {tipos.map((t) => (
                  <option key={t.id} value={t.id}>{t.nombre} ({t.codigo})</option>
                ))}
              </select>
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
                <input id="monto-asignar" type="number" min="0" step="0.01" value={formEmp.monto} onChange={(e) => setFormEmp((f) => ({ ...f, monto: e.target.value }))} className="input" />
              </div>
              {formEmp.forma === "CUOTAS" && (
                <div>
                  <label htmlFor="cuotas-asignar" className="mb-1 block text-sm font-medium text-gray-800">Número de cuotas</label>
                  <input id="cuotas-asignar" type="number" min="1" step="1" value={formEmp.cuotasMeses} onChange={(e) => setFormEmp((f) => ({ ...f, cuotasMeses: e.target.value }))} className="input" />
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
