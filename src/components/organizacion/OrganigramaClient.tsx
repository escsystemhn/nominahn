"use client";

/**
 * Organigrama de la línea de reporte.
 *
 * DECISIONES DE DIBUJO, cada una con su motivo:
 *
 * · ÁRBOL VERTICAL CON SANGRÍA, no cajas conectadas por líneas. Un organigrama
 *   clásico se lee bien con 20 personas y se vuelve un mapa ilegible con 200;
 *   la sangría escala, se navega con teclado y funciona en un teléfono.
 *
 * · LAS RAMAS SE PLIEGAN y el estado se conserva mientras dure la pantalla: en
 *   una plantilla grande nadie quiere ver los 300 nodos a la vez.
 *
 * · LOS NODOS DE CONTEXTO se dibujan apagados. Son jefes que quedan fuera del
 *   alcance de datos de quien mira: aparecen para que la rama no cuelgue en el
 *   aire, pero sin detalle. Sin ellos el árbol parecería roto.
 *
 * · REASIGNAR ES EXPLÍCITO, con un selector, no arrastrando. Arrastrar sobre un
 *   árbol plegable es fácil de errar, y aquí un error cambia quién aprueba las
 *   vacaciones de alguien y quién lo evalúa.
 */

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";

interface Nodo {
  id: string;
  codigo: string;
  nombre: string;
  supervisorId: string | null;
  puesto: string | null;
  departamento: string | null;
  departamentoId: string | null;
  sucursal: string | null;
  centroCosto: string | null;
  estado: string;
  emailCorporativo: string | null;
  extension: string | null;
  salarioBase?: string;
  antiguedadAnios?: number;
  contexto?: boolean;
}

interface NodoArbol {
  datos: Nodo;
  hijos: NodoArbol[];
  nivel: number;
  directos: number;
  total: number;
  contexto?: boolean;
}

interface Props {
  raices: NodoArbol[];
  enCiclo: string[];
  huerfanos: string[];
  totales: { empleados: number; sinJefe: number; conContexto: number };
  vacantesPorDepartamento: Record<string, number>;
  puedeReasignar: boolean;
  vePII: boolean;
  sucursales: Array<{ id: string; nombre: string }>;
  sucursalActiva?: string;
}

const COLOR_ESTADO: Record<string, string> = {
  ACTIVO: "bg-green-100 text-green-800",
  VACACIONES: "bg-blue-100 text-blue-800",
  PERMISO: "bg-amber-100 text-amber-800",
  SUSPENDIDO: "bg-red-100 text-red-800",
  INACTIVO: "bg-gray-100 text-gray-500",
};

