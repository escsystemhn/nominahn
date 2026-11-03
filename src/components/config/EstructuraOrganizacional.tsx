"use client";

/**
 * Configuración → Estructura organizacional: sucursales, divisiones,
 * departamentos y los puestos de cada departamento, y la opción que habilita el
 * nivel División (Sucursal → División → Departamento). Con la opción apagada la
 * pantalla no muestra divisiones: sucursales, departamentos y puestos.
 */

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import EstadoBadge from "@/components/ui/EstadoBadge";
import { SIN_DIVISION, etiquetaDepartamento } from "@/lib/organizacion/estructura";
import { rangoSalarialValido } from "@/lib/organizacion/puestos";
import { formatCurrency } from "@/lib/utils";

export interface SucursalEstructura { id: string; empresaId: string; nombre: string; codigo: string; direccion: string | null; telefono: string | null; activa: boolean }
export interface DivisionEstructura { id: string; nombre: string; codigo: string | null; activa: boolean; sucursalId: string; departamentos: number }
export interface DepartamentoEstructura { id: string; nombre: string; codigo: string | null; activo: boolean; sucursalId: string; divisionId: string | null; empleados: number }
export interface PuestoEstructura {
  id: string; nombre: string; descripcion: string | null; salarioMinimo: number; salarioMaximo: number; activo: boolean;
  departamentoId: string; empleados: number; competencias: number; coberturas: number;
}

interface Props {
  empresaId: string | null;
  sucursales: SucursalEstructura[];
  divisiones: DivisionEstructura[];
  departamentos: DepartamentoEstructura[];
  puestos: PuestoEstructura[];
  divisionesHabilitadas: boolean;
  /** `configuracion.editar`: sin él, la pantalla es de sólo lectura. */
  puedeEditar: boolean;
}

type Edicion =
  | { tipo: "sucursal"; sucursal: SucursalEstructura | null }
  | { tipo: "division"; division: DivisionEstructura | null }
  | { tipo: "departamento"; departamento: DepartamentoEstructura | null }
  | { tipo: "puesto"; puesto: PuestoEstructura | null; departamentoId: string }
  | { tipo: "copiar"; departamento: DepartamentoEstructura };

async function enviar(url: string, method: string, body?: unknown): Promise<string | null> {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return d.error ?? "No se pudo guardar. Intente de nuevo.";
}

/** El rango es opcional: cero significa «sin definir». */
function textoRango(p: PuestoEstructura): string {
  if (p.salarioMinimo > 0 && p.salarioMaximo > 0) return `${formatCurrency(p.salarioMinimo)} – ${formatCurrency(p.salarioMaximo)}`;
  if (p.salarioMinimo > 0) return `Desde ${formatCurrency(p.salarioMinimo)}`;
  if (p.salarioMaximo > 0) return `Hasta ${formatCurrency(p.salarioMaximo)}`;
  return "—";
}

