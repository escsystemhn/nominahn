"use client";

/**
 * Configuración → Estructura organizacional: sucursales, divisiones,
 * departamentos y los puestos de cada departamento, y la opción que habilita el
 * nivel División (Sucursal → División → Departamento). Con la opción apagada la
 * pantalla no muestra divisiones: sucursales, departamentos y puestos.
 */

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import EstadoBadge from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";
import { Modal, Campo } from "@/components/ui/ModalForm";
import LogoSucursalForm, { urlLogoSucursal } from "./LogoSucursalForm";
import { aplicarCambioOpciones, etiquetaDepartamento, etiquetasNiveles, type NivelesEstructura, type OpcionesOrganizacion } from "@/lib/organizacion/estructura";
import { claveNombre, divisionesSinDepartamento, rangoSalarialValido } from "@/lib/organizacion/puestos";
import { formatCurrency } from "@/lib/utils";

export interface SucursalEstructura { id: string; empresaId: string; nombre: string; codigo: string; direccion: string | null; telefono: string | null; descripcion: string | null; activa: boolean; logoVersion: number | null }
export interface DivisionEstructura { id: string; nombre: string; codigo: string | null; rtn: string | null; activa: boolean; sucursalId: string; departamentos: number }
export interface DepartamentoEstructura { id: string; nombre: string; codigo: string | null; activo: boolean; sucursalId: string; divisionId: string | null; empleados: number }
export interface PuestoEstructura {
  id: string; nombre: string; descripcion: string | null; salarioMinimo: number; salarioMaximo: number; activo: boolean;
  departamentoId: string; empleados: number; competencias: number; coberturas: number;
}

interface Props {
  empresaId: string | null;
  empresaNombre: string | null;
  empresaRtn: string | null;
  sucursales: SucursalEstructura[];
  divisiones: DivisionEstructura[];
  departamentos: DepartamentoEstructura[];
  puestos: PuestoEstructura[];
  divisionesHabilitadas: boolean;
  jerarquiaHabilitada: boolean;
  /** `configuracion.editar`: sin él, la pantalla es de sólo lectura. */
  puedeEditar: boolean;
}

type Edicion =
  | { tipo: "sucursal"; sucursal: SucursalEstructura | null }
  | { tipo: "logo"; sucursal: SucursalEstructura }
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