export default function OrganigramaClient({
  raices,
  enCiclo,
  huerfanos,
  totales,
  vacantesPorDepartamento,
  puedeReasignar,
  vePII,
  sucursales,
  sucursalActiva,
}: Props) {
  const [plegados, setPlegados] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState("");
  const [reasignando, setReasignando] = useState<Nodo | null>(null);

  const alternar = useCallback((id: string) => {
    setPlegados((previos) => {
      const siguiente = new Set(previos);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }, []);

  /** Todos los nodos en plano: alimenta la búsqueda y el selector de jefe. */
  const planos = useMemo(() => {
    const salida: Nodo[] = [];
    const pila = [...raices];
    while (pila.length) {
      const nodo = pila.pop()!;
      salida.push(nodo.datos);
      pila.push(...nodo.hijos);
    }
    return salida.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [raices]);

  /**
   * Al buscar se resaltan las coincidencias y se DESPLIEGAN sus ancestros: si se
   * ocultaran las ramas sin coincidencia, se perdería la cadena de mando, que es
   * justo lo que se quiere ver de una persona.
   */
  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      planos
        .filter(
          (n) =>
            n.nombre.toLowerCase().includes(q) ||
            n.codigo.toLowerCase().includes(q) ||
            (n.puesto ?? "").toLowerCase().includes(q) ||
            (n.departamento ?? "").toLowerCase().includes(q)
        )
        .map((n) => n.id)
    );
  }, [busqueda, planos]);

  const sinJefe = totales.sinJefe;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Organigrama</h1>
          <p className="text-sm text-gray-500">
            Línea de reporte: quién depende de quién. Decide también quién aprueba los permisos y
            quién evalúa a cada persona.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPlegados(new Set())}
            className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
          >
            Desplegar todo
          </button>
          <button
            onClick={() => setPlegados(new Set(planos.filter((n) => n.supervisorId === null).map((n) => n.id)))}
            className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
          >
            Plegar todo
          </button>
        </div>
      </div>

      {/* ─── Avisos ────────────────────────────────────────────────────── */}
      {enCiclo.length > 0 && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          <p className="font-semibold">
            {enCiclo.length} empleado(s) forman un ciclo en la jerarquía y no se pueden dibujar.
          </p>
          <p className="mt-1 text-xs">
            Alguien depende de sí mismo a través de su cadena de mando. Corrija el jefe de uno de
            ellos desde su ficha para deshacer el lazo. El sistema ya impide crear ciclos nuevos;
            estos vienen de datos anteriores.
          </p>
        </div>
      )}

      {sinJefe > 0 && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
          <p>
            <span className="font-semibold">{sinJefe} empleado(s) sin jefe directo.</span> Mientras
            no lo tengan, su supervisor no verá sus solicitudes de permiso y las evaluaciones 360°
            no podrán añadir al jefe como evaluador.
          </p>
          <p className="mt-1 text-xs">
            Se pueden asignar en bloque con la columna <span className="font-mono">Codigo Supervisor</span>{" "}
            del <Link href="/empleados" className="underline font-medium">importador de empleados</Link>.
          </p>
        </div>
      )}

      {/* ─── Resumen y filtros ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, código, puesto o departamento…"
          className="flex-1 min-w-56 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <form className="flex gap-2">
          <select
            name="sucursalId"
            defaultValue={sucursalActiva ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">Todas las sucursales</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </form>
        <span className="text-sm text-gray-500">
          {totales.empleados} persona(s)
          {coincidencias && ` · ${coincidencias.size} coincidencia(s)`}
        </span>
      </div>

      {/* ─── Árbol ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 overflow-x-auto">
        {raices.length === 0 ? (
          <p className="text-center py-10 text-gray-400 text-sm">
            No hay empleados que mostrar con los filtros actuales.
          </p>
        ) : (
          <ul className="space-y-1 min-w-[32rem]">
            {raices.map((nodo) => (
              <Rama
                key={nodo.datos.id}
                nodo={nodo}
                plegados={plegados}
                alternar={alternar}
                coincidencias={coincidencias}
                vacantes={vacantesPorDepartamento}
                puedeReasignar={puedeReasignar}
                vePII={vePII}
                onReasignar={setReasignando}
              />
            ))}
          </ul>
        )}
      </div>

      {huerfanos.length > 0 && (
        <p className="text-xs text-gray-500">
          {huerfanos.length} empleado(s) tienen un jefe que no aparece aquí (está fuera del filtro o
          de su alcance) y se muestran en la raíz.
        </p>
      )}

      {reasignando && (
        <DialogoReasignar
          empleado={reasignando}
          candidatos={planos.filter((n) => n.id !== reasignando.id && !n.contexto)}
          onCerrar={() => setReasignando(null)}
        />
      )}
    </div>
  );
}

// ─── RAMA ────────────────────────────────────────────────────────────────────

function Rama({
  nodo,
  plegados,
  alternar,
  coincidencias,
  vacantes,
  puedeReasignar,
  vePII,
  onReasignar,
}: {
  nodo: NodoArbol;
  plegados: Set<string>;
  alternar: (id: string) => void;
  coincidencias: Set<string> | null;
  vacantes: Record<string, number>;
  puedeReasignar: boolean;
  vePII: boolean;
  onReasignar: (n: Nodo) => void;
}) {
  const { datos } = nodo;
  const plegado = plegados.has(datos.id);
  const tieneHijos = nodo.hijos.length > 0;
  const resaltado = coincidencias?.has(datos.id) ?? false;
  const apagado = coincidencias ? !resaltado : false;
  const plazas = datos.departamentoId ? vacantes[datos.departamentoId] : undefined;

  return (
    <li>
      <div
        className={`flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors ${
          resaltado ? "bg-yellow-50 ring-1 ring-yellow-300" : "hover:bg-gray-50"
        } ${apagado ? "opacity-40" : ""}`}
      >
        <button
          type="button"
          onClick={() => tieneHijos && alternar(datos.id)}
          aria-label={tieneHijos ? (plegado ? "Desplegar equipo" : "Plegar equipo") : undefined}
          disabled={!tieneHijos}
          className={`mt-1 w-5 h-5 shrink-0 flex items-center justify-center rounded text-xs ${
            tieneHijos ? "text-gray-500 hover:bg-gray-200" : "text-transparent"
          }`}
        >
          {tieneHijos ? (plegado ? "▸" : "▾") : "·"}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {datos.contexto ? (
              // Fuera del alcance: sin enlace a la ficha, que tampoco podría abrir.
              <span className="font-medium text-gray-400 italic">{datos.nombre}</span>
            ) : (
              <Link
                href={`/empleados/${datos.id}`}
                className="font-medium text-gray-900 hover:text-blue-700"
              >
                {datos.nombre}
              </Link>
            )}
            <span className="font-mono text-xs text-gray-400">{datos.codigo}</span>

            {datos.estado !== "ACTIVO" && (
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${COLOR_ESTADO[datos.estado] ?? ""}`}>
                {datos.estado}
              </span>
            )}
            {datos.contexto && (
              <span
                className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500"
                title="Fuera de su alcance de datos. Se muestra sólo para no dejar esta rama sin su jefe."
              >
                contexto
              </span>
            )}
            {nodo.total > 0 && (
              <span
                className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-700"
                title={`${nodo.directos} directo(s), ${nodo.total} en total`}
              >
                {nodo.directos} · {nodo.total} total
              </span>
            )}
            {plazas ? (
              <span
                className="px-1.5 py-0.5 rounded text-xs bg-purple-50 text-purple-700"
                title="Vacantes abiertas en este departamento"
              >
                {plazas} vacante(s)
              </span>
            ) : null}
          </div>

          <div className="text-xs text-gray-500 flex flex-wrap gap-x-3">
            {datos.puesto && <span>{datos.puesto}</span>}
            {datos.departamento && <span>· {datos.departamento}</span>}
            {datos.sucursal && <span>· {datos.sucursal}</span>}
            {datos.centroCosto && <span title="Centro de costo">· 💼 {datos.centroCosto}</span>}
            {datos.emailCorporativo && <span>· {datos.emailCorporativo}</span>}
            {datos.extension && <span>· ext. {datos.extension}</span>}
            {vePII && datos.salarioBase && (
              <span className="text-gray-600">· {formatCurrency(datos.salarioBase)}</span>
            )}
          </div>
        </div>

        {puedeReasignar && !datos.contexto && (
          <button
            type="button"
            onClick={() => onReasignar(datos)}
            className="text-xs text-blue-600 hover:text-blue-800 shrink-0 mt-1"
          >
            Cambiar jefe
          </button>
        )}
      </div>

      {tieneHijos && !plegado && (
        <ul className="ml-5 pl-3 border-l border-gray-200 space-y-1 mt-1">
          {nodo.hijos.map((hijo) => (
            <Rama
              key={hijo.datos.id}
              nodo={hijo}
              plegados={plegados}
              alternar={alternar}
              coincidencias={coincidencias}
              vacantes={vacantes}
              puedeReasignar={puedeReasignar}
              vePII={vePII}
              onReasignar={onReasignar}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ─── REASIGNACIÓN ────────────────────────────────────────────────────────────

function DialogoReasignar({
  empleado,
  candidatos,
  onCerrar,
}: {
  empleado: Nodo;
  candidatos: Nodo[];
  onCerrar: () => void;
}) {
  const [nuevo, setNuevo] = useState<string>(empleado.supervisorId ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/organigrama/reasignar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empleadoId: empleado.id, supervisorId: nuevo || null }),
      });
      const datos = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(datos.error ?? "No se pudo cambiar el jefe.");
      // Recarga completa: el árbol cambia de forma y reconstruirlo en el cliente
      // duplicaría la lógica del servidor, que es donde vive la validación.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el jefe.");
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Cambiar jefe directo</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {empleado.nombre} · <span className="font-mono text-xs">{empleado.codigo}</span>
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              {error}
            </div>
          )}

          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Nuevo jefe</span>
            <select
              value={nuevo}
              onChange={(e) => setNuevo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">Sin jefe (raíz del organigrama)</option>
              {candidatos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} · {c.codigo}
                  {c.puesto ? ` — ${c.puesto}` : ""}
                </option>
              ))}
            </select>
            <span className="block text-xs text-gray-500 mt-1">
              No aparecen aquí quienes crearían un ciclo; si aun así elige uno, el servidor lo
              rechaza y le dice por qué.
            </span>
          </label>

          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            Esto cambia quién aprueba sus permisos y quién lo evalúa como jefe directo. Queda
            registrado en la auditoría.
          </p>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onCerrar} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
