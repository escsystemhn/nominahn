"use client";

/**
 * Configuración → Estructura organizacional: sucursales, divisiones y
 * departamentos, y la opción que habilita el nivel División
 * (Sucursal → División → Departamento). Con la opción apagada la pantalla se
 * ve como antes: sucursales y sus departamentos.
 */

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import EstadoBadge from "@/components/ui/EstadoBadge";
import { SIN_DIVISION } from "@/lib/organizacion/estructura";

export interface SucursalEstructura { id: string; nombre: string; codigo: string; direccion: string | null; activa: boolean }
export interface DivisionEstructura { id: string; nombre: string; codigo: string | null; activa: boolean; sucursalId: string; departamentos: number }
export interface DepartamentoEstructura { id: string; nombre: string; codigo: string | null; activo: boolean; sucursalId: string; divisionId: string | null; empleados: number }

interface Props {
  empresaId: string | null;
  sucursales: SucursalEstructura[];
  divisiones: DivisionEstructura[];
  departamentos: DepartamentoEstructura[];
  divisionesHabilitadas: boolean;
  /** `configuracion.editar`: sin él, la pantalla es de sólo lectura. */
  puedeEditar: boolean;
}

type Edicion =
  | { tipo: "sucursal" }
  | { tipo: "division"; division: DivisionEstructura | null }
  | { tipo: "departamento"; departamento: DepartamentoEstructura | null };

async function enviar(url: string, method: string, body?: unknown): Promise<string | null> {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return d.error ?? "No se pudo guardar. Intente de nuevo.";
}

export default function EstructuraOrganizacional({ empresaId, sucursales, divisiones, departamentos, divisionesHabilitadas, puedeEditar }: Props) {
  const router = useRouter();
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cambiandoOpcion, setCambiandoOpcion] = useState(false);
  // La casilla cambia al instante; si el servidor rechaza, vuelve atrás. Atada
  // sólo al valor del servidor, no se movía hasta recargar la página.
  const [opcion, setOpcion] = useState(divisionesHabilitadas);

  const nombreSucursal = useMemo(() => new Map(sucursales.map((s) => [s.id, s.nombre])), [sucursales]);

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

  return (
    <div className="space-y-6">
      {aviso && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{aviso}</div>}

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
          {puedeEditar && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEdicion({ tipo: "sucursal" })}>Nueva sucursal</button>}
        </div>
        <div className="panel overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Nombre</th><th>Código</th><th>Dirección</th><th>Estado</th></tr></thead>
            <tbody>
              {sucursales.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium text-gray-900">{s.nombre}</td>
                  <td className="font-mono text-xs">{s.codigo}</td>
                  <td>{s.direccion ?? "—"}</td>
                  <td><EstadoBadge valor={s.activa ? "ACTIVA" : "INACTIVA"} /></td>
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
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Departamentos ({departamentos.length})</h2>
          {puedeEditar && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEdicion({ tipo: "departamento", departamento: null })}>Nuevo departamento</button>}
        </div>
        <div className="panel overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Departamento</th><th>Código</th><th className="num">Empleados</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {arbol.filter((a) => a.grupos.some((g) => g.departamentos.length || g.division)).map(({ sucursal, grupos }) => (
                <Fragment key={sucursal.id}>
                  <tr><td colSpan={5} className="bg-gray-50 font-semibold text-gray-900">{sucursal.nombre}</td></tr>
                  {grupos.map((g) => (
                    <Fragment key={g.division?.id ?? "sin"}>
                      {g.titulo && <tr><td colSpan={5} className="pl-8 font-medium text-gray-800">{g.titulo}</td></tr>}
                      {g.departamentos.length === 0 && g.division && (
                        <tr><td colSpan={5} className="pl-14 text-xs text-gray-500">Sin departamentos asignados.</td></tr>
                      )}
                      {g.departamentos.map((d) => (
                        <tr key={d.id}>
                          <td className={g.titulo ? "pl-14" : "pl-8"}>{d.nombre}</td>
                          <td className="font-mono text-xs">{d.codigo ?? "—"}</td>
                          <td className="num">{d.empleados}</td>
                          <td><EstadoBadge valor={d.activo ? "ACTIVO" : "INACTIVO"} /></td>
                          <td className="text-right">
                            {puedeEditar && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdicion({ tipo: "departamento", departamento: d })}>Editar</button>}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {edicion?.tipo === "sucursal" && (
        <FormSucursal empresaId={empresaId} onCerrar={() => setEdicion(null)} onListo={() => { setEdicion(null); router.refresh(); }} />
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
    </div>
  );
}

// ─── Formularios ──────────────────────────────────────────────────────────────

function Modal({ titulo, error, cargando, puedeGuardar, onCerrar, onGuardar, children }: {
  titulo: string; error: string | null; cargando: boolean; puedeGuardar: boolean;
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
          <button type="button" className="btn btn-primary" disabled={cargando || !puedeGuardar} onClick={onGuardar}>{cargando ? "Guardando…" : "Guardar"}</button>
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

function FormSucursal({ empresaId, onCerrar, onListo }: { empresaId: string | null; onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({ nombre: "", codigo: "", direccion: "", telefono: "" });
  const { cargando, error, guardar } = useGuardar(onListo);
  return (
    <Modal titulo="Nueva sucursal" error={error} cargando={cargando} puedeGuardar={!!f.nombre.trim() && !!f.codigo.trim()} onCerrar={onCerrar}
      onGuardar={() => guardar("/api/configuracion/sucursales", "POST", { ...f, empresaId })}>
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
  const [f, setF] = useState({ nombre: division?.nombre ?? "", codigo: division?.codigo ?? "", sucursalId: division?.sucursalId ?? sucursales[0]?.id ?? "" });
  const { cargando, error, guardar } = useGuardar(onListo);
  return (
    <Modal titulo={division ? `Editar división ${division.nombre}` : "Nueva división"} error={error} cargando={cargando}
      puedeGuardar={!!f.nombre.trim() && !!f.sucursalId} onCerrar={onCerrar}
      onGuardar={() => division
        ? guardar(`/api/configuracion/divisiones/${division.id}`, "PATCH", { nombre: f.nombre, codigo: f.codigo || null })
        : guardar("/api/configuracion/divisiones", "POST", f)}>
      <Campo etiqueta="Sucursal">
        <select className="input" value={f.sucursalId} disabled={!!division} onChange={(e) => setF({ ...f, sucursalId: e.target.value })}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
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
  const [f, setF] = useState({
    nombre: departamento?.nombre ?? "",
    codigo: departamento?.codigo ?? "",
    sucursalId: departamento?.sucursalId ?? sucursales[0]?.id ?? "",
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
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
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
