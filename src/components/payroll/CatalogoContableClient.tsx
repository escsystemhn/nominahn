"use client";

/**
 * Plan de cuentas en árbol, como en Gestión360: código, nombre, tipo NIIF,
 * naturaleza y nivel (grupo o detalle), con alta, edición y baja en un modal.
 *
 * Las cuentas de sistema (sembradas) se renombran y desactivan pero no se
 * borran ni se recodifican; lo demás es del contador.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import {
  TIPOS,
  ETIQUETA_TIPO,
  ETIQUETA_NATURALEZA,
  NATURALEZA_NORMAL,
  construirArbol,
  validarCuenta,
  type CuentaCatalogo,
  type NodoCatalogo,
  type TipoCuenta,
  type Naturaleza,
} from "@/lib/payroll/catalogo-contable";

interface Props {
  cuentas: CuentaCatalogo[];
  puedeEditar: boolean;
  /** Catálogo importado de SAP Business One: se consulta, no se edita. */
  origenSap?: { importadoAt: string | null; cuentas: number | null } | null;
}

interface Formulario {
  codigo: string;
  nombre: string;
  descripcion: string;
  tipo: TipoCuenta;
  naturaleza: Naturaleza;
  padreCodigo: string;
  esDetalle: boolean;
  activa: boolean;
}

const VACIO: Formulario = {
  codigo: "", nombre: "", descripcion: "", tipo: "ACTIVO", naturaleza: "DEUDORA", padreCodigo: "", esDetalle: true, activa: true,
};

