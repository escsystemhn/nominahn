"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

interface Articulo {
  id: string;
  nombre: string;
  categoria: string;
  descripcion: string | null;
  requiereTalla: boolean;
  vidaUtilMeses: number | null;
  activo: boolean;
}

interface Asignacion {
  id: string;
  cantidad: number;
  talla: string | null;
  fechaEntrega: string;
  fechaVencimiento: string | null;
  estado: string;
  observacion: string | null;
  empleado: { primerNombre: string; primerApellido: string; codigo: string };
  articulo: { nombre: string; categoria: string };
}

interface Props {
  empleados: { id: string; nombre: string }[];
  articulos: Articulo[];
  puedeGestionar: boolean;
}

const CATEGORIAS = [
  { v: "UNIFORME", l: "Uniforme" },
  { v: "EPP", l: "EPP" },
  { v: "EQUIPO", l: "Equipo" },
  { v: "HERRAMIENTA", l: "Herramienta" },
  { v: "OTRO", l: "Otro" },
];
const catLabel = (v: string) => CATEGORIAS.find((c) => c.v === v)?.l ?? v;

const badge: Record<string, string> = {
  ASIGNADO: "bg-green-100 text-green-800",
  DEVUELTO: "bg-gray-100 text-gray-600",
  REPOSICION: "bg-amber-100 text-amber-800",
  BAJA: "bg-red-100 text-red-700",
};

// Peticiones puras (no tocan estado de React), reutilizables desde los efectos y
// desde los manejadores de eventos.
async function obtenerAsignaciones(): Promise<Asignacion[]> {
  const res = await fetch("/api/dotaciones/asignaciones");
  return res.ok ? await res.json() : [];
}

async function obtenerPorVencer(d: number): Promise<Asignacion[]> {
  const res = await fetch(`/api/dotaciones/asignaciones?porVencer=${d}`);
  return res.ok ? await res.json() : [];
}

