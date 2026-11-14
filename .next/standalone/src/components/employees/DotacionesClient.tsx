"use client";

import { useCallback, useEffect, useState } from "react";
import { useAvisos } from "@/components/ui/Avisos";
import { formatDate } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge, { type Tono } from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";
import { Campo } from "@/components/ui/ModalForm";

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

const badge: Record<string, { etiqueta: string; tono: Tono }> = {
  ASIGNADO: { etiqueta: "Asignado", tono: "ok" },
  DEVUELTO: { etiqueta: "Devuelto", tono: "neutro" },
  REPOSICION: { etiqueta: "En reposición", tono: "aviso" },
  BAJA: { etiqueta: "Baja", tono: "error" },
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
  const { avisar } = useAvisos();
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
    if (!res.ok) { setMsg((await res.json().catch(() => ({}))).error ?? "No se pudo asignar."); return; }
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
    if (!res.ok) { setMsg((await res.json().catch(() => ({}))).error ?? "No se pudo crear el artículo."); return; }
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
    if (!res.ok) { avisar.error((await res.json().catch(() => ({}))).error ?? "No se pudo actualizar."); return; }
    await cargarAsignaciones();
    if (tab === "porvencer") await cargarPorVencer(dias);
  }

  const tabs: ["asignaciones" | "catalogo" | "porvencer", string][] = [
    ["asignaciones", "Asignaciones"],
    ["catalogo", "Catálogo"],
    ["porvencer", "Por vencer"],
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Dotaciones" description="Uniformes, EPP y equipo asignado a los empleados.">
        <div className="-mb-5 flex gap-1">
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              {l}
            </button>
          ))}
        </div>
      </PageHeader>

      {msg && <p className="text-sm text-red-700" role="alert">{msg}</p>}

      {tab === "asignaciones" && (
        <div className="grid gap-5 lg:grid-cols-3">
          {puedeGestionar && (
            <form onSubmit={asignar} className="panel h-fit space-y-3 p-5">
              <h2 className="font-semibold text-gray-900">Asignar artículo</h2>
              <Campo etiqueta="Empleado">
                <select value={fAsig.empleadoId} onChange={(e) => setFAsig({ ...fAsig, empleadoId: e.target.value })} className="input">
                  <option value="">Seleccione…</option>
                  {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Artículo">
                <select value={fAsig.articuloId} onChange={(e) => setFAsig({ ...fAsig, articuloId: e.target.value })} className="input">
                  <option value="">Seleccione…</option>
                  {articulos.filter((a) => a.activo).map((a) => <option key={a.id} value={a.id}>{a.nombre} ({catLabel(a.categoria)})</option>)}
                </select>
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Cantidad">
                  <input type="number" min={1} value={fAsig.cantidad} onChange={(e) => setFAsig({ ...fAsig, cantidad: Number(e.target.value) })} className="input" />
                </Campo>
                {artSel?.requiereTalla && (
                  <Campo etiqueta="Talla">
                    <input type="text" value={fAsig.talla} onChange={(e) => setFAsig({ ...fAsig, talla: e.target.value })} className="input" />
                  </Campo>
                )}
              </div>
              <div>
                <Campo etiqueta="Fecha de entrega">
                  <input type="date" value={fAsig.fechaEntrega} onChange={(e) => setFAsig({ ...fAsig, fechaEntrega: e.target.value })} className="input" />
                </Campo>
                {artSel?.vidaUtilMeses ? <p className="mt-1 text-xs text-gray-500">Reposición programada a {artSel.vidaUtilMeses} meses.</p> : null}
              </div>
              <Campo etiqueta="Observación">
                <input type="text" value={fAsig.observacion} onChange={(e) => setFAsig({ ...fAsig, observacion: e.target.value })} className="input" />
              </Campo>
              <button type="submit" className="btn btn-primary">Asignar</button>
            </form>
          )}

          <div className={`panel overflow-hidden ${puedeGestionar ? "lg:col-span-2" : "lg:col-span-3"}`}>
            {loading ? <p className="p-5 text-sm text-gray-500">Cargando…</p> : (
              <div className="overflow-x-auto">
                <table className="table-base tabla-tarjetas">
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Artículo</th>
                      <th className="num">Cant.</th>
                      <th>Talla</th>
                      <th>Entrega</th>
                      <th>Vence</th>
                      <th>Estado</th>
                      {puedeGestionar && <th>Acción</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {asignaciones.length === 0 ? (
                      <tr>
                        <td colSpan={puedeGestionar ? 8 : 7}>
                          <EstadoVacio
                            titulo="Todavía no hay asignaciones."
                            detalle={puedeGestionar ? "Asigne el primer artículo a un empleado con el formulario de la izquierda." : "Cuando Recursos Humanos asigne uniformes o equipo, aparecerán aquí."}
                          />
                        </td>
                      </tr>
                    ) : asignaciones.map((a) => (
                      <tr key={a.id}>
                        <td data-titulo>
                          <div className="font-medium text-gray-900">{a.empleado.primerNombre} {a.empleado.primerApellido}</div>
                          <div className="text-xs text-gray-500">{a.empleado.codigo}</div>
                        </td>
                        <td data-etiqueta="Artículo">{a.articulo.nombre}<div className="text-xs text-gray-500">{catLabel(a.articulo.categoria)}</div></td>
                        <td data-etiqueta="Cantidad" className="num">{a.cantidad}</td>
                        <td data-etiqueta="Talla">{a.talla ?? "—"}</td>
                        <td data-etiqueta="Entrega" className="whitespace-nowrap">{formatDate(a.fechaEntrega)}</td>
                        <td data-etiqueta="Vence" className="whitespace-nowrap">{a.fechaVencimiento ? formatDate(a.fechaVencimiento) : "—"}</td>
                        <td data-etiqueta="Estado">
                          <EstadoBadge valor={a.estado} {...(badge[a.estado] ?? {})} />
                        </td>
                        {puedeGestionar && (
                          <td data-accion className="whitespace-nowrap">
                            {a.estado === "ASIGNADO" ? (
                              <div className="flex gap-1">
                                <button onClick={() => cambiarEstado(a.id, "DEVUELTO")} className="btn btn-secondary btn-sm">Devolver</button>
                                <button onClick={() => cambiarEstado(a.id, "REPOSICION")} className="btn btn-secondary btn-sm">Reponer</button>
                              </div>
                            ) : <span className="text-gray-400">—</span>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "catalogo" && (
        <div className="grid gap-5 lg:grid-cols-3">
          {puedeGestionar && (
            <form onSubmit={crearArticulo} className="panel h-fit space-y-3 p-5">
              <h2 className="font-semibold text-gray-900">Nuevo artículo</h2>
              <Campo etiqueta="Nombre">
                <input type="text" value={fArt.nombre} onChange={(e) => setFArt({ ...fArt, nombre: e.target.value })} className="input" />
              </Campo>
              <Campo etiqueta="Categoría">
                <select value={fArt.categoria} onChange={(e) => setFArt({ ...fArt, categoria: e.target.value })} className="input">
                  {CATEGORIAS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Descripción">
                <input type="text" value={fArt.descripcion} onChange={(e) => setFArt({ ...fArt, descripcion: e.target.value })} className="input" />
              </Campo>
              <div className="grid grid-cols-2 items-end gap-3">
                <Campo etiqueta="Vida útil (meses)">
                  <input type="number" min={0} value={fArt.vidaUtilMeses} onChange={(e) => setFArt({ ...fArt, vidaUtilMeses: e.target.value })} className="input" placeholder="opcional" />
                </Campo>
                <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
                  <input type="checkbox" checked={fArt.requiereTalla} onChange={(e) => setFArt({ ...fArt, requiereTalla: e.target.checked })} />
                  Requiere talla
                </label>
              </div>
              <button type="submit" className="btn btn-primary">Crear artículo</button>
            </form>
          )}

          <div className={`panel overflow-hidden ${puedeGestionar ? "lg:col-span-2" : "lg:col-span-3"}`}>
            <div className="overflow-x-auto">
              <table className="table-base tabla-tarjetas">
                <thead>
                  <tr>
                    <th>Artículo</th>
                    <th>Categoría</th>
                    <th>Talla</th>
                    <th className="num">Vida útil</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {articulos.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <EstadoVacio
                          titulo="El catálogo está vacío."
                          detalle={puedeGestionar ? "Cree el primer artículo con el formulario de la izquierda para poder asignarlo." : "Cuando Recursos Humanos cree artículos, aparecerán aquí."}
                        />
                      </td>
                    </tr>
                  ) : articulos.map((a) => (
                    <tr key={a.id}>
                      <td data-titulo className="font-medium text-gray-900">{a.nombre}{a.descripcion && <div className="text-xs font-normal text-gray-500">{a.descripcion}</div>}</td>
                      <td data-etiqueta="Categoría">{catLabel(a.categoria)}</td>
                      <td data-etiqueta="Talla">{a.requiereTalla ? "Sí" : "—"}</td>
                      <td data-etiqueta="Vida útil" className="num">{a.vidaUtilMeses ? `${a.vidaUtilMeses} meses` : "—"}</td>
                      <td data-etiqueta="Estado">
                        <EstadoBadge valor={a.activo ? "ACTIVO" : "INACTIVO"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "porvencer" && (
        <div className="panel overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-200 px-5 py-3">
            <span className="text-sm font-semibold text-gray-900">Reposiciones próximas</span>
            <select aria-label="Rango de días" value={dias} onChange={(e) => setDias(Number(e.target.value))} className="input h-8! w-auto! text-xs">
              <option value={15}>Próximos 15 días</option>
              <option value={30}>Próximos 30 días</option>
              <option value={60}>Próximos 60 días</option>
              <option value={90}>Próximos 90 días</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base tabla-tarjetas">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Artículo</th>
                  <th>Vence</th>
                  {puedeGestionar && <th>Acción</th>}
                </tr>
              </thead>
              <tbody>
                {porVencer.length === 0 ? (
                  <tr>
                    <td colSpan={puedeGestionar ? 4 : 3}>
                      <EstadoVacio titulo="No hay reposiciones en ese rango." detalle="Amplíe el rango de días para ver las que vencen más adelante." />
                    </td>
                  </tr>
                ) : porVencer.map((a) => (
                  <tr key={a.id}>
                    <td data-titulo>{a.empleado.primerNombre} {a.empleado.primerApellido}<div className="text-xs text-gray-500">{a.empleado.codigo}</div></td>
                    <td data-etiqueta="Artículo">{a.articulo.nombre}</td>
                    <td data-etiqueta="Vence" className="whitespace-nowrap font-medium text-gray-900">{a.fechaVencimiento ? formatDate(a.fechaVencimiento) : "—"}</td>
                    {puedeGestionar && (
                      <td data-accion>
                        <button onClick={() => cambiarEstado(a.id, "REPOSICION")} className="btn btn-secondary btn-sm">Marcar reposición</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
