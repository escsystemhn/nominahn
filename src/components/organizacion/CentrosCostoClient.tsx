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
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";

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
    <div className="space-y-6">
      <PageHeader
        title="Centros de costo"
        description={
          <>
            Segunda dimensión del asiento contable: la cuenta dice <em>qué</em> es el gasto, el
            centro dice <em>dónde</em> se imputa.
          </>
        }
        actions={
          puedeGestionar && (
            <button
              onClick={() => {
                setForm(FORM_VACIO);
                setModal(true);
              }}
              className="btn btn-primary"
            >
              Nuevo centro
            </button>
          )
        }
      />

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

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base tabla-tarjetas">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Cuenta contable</th>
                <th className="num">Departamentos</th>
                <th className="num">Empleados propios</th>
                <th>Estado</th>
                {puedeGestionar && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {centros.length === 0 ? (
                <tr>
                  <td colSpan={puedeGestionar ? 7 : 6}>
                    <EstadoVacio
                      titulo="Todavía no hay centros de costo."
                      detalle={
                        puedeGestionar
                          ? "Sin ellos, la partida contable sale consolidada, sin reparto por área. Cree el primero con «Nuevo centro»."
                          : "Sin ellos, la partida contable sale consolidada, sin reparto por área."
                      }
                    />
                  </td>
                </tr>
              ) : (
                centros.map((c) => (
                  <tr key={c.id} className={!c.activo ? "opacity-60" : ""}>
                    <td data-etiqueta="Código" className="font-mono text-xs">{c.codigo}</td>
                    <td data-titulo>
                      <div className="font-medium text-gray-900">{c.nombre}</div>
                      {c.descripcion && <div className="text-xs text-gray-500">{c.descripcion}</div>}
                    </td>
                    <td data-etiqueta="Cuenta contable" className="font-mono text-xs text-gray-600">
                      {c.cuentaGasto ?? <span className="text-gray-500 font-sans">plan general</span>}
                    </td>
                    <td data-etiqueta="Departamentos" className="num text-gray-600">{c.departamentos}</td>
                    <td data-etiqueta="Empleados propios" className="num text-gray-600">{c.empleados}</td>
                    <td data-etiqueta="Estado">
                      <EstadoBadge valor={c.activo ? "ACTIVO" : "INACTIVO"} />
                    </td>
                    {puedeGestionar && (
                      <td data-accion>
                        <div className="flex flex-wrap gap-1">
                          <button
                            onClick={() => setAsignando(c)}
                            className="btn btn-ghost btn-sm"
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
                            className="btn btn-ghost btn-sm"
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
                className="input font-mono"
              />
            </Campo>
            <Campo etiqueta="Nombre">
              <input
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder="Producción"
                className="input"
              />
            </Campo>
            <Campo etiqueta="Descripción">
              <input
                value={form.descripcion}
                onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                className="input"
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
                className="input font-mono"
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
                {d.nombre} <span className="text-xs text-gray-500">({d.sucursal})</span>
              </span>
              {ocupadoPorOtro && !seleccion.includes(d.id) && (
                <span className="text-xs text-amber-700" title="Ya imputa a otro centro de costo">
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
      <span className="block text-sm font-medium text-gray-800 mb-1">{etiqueta}</span>
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
      <div className="panel shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">{titulo}</h2>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 shrink-0">
          <button onClick={onCerrar} className="btn btn-ghost">
            Cancelar
          </button>
          <button
            onClick={onGuardar}
            disabled={cargando}
            className="btn btn-primary"
          >
            {cargando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
