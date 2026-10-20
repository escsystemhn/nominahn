"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, nombreCompleto } from "@/lib/utils";
import BarraDatos from "@/components/importacion/BarraDatos";

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
}

const tiposBadge: Record<string, string> = {
  LEGAL: "bg-blue-100 text-blue-700",
  PRESTAMO: "bg-amber-100 text-amber-700",
  ADELANTO: "bg-orange-100 text-orange-700",
  COOPERATIVA: "bg-purple-100 text-purple-700",
  AFP: "bg-indigo-100 text-indigo-700",
  IMPUESTO: "bg-red-100 text-red-700",
  VOLUNTARIA: "bg-gray-100 text-gray-700",
  OTRO: "bg-gray-100 text-gray-700",
};

export default function DeduccionesClient({
  tipos,
  deduccionesEmpleados,
  empleados,
  puedeExportar,
  puedeImportar,
}: Props) {
  const router = useRouter();
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
    monto: "",
    cuotasMeses: "",
    fechaInicio: new Date().toISOString().split("T")[0],
    observacion: "",
  });

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
      router.refresh();
    } catch {
      alert("No se pudo crear el tipo de deducción. Intente nuevamente.");
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
        body: JSON.stringify(formEmp),
      });
      if (!res.ok) throw new Error();
      setModalEmp(false);
      router.refresh();
    } catch {
      alert("No se pudo asignar la deducción. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Deducciones</h1>
          <p className="text-sm text-gray-500">Gestión de tipos de deducción y asignación a empleados</p>
        </div>
        <div className="flex gap-2">
          <BarraDatos
            recurso="deducciones"
            puedeExportar={puedeExportar}
            puedeImportar={puedeImportar}
            incluyePII
            tituloImportacion="Importar deducciones de empleados"
            ayudaImportacion="Cada fila asigna una deducción a un empleado, identificada por el código del empleado, el código del tipo de deducción y la fecha de inicio. Reimportar el mismo archivo actualiza esas mismas deducciones en vez de duplicar el descuento. Las deducciones legales (IHSS, RAP, INFOP) las calcula la planilla y no se asignan por aquí."
          />
          <button onClick={() => setModalEmp(true)} className="px-4 py-2 border border-blue-600 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-50">
            Asignar a empleado
          </button>
          <button onClick={() => setModalTipo(true)} className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800">
            Nuevo tipo
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["tipos", "empleados"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "tipos" ? "Tipos de Deducción" : "Asignaciones por Empleado"}
          </button>
        ))}
      </div>

      {tab === "tipos" && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Código</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Valor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Legal</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {tipos.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{t.nombre}</td>
                  <td className="px-4 py-3 font-mono text-xs">{t.codigo}</td>
                  <td className="px-4 py-3">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${tiposBadge[t.tipo] ?? ""}`}>{t.tipo}</span>
                  </td>
                  <td className="px-4 py-3">
                    {t.porcentaje ? `${(Number(t.porcentaje) * 100).toFixed(2)}%` : t.montoFijo ? formatCurrency(Number(t.montoFijo)) : "Variable"}
                  </td>
                  <td className="px-4 py-3">{t.esLegal ? "✓" : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${t.activo ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {t.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "empleados" && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Empleado</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Deducción</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Monto</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Cuotas</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Observación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {deduccionesEmpleados.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-6 text-gray-400">Sin deducciones asignadas</td></tr>
              ) : deduccionesEmpleados.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.empleado.primerNombre} {d.empleado.primerApellido}</div>
                    <div className="text-xs text-gray-400">{d.empleado.sucursal.nombre}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${tiposBadge[d.tipoDeduccion.tipo] ?? ""}`}>
                      {d.tipoDeduccion.nombre}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(Number(d.monto))}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {d.cuotasMeses ? `${d.cuotasPagadas}/${d.cuotasMeses}` : "Indefinido"}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{d.observacion ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal nuevo tipo */}
      {modalTipo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-gray-900">Nuevo tipo de deducción</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nombre</label>
                <input value={formTipo.nombre} onChange={(e) => setFormTipo((f) => ({ ...f, nombre: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Código</label>
                <input value={formTipo.codigo} onChange={(e) => setFormTipo((f) => ({ ...f, codigo: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="EJ: COOP1" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tipo</label>
                <select value={formTipo.tipo} onChange={(e) => setFormTipo((f) => ({ ...f, tipo: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  {["LEGAL","VOLUNTARIA","PRESTAMO","ADELANTO","COOPERATIVA","IMPUESTO","AFP","OTRO"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">% (si aplica)</label>
                <input type="number" step="0.01" value={formTipo.porcentaje} onChange={(e) => setFormTipo((f) => ({ ...f, porcentaje: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Ej: 2.5" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Monto Fijo (si aplica)</label>
                <input type="number" step="0.01" value={formTipo.montoFijo} onChange={(e) => setFormTipo((f) => ({ ...f, montoFijo: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div className="flex items-center gap-2 mt-4">
                <input type="checkbox" id="esLegal" checked={formTipo.esLegal} onChange={(e) => setFormTipo((f) => ({ ...f, esLegal: e.target.checked }))} />
                <label htmlFor="esLegal" className="text-sm text-gray-700">Es deducción legal</label>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Descripción</label>
              <input value={formTipo.descripcion} onChange={(e) => setFormTipo((f) => ({ ...f, descripcion: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setModalTipo(false)} className="flex-1 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={crearTipo} disabled={loading} className="flex-1 py-2 bg-blue-700 text-white text-sm rounded-lg hover:bg-blue-800 disabled:bg-blue-400">
                {loading ? "Guardando..." : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal asignar empleado */}
      {modalEmp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-gray-900">Asignar deducción a empleado</h3>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Empleado</label>
              <select value={formEmp.empleadoId} onChange={(e) => setFormEmp((f) => ({ ...f, empleadoId: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Seleccione...</option>
                {empleados.map((emp) => (
                  <option key={emp.id} value={emp.id}>{nombreCompleto(emp)} ({emp.codigo})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Tipo de Deducción</label>
              <select value={formEmp.tipoDeduccionId} onChange={(e) => setFormEmp((f) => ({ ...f, tipoDeduccionId: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Seleccione...</option>
                {tipos.map((t) => (
                  <option key={t.id} value={t.id}>{t.nombre} ({t.codigo})</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Monto por Período (L.)</label>
                <input type="number" step="0.01" value={formEmp.monto} onChange={(e) => setFormEmp((f) => ({ ...f, monto: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">No. Cuotas (0 = indefinido)</label>
                <input type="number" value={formEmp.cuotasMeses} onChange={(e) => setFormEmp((f) => ({ ...f, cuotasMeses: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Fecha Inicio</label>
                <input type="date" value={formEmp.fechaInicio} onChange={(e) => setFormEmp((f) => ({ ...f, fechaInicio: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Observación</label>
              <input value={formEmp.observacion} onChange={(e) => setFormEmp((f) => ({ ...f, observacion: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setModalEmp(false)} className="flex-1 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={asignarEmpleado} disabled={loading || !formEmp.empleadoId || !formEmp.tipoDeduccionId} className="flex-1 py-2 bg-blue-700 text-white text-sm rounded-lg hover:bg-blue-800 disabled:bg-blue-400">
                {loading ? "Guardando..." : "Asignar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
