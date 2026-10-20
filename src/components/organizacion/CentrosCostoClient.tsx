"use client";

/**
 * Centros de costo: cómo se reparte el gasto de nómina entre las áreas.
 *
 * La pantalla explica la regla de resolución en el sitio donde se aplica, porque
 * es la fuente habitual de confusión: el centro del EMPLEADO prevalece sobre el
 * de su departamento, y quien no tiene ninguno cae en un grupo «sin asignar» que
 * aparece en la partida en lugar de desaparecer del reparto.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Centro {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  cuentaGasto: string | null;
  activo: boolean;
  departamentos: number;
  empleados: number;
}

interface Props {
  centros: Centro[];
  departamentos: Array<{ id: string; nombre: string; sucursal: string; centroCostoId: string | null }>;
  empleadosSinCentro: number;
  puedeGestionar: boolean;
}

const FORM_VACIO = { codigo: "", nombre: "", descripcion: "", cuentaGasto: "" };

export default function CentrosCostoClient({
  centros,
  departamentos,
  empleadosSinCentro,
  puedeGestionar,
}: Props) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [asignando, setAsignando] = useState<Centro | null>(null);

  async function llamar(url: string, opciones: RequestInit) {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opciones });
      const datos = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(datos.error ?? "La operación no se pudo completar.");
      router.refresh();
      return datos;
    } catch (e) {
      setError(e instanceof Error ? e.message : "La operación no se pudo completar.");
      return null;
    } finally {
      setCargando(false);
    }
  }

  async function crear() {
    const ok = await llamar("/api/centros-costo", {
      method: "POST",
      body: JSON.stringify({
        codigo: form.codigo,
        nombre: form.nombre,
        descripcion: form.descripcion || undefined,
        cuentaGasto: form.cuentaGasto || undefined,
      }),
    });
    if (ok) {
      setModal(false);
      setForm(FORM_VACIO);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Centros de costo</h1>
          <p className="text-sm text-gray-500">
            Segunda dimensión del asiento contable: la cuenta dice <em>qué</em> es el gasto, el
            centro dice <em>dónde</em> se imputa.
          </p>
        </div>
        {puedeGestionar && (
          <button
            onClick={() => {
              setForm(FORM_VACIO);
              setModal(true);
            }}
            className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800"
          >
            Nuevo centro
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
        <p className="font-medium">Cómo se decide el centro de un empleado</p>
        <p className="mt-1 text-xs">
          Manda el centro asignado a la <span className="font-medium">persona</span>; si no tiene,
          hereda el de su <span className="font-medium">departamento</span>. Quien no tenga ninguno
          aparece en la partida bajo «Sin centro de costo asignado», para que el reparto siempre
          sume el 100% del gasto y el hueco se vea.
        </p>
        {empleadosSinCentro > 0 && (
          <p className="mt-2 text-xs font-medium">
            Ahora mismo hay {empleadosSinCentro} empleado(s) activos sin centro, ni propio ni por
            departamento.
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Código</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Cuenta contable</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Departamentos</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Empleados propios</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                {puedeGestionar && <th className="text-left px-4 py-3 font-medium text-gray-600">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {centros.length === 0 ? (
                <tr>
                  <td colSpan={puedeGestionar ? 7 : 6} className="text-center py-8 text-gray-400">
                    Todavía no hay centros de costo. Sin ellos, la partida contable sale consolidada,
                    sin reparto por área.
                  </td>
                </tr>
              ) : (
                centros.map((c) => (
                  <tr key={c.id} className={`hover:bg-gray-50 ${!c.activo ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3 font-mono text-xs">{c.codigo}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{c.nombre}</div>
                      {c.descripcion && <div className="text-xs text-gray-500">{c.descripcion}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {c.cuentaGasto ?? <span className="text-gray-400 font-sans">plan general</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.departamentos}</td>
                    <td className="px-4 py-3 text-gray-600">{c.empleados}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          c.activo ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {c.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    {puedeGestionar && (
                      <td className="px-4 py-3">
                        <div className="flex gap-3 text-xs">
                          <button
                            onClick={() => setAsignando(c)}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Departamentos
                          </button>
                          <button
                            onClick={() =>
                              llamar(`/api/centros-costo/${c.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({ activo: !c.activo }),
                              })
                            }
                            disabled={cargando}
                            className="text-gray-600 hover:text-gray-900 disabled:opacity-40"
                          >
                            {c.activo ? "Desactivar" : "Reactivar"}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal titulo="Nuevo centro de costo" onCerrar={() => setModal(false)} onGuardar={crear} cargando={cargando}>
          <div className="space-y-4">
            <Campo etiqueta="Código">
              <input
                value={form.codigo}
                onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                placeholder="PROD"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
              />
            </Campo>
            <Campo etiqueta="Nombre">
              <input
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder="Producción"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </Campo>
            <Campo etiqueta="Descripción">
              <input
                value={form.descripcion}
                onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </Campo>
            <Campo
              etiqueta="Cuenta contable propia"
              ayuda="Opcional. Un sufijo como «-01» se añade a la cuenta del plan (5101-01); una cuenta completa como «610101» la sustituye. Vacío = se usa el plan general y el centro viaja como dimensión aparte."
            >
              <input
                value={form.cuentaGasto}
                onChange={(e) => setForm({ ...form, cuentaGasto: e.target.value })}
                placeholder="-01"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
              />
            </Campo>
          </div>
        </Modal>
      )}

      {asignando && (
        <AsignarDepartamentos
          centro={asignando}
          departamentos={departamentos}
          onCerrar={() => setAsignando(null)}
          onGuardar={async (ids) => {
            const ok = await llamar(`/api/centros-costo/${asignando.id}`, {
              method: "PATCH",
              body: JSON.stringify({ departamentosIds: ids }),
            });
            if (ok) setAsignando(null);
          }}
          cargando={cargando}
        />
      )}
    </div>
  );
}

function AsignarDepartamentos({
  centro,
  departamentos,
  onCerrar,
  onGuardar,
  cargando,
}: {
  centro: Centro;
  departamentos: Props["departamentos"];
  onCerrar: () => void;
  onGuardar: (ids: string[]) => void;
  cargando: boolean;
}) {
  const [seleccion, setSeleccion] = useState<string[]>(
    departamentos.filter((d) => d.centroCostoId === centro.id).map((d) => d.id)
  );

  return (
    <Modal
      titulo={`Departamentos de «${centro.nombre}»`}
      onCerrar={onCerrar}
      onGuardar={() => onGuardar(seleccion)}
      cargando={cargando}
    >
      <p className="text-xs text-gray-500 mb-3">
        Todo el personal de estos departamentos imputará aquí, salvo quien tenga otro centro
        asignado en su propia ficha. Al quitar un departamento de la lista queda sin centro, no
        conserva el anterior.
      </p>
      <div className="space-y-1 max-h-72 overflow-y-auto border border-gray-200 rounded-lg p-2">
        {departamentos.map((d) => {
          const ocupadoPorOtro = d.centroCostoId !== null && d.centroCostoId !== centro.id;
          return (
            <label key={d.id} className="flex items-center gap-2 text-sm px-1 py-1">
              <input
                type="checkbox"
                checked={seleccion.includes(d.id)}
                onChange={(e) =>
                  setSeleccion(
                    e.target.checked ? [...seleccion, d.id] : seleccion.filter((x) => x !== d.id)
                  )
                }
              />
              <span className="flex-1">
                {d.nombre} <span className="text-xs text-gray-400">· {d.sucursal}</span>
              </span>
              {ocupadoPorOtro && !seleccion.includes(d.id) && (
                <span className="text-xs text-amber-600" title="Ya imputa a otro centro de costo">
                  otro centro
                </span>
              )}
            </label>
          );
        })}
      </div>
    </Modal>
  );
}

function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">{etiqueta}</span>
      {children}
      {ayuda && <span className="block text-xs text-gray-500 mt-1">{ayuda}</span>}
    </label>
  );
}

function Modal({
  titulo,
  children,
  onCerrar,
  onGuardar,
  cargando,
}: {
  titulo: string;
  children: React.ReactNode;
  onCerrar: () => void;
  onGuardar: () => void;
  cargando: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-bold text-gray-900">{titulo}</h2>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 shrink-0">
          <button onClick={onCerrar} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
            Cancelar
          </button>
          <button
            onClick={onGuardar}
            disabled={cargando}
            className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 disabled:opacity-50"
          >
            {cargando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