export default function EstructuraOrganizacional({ empresaId, sucursales, divisiones, departamentos, puestos, divisionesHabilitadas, puedeEditar }: Props) {
  const router = useRouter();
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [cambiandoOpcion, setCambiandoOpcion] = useState(false);
  // La casilla cambia al instante; si el servidor rechaza, vuelve atrás. Atada
  // sólo al valor del servidor, no se movía hasta recargar la página.
  const [opcion, setOpcion] = useState(divisionesHabilitadas);
  const [filtroSucursal, setFiltroSucursal] = useState("");
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(new Set());

  const nombreSucursal = useMemo(() => new Map(sucursales.map((s) => [s.id, s.nombre])), [sucursales]);
  const puestosPorDepartamento = useMemo(() => {
    const mapa = new Map<string, PuestoEstructura[]>();
    for (const p of puestos) mapa.set(p.departamentoId, [...(mapa.get(p.departamentoId) ?? []), p]);
    return mapa;
  }, [puestos]);

  function alternarAbierto(id: string, abrir?: boolean) {
    setAbiertos((actual) => {
      const nuevo = new Set(actual);
      if (abrir ?? !nuevo.has(id)) nuevo.add(id);
      else nuevo.delete(id);
      return nuevo;
    });
  }

  async function cambiarOpcion(habilitar: boolean) {
    if (!habilitar && divisiones.length > 0 &&
      !confirm(`Las ${divisiones.length} división(es) y la división de cada departamento se conservan, pero dejarán de mostrarse y los reportes volverán a agrupar Sucursal → Departamento. ¿Desactivar?`)) return;
    setOpcion(habilitar);
    setCambiandoOpcion(true);
    const error = await enviar("/api/configuracion/estructura", "PUT", { divisiones: habilitar });
    setCambiandoOpcion(false);
    setAviso(error);
    if (error) setOpcion(!habilitar);
    else router.refresh();
  }

  async function alternarSucursal(s: SucursalEstructura) {
    if (s.activa && !confirm(`«${s.nombre}» dejará de ofrecerse al crear empleados, planillas y horarios. Su historial se conserva. ¿Desactivar?`)) return;
    const error = await enviar(`/api/configuracion/sucursales/${s.id}`, "PATCH", { activa: !s.activa });
    setAviso(error);
    if (!error) router.refresh();
  }

  async function borrarDivision(v: DivisionEstructura) {
    if (!confirm(`¿Eliminar la división «${v.nombre}»?`)) return;
    const error = await enviar(`/api/configuracion/divisiones/${v.id}`, "DELETE");
    setAviso(error);
    if (!error) router.refresh();
  }

  async function alternarDivision(v: DivisionEstructura) {
    const error = await enviar(`/api/configuracion/divisiones/${v.id}`, "PATCH", { activa: !v.activa });
    setAviso(error);
    if (!error) router.refresh();
  }

  async function alternarPuesto(p: PuestoEstructura) {
    if (p.activo && !confirm(`«${p.nombre}» dejará de ofrecerse al asignar puestos. Quienes ya lo tienen lo conservan. ¿Desactivar?`)) return;
    const error = await enviar(`/api/configuracion/puestos/${p.id}`, "PATCH", { activo: !p.activo });
    setAviso(error);
    if (!error) router.refresh();
  }

  async function borrarPuesto(p: PuestoEstructura) {
    if (!confirm(`¿Eliminar el puesto «${p.nombre}»?`)) return;
    const error = await enviar(`/api/configuracion/puestos/${p.id}`, "DELETE");
    setAviso(error);
    if (!error) router.refresh();
  }

  // Departamentos agrupados por sucursal y, con divisiones, por división.
  const arbol = useMemo(() => sucursales.map((s) => {
    const propios = departamentos.filter((d) => d.sucursalId === s.id).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    if (!divisionesHabilitadas) return { sucursal: s, grupos: [{ division: null as DivisionEstructura | null, titulo: null as string | null, departamentos: propios }] };
    const grupos = divisiones
      .filter((v) => v.sucursalId === s.id)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      .map((v) => ({ division: v as DivisionEstructura | null, titulo: v.nombre as string | null, departamentos: propios.filter((d) => d.divisionId === v.id) }));
    const sueltos = propios.filter((d) => !d.divisionId || !divisiones.some((v) => v.id === d.divisionId));
    if (sueltos.length) grupos.push({ division: null, titulo: grupos.length ? SIN_DIVISION : null, departamentos: sueltos });
    return { sucursal: s, grupos };
  }), [sucursales, divisiones, departamentos, divisionesHabilitadas]);

  const visibles = arbol.filter((a) => (!filtroSucursal || a.sucursal.id === filtroSucursal) && a.grupos.some((g) => g.departamentos.length || g.division));

  return (
    <div className="space-y-6">
      {aviso && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{aviso}</div>}
      {exito && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800" role="status">{exito}</div>}

      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-gray-900">Nivel División</h2>
            <p className="mt-1 text-sm text-gray-600">
              Agrega un nivel entre la sucursal y el departamento (Sucursal → División → Departamento) para agrupar
              empresas o unidades de negocio dentro de una misma nómina. Los reportes y las planillas se agrupan y filtran
              por ese nivel. Desactivado, todo funciona como siempre.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-800">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300"
              checked={opcion}
              disabled={!puedeEditar || cambiandoOpcion}
              onChange={(e) => cambiarOpcion(e.target.checked)}
            />
            Usar divisiones
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Sucursales ({sucursales.length})</h2>
          {puedeEditar && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEdicion({ tipo: "sucursal", sucursal: null })}>Nueva sucursal</button>}
        </div>
        <div className="panel overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Nombre</th><th>Código</th><th>Dirección</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {sucursales.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium text-gray-900">{s.nombre}</td>
                  <td className="font-mono text-xs">{s.codigo}</td>
                  <td>{s.direccion ?? "—"}</td>
                  <td><EstadoBadge valor={s.activa ? "ACTIVA" : "INACTIVA"} /></td>
                  <td className="whitespace-nowrap text-right">
                    {puedeEditar && (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdicion({ tipo: "sucursal", sucursal: s })}>Editar</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => alternarSucursal(s)}>{s.activa ? "Desactivar" : "Activar"}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {divisionesHabilitadas && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Divisiones ({divisiones.length})</h2>
            {puedeEditar && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEdicion({ tipo: "division", division: null })}>Nueva división</button>}
          </div>
          <div className="panel overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Sucursal</th><th>División</th><th>Código</th><th className="num">Departamentos</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {divisiones.length === 0 && (
                  <tr><td colSpan={6} className="text-gray-500">Todavía no hay divisiones. Cree la primera y luego asígnela a sus departamentos.</td></tr>
                )}
                {divisiones.map((v) => (
                  <tr key={v.id}>
                    <td>{nombreSucursal.get(v.sucursalId)}</td>
                    <td className="font-medium text-gray-900">{v.nombre}</td>
                    <td className="font-mono text-xs">{v.codigo ?? "—"}</td>
                    <td className="num">{v.departamentos}</td>
                    <td><EstadoBadge valor={v.activa ? "ACTIVA" : "INACTIVA"} /></td>
                    <td className="whitespace-nowrap text-right">
                      {puedeEditar && (
                        <>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdicion({ tipo: "division", division: v })}>Editar</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => alternarDivision(v)}>{v.activa ? "Desactivar" : "Activar"}</button>
                          {v.departamentos === 0 && <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => borrarDivision(v)}>Eliminar</button>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">Departamentos ({departamentos.length}) y puestos ({puestos.length})</h2>
          <div className="flex flex-wrap items-center gap-2">
            {sucursales.length > 1 && (
              <select className="input w-auto" aria-label="Filtrar por sucursal" value={filtroSucursal} onChange={(e) => setFiltroSucursal(e.target.value)}>
                <option value="">Todas las sucursales</option>
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            )}
            {puedeEditar && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEdicion({ tipo: "departamento", departamento: null })}>Nuevo departamento</button>}
          </div>
        </div>
        <div className="panel overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Departamento</th><th>Código</th><th className="num">Puestos</th><th className="num">Empleados</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {visibles.length === 0 && (
                <tr><td colSpan={6} className="text-gray-500">Todavía no hay departamentos{filtroSucursal ? " en esta sucursal" : ""}.{puedeEditar ? " Cree el primero con «Nuevo departamento»." : ""}</td></tr>
              )}
              {visibles.map(({ sucursal, grupos }) => (
                <Fragment key={sucursal.id}>
                  <tr><td colSpan={6} className="bg-gray-50 font-semibold text-gray-900">{sucursal.nombre}</td></tr>
                  {grupos.map((g) => (
                    <Fragment key={g.division?.id ?? "sin"}>
                      {g.titulo && <tr><td colSpan={6} className="pl-8 font-medium text-gray-800">{g.titulo}</td></tr>}
                      {g.departamentos.length === 0 && g.division && (
                        <tr><td colSpan={6} className="pl-14 text-xs text-gray-500">Sin departamentos asignados.</td></tr>
                      )}
                      {g.departamentos.map((d) => {
                        const propios = puestosPorDepartamento.get(d.id) ?? [];
                        const abierto = abiertos.has(d.id);
                        return (
                          <Fragment key={d.id}>
                            <tr>
                              <td className={g.titulo ? "pl-14" : "pl-8"}>
                                <button type="button" className="inline-flex items-center gap-1.5 text-left font-medium text-gray-900 hover:text-blue-700" aria-expanded={abierto} onClick={() => alternarAbierto(d.id)}>
                                  <svg className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform ${abierto ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                                  </svg>
                                  {d.nombre}
                                </button>
                              </td>
                              <td className="font-mono text-xs">{d.codigo ?? "—"}</td>
                              <td className="num">{propios.length}</td>
                              <td className="num">{d.empleados}</td>
                              <td><EstadoBadge valor={d.activo ? "ACTIVO" : "INACTIVO"} /></td>
                              <td className="whitespace-nowrap text-right">
                                {puedeEditar && (
                                  <>
                                    {d.activo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdicion({ tipo: "puesto", puesto: null, departamentoId: d.id })}>Agregar puesto</button>}
                                    {d.activo && sucursales.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setExito(null); setEdicion({ tipo: "copiar", departamento: d }); }}>Copiar</button>}
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdicion({ tipo: "departamento", departamento: d })}>Editar</button>
                                  </>
                                )}
                              </td>
                            </tr>
                            {abierto && (
                              <tr>
                                <td colSpan={6} className="bg-gray-50 p-3">
                                  {propios.length === 0 ? (
                                    <p className="pl-8 text-sm text-gray-500">Este departamento todavía no tiene puestos.</p>
                                  ) : (
                                    <table className="table-base rounded-lg bg-white" aria-label={`Puestos de ${d.nombre}`}>
                                      <thead><tr><th>Puesto</th><th>Rango salarial</th><th className="num">Empleados</th><th>Estado</th><th /></tr></thead>
                                      <tbody>
                                        {propios.map((p) => (
                                          <tr key={p.id}>
                                            <td>
                                              <span className="font-medium text-gray-900">{p.nombre}</span>
                                              {p.descripcion && <span className="block text-xs text-gray-500">{p.descripcion}</span>}
                                            </td>
                                            <td className="whitespace-nowrap">{textoRango(p)}</td>
                                            <td className="num">{p.empleados}</td>
                                            <td><EstadoBadge valor={p.activo ? "ACTIVO" : "INACTIVO"} /></td>
                                            <td className="whitespace-nowrap text-right">
                                              {puedeEditar && (
                                                <>
                                                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdicion({ tipo: "puesto", puesto: p, departamentoId: p.departamentoId })}>Editar</button>
                                                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => alternarPuesto(p)}>{p.activo ? "Desactivar" : "Activar"}</button>
                                                  {p.empleados + p.competencias + p.coberturas === 0 && <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => borrarPuesto(p)}>Eliminar</button>}
                                                </>
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {edicion?.tipo === "sucursal" && (
        <FormSucursal sucursal={edicion.sucursal} empresaId={empresaId} onCerrar={() => setEdicion(null)} onListo={() => { setEdicion(null); router.refresh(); }} />
      )}
      {edicion?.tipo === "division" && (
        <FormDivision division={edicion.division} sucursales={sucursales} onCerrar={() => setEdicion(null)} onListo={() => { setEdicion(null); router.refresh(); }} />
      )}
      {edicion?.tipo === "departamento" && (
        <FormDepartamento
          departamento={edicion.departamento}
          sucursales={sucursales}
          divisiones={divisionesHabilitadas ? divisiones : []}
          onCerrar={() => setEdicion(null)}
          onListo={() => { setEdicion(null); router.refresh(); }}
        />
      )}
      {edicion?.tipo === "puesto" && (
        <FormPuesto
          puesto={edicion.puesto}
          departamentoId={edicion.departamentoId}
          departamentos={departamentos}
          nombreSucursal={nombreSucursal}
          onCerrar={() => setEdicion(null)}
          onListo={(id) => { setEdicion(null); alternarAbierto(id, true); router.refresh(); }}
        />
      )}
      {edicion?.tipo === "copiar" && (
        <FormCopiar
          departamento={edicion.departamento}
          puestosActivos={(puestosPorDepartamento.get(edicion.departamento.id) ?? []).filter((p) => p.activo).length}
          sucursales={sucursales}
          divisiones={divisionesHabilitadas ? divisiones : []}
          onCerrar={() => setEdicion(null)}
          onListo={(r) => {
            setEdicion(null);
            setExito(r.mensaje);
            setFiltroSucursal(r.sucursalId);
            alternarAbierto(r.departamentoId, true);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── Formularios ──────────────────────────────────────────────────────────────

function Modal({ titulo, error, cargando, puedeGuardar, textoGuardar = "Guardar", onCerrar, onGuardar, children }: {
  titulo: string; error: string | null; cargando: boolean; puedeGuardar: boolean; textoGuardar?: string;
  onCerrar: () => void; onGuardar: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="panel w-full max-w-md space-y-4 p-5 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">{titulo}</h3>
        <div className="space-y-3">{children}</div>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={cargando || !puedeGuardar} onClick={onGuardar}>{cargando ? "Guardando…" : textoGuardar}</button>
        </div>
      </div>
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="font-medium text-gray-800">{etiqueta}</span><div className="mt-1">{children}</div></label>;
}

function useGuardar(onListo: () => void) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = async (url: string, method: string, body: unknown) => {
    setCargando(true);
    const e = await enviar(url, method, body);
    setCargando(false);
    setError(e);
    if (!e) onListo();
  };
  return { cargando, error, guardar };
}

function FormSucursal({ sucursal, empresaId, onCerrar, onListo }: { sucursal: SucursalEstructura | null; empresaId: string | null; onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({ nombre: sucursal?.nombre ?? "", codigo: sucursal?.codigo ?? "", direccion: sucursal?.direccion ?? "", telefono: sucursal?.telefono ?? "" });
  const { cargando, error, guardar } = useGuardar(onListo);
  return (
    <Modal titulo={sucursal ? `Editar ${sucursal.nombre}` : "Nueva sucursal"} error={error} cargando={cargando} puedeGuardar={!!f.nombre.trim() && !!f.codigo.trim()} onCerrar={onCerrar}
      onGuardar={() => sucursal
        ? guardar(`/api/configuracion/sucursales/${sucursal.id}`, "PATCH", { nombre: f.nombre, codigo: f.codigo, direccion: f.direccion || null, telefono: f.telefono || null })
        : guardar("/api/configuracion/sucursales", "POST", { ...f, empresaId })}>
      <Campo etiqueta="Nombre"><input className="input" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
      <Campo etiqueta="Código"><input className="input" value={f.codigo} placeholder="SPS-002" onChange={(e) => setF({ ...f, codigo: e.target.value })} /></Campo>
      <Campo etiqueta="Dirección"><input className="input" value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></Campo>
      <Campo etiqueta="Teléfono"><input className="input" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></Campo>
    </Modal>
  );
}

function FormDivision({ division, sucursales, onCerrar, onListo }: {
  division: DivisionEstructura | null; sucursales: SucursalEstructura[]; onCerrar: () => void; onListo: () => void;
}) {
  const opcionesSucursal = sucursales.filter((s) => s.activa || s.id === division?.sucursalId);
  const [f, setF] = useState({ nombre: division?.nombre ?? "", codigo: division?.codigo ?? "", sucursalId: division?.sucursalId ?? opcionesSucursal[0]?.id ?? "" });
  const { cargando, error, guardar } = useGuardar(onListo);
  return (
    <Modal titulo={division ? `Editar división ${division.nombre}` : "Nueva división"} error={error} cargando={cargando}
      puedeGuardar={!!f.nombre.trim() && !!f.sucursalId} onCerrar={onCerrar}
      onGuardar={() => division
        ? guardar(`/api/configuracion/divisiones/${division.id}`, "PATCH", { nombre: f.nombre, codigo: f.codigo || null })
        : guardar("/api/configuracion/divisiones", "POST", f)}>
      <Campo etiqueta="Sucursal">
        <select className="input" value={f.sucursalId} disabled={!!division} onChange={(e) => setF({ ...f, sucursalId: e.target.value })}>
          {opcionesSucursal.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Nombre"><input className="input" value={f.nombre} placeholder="PAGSA MAYOREO" onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
      <Campo etiqueta="Código (opcional)"><input className="input" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} /></Campo>
      {division && <p className="text-xs text-gray-500">La sucursal de una división no cambia: sus departamentos y planillas cuelgan de ella.</p>}
    </Modal>
  );
}

function FormDepartamento({ departamento, sucursales, divisiones, onCerrar, onListo }: {
  departamento: DepartamentoEstructura | null; sucursales: SucursalEstructura[]; divisiones: DivisionEstructura[]; onCerrar: () => void; onListo: () => void;
}) {
  const opcionesSucursal = sucursales.filter((s) => s.activa || s.id === departamento?.sucursalId);
  const [f, setF] = useState({
    nombre: departamento?.nombre ?? "",
    codigo: departamento?.codigo ?? "",
    sucursalId: departamento?.sucursalId ?? opcionesSucursal[0]?.id ?? "",
    divisionId: departamento?.divisionId ?? "",
    activo: departamento?.activo ?? true,
  });
  const { cargando, error, guardar } = useGuardar(onListo);
  const opciones = divisiones.filter((v) => v.sucursalId === f.sucursalId && (v.activa || v.id === f.divisionId));
  const exigeDivision = divisiones.some((v) => v.sucursalId === f.sucursalId && v.activa);
  const usaDivisiones = divisiones.length > 0 || opciones.length > 0;

  return (
    <Modal titulo={departamento ? `Editar ${departamento.nombre}` : "Nuevo departamento"} error={error} cargando={cargando}
      puedeGuardar={!!f.nombre.trim() && !!f.sucursalId && (!exigeDivision || !!f.divisionId)} onCerrar={onCerrar}
      onGuardar={() => departamento
        ? guardar(`/api/configuracion/departamentos/${departamento.id}`, "PATCH", {
          nombre: f.nombre, codigo: f.codigo || null, activo: f.activo, ...(usaDivisiones ? { divisionId: f.divisionId || null } : {}),
        })
        : guardar("/api/configuracion/departamentos", "POST", {
          nombre: f.nombre, codigo: f.codigo || undefined, sucursalId: f.sucursalId, ...(usaDivisiones ? { divisionId: f.divisionId || null } : {}),
        })}>
      <Campo etiqueta="Nombre"><input className="input" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
      <Campo etiqueta="Código (opcional)"><input className="input" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} /></Campo>
      <Campo etiqueta="Sucursal">
        <select className="input" value={f.sucursalId} disabled={!!departamento} onChange={(e) => setF({ ...f, sucursalId: e.target.value, divisionId: "" })}>
          {opcionesSucursal.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </Campo>
      {usaDivisiones && (
        <Campo etiqueta="División">
          <select className="input" value={f.divisionId} onChange={(e) => setF({ ...f, divisionId: e.target.value })}>
            <option value="">{exigeDivision ? "Elija la división" : "Sin división"}</option>
            {opciones.map((v) => <option key={v.id} value={v.id}>{v.nombre}{v.activa ? "" : " (inactiva)"}</option>)}
          </select>
        </Campo>
      )}
      {departamento && (
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Activo
        </label>
      )}
    </Modal>
  );
}

function FormPuesto({ puesto, departamentoId, departamentos, nombreSucursal, onCerrar, onListo }: {
  puesto: PuestoEstructura | null; departamentoId: string; departamentos: DepartamentoEstructura[]; nombreSucursal: Map<string, string>;
  onCerrar: () => void; onListo: (departamentoId: string) => void;
}) {
  const [f, setF] = useState({
    nombre: puesto?.nombre ?? "",
    descripcion: puesto?.descripcion ?? "",
    departamentoId,
    salarioMinimo: puesto?.salarioMinimo ? String(puesto.salarioMinimo) : "",
    salarioMaximo: puesto?.salarioMaximo ? String(puesto.salarioMaximo) : "",
  });
  const { cargando, error, guardar } = useGuardar(() => onListo(f.departamentoId));
  const minimo = Number(f.salarioMinimo || 0);
  const maximo = Number(f.salarioMaximo || 0);
  const rangoValido = minimo >= 0 && maximo >= 0 && rangoSalarialValido(minimo, maximo);
  const fijo = !!puesto && (puesto.empleados > 0 || puesto.coberturas > 0);
  const opciones = departamentos
    .filter((d) => d.activo || d.id === departamentoId)
    .map((d) => ({ id: d.id, etiqueta: etiquetaDepartamento({ nombre: d.nombre, sucursal: { nombre: nombreSucursal.get(d.sucursalId) ?? "" } }) }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
  const datos = { nombre: f.nombre, descripcion: f.descripcion || null, departamentoId: f.departamentoId, salarioMinimo: minimo, salarioMaximo: maximo };

  return (
    <Modal titulo={puesto ? `Editar ${puesto.nombre}` : "Nuevo puesto"} error={error} cargando={cargando}
      puedeGuardar={!!f.nombre.trim() && !!f.departamentoId && rangoValido} onCerrar={onCerrar}
      onGuardar={() => puesto ? guardar(`/api/configuracion/puestos/${puesto.id}`, "PATCH", datos) : guardar("/api/configuracion/puestos", "POST", datos)}>
      <Campo etiqueta="Departamento">
        <select className="input" value={f.departamentoId} disabled={fijo} onChange={(e) => setF({ ...f, departamentoId: e.target.value })}>
          {opciones.map((d) => <option key={d.id} value={d.id}>{d.etiqueta}</option>)}
        </select>
      </Campo>
      {fijo && <p className="text-xs text-gray-500">No se puede cambiar de departamento porque tiene empleados o cobertura de horarios.</p>}
      <Campo etiqueta="Nombre"><input className="input" value={f.nombre} placeholder="Cajero" onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
      <p className="text-xs text-gray-500">Para que los horarios puedan prestar personal entre sucursales, use el mismo nombre en todas.</p>
      <Campo etiqueta="Descripción (opcional)"><input className="input" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Salario mínimo (opcional)"><input className="input" type="number" min="0" step="0.01" value={f.salarioMinimo} onChange={(e) => setF({ ...f, salarioMinimo: e.target.value })} /></Campo>
        <Campo etiqueta="Salario máximo (opcional)"><input className="input" type="number" min="0" step="0.01" value={f.salarioMaximo} onChange={(e) => setF({ ...f, salarioMaximo: e.target.value })} /></Campo>
      </div>
      {!rangoValido && <p className="text-sm text-red-700" role="alert">El salario mínimo no puede ser mayor que el máximo, y ninguno puede ser negativo.</p>}
    </Modal>
  );
}

function FormCopiar({ departamento, puestosActivos, sucursales, divisiones, onCerrar, onListo }: {
  departamento: DepartamentoEstructura; puestosActivos: number; sucursales: SucursalEstructura[]; divisiones: DivisionEstructura[];
  onCerrar: () => void; onListo: (r: { departamentoId: string; sucursalId: string; mensaje: string }) => void;
}) {
  const origen = sucursales.find((s) => s.id === departamento.sucursalId);
  const destinos = sucursales.filter((s) => s.id !== departamento.sucursalId && s.activa && s.empresaId === origen?.empresaId);
  const [f, setF] = useState({ sucursalId: destinos[0]?.id ?? "", divisionId: "" });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opciones = divisiones.filter((v) => v.sucursalId === f.sucursalId && v.activa);

  async function copiar() {
    setCargando(true);
    const r = await fetch(`/api/configuracion/departamentos/${departamento.id}/copiar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sucursalId: f.sucursalId, divisionId: f.divisionId || null }),
    });
    const d = await r.json().catch(() => ({}));
    setCargando(false);
    if (!r.ok) {
      setError(d.error ?? "No se pudo copiar. Intente de nuevo.");
      return;
    }
    onListo({ departamentoId: d.departamentoId, sucursalId: f.sucursalId, mensaje: d.mensaje });
  }

  return (
    <Modal titulo={`Copiar ${departamento.nombre} a otra sucursal`} error={error} cargando={cargando} textoGuardar="Copiar"
      puedeGuardar={!!f.sucursalId && (opciones.length === 0 || !!f.divisionId)} onCerrar={onCerrar} onGuardar={copiar}>
      {destinos.length === 0 && <p className="text-sm text-gray-600">No hay otra sucursal activa de esta empresa a la cual copiarlo.</p>}
      {destinos.length > 0 && (
        <Campo etiqueta="Sucursal de destino">
          <select className="input" value={f.sucursalId} onChange={(e) => setF({ sucursalId: e.target.value, divisionId: "" })}>
            {destinos.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </Campo>
      )}
      {opciones.length > 0 && (
        <Campo etiqueta="División">
          <select className="input" value={f.divisionId} onChange={(e) => setF({ ...f, divisionId: e.target.value })}>
            <option value="">Elija la división</option>
            {opciones.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
        </Campo>
      )}
      <p className="text-xs text-gray-500">
        Se copian el departamento y {puestosActivos === 1 ? "su puesto activo" : `sus ${puestosActivos} puestos activos`}, con su rango salarial.
        Si allí ya existe, sólo se agregan los puestos que le falten. No se copian empleados, cobertura de horarios ni centro de costo.
      </p>
    </Modal>
  );
}