export default function EstructuraOrganizacional({ empresaId, empresaNombre, empresaRtn, sucursales, divisiones, departamentos, puestos, divisionesHabilitadas, jerarquiaHabilitada, puedeEditar }: Props) {
  const router = useRouter();
  const { confirmar } = useAvisos();
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [cambiandoOpcion, setCambiandoOpcion] = useState(false);
  // La casilla cambia al instante; si el servidor rechaza, vuelve atrás. Atada
  // sólo al valor del servidor, no se movía hasta recargar la página.
  const [opciones, setOpciones] = useState<OpcionesOrganizacion>({ divisiones: divisionesHabilitadas, jerarquia: jerarquiaHabilitada });
  const niveles = etiquetasNiveles(jerarquiaHabilitada);
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

  async function cambiarOpcion(cambio: Partial<OpcionesOrganizacion>) {
    if (cambio.divisiones === false && divisiones.length > 0 &&
      !(await confirmar({
        titulo: "¿Desactivar las divisiones?",
        detalle: `Las ${divisiones.length} división(es) y la división de cada departamento se conservan, pero dejarán de mostrarse y los reportes volverán a agrupar Sucursal → Departamento.${opciones.jerarquia ? " La jerarquía de nómina también se desactivará." : ""}`,
        accion: "Desactivar",
      }))) return;
    const anteriores = opciones;
    setOpciones(aplicarCambioOpciones(opciones, cambio));
    setCambiandoOpcion(true);
    const error = await enviar("/api/configuracion/estructura", "PUT", cambio);
    setCambiandoOpcion(false);
    setAviso(error);
    if (error) setOpciones(anteriores);
    else router.refresh();
  }

  async function alternarSucursal(s: SucursalEstructura) {
    if (s.activa && !(await confirmar({
      titulo: `¿Desactivar la sucursal «${s.nombre}»?`,
      detalle: "Dejará de ofrecerse al crear empleados, planillas y horarios. Su historial se conserva.",
      accion: "Desactivar",
    }))) return;
    const error = await enviar(`/api/configuracion/sucursales/${s.id}`, "PATCH", { activa: !s.activa });
    setAviso(error);
    if (!error) router.refresh();
  }

  async function borrarDivision(v: DivisionEstructura) {
    if (!(await confirmar({ titulo: `¿Eliminar la división «${v.nombre}»?`, accion: "Eliminar", peligro: true }))) return;
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
    if (p.activo && !(await confirmar({
      titulo: `¿Desactivar el puesto «${p.nombre}»?`,
      detalle: "Dejará de ofrecerse al asignar puestos. Quienes ya lo tienen lo conservan.",
      accion: "Desactivar",
    }))) return;
    const error = await enviar(`/api/configuracion/puestos/${p.id}`, "PATCH", { activo: !p.activo });
    setAviso(error);
    if (!error) router.refresh();
  }

  async function borrarPuesto(p: PuestoEstructura) {
    if (!(await confirmar({ titulo: `¿Eliminar el puesto «${p.nombre}»?`, accion: "Eliminar", peligro: true }))) return;
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
    if (sueltos.length) grupos.push({ division: null, titulo: grupos.length ? etiquetasNiveles(jerarquiaHabilitada).sinDivision : null, departamentos: sueltos });
    return { sucursal: s, grupos };
  }), [sucursales, divisiones, departamentos, divisionesHabilitadas, jerarquiaHabilitada]);

  const visibles = arbol.filter((a) => (!filtroSucursal || a.sucursal.id === filtroSucursal) && a.grupos.some((g) => g.departamentos.length || g.division));

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
              checked={opciones.divisiones}
              disabled={!puedeEditar || cambiandoOpcion}
              onChange={(e) => cambiarOpcion({ divisiones: e.target.checked })}
            />
            Usar divisiones
          </label>
        </div>
        <div className="mt-5 flex flex-wrap items-start justify-between gap-4 border-t border-gray-200 pt-5">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-gray-900">Jerarquía de nómina</h2>
            <p className="mt-1 text-sm text-gray-600">
              Agrega al menú Nómina una vista en árbol: Frecuencia → Grupo → Empresa → Departamento → Empleados, con cambio
              rápido entre quincenal y mensual. Cada sucursal funciona como grupo de nómina y cada división como empresa, con
              su RTN. Al activarla se activa también el nivel División.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-800">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300"
              checked={opciones.jerarquia}
              disabled={!puedeEditar || cambiandoOpcion}
              onChange={(e) => cambiarOpcion({ jerarquia: e.target.checked })}
            />
            Usar jerarquía de nómina
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{niveles.sucursales} ({sucursales.length})</h2>
          {puedeEditar && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdicion({ tipo: "sucursal", sucursal: null })}>{niveles.nuevaSucursal}</button>}
        </div>
        <div className="panel overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Logo</th><th>Nombre</th><th>Código</th><th>Dirección</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {sucursales.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.logoVersion
                      // eslint-disable-next-line @next/next/no-img-element -- imagen privada, servida tras la sesión: el optimizador de Next no aplica.
                      ? <img src={urlLogoSucursal(s.id, s.logoVersion)} alt={`Logo de ${s.nombre}`} className="h-8 max-w-24 object-contain" />
                      : <span className="text-xs text-gray-500">Sin logo</span>}
                  </td>
                  <td className="font-medium text-gray-900">{s.nombre}</td>
                  <td className="font-mono text-xs">{s.codigo}</td>
                  <td>{s.direccion ?? "—"}</td>
                  <td><EstadoBadge valor={s.activa ? "ACTIVA" : "INACTIVA"} /></td>
                  <td className="whitespace-nowrap text-right">
                    {puedeEditar && (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdicion({ tipo: "logo", sucursal: s })}>{s.logoVersion ? "Cambiar logo" : "Agregar logo"}</button>
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
            <h2 className="text-base font-semibold text-gray-900">{niveles.divisiones} ({divisiones.length})</h2>
            {puedeEditar && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdicion({ tipo: "division", division: null })}>{niveles.nuevaDivision}</button>}
          </div>
          <div className="panel overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{niveles.sucursal}</th><th>{niveles.division}</th><th>Código</th>{jerarquiaHabilitada && <th>RTN</th>}<th className="num">Departamentos</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {divisiones.length === 0 && (
                  <tr><td colSpan={jerarquiaHabilitada ? 7 : 6}><EstadoVacio titulo={`Todavía no hay ${niveles.divisiones.toLowerCase()}.`} detalle="Cree la primera y luego asígnela a sus departamentos." /></td></tr>
                )}
                {divisiones.map((v) => (
                  <tr key={v.id}>
                    <td>{nombreSucursal.get(v.sucursalId)}</td>
                    <td className="font-medium text-gray-900">{v.nombre}</td>
                    <td className="font-mono text-xs">{v.codigo ?? "—"}</td>
                    {jerarquiaHabilitada && <td className="font-mono text-xs">{v.rtn ?? "—"}</td>}
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
              <select className="input w-auto" aria-label={`Filtrar por ${niveles.sucursal.toLowerCase()}`} value={filtroSucursal} onChange={(e) => setFiltroSucursal(e.target.value)}>
                <option value="">{niveles.todasSucursales}</option>
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            )}
            {puedeEditar && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdicion({ tipo: "departamento", departamento: null })}>Nuevo departamento</button>}
          </div>
        </div>
        {/* Aquí y no arriba de la página: se crea desde esta sección y el mensaje debe quedar a la vista. */}
        {exito && <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800" role="status">{exito}</div>}
        <div className="panel overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Departamento</th><th>Código</th><th className="num">Puestos</th><th className="num">Empleados</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {visibles.length === 0 && (
                <tr><td colSpan={6}><EstadoVacio titulo={`Todavía no hay departamentos${filtroSucursal ? " en esta sucursal" : ""}.`} detalle={puedeEditar ? "Cree el primero con «Nuevo departamento»." : undefined} /></td></tr>
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
                                    {d.activo && destinosDeCopia(d, sucursales, divisionesHabilitadas ? divisiones : []).length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setExito(null); setEdicion({ tipo: "copiar", departamento: d }); }}>Copiar</button>}
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
                                      <thead><tr><th>Puesto</th><th>Rango salarial</th><th className="num">Empleados</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
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
        <FormSucursal sucursal={edicion.sucursal} empresaId={empresaId} conJerarquia={jerarquiaHabilitada} onCerrar={() => setEdicion(null)} onListo={() => { setEdicion(null); router.refresh(); }} />
      )}
      {edicion?.tipo === "logo" && (
        <LogoSucursalForm
          sucursal={edicion.sucursal}
          empresaNombre={empresaNombre}
          empresaRtn={empresaRtn}
          onCerrar={() => setEdicion(null)}
          onListo={() => { setEdicion(null); router.refresh(); }}
        />
      )}
      {edicion?.tipo === "division" && (
        <FormDivision division={edicion.division} sucursales={sucursales} conJerarquia={jerarquiaHabilitada} onCerrar={() => setEdicion(null)} onListo={() => { setEdicion(null); router.refresh(); }} />
      )}
      {edicion?.tipo === "departamento" && (
        <FormDepartamento
          niveles={niveles}
          departamento={edicion.departamento}
          sucursales={sucursales}
          divisiones={divisionesHabilitadas ? divisiones : []}
          departamentos={departamentos}
          onCerrar={() => setEdicion(null)}
          onListo={(mensaje) => { setEdicion(null); setExito(mensaje ?? null); router.refresh(); }}
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
          niveles={niveles}
          departamento={edicion.departamento}
          puestosActivos={(puestosPorDepartamento.get(edicion.departamento.id) ?? []).filter((p) => p.activo).length}
          sucursales={sucursales}
          divisiones={divisionesHabilitadas ? divisiones : []}
          departamentos={departamentos}
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

function FormSucursal({ sucursal, empresaId, conJerarquia, onCerrar, onListo }: { sucursal: SucursalEstructura | null; empresaId: string | null; conJerarquia: boolean; onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({ nombre: sucursal?.nombre ?? "", codigo: sucursal?.codigo ?? "", direccion: sucursal?.direccion ?? "", telefono: sucursal?.telefono ?? "", descripcion: sucursal?.descripcion ?? "" });
  const { cargando, error, guardar } = useGuardar(onListo);
  return (
    <Modal titulo={sucursal ? `Editar ${sucursal.nombre}` : etiquetasNiveles(conJerarquia).nuevaSucursal} error={error} cargando={cargando} puedeGuardar={!!f.nombre.trim() && !!f.codigo.trim()} onCerrar={onCerrar}
      onGuardar={() => sucursal
        ? guardar(`/api/configuracion/sucursales/${sucursal.id}`, "PATCH", { nombre: f.nombre, codigo: f.codigo, direccion: f.direccion || null, telefono: f.telefono || null, ...(conJerarquia ? { descripcion: f.descripcion || null } : {}) })
        : guardar("/api/configuracion/sucursales", "POST", { ...f, empresaId })}>
      <Campo etiqueta="Nombre"><input className="input" value={f.nombre} placeholder={conJerarquia ? "Nómina Confidencial" : undefined} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
      <Campo etiqueta="Código"><input className="input" value={f.codigo} placeholder="SPS-002" onChange={(e) => setF({ ...f, codigo: e.target.value })} /></Campo>
      {conJerarquia && <Campo etiqueta="Descripción (opcional)"><input className="input" value={f.descripcion} maxLength={300} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Campo>}
      <Campo etiqueta="Dirección"><input className="input" value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></Campo>
      <Campo etiqueta="Teléfono"><input className="input" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></Campo>
    </Modal>
  );
}

function FormDivision({ division, sucursales, conJerarquia, onCerrar, onListo }: {
  division: DivisionEstructura | null; sucursales: SucursalEstructura[]; conJerarquia: boolean; onCerrar: () => void; onListo: () => void;
}) {
  const niveles = etiquetasNiveles(conJerarquia);
  const opcionesSucursal = sucursales.filter((s) => s.activa || s.id === division?.sucursalId);
  const [f, setF] = useState({ nombre: division?.nombre ?? "", codigo: division?.codigo ?? "", rtn: division?.rtn ?? "", sucursalId: division?.sucursalId ?? opcionesSucursal[0]?.id ?? "" });
  const { cargando, error, guardar } = useGuardar(onListo);
  const digitosRtn = f.rtn.replace(/\D/g, "").length;
  const rtnValido = /^[\d\s-]*$/.test(f.rtn) && (digitosRtn === 0 || digitosRtn === 14);
  const rtn = conJerarquia ? { rtn: f.rtn || null } : {};
  return (
    <Modal titulo={division ? `Editar ${niveles.division.toLowerCase()} ${division.nombre}` : niveles.nuevaDivision} error={error} cargando={cargando}
      puedeGuardar={!!f.nombre.trim() && !!f.sucursalId && rtnValido} onCerrar={onCerrar}
      onGuardar={() => division
        ? guardar(`/api/configuracion/divisiones/${division.id}`, "PATCH", { nombre: f.nombre, codigo: f.codigo || null, ...rtn })
        : guardar("/api/configuracion/divisiones", "POST", { nombre: f.nombre, codigo: f.codigo, sucursalId: f.sucursalId, ...rtn })}>
      <Campo etiqueta={niveles.sucursal}>
        <select className="input" value={f.sucursalId} disabled={!!division} onChange={(e) => setF({ ...f, sucursalId: e.target.value })}>
          {opcionesSucursal.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Nombre"><input className="input" value={f.nombre} placeholder={conJerarquia ? "PAGSA" : "PAGSA MAYOREO"} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
      <Campo etiqueta="Código (opcional)"><input className="input" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} /></Campo>
      {conJerarquia && <Campo etiqueta="RTN (opcional)"><input className="input" inputMode="numeric" value={f.rtn} onChange={(e) => setF({ ...f, rtn: e.target.value })} /></Campo>}
      {!rtnValido && <p className="text-sm text-red-700" role="alert">El RTN debe tener 14 dígitos. Puede usar guiones o espacios.</p>}
      {division && <p className="text-xs text-gray-500">{`${conJerarquia ? "El grupo de una empresa" : "La sucursal de una división"} no cambia: sus departamentos y planillas cuelgan de ${conJerarquia ? "él" : "ella"}.`}</p>}
    </Modal>
  );
}

/** Las divisiones a marcar al crear o copiar un departamento. */
function CasillasDivisiones({ titulo, filas, marcadas, onCambiar, nota }: {
  titulo: string;
  filas: Array<{ id: string; nombre: string; bloqueada: boolean; estado?: string }>;
  marcadas: ReadonlySet<string>;
  onCambiar: (marcadas: ReadonlySet<string>) => void;
  nota: string;
}) {
  const libres = filas.filter((f) => !f.bloqueada);
  const todas = libres.length > 0 && libres.every((f) => marcadas.has(f.id));

  function alternar(id: string) {
    const nuevo = new Set(marcadas);
    if (!nuevo.delete(id)) nuevo.add(id);
    onCambiar(nuevo);
  }

  return (
    <div role="group" aria-labelledby="departamento-destinos" className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <span id="departamento-destinos" className="text-sm font-medium text-gray-800">{titulo}</span>
        {libres.length > 1 && (
          <button type="button" className="-my-1 py-1 text-sm font-medium text-blue-700 hover:underline" onClick={() => onCambiar(new Set(todas ? [] : libres.map((f) => f.id)))}>
            {todas ? "Quitar todas" : "Marcar todas"}
          </button>
        )}
      </div>
      <div className="mt-1 max-h-52 divide-y divide-gray-200 overflow-y-auto rounded-lg border border-gray-300">
        {filas.map((f) => (
          <label key={f.id} className={`flex min-h-11 items-center gap-2.5 px-3 text-sm lg:min-h-9 ${f.bloqueada ? "text-gray-500" : "cursor-pointer text-gray-900 hover:bg-gray-50"}`}>
            <input type="checkbox" className="h-4 w-4 shrink-0 rounded border-gray-300" disabled={f.bloqueada} checked={!f.bloqueada && marcadas.has(f.id)} onChange={() => alternar(f.id)} />
            <span className="min-w-0 flex-1 truncate">{f.nombre}</span>
            {f.estado && <span className="shrink-0 text-xs text-gray-500">{f.estado}</span>}
          </label>
        ))}
      </div>
      {nota && <p className="mt-1.5 text-xs text-gray-500" aria-live="polite">{nota}</p>}
    </div>
  );
}

function FormDepartamento({ departamento, sucursales, divisiones, departamentos, niveles, onCerrar, onListo }: {
  departamento: DepartamentoEstructura | null; sucursales: SucursalEstructura[]; divisiones: DivisionEstructura[]; departamentos: DepartamentoEstructura[];
  niveles: NivelesEstructura; onCerrar: () => void; onListo: (mensaje?: string) => void;
}) {
  const opcionesSucursal = sucursales.filter((s) => s.activa || s.id === departamento?.sucursalId);
  const [f, setF] = useState({
    nombre: departamento?.nombre ?? "",
    codigo: departamento?.codigo ?? "",
    sucursalId: departamento?.sucursalId ?? opcionesSucursal[0]?.id ?? "",
    divisionId: departamento?.divisionId ?? "",
    activo: departamento?.activo ?? true,
  });
  // Con una sola no hay nada que elegir: viene marcada.
  const marcadasDe = (sucursalId: string): ReadonlySet<string> => {
    const activas = divisiones.filter((v) => v.sucursalId === sucursalId && v.activa);
    return new Set(activas.length === 1 ? [activas[0].id] : []);
  };
  const [marcadas, setMarcadas] = useState(() => marcadasDe(f.sucursalId));
  const opciones = divisiones.filter((v) => v.sucursalId === f.sucursalId && (v.activa || v.id === f.divisionId));
  const exigeDivision = divisiones.some((v) => v.sucursalId === f.sucursalId && v.activa);
  const usaDivisiones = divisiones.length > 0 || opciones.length > 0;

  // Al crear se marcan varias; un departamento ya creado es de una sola.
  const conCasillas = !departamento && opciones.length > 0;
  const ocupadas = new Set(divisionesSinDepartamento(f.nombre, opciones.map((v) => v.id), departamentos.filter((d) => d.sucursalId === f.sucursalId)).omitir);
  const libres = opciones.filter((v) => !ocupadas.has(v.id));
  const elegidas = libres.filter((v) => marcadas.has(v.id));
  const unidad = niveles.division.toLowerCase();
  const plural = niveles.divisiones.toLowerCase();
  const nota = libres.length === 0
    ? `«${f.nombre.trim()}» ya existe en todas. Use otro nombre.`
    : elegidas.length === 0
      ? `Marque al menos una ${unidad}.`
      : elegidas.length === 1
        ? `Se creará en ${elegidas[0].nombre}.`
        : `Cada ${unidad} tendrá su propio departamento, con sus puestos y empleados.`;

  const { cargando, error, guardar } = useGuardar(() =>
    onListo(conCasillas && elegidas.length > 1 ? `Se creó «${f.nombre.trim()}» en ${elegidas.length} ${plural}: ${elegidas.map((v) => v.nombre).join(", ")}.` : undefined)
  );

  return (
    <Modal titulo={departamento ? `Editar ${departamento.nombre}` : "Nuevo departamento"} error={error} cargando={cargando}
      textoGuardar={conCasillas ? (elegidas.length > 1 ? `Crear en ${elegidas.length} ${plural}` : "Crear departamento") : undefined}
      puedeGuardar={!!f.nombre.trim() && !!f.sucursalId && (conCasillas ? elegidas.length > 0 : !exigeDivision || !!f.divisionId)} onCerrar={onCerrar}
      onGuardar={() => departamento
        ? guardar(`/api/configuracion/departamentos/${departamento.id}`, "PATCH", {
          nombre: f.nombre, codigo: f.codigo || null, activo: f.activo, ...(usaDivisiones ? { divisionId: f.divisionId || null } : {}),
        })
        : guardar("/api/configuracion/departamentos", "POST", {
          nombre: f.nombre, codigo: f.codigo || undefined, sucursalId: f.sucursalId,
          ...(conCasillas ? { divisionIds: elegidas.map((v) => v.id) } : usaDivisiones ? { divisionId: f.divisionId || null } : {}),
        })}>
      <Campo etiqueta="Nombre"><input className="input" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
      <Campo etiqueta="Código (opcional)"><input className="input" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} /></Campo>
      <Campo etiqueta={niveles.sucursal}>
        <select className="input" value={f.sucursalId} disabled={!!departamento} onChange={(e) => { setF({ ...f, sucursalId: e.target.value, divisionId: "" }); setMarcadas(marcadasDe(e.target.value)); }}>
          {opcionesSucursal.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </Campo>
      {conCasillas && (
        <CasillasDivisiones
          titulo={niveles.divisiones}
          filas={opciones.map((v) => ({ id: v.id, nombre: v.nombre, bloqueada: ocupadas.has(v.id), estado: ocupadas.has(v.id) ? "Ya existe" : undefined }))}
          marcadas={marcadas}
          onCambiar={setMarcadas}
          nota={nota}
        />
      )}
      {usaDivisiones && !conCasillas && (
        <Campo etiqueta={niveles.division}>
          <select className="input" value={f.divisionId} onChange={(e) => setF({ ...f, divisionId: e.target.value })}>
            <option value="">{exigeDivision ? `Elija la ${niveles.division.toLowerCase()}` : niveles.sinDivision}</option>
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

/** A dónde se puede copiar: otras sucursales de la empresa, o la propia si tiene otras divisiones activas. */
function destinosDeCopia(d: DepartamentoEstructura, sucursales: SucursalEstructura[], divisiones: DivisionEstructura[]) {
  const origen = sucursales.find((s) => s.id === d.sucursalId);
  return sucursales.filter((s) => s.activa && s.empresaId === origen?.empresaId &&
    (s.id !== d.sucursalId || divisiones.some((v) => v.sucursalId === s.id && v.activa && v.id !== d.divisionId)));
}

function FormCopiar({ departamento, puestosActivos, sucursales, divisiones, departamentos, niveles, onCerrar, onListo }: {
  departamento: DepartamentoEstructura; puestosActivos: number; sucursales: SucursalEstructura[]; divisiones: DivisionEstructura[]; departamentos: DepartamentoEstructura[]; niveles: NivelesEstructura;
  onCerrar: () => void; onListo: (r: { departamentoId: string; sucursalId: string; mensaje: string }) => void;
}) {
  const destinos = destinosDeCopia(departamento, sucursales, divisiones);
  const opcionesDe = (id: string) => divisiones.filter((v) => v.sucursalId === id && v.activa && v.id !== departamento.divisionId);
  // Con una sola no hay nada que elegir: viene marcada.
  const marcadasDe = (id: string): ReadonlySet<string> => {
    const o = opcionesDe(id);
    return new Set(o.length === 1 ? [o[0].id] : []);
  };
  // Lo habitual es repartirlo entre las otras empresas de su propio grupo.
  const [sucursalId, setSucursalId] = useState(() => destinos.find((s) => s.id === departamento.sucursalId)?.id ?? destinos[0]?.id ?? "");
  const [marcadas, setMarcadas] = useState(() => marcadasDe(sucursalId));
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opciones = opcionesDe(sucursalId);
  const clave = claveNombre(departamento.nombre);
  const filas = opciones.map((v) => {
    const ya = departamentos.find((d) => d.divisionId === v.id && claveNombre(d.nombre) === clave);
    return { id: v.id, nombre: v.nombre, bloqueada: !!ya && !ya.activo, estado: ya ? (ya.activo ? "Ya existe" : "Inactivo") : undefined };
  });
  const elegidas = filas.filter((f) => !f.bloqueada && marcadas.has(f.id));

  async function copiar() {
    setCargando(true);
    const r = await fetch(`/api/configuracion/departamentos/${departamento.id}/copiar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sucursalId, ...(opciones.length ? { divisionIds: elegidas.map((f) => f.id) } : { divisionId: null }) }),
    });
    const d = await r.json().catch(() => ({}));
    setCargando(false);
    if (!r.ok) {
      setError(d.error ?? "No se pudo copiar. Intente de nuevo.");
      return;
    }
    onListo({ departamentoId: d.departamentoId, sucursalId, mensaje: d.mensaje });
  }

  return (
    <Modal titulo={`Copiar ${departamento.nombre}`} error={error} cargando={cargando}
      textoGuardar={elegidas.length > 1 ? `Copiar a ${elegidas.length} ${niveles.divisiones.toLowerCase()}` : "Copiar"}
      puedeGuardar={!!sucursalId && (opciones.length === 0 || elegidas.length > 0)} onCerrar={onCerrar} onGuardar={copiar}>
      {destinos.length > 1 && (
        <Campo etiqueta={`${niveles.sucursal} de destino`}>
          <select className="input" value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); setMarcadas(marcadasDe(e.target.value)); }}>
            {destinos.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </Campo>
      )}
      {opciones.length > 0 && (
        <CasillasDivisiones
          titulo={niveles.divisiones}
          filas={filas}
          marcadas={marcadas}
          onCambiar={setMarcadas}
          nota={elegidas.length === 0 ? `Marque al menos una ${niveles.division.toLowerCase()}.` : ""}
        />
      )}
      <p className="text-xs text-gray-500">
        Se copian el departamento y {puestosActivos === 1 ? "su puesto activo" : `sus ${puestosActivos} puestos activos`}, con su rango salarial.
        Donde ya existe, sólo se agregan los puestos que le falten. No se copian empleados, cobertura de horarios ni centro de costo.
      </p>
    </Modal>
  );
}