export default function DotacionesClient({ empleados, articulos: articulosIniciales, puedeGestionar }: Props) {
  const [tab, setTab] = useState<"asignaciones" | "catalogo" | "porvencer">("asignaciones");
  const [articulos, setArticulos] = useState<Articulo[]>(articulosIniciales);
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([]);
  const [porVencer, setPorVencer] = useState<Asignacion[]>([]);
  const [dias, setDias] = useState(30);
  // Arranca en true: el efecto de carga inicial lo baja al recibir los datos.
  const [loading, setLoading] = useState(true);

  const [fAsig, setFAsig] = useState({ empleadoId: "", articuloId: "", cantidad: 1, talla: "", fechaEntrega: "", observacion: "" });
  const [fArt, setFArt] = useState({ nombre: "", categoria: "UNIFORME", descripcion: "", requiereTalla: false, vidaUtilMeses: "" });
  const [msg, setMsg] = useState("");

  // Refresco manual tras una mutación (desde manejadores de eventos).
  const cargarAsignaciones = useCallback(async () => {
    setLoading(true);
    try {
      setAsignaciones(await obtenerAsignaciones());
    } finally {
      setLoading(false);
    }
  }, []);

  const cargarPorVencer = useCallback(async (d: number) => {
    setPorVencer(await obtenerPorVencer(d));
  }, []);

  // Carga inicial. `vivo` descarta respuestas que llegan tarde para que no pisen
  // datos más nuevos.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const datos = await obtenerAsignaciones();
      if (!vivo) return;
      setAsignaciones(datos);
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (tab !== "porvencer") return;
    let vivo = true;
    (async () => {
      const datos = await obtenerPorVencer(dias);
      if (vivo) setPorVencer(datos);
    })();
    return () => { vivo = false; };
  }, [tab, dias]);

  const artSel = articulos.find((a) => a.id === fAsig.articuloId);

  async function asignar(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!fAsig.empleadoId || !fAsig.articuloId) { setMsg("Seleccione empleado y artículo."); return; }
    const res = await fetch("/api/dotaciones/asignaciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fAsig),
    });
    if (!res.ok) { setMsg((await res.json()).error ?? "No se pudo asignar."); return; }
    setFAsig({ empleadoId: "", articuloId: "", cantidad: 1, talla: "", fechaEntrega: "", observacion: "" });
    await cargarAsignaciones();
  }

  async function crearArticulo(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!fArt.nombre.trim()) { setMsg("El nombre del artículo es obligatorio."); return; }
    const res = await fetch("/api/dotaciones/articulos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fArt),
    });
    if (!res.ok) { setMsg((await res.json()).error ?? "No se pudo crear el artículo."); return; }
    const nuevo = await res.json();
    setArticulos((prev) => [nuevo, ...prev]);
    setFArt({ nombre: "", categoria: "UNIFORME", descripcion: "", requiereTalla: false, vidaUtilMeses: "" });
  }

  async function cambiarEstado(id: string, estado: string) {
    const res = await fetch(`/api/dotaciones/asignaciones/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado }),
    });
    if (!res.ok) { alert((await res.json()).error ?? "No se pudo actualizar."); return; }
    await cargarAsignaciones();
    if (tab === "porvencer") await cargarPorVencer(dias);
  }

  const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm";
  const tabs: ["asignaciones" | "catalogo" | "porvencer", string][] = [
    ["asignaciones", "Asignaciones"],
    ["catalogo", "Catálogo"],
    ["porvencer", "Por vencer"],
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dotaciones</h1>
        <p className="text-sm text-gray-500">Uniformes, EPP y equipo asignado a los empleados</p>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === k ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {l}
          </button>
        ))}
      </div>

      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {tab === "asignaciones" && (
        <div className="grid lg:grid-cols-3 gap-5">
          {puedeGestionar && (
            <form onSubmit={asignar} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3 h-fit">
              <h2 className="font-semibold text-gray-900">Asignar artículo</h2>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Empleado</label>
                <select value={fAsig.empleadoId} onChange={(e) => setFAsig({ ...fAsig, empleadoId: e.target.value })} className={inputCls}>
                  <option value="">Seleccione…</option>
                  {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Artículo</label>
                <select value={fAsig.articuloId} onChange={(e) => setFAsig({ ...fAsig, articuloId: e.target.value })} className={inputCls}>
                  <option value="">Seleccione…</option>
                  {articulos.filter((a) => a.activo).map((a) => <option key={a.id} value={a.id}>{a.nombre} ({catLabel(a.categoria)})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Cantidad</label>
                  <input type="number" min={1} value={fAsig.cantidad} onChange={(e) => setFAsig({ ...fAsig, cantidad: Number(e.target.value) })} className={inputCls} />
                </div>
                {artSel?.requiereTalla && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Talla</label>
                    <input type="text" value={fAsig.talla} onChange={(e) => setFAsig({ ...fAsig, talla: e.target.value })} className={inputCls} />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Fecha de entrega</label>
                <input type="date" value={fAsig.fechaEntrega} onChange={(e) => setFAsig({ ...fAsig, fechaEntrega: e.target.value })} className={inputCls} />
                {artSel?.vidaUtilMeses ? <p className="text-xs text-gray-400 mt-1">Reposición programada a {artSel.vidaUtilMeses} meses.</p> : null}
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Observación</label>
                <input type="text" value={fAsig.observacion} onChange={(e) => setFAsig({ ...fAsig, observacion: e.target.value })} className={inputCls} />
              </div>
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">Asignar</button>
            </form>
          )}

          <div className={`bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden ${puedeGestionar ? "lg:col-span-2" : "lg:col-span-3"}`}>
            {loading ? <p className="p-5 text-sm text-gray-400">Cargando…</p> : asignaciones.length === 0 ? (
              <p className="p-5 text-sm text-gray-400">Sin asignaciones registradas.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b text-gray-600">
                    <th className="text-left px-3 py-3 font-medium">Empleado</th>
                    <th className="text-left px-3 py-3 font-medium">Artículo</th>
                    <th className="text-right px-3 py-3 font-medium">Cant.</th>
                    <th className="text-left px-3 py-3 font-medium">Talla</th>
                    <th className="text-left px-3 py-3 font-medium">Entrega</th>
                    <th className="text-left px-3 py-3 font-medium">Vence</th>
                    <th className="text-center px-3 py-3 font-medium">Estado</th>
                    {puedeGestionar && <th className="text-center px-3 py-3 font-medium">Acción</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {asignaciones.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{a.empleado.primerNombre} {a.empleado.primerApellido}</div>
                        <div className="text-gray-400">{a.empleado.codigo}</div>
                      </td>
                      <td className="px-3 py-2">{a.articulo.nombre}<div className="text-gray-400">{catLabel(a.articulo.categoria)}</div></td>
                      <td className="px-3 py-2 text-right">{a.cantidad}</td>
                      <td className="px-3 py-2">{a.talla ?? "—"}</td>
                      <td className="px-3 py-2">{formatDate(a.fechaEntrega)}</td>
                      <td className="px-3 py-2">{a.fechaVencimiento ? formatDate(a.fechaVencimiento) : "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-1 rounded-full font-medium ${badge[a.estado] ?? "bg-gray-100 text-gray-600"}`}>{a.estado}</span>
                      </td>
                      {puedeGestionar && (
                        <td className="px-3 py-2 text-center whitespace-nowrap">
                          {a.estado === "ASIGNADO" ? (
                            <div className="flex gap-1 justify-center">
                              <button onClick={() => cambiarEstado(a.id, "DEVUELTO")} className="px-2 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">Devolver</button>
                              <button onClick={() => cambiarEstado(a.id, "REPOSICION")} className="px-2 py-1 border border-amber-300 rounded text-amber-700 hover:bg-amber-50">Reponer</button>
                            </div>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "catalogo" && (
        <div className="grid lg:grid-cols-3 gap-5">
          {puedeGestionar && (
            <form onSubmit={crearArticulo} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3 h-fit">
              <h2 className="font-semibold text-gray-900">Nuevo artículo</h2>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Nombre</label>
                <input type="text" value={fArt.nombre} onChange={(e) => setFArt({ ...fArt, nombre: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Categoría</label>
                <select value={fArt.categoria} onChange={(e) => setFArt({ ...fArt, categoria: e.target.value })} className={inputCls}>
                  {CATEGORIAS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Descripción</label>
                <input type="text" value={fArt.descripcion} onChange={(e) => setFArt({ ...fArt, descripcion: e.target.value })} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Vida útil (meses)</label>
                  <input type="number" min={0} value={fArt.vidaUtilMeses} onChange={(e) => setFArt({ ...fArt, vidaUtilMeses: e.target.value })} className={inputCls} placeholder="opcional" />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
                  <input type="checkbox" checked={fArt.requiereTalla} onChange={(e) => setFArt({ ...fArt, requiereTalla: e.target.checked })} />
                  Requiere talla
                </label>
              </div>
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">Crear artículo</button>
            </form>
          )}

          <div className={`bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden ${puedeGestionar ? "lg:col-span-2" : "lg:col-span-3"}`}>
            {articulos.length === 0 ? <p className="p-5 text-sm text-gray-400">Catálogo vacío.</p> : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b text-gray-600">
                    <th className="text-left px-3 py-3 font-medium">Artículo</th>
                    <th className="text-left px-3 py-3 font-medium">Categoría</th>
                    <th className="text-center px-3 py-3 font-medium">Talla</th>
                    <th className="text-right px-3 py-3 font-medium">Vida útil</th>
                    <th className="text-center px-3 py-3 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {articulos.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{a.nombre}{a.descripcion && <div className="text-gray-400 font-normal">{a.descripcion}</div>}</td>
                      <td className="px-3 py-2">{catLabel(a.categoria)}</td>
                      <td className="px-3 py-2 text-center">{a.requiereTalla ? "Sí" : "—"}</td>
                      <td className="px-3 py-2 text-right">{a.vidaUtilMeses ? `${a.vidaUtilMeses} m` : "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-1 rounded-full font-medium ${a.activo ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>{a.activo ? "Activo" : "Inactivo"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "porvencer" && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
            <span className="font-semibold text-gray-900 text-sm">Reposiciones próximas</span>
            <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className="border border-gray-300 rounded-lg px-2 py-1 text-xs">
              <option value={15}>Próximos 15 días</option>
              <option value={30}>Próximos 30 días</option>
              <option value={60}>Próximos 60 días</option>
              <option value={90}>Próximos 90 días</option>
            </select>
          </div>
          {porVencer.length === 0 ? <p className="p-5 text-sm text-gray-400">No hay reposiciones en ese rango.</p> : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b text-gray-600">
                  <th className="text-left px-3 py-3 font-medium">Empleado</th>
                  <th className="text-left px-3 py-3 font-medium">Artículo</th>
                  <th className="text-left px-3 py-3 font-medium">Vence</th>
                  {puedeGestionar && <th className="text-center px-3 py-3 font-medium">Acción</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {porVencer.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{a.empleado.primerNombre} {a.empleado.primerApellido} <span className="text-gray-400">· {a.empleado.codigo}</span></td>
                    <td className="px-3 py-2">{a.articulo.nombre}</td>
                    <td className="px-3 py-2 text-amber-700 font-medium">{a.fechaVencimiento ? formatDate(a.fechaVencimiento) : "—"}</td>
                    {puedeGestionar && (
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => cambiarEstado(a.id, "REPOSICION")} className="px-2 py-1 border border-amber-300 rounded text-amber-700 hover:bg-amber-50">Marcar reposición</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