const IconoFlecha = ({ abierta }: { abierta: boolean }) => (
  <svg className={cn("h-3.5 w-3.5 transition-transform", abierta && "rotate-90")} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

function coincide(n: NodoCatalogo, q: string): boolean {
  if (!q) return true;
  return n.codigo.toLowerCase().includes(q) || n.nombre.toLowerCase().includes(q) || n.hijos.some((h) => coincide(h, q));
}

export default function CatalogoContableClient({ cuentas, puedeEditar: puedeEditarProp, origenSap = null }: Props) {
  // Con SAP mandando, nadie edita aquí: ni siquiera quien tiene el permiso.
  const puedeEditar = puedeEditarProp && !origenSap;
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [cerrados, setCerrados] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<{ modo: "nueva" | "editar"; id?: string; esSistema?: boolean } | null>(null);
  const [form, setForm] = useState<Formulario>(VACIO);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);

  const arbol = useMemo(() => construirArbol(cuentas), [cuentas]);
  const q = busqueda.trim().toLowerCase();
  const grupos = useMemo(() => cuentas.filter((c) => !c.esDetalle), [cuentas]);
  const totalDetalle = cuentas.filter((c) => c.esDetalle).length;

  const alternar = (codigo: string) =>
    setCerrados((prev) => {
      const s = new Set(prev);
      if (s.has(codigo)) s.delete(codigo);
      else s.add(codigo);
      return s;
    });

  function abrirNueva(padre?: CuentaCatalogo) {
    setError("");
    setForm({
      ...VACIO,
      tipo: padre?.tipo ?? "ACTIVO",
      naturaleza: padre ? NATURALEZA_NORMAL[padre.tipo] : "DEUDORA",
      padreCodigo: padre?.codigo ?? "",
      codigo: padre ? `${padre.codigo}` : "",
    });
    setModal({ modo: "nueva" });
  }

  function abrirEditar(c: CuentaCatalogo) {
    setError("");
    setForm({
      codigo: c.codigo,
      nombre: c.nombre,
      descripcion: c.descripcion ?? "",
      tipo: c.tipo,
      naturaleza: c.naturaleza,
      padreCodigo: c.padreCodigo ?? "",
      esDetalle: c.esDetalle,
      activa: c.activa,
    });
    setModal({ modo: "editar", id: c.id, esSistema: c.esSistema });
  }

  const set = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setForm((f) => ({ ...f, [k]: v }));

  function elegirTipo(t: TipoCuenta) {
    setForm((f) => ({ ...f, tipo: t, naturaleza: NATURALEZA_NORMAL[t] }));
  }

  async function guardar() {
    if (!modal) return;
    const errores = validarCuenta(
      { ...form, padreCodigo: form.padreCodigo || null },
      cuentas.filter((c) => !(modal.modo === "editar" && c.id === modal.id)).map((c) => ({ codigo: c.codigo, esDetalle: c.esDetalle }))
    );
    if (errores.length > 0) {
      setError(errores.join(" "));
      return;
    }
    setGuardando(true);
    setError("");
    try {
      const res = await fetch(modal.modo === "nueva" ? "/api/plan-cuentas" : `/api/plan-cuentas/${modal.id}`, {
        method: modal.modo === "nueva" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo: form.codigo.trim(),
          nombre: form.nombre.trim(),
          descripcion: form.descripcion.trim() || null,
          tipo: form.tipo,
          naturaleza: form.naturaleza,
          padreCodigo: form.padreCodigo || null,
          esDetalle: form.esDetalle,
          activa: form.activa,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "No se pudo guardar la cuenta.");
      setModal(null);
      setAviso({ tono: "ok", texto: modal.modo === "nueva" ? `Cuenta ${form.codigo.trim()} creada.` : `Cuenta ${form.codigo.trim()} actualizada.` });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(c: CuentaCatalogo) {
    if (!confirm(`¿Eliminar la cuenta ${c.codigo} ${c.nombre}?`)) return;
    setAviso(null);
    const res = await fetch(`/api/plan-cuentas/${c.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAviso({ tono: "error", texto: d.error ?? "No se pudo eliminar." });
      return;
    }
    setAviso({ tono: "ok", texto: `Cuenta ${c.codigo} eliminada.` });
    router.refresh();
  }

  const tipoElegido = TIPOS.find((t) => t.v === form.tipo);

  function Fila({ n }: { n: NodoCatalogo }) {
    if (!coincide(n, q)) return null;
    const abierta = q ? true : !cerrados.has(n.codigo);
    const tieneHijos = n.hijos.length > 0;
    return (
      <>
        <tr className={cn(!n.esDetalle && "bg-gray-50/70", !n.activa && "opacity-50")}>
          <td className="whitespace-nowrap" style={{ paddingLeft: `${16 + n.nivel * 20}px` }}>
            <div className="flex items-center gap-1.5">
              {tieneHijos ? (
                <button type="button" onClick={() => alternar(n.codigo)} className="text-gray-400 hover:text-gray-700" aria-label={abierta ? "Contraer" : "Expandir"}>
                  <IconoFlecha abierta={abierta} />
                </button>
              ) : (
                <span className="inline-block w-3.5" />
              )}
              <span className={cn("font-mono text-xs", n.esDetalle ? "text-gray-600" : "font-medium text-gray-900")}>{n.codigo}</span>
            </div>
          </td>
          <td className={cn(!n.esDetalle && "font-medium text-gray-900")}>
            {n.nombre}
            {n.esSistema && <span className="ml-2 text-[11px] text-gray-400">sistema</span>}
          </td>
          <td className="whitespace-nowrap">{ETIQUETA_TIPO[n.tipo]}</td>
          <td className="whitespace-nowrap text-gray-500">
            {ETIQUETA_NATURALEZA[n.naturaleza]}
            {NATURALEZA_NORMAL[n.tipo] !== n.naturaleza && <span className="ml-1 text-[11px] text-gray-400">contracuenta</span>}
          </td>
          <td className="whitespace-nowrap text-gray-500">{n.esDetalle ? "Detalle" : "Grupo"}</td>
          <td className="whitespace-nowrap text-right">
            {puedeEditar && (
              <div className="flex justify-end gap-3 text-xs font-medium">
                {!n.esDetalle && (
                  <button type="button" onClick={() => abrirNueva(n)} className="text-blue-600 hover:underline">
                    Subcuenta
                  </button>
                )}
                <button type="button" onClick={() => abrirEditar(n)} className="text-blue-600 hover:underline">
                  Editar
                </button>
                {!n.esSistema && (
                  <button type="button" onClick={() => eliminar(n)} className="text-red-700 hover:underline">
                    Eliminar
                  </button>
                )}
              </div>
            )}
          </td>
        </tr>
        {abierta && n.hijos.map((h) => <Fila key={h.id} n={h} />)}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan de cuentas"
        description={
          origenSap
            ? `Espejo del plan de cuentas de SAP Business One${origenSap.importadoAt ? `, importado el ${new Date(origenSap.importadoAt).toLocaleDateString("es-HN")}` : ""}. ${cuentas.length} cuentas, ${totalDetalle} de detalle: sólo esas reciben la partida de la nómina. Se actualiza desde Configuración, SAP - Conexión.`
            : `Catálogo contable de la empresa (NIIF para PYMES). ${cuentas.length} cuentas, ${totalDetalle} de detalle: sólo esas reciben la partida de la nómina.`
        }
        actions={
          <>
            <Link href="/plan-cuentas/configuracion" className="btn btn-secondary">
              Configuración contable
            </Link>
            {puedeEditar && (
              <button type="button" onClick={() => abrirNueva()} className="btn btn-primary">
                Nueva cuenta
              </button>
            )}
          </>
        }
      >
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por código o nombre"
          aria-label="Buscar cuenta"
          className="input max-w-sm"
        />
      </PageHeader>

      {aviso && (
        <div className={cn("rounded-lg border px-4 py-3 text-sm", aviso.tono === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800")}>
          {aviso.texto}
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Naturaleza</th>
                <th>Nivel</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {cuentas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center">
                    <p className="text-sm font-medium text-gray-900">El catálogo está vacío.</p>
                    <p className="mt-1 text-sm text-gray-500">Ejecute el seed para cargar el catálogo de ejemplo o cree la primera cuenta.</p>
                  </td>
                </tr>
              ) : (
                arbol.map((n) => <Fila key={n.id} n={n} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-blue-950/50 p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{modal.modo === "nueva" ? "Nueva cuenta contable" : "Editar cuenta contable"}</h2>
                <p className="text-xs text-gray-500">Estructura jerárquica según NIIF para PYMES.</p>
              </div>
              <button type="button" onClick={() => setModal(null)} className="btn btn-ghost btn-sm">
                Cerrar
              </button>
            </div>

            <div className="space-y-6 overflow-y-auto px-6 py-5">
              {error && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {error}
                </div>
              )}

              <section>
                <h3 className="text-sm font-semibold text-gray-900">Clasificación NIIF</h3>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {TIPOS.map((t) => (
                    <button
                      key={t.v}
                      type="button"
                      disabled={modal.esSistema}
                      onClick={() => elegirTipo(t.v)}
                      className={cn(
                        "rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60",
                        form.tipo === t.v ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                      )}
                    >
                      <div className={cn("text-sm font-semibold", form.tipo === t.v ? "text-blue-800" : "text-gray-800")}>{t.l}</div>
                      <div className="mt-0.5 font-mono text-xs text-gray-400">{t.prefijo}</div>
                    </button>
                  ))}
                </div>
                {tipoElegido && <p className="mt-2 text-xs text-blue-700">{tipoElegido.pista}</p>}
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Datos de la cuenta</h3>
                <div>
                  <label htmlFor="cc-padre" className="mb-1 block text-sm font-medium text-gray-700">
                    Cuenta madre <span className="font-normal text-gray-400">(opcional)</span>
                  </label>
                  <select
                    id="cc-padre"
                    value={form.padreCodigo}
                    disabled={modal.esSistema}
                    onChange={(e) => set("padreCodigo", e.target.value)}
                    className="input"
                  >
                    <option value="">Sin cuenta madre (nivel 1)</option>
                    {grupos
                      .filter((g) => !(modal.modo === "editar" && g.id === modal.id))
                      .map((g) => (
                        <option key={g.id} value={g.codigo}>
                          {g.codigo} {g.nombre}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <div>
                    <label htmlFor="cc-codigo" className="mb-1 block text-sm font-medium text-gray-700">
                      Código
                    </label>
                    <input
                      id="cc-codigo"
                      value={form.codigo}
                      disabled={modal.esSistema}
                      onChange={(e) => set("codigo", e.target.value)}
                      placeholder="610206"
                      className="input font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="cc-nombre" className="mb-1 block text-sm font-medium text-gray-700">
                      Nombre
                    </label>
                    <input id="cc-nombre" value={form.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Nombre de la cuenta" className="input" />
                  </div>
                </div>
                <div>
                  <label htmlFor="cc-desc" className="mb-1 block text-sm font-medium text-gray-700">
                    Descripción <span className="font-normal text-gray-400">(opcional)</span>
                  </label>
                  <textarea id="cc-desc" rows={2} value={form.descripcion} onChange={(e) => set("descripcion", e.target.value)} placeholder="Para qué se usa esta cuenta" className="input h-auto resize-none py-2" />
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Parámetros contables</h3>
                <div>
                  <p className="mb-2 text-sm font-medium text-gray-700">Naturaleza</p>
                  <div className="grid grid-cols-2 gap-3">
                    {(["DEUDORA", "ACREEDORA"] as const).map((n) => (
                      <label
                        key={n}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3",
                          form.naturaleza === n ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300",
                          modal.esSistema && "cursor-default opacity-60"
                        )}
                      >
                        <input type="radio" name="naturaleza" value={n} disabled={modal.esSistema} checked={form.naturaleza === n} onChange={() => set("naturaleza", n)} className="accent-blue-700" />
                        <div>
                          <div className="text-sm font-semibold text-gray-800">{ETIQUETA_NATURALEZA[n]}</div>
                          <div className="text-xs text-gray-500">Saldo normal en el {n === "DEUDORA" ? "Debe" : "Haber"}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                  {tipoElegido && (
                    <p className="mt-2 text-xs text-gray-500">
                      Para una cuenta de {tipoElegido.l.toLowerCase()} lo normal es {ETIQUETA_NATURALEZA[tipoElegido.naturaleza].toLowerCase()}
                      {form.naturaleza !== tipoElegido.naturaleza ? "; con la contraria queda como contracuenta." : "."}
                    </p>
                  )}
                </div>
                <label className={cn("flex items-start gap-3", modal.esSistema ? "cursor-default opacity-60" : "cursor-pointer")}>
                  <input type="checkbox" disabled={modal.esSistema} checked={form.esDetalle} onChange={(e) => set("esDetalle", e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-700" />
                  <div>
                    <div className="text-sm font-semibold text-gray-800">Permite movimiento (cuenta de detalle)</div>
                    <div className="text-xs text-gray-500">Sólo una cuenta de detalle recibe asientos. Las de grupo agrupan subcuentas.</div>
                  </div>
                </label>
                {modal.modo === "editar" && (
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={form.activa} onChange={(e) => set("activa", e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-700" />
                    <div>
                      <div className="text-sm font-semibold text-gray-800">Cuenta activa</div>
                      <div className="text-xs text-gray-500">Una cuenta inactiva no se ofrece en Configuración contable.</div>
                    </div>
                  </label>
                )}
              </section>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
              <button type="button" onClick={() => setModal(null)} className="btn btn-secondary">
                Cancelar
              </button>
              <button type="button" onClick={guardar} disabled={guardando} className="btn btn-primary">
                {guardando ? "Guardando" : modal.modo === "nueva" ? "Crear cuenta" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
