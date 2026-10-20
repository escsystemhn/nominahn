"use client";

/**
 * Editor de perfiles de acceso.
 *
 * La matriz de permisos es la pantalla desde la que se decide lo que puede hacer
 * el resto de la organización, así que se apoya en tres detalles:
 *
 * · CADA PERMISO EXPLICA QUÉ HABILITA, en una línea. Una lista de códigos
 *   (`empleados.pii`) obliga a adivinar, y quien adivina concede de más.
 *
 * · LOS SENSIBLES SE MARCAN. Mueven dinero, sacan datos personales del sistema o
 *   alteran registros en masa; conceder uno debe ser una decisión consciente.
 *
 * · LO QUE EL PROPIO USUARIO NO TIENE, SE DESHABILITA. Nadie reparte permisos que
 *   no posee. El servidor lo impone igualmente; aquí se muestra el porqué.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Alcance = "TODO" | "SUCURSAL" | "DEPARTAMENTO" | "PROPIO";

interface Perfil {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  permisos: string[];
  alcance: Alcance;
  esSistema: boolean;
  activo: boolean;
  usuariosAsignados: number;
}

interface ModuloCatalogo {
  modulo: string;
  etiqueta: string;
  descripcion: string;
  permisos: Array<{ codigo: string; etiqueta: string; descripcion: string; sensible?: boolean }>;
}

interface Props {
  perfiles: Perfil[];
  catalogo: ModuloCatalogo[];
  permisosDelActor: string[];
}

const ALCANCES: Array<{ valor: Alcance; titulo: string; detalle: string }> = [
  { valor: "TODO", titulo: "Toda la empresa", detalle: "Ve y actúa sobre el personal de todas las sucursales." },
  { valor: "SUCURSAL", titulo: "Sus sucursales", detalle: "Sólo el personal de las sucursales que se le asignen en su cuenta." },
  { valor: "DEPARTAMENTO", titulo: "Su departamento", detalle: "Sólo el personal del departamento del empleado vinculado." },
  { valor: "PROPIO", titulo: "Sólo su expediente", detalle: "Únicamente sus propios datos. Para cuentas de autoservicio." },
];

const NUEVO: Omit<Perfil, "id" | "esSistema" | "usuariosAsignados"> = {
  codigo: "",
  nombre: "",
  descripcion: "",
  permisos: [],
  alcance: "TODO",
  activo: true,
};

export default function PerfilesClient({ perfiles, catalogo, permisosDelActor }: Props) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ perfil: Perfil | null; datos: typeof NUEVO } | null>(null);

  const puedeConceder = (codigo: string) => permisosDelActor.includes(codigo);

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

  async function guardar() {
    if (!editor) return;
    const { perfil, datos } = editor;
    const cuerpo = {
      nombre: datos.nombre,
      descripcion: datos.descripcion || undefined,
      alcance: datos.alcance,
      permisos: datos.permisos,
      ...(perfil ? { activo: datos.activo } : { codigo: datos.codigo }),
    };
    const respuesta = perfil
      ? await llamar(`/api/perfiles/${perfil.id}`, { method: "PATCH", body: JSON.stringify(cuerpo) })
      : await llamar("/api/perfiles", { method: "POST", body: JSON.stringify(cuerpo) });
    if (respuesta) setEditor(null);
  }

  async function eliminar(perfil: Perfil) {
    if (!window.confirm(`¿Eliminar el perfil "${perfil.nombre}"?`)) return;
    await llamar(`/api/perfiles/${perfil.id}`, { method: "DELETE" });
  }

  /**
   * Duplica un perfil para partir de él.
   *
   * Es la vía para ajustar un perfil de sistema —que no se puede editar— sin
   * tener que reconstruir su lista de permisos casilla por casilla. El código se
   * deja vacío a propósito: es único, así que lo elige quien duplica.
   */
  function duplicar(perfil: Perfil) {
    setEditor({
      perfil: null,
      datos: {
        codigo: "",
        nombre: `${perfil.nombre} (copia)`,
        descripcion: perfil.descripcion ?? "",
        // El comodín se expande a la lista concreta: un perfil nuevo con `*`
        // sería un segundo acceso total, y eso se concede a conciencia, no
        // heredado de una copia.
        permisos: perfil.permisos.includes("*")
          ? permisosDelActor.filter((codigo) => puedeConceder(codigo))
          : perfil.permisos.filter((codigo) => puedeConceder(codigo)),
        alcance: perfil.alcance,
        activo: true,
      },
    });
  }

  function alternar(codigo: string) {
    if (!editor) return;
    const { datos } = editor;
    setEditor({
      ...editor,
      datos: {
        ...datos,
        permisos: datos.permisos.includes(codigo)
          ? datos.permisos.filter((p) => p !== codigo)
          : [...datos.permisos, codigo],
      },
    });
  }

  function alternarModulo(modulo: ModuloCatalogo, marcar: boolean) {
    if (!editor) return;
    // Sólo se tocan los que el actor puede conceder: "seleccionar todo" no debe
    // colar por la puerta de atrás lo que la casilla individual bloquea.
    const afectados = modulo.permisos.filter((p) => puedeConceder(p.codigo)).map((p) => p.codigo);
    const actuales = new Set(editor.datos.permisos);
    for (const codigo of afectados) {
      if (marcar) actuales.add(codigo);
      else actuales.delete(codigo);
    }
    setEditor({ ...editor, datos: { ...editor.datos, permisos: [...actuales] } });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/usuarios" className="text-xs text-blue-600 hover:text-blue-800">
            ← Volver a usuarios
          </Link>
          <h1 className="text-xl font-bold text-gray-900 mt-1">Perfiles de acceso</h1>
          <p className="text-sm text-gray-500">
            Cada perfil agrupa permisos y un alcance de datos. Se asigna a las cuentas desde Usuarios.
          </p>
        </div>
        <button
          onClick={() => setEditor({ perfil: null, datos: { ...NUEVO } })}
          className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800"
        >
          Nuevo perfil
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {perfiles.length === 0 && (
          <p className="text-sm text-gray-400 col-span-full py-8 text-center">
            Todavía no hay perfiles. Mientras tanto, los permisos de cada cuenta se derivan de su rol.
          </p>
        )}
        {perfiles.map((p) => (
          <div
            key={p.id}
            className={`bg-white rounded-xl border p-4 flex flex-col gap-2 ${
              p.activo ? "border-gray-200" : "border-gray-200 opacity-60"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold text-gray-900">{p.nombre}</h2>
                <p className="text-xs font-mono text-gray-400">{p.codigo}</p>
              </div>
              {p.esSistema && (
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 shrink-0"
                  title="Perfil de sistema: no se puede editar ni eliminar, para que la instalación nunca se quede sin un perfil capaz de administrar accesos."
                >
                  sistema
                </span>
              )}
            </div>

            {p.descripcion && <p className="text-xs text-gray-500">{p.descripcion}</p>}

            <dl className="text-xs text-gray-600 space-y-0.5 mt-1">
              <div className="flex justify-between">
                <dt>Permisos</dt>
                <dd className="font-medium">{p.permisos.includes("*") ? "todos" : p.permisos.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Alcance</dt>
                <dd className="font-medium">
                  {ALCANCES.find((a) => a.valor === p.alcance)?.titulo ?? p.alcance}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Cuentas asignadas</dt>
                <dd className="font-medium">{p.usuariosAsignados}</dd>
              </div>
            </dl>

            <div className="flex gap-3 text-xs mt-2 pt-2 border-t border-gray-100">
              {p.esSistema ? (
                <span className="text-gray-400">
                  Protegido: duplíquelo para crear una variante.
                </span>
              ) : (
                <>
                  <button
                    onClick={() =>
                      setEditor({
                        perfil: p,
                        datos: {
                          codigo: p.codigo,
                          nombre: p.nombre,
                          descripcion: p.descripcion ?? "",
                          permisos: p.permisos,
                          alcance: p.alcance,
                          activo: p.activo,
                        },
                      })
                    }
                    className="text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => eliminar(p)}
                    disabled={cargando || p.usuariosAsignados > 0}
                    title={p.usuariosAsignados > 0 ? "Tiene usuarios asignados." : undefined}
                    className="text-red-600 hover:text-red-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Eliminar
                  </button>
                </>
              )}
              {/* Duplicar sirve para TODOS, incluidos los de sistema: es la única
                  forma de partir de uno protegido sin rehacer sus permisos. */}
              <button
                onClick={() => duplicar(p)}
                className="text-gray-600 hover:text-gray-900 ml-auto"
              >
                Duplicar
              </button>
            </div>
          </div>
        ))}
      </div>

      {editor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 shrink-0">
              <h2 className="text-lg font-bold text-gray-900">
                {editor.perfil ? `Editar «${editor.perfil.nombre}»` : "Nuevo perfil de acceso"}
              </h2>
              {editor.perfil && editor.perfil.usuariosAsignados > 0 && (
                <p className="text-xs text-amber-700 mt-1">
                  Los cambios afectarán de inmediato a {editor.perfil.usuariosAsignados} cuenta(s).
                </p>
              )}
            </div>

            <div className="px-6 py-5 overflow-y-auto flex-1 space-y-5">
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Nombre</span>
                  <input
                    value={editor.datos.nombre}
                    onChange={(e) =>
                      setEditor({ ...editor, datos: { ...editor.datos, nombre: e.target.value } })
                    }
                    placeholder="Supervisor de sucursal"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Código</span>
                  <input
                    value={editor.datos.codigo}
                    disabled={!!editor.perfil}
                    onChange={(e) =>
                      setEditor({ ...editor, datos: { ...editor.datos, codigo: e.target.value } })
                    }
                    placeholder="SUPERVISOR_SUC"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </label>
              </div>

              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">Descripción</span>
                <input
                  value={editor.datos.descripcion ?? ""}
                  onChange={(e) =>
                    setEditor({ ...editor, datos: { ...editor.datos, descripcion: e.target.value } })
                  }
                  placeholder="Para quién es este perfil y qué se espera que haga"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </label>

              <fieldset>
                <legend className="text-sm font-medium text-gray-700 mb-2">Alcance de datos</legend>
                <p className="text-xs text-gray-500 mb-2">
                  Los permisos dicen QUÉ puede hacer; el alcance, sobre QUIÉNES.
                </p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {ALCANCES.map((a) => (
                    <label
                      key={a.valor}
                      className={`flex gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                        editor.datos.alcance === a.valor
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="radio"
                        className="mt-1"
                        checked={editor.datos.alcance === a.valor}
                        onChange={() =>
                          setEditor({ ...editor, datos: { ...editor.datos, alcance: a.valor } })
                        }
                      />
                      <span>
                        <span className="block text-sm font-medium text-gray-900">{a.titulo}</span>
                        <span className="block text-xs text-gray-500">{a.detalle}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">Permisos</h3>
                <p className="text-xs text-gray-500 mb-3">
                  {editor.datos.permisos.length} seleccionado(s). Las acciones marcadas como
                  sensibles mueven dinero, sacan datos personales del sistema o alteran registros en
                  masa.
                </p>

                <div className="space-y-3">
                  {catalogo.map((modulo) => {
                    const concedibles = modulo.permisos.filter((p) => puedeConceder(p.codigo));
                    const marcados = modulo.permisos.filter((p) =>
                      editor.datos.permisos.includes(p.codigo)
                    ).length;
                    return (
                      <div key={modulo.modulo} className="border border-gray-200 rounded-lg">
                        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
                          <div>
                            <span className="text-sm font-medium text-gray-800">{modulo.etiqueta}</span>
                            <span className="ml-2 text-xs text-gray-500">
                              {marcados}/{modulo.permisos.length}
                            </span>
                            <span className="block text-xs text-gray-500">{modulo.descripcion}</span>
                          </div>
                          {concedibles.length > 0 && (
                            <div className="flex gap-2 text-xs shrink-0">
                              <button
                                onClick={() => alternarModulo(modulo, true)}
                                className="text-blue-600 hover:text-blue-800"
                              >
                                Todos
                              </button>
                              <button
                                onClick={() => alternarModulo(modulo, false)}
                                className="text-gray-500 hover:text-gray-700"
                              >
                                Ninguno
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="divide-y divide-gray-50">
                          {modulo.permisos.map((permiso) => {
                            const disponible = puedeConceder(permiso.codigo);
                            return (
                              <label
                                key={permiso.codigo}
                                title={
                                  disponible
                                    ? undefined
                                    : "No puede conceder un permiso que usted no tiene."
                                }
                                className={`flex gap-3 px-3 py-2 ${
                                  disponible ? "cursor-pointer hover:bg-gray-50" : "opacity-40 cursor-not-allowed"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="mt-1"
                                  disabled={!disponible}
                                  checked={editor.datos.permisos.includes(permiso.codigo)}
                                  onChange={() => alternar(permiso.codigo)}
                                />
                                <span className="min-w-0">
                                  <span className="text-sm text-gray-900">
                                    {permiso.etiqueta}
                                    {permiso.sensible && (
                                      <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800 font-medium">
                                        sensible
                                      </span>
                                    )}
                                  </span>
                                  <span className="block text-xs text-gray-500">{permiso.descripcion}</span>
                                  <span className="block text-xs font-mono text-gray-300">{permiso.codigo}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {editor.perfil && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editor.datos.activo}
                    onChange={(e) =>
                      setEditor({ ...editor, datos: { ...editor.datos, activo: e.target.checked } })
                    }
                  />
                  Perfil activo
                  <span className="text-xs text-gray-500">
                    — al desactivarlo, sus cuentas se quedan sin permisos hasta reasignarlas.
                  </span>
                </label>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setEditor(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={cargando || !editor.datos.nombre || (!editor.perfil && !editor.datos.codigo)}
                className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 disabled:opacity-50"
              >
                {cargando ? "Guardando…" : "Guardar perfil"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
