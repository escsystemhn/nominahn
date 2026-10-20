"use client";

/**
 * Administración de cuentas de acceso.
 *
 * Dos decisiones de interfaz que responden a riesgos concretos:
 *
 * · LA CONTRASEÑA TEMPORAL SE MUESTRA UNA SOLA VEZ, en un panel que obliga a
 *   copiarla antes de cerrar. No se guarda en claro en ningún sitio, así que si
 *   se pierde la única salida es volver a restablecerla.
 *
 * · LAS ACCIONES SOBRE LA PROPIA CUENTA SE DESACTIVAN en la pantalla, además de
 *   bloquearse en el servidor. Desactivarse a uno mismo deja a la persona al
 *   otro lado de la puerta que acaba de cerrar.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDateTime } from "@/lib/utils";

type Alcance = "TODO" | "SUCURSAL" | "DEPARTAMENTO" | "PROPIO";

interface Usuario {
  id: string;
  name: string | null;
  email: string;
  role: string;
  activo: boolean;
  debeCambiarPassword: boolean;
  ultimoAcceso: string | null;
  createdAt: string;
  sucursalesIds: string[];
  perfil: { id: string; nombre: string; alcance: Alcance; activo: boolean } | null;
  empleado: { id: string; codigo: string; primerNombre: string; primerApellido: string } | null;
}

interface Props {
  usuarios: Usuario[];
  perfiles: Array<{ id: string; nombre: string; alcance: Alcance }>;
  sucursales: Array<{ id: string; nombre: string; codigo: string }>;
  empleadosSinCuenta: Array<{ id: string; codigo: string; primerNombre: string; primerApellido: string }>;
  usuarioActualId: string;
  puedeGestionar: boolean;
  puedeResetear: boolean;
  puedeVerPerfiles: boolean;
}

const ROLES = [
  "SUPER_ADMIN", "ADMIN_RRHH", "CONTADOR", "GERENTE", "SUPERVISOR", "AUDITOR", "EMPLEADO",
] as const;

const ETIQUETA_ALCANCE: Record<Alcance, string> = {
  TODO: "Toda la empresa",
  SUCURSAL: "Sus sucursales",
  DEPARTAMENTO: "Su departamento",
  PROPIO: "Sólo su expediente",
};

const FORM_VACIO = {
  email: "",
  name: "",
  perfilId: "",
  role: "EMPLEADO",
  empleadoId: "",
  sucursalesIds: [] as string[],
};

export default function UsuariosClient({
  usuarios,
  perfiles,
  sucursales,
  empleadosSinCuenta,
  usuarioActualId,
  puedeGestionar,
  puedeResetear,
  puedeVerPerfiles,
}: Props) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [modalNuevo, setModalNuevo] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  /** Contraseña temporal recién generada. Se enseña una vez y se descarta. */
  const [temporal, setTemporal] = useState<{ email: string; password: string } | null>(null);

  const visibles = usuarios.filter((u) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return (u.name ?? "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  async function llamar(url: string, opciones: RequestInit): Promise<Record<string, unknown> | null> {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...opciones,
      });
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
    const datos = await llamar("/api/usuarios", {
      method: "POST",
      body: JSON.stringify({
        email: form.email,
        name: form.name,
        role: form.role,
        perfilId: form.perfilId || undefined,
        empleadoId: form.empleadoId || undefined,
        sucursalesIds: form.sucursalesIds,
      }),
    });
    if (!datos) return;
    setModalNuevo(false);
    setForm(FORM_VACIO);
    setTemporal({ email: form.email, password: String(datos.passwordTemporal) });
  }

  async function guardarEdicion() {
    if (!editando) return;
    const ok = await llamar(`/api/usuarios/${editando.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: form.name,
        role: form.role,
        perfilId: form.perfilId || null,
        empleadoId: form.empleadoId || null,
        sucursalesIds: form.sucursalesIds,
      }),
    });
    if (ok) setEditando(null);
  }

  async function alternarActivo(u: Usuario) {
    if (u.activo) {
      const confirmado = window.confirm(
        `¿Desactivar la cuenta de ${u.name ?? u.email}?\n\nNo podrá iniciar sesión y su sesión abierta se cerrará en pocos minutos. La cuenta no se elimina: su rastro en la auditoría se conserva.`
      );
      if (!confirmado) return;
      await llamar(`/api/usuarios/${u.id}`, { method: "DELETE" });
    } else {
      await llamar(`/api/usuarios/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ activo: true }),
      });
    }
  }

  async function resetear(u: Usuario) {
    const confirmado = window.confirm(
      `¿Restablecer la contraseña de ${u.name ?? u.email}?\n\nSe generará una clave temporal que deberá entregarle por un canal seguro. Su sesión actual se cerrará.`
    );
    if (!confirmado) return;
    const datos = await llamar(`/api/usuarios/${u.id}/password`, { method: "POST" });
    if (datos) setTemporal({ email: u.email, password: String(datos.passwordTemporal) });
  }

  function abrirEdicion(u: Usuario) {
    setEditando(u);
    setForm({
      email: u.email,
      name: u.name ?? "",
      perfilId: u.perfil?.id ?? "",
      role: u.role,
      empleadoId: u.empleado?.id ?? "",
      sucursalesIds: u.sucursalesIds,
    });
  }

  const alcanceSeleccionado =
    perfiles.find((p) => p.id === form.perfilId)?.alcance ?? "TODO";
  const pideSucursales = alcanceSeleccionado === "SUCURSAL";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Usuarios</h1>
          <p className="text-sm text-gray-500">
            {usuarios.filter((u) => u.activo).length} cuenta(s) activa(s) de {usuarios.length}
          </p>
        </div>
        <div className="flex gap-2">
          {puedeVerPerfiles && (
            <Link
              href="/usuarios/perfiles"
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
            >
              Perfiles de acceso
            </Link>
          )}
          {puedeGestionar && (
            <button
              onClick={() => {
                setForm(FORM_VACIO);
                setModalNuevo(true);
              }}
              className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800"
            >
              Nuevo usuario
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      {temporal && <PanelPasswordTemporal datos={temporal} onCerrar={() => setTemporal(null)} />}

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por nombre o correo…"
        className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Usuario</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Perfil / Rol</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Alcance</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Empleado</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Último acceso</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visibles.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">
                    No hay usuarios que coincidan
                  </td>
                </tr>
              ) : (
                visibles.map((u) => {
                  const esYo = u.id === usuarioActualId;
                  return (
                    <tr key={u.id} className={`hover:bg-gray-50 ${!u.activo ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">
                          {u.name ?? "—"}
                          {esYo && (
                            <span className="ml-2 text-xs font-normal text-blue-600">(usted)</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400">{u.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        {u.perfil ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {u.perfil.nombre}
                          </span>
                        ) : (
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600"
                            title="Sin perfil asignado: los permisos se derivan del rol."
                          >
                            {u.role}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {ETIQUETA_ALCANCE[u.perfil?.alcance ?? "TODO"]}
                        {u.perfil?.alcance === "SUCURSAL" && (
                          <span className="block text-gray-400">
                            {u.sucursalesIds.length === 0
                              ? "sin sucursales asignadas"
                              : `${u.sucursalesIds.length} sucursal(es)`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {u.empleado ? `${u.empleado.codigo} · ${u.empleado.primerNombre} ${u.empleado.primerApellido}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {u.ultimoAcceso ? formatDateTime(u.ultimoAcceso) : "Nunca"}
                      </td>
                      <td className="px-4 py-3">
                        {u.activo ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Activo
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            Inactivo
                          </span>
                        )}
                        {u.debeCambiarPassword && u.activo && (
                          <span
                            className="block mt-1 text-xs text-amber-600"
                            title="Tiene una contraseña temporal y deberá cambiarla al entrar."
                          >
                            clave temporal
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3 text-xs">
                          {puedeGestionar && (
                            <button
                              onClick={() => abrirEdicion(u)}
                              className="text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Editar
                            </button>
                          )}
                          {puedeResetear && u.activo && (
                            <button
                              onClick={() => resetear(u)}
                              disabled={cargando}
                              className="text-gray-600 hover:text-gray-900 disabled:opacity-40"
                            >
                              Restablecer clave
                            </button>
                          )}
                          {puedeGestionar && (
                            <button
                              onClick={() => alternarActivo(u)}
                              disabled={cargando || esYo}
                              title={esYo ? "No puede desactivar su propia cuenta." : undefined}
                              className={`disabled:opacity-40 disabled:cursor-not-allowed ${
                                u.activo ? "text-red-600 hover:text-red-800" : "text-green-700 hover:text-green-900"
                              }`}
                            >
                              {u.activo ? "Desactivar" : "Reactivar"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(modalNuevo || editando) && (
        <Modal
          titulo={editando ? `Editar ${editando.name ?? editando.email}` : "Nuevo usuario"}
          onCerrar={() => {
            setModalNuevo(false);
            setEditando(null);
          }}
          onGuardar={editando ? guardarEdicion : crear}
          cargando={cargando}
        >
          <div className="space-y-4">
            <Campo etiqueta="Nombre completo">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="Ana Núñez"
              />
            </Campo>

            <Campo
              etiqueta="Correo electrónico"
              ayuda={editando ? "El correo no se puede cambiar: es el identificador de la cuenta." : undefined}
            >
              <input
                type="email"
                value={form.email}
                disabled={!!editando}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-500"
                placeholder="ana.nunez@empresa.hn"
              />
            </Campo>

            <Campo
              etiqueta="Perfil de acceso"
              ayuda="Define qué puede hacer y sobre qué datos. Sin perfil, los permisos se derivan del rol."
            >
              <select
                value={form.perfilId}
                onChange={(e) => setForm({ ...form, perfilId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">Sin perfil — usar el rol</option>
                {perfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} · {ETIQUETA_ALCANCE[p.alcance]}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo
              etiqueta="Rol"
              ayuda="Se conserva para los módulos que todavía deciden por rol. Si hay perfil, manda el perfil."
            >
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Campo>

            {pideSucursales && (
              <Campo
                etiqueta="Sucursales que puede ver"
                ayuda="El perfil elegido limita el acceso a las sucursales asignadas. Sin ninguna, no verá personal."
              >
                <div className="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
                  {sucursales.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={form.sucursalesIds.includes(s.id)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            sucursalesIds: e.target.checked
                              ? [...form.sucursalesIds, s.id]
                              : form.sucursalesIds.filter((x) => x !== s.id),
                          })
                        }
                      />
                      {s.nombre} <span className="text-xs text-gray-400">({s.codigo})</span>
                    </label>
                  ))}
                </div>
              </Campo>
            )}

            <Campo
              etiqueta="Empleado vinculado"
              ayuda="Le da acceso a Mi Espacio y a sus boletas de pago. Opcional."
            >
              <select
                value={form.empleadoId}
                onChange={(e) => setForm({ ...form, empleadoId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">Sin vincular</option>
                {editando?.empleado && (
                  <option value={editando.empleado.id}>
                    {editando.empleado.codigo} · {editando.empleado.primerNombre}{" "}
                    {editando.empleado.primerApellido}
                  </option>
                )}
                {empleadosSinCuenta.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.codigo} · {e.primerNombre} {e.primerApellido}
                  </option>
                ))}
              </select>
            </Campo>

            {!editando && (
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                Se generará una contraseña temporal que se mostrará una sola vez. El usuario deberá
                cambiarla la primera vez que entre.
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── PIEZAS ──────────────────────────────────────────────────────────────────

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

/**
 * La contraseña temporal, mostrada una sola vez.
 *
 * No hay forma de recuperarla después: sólo se guarda su hash. El panel lo dice
 * explícitamente para que nadie cierre esperando encontrarla luego en la ficha.
 */
function PanelPasswordTemporal({
  datos,
  onCerrar,
}: {
  datos: { email: string; password: string };
  onCerrar: () => void;
}) {
  const [copiada, setCopiada] = useState(false);

  return (
    <div className="px-4 py-4 bg-amber-50 border border-amber-300 rounded-lg">
      <p className="text-sm font-semibold text-amber-900">
        Contraseña temporal para {datos.email}
      </p>
      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <code className="px-3 py-2 bg-white border border-amber-300 rounded font-mono text-base tracking-wide select-all">
          {datos.password}
        </code>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(datos.password);
              setCopiada(true);
            } catch {
              // Sin permiso de portapapeles el texto sigue siendo seleccionable.
              setCopiada(false);
            }
          }}
          className="px-3 py-2 bg-amber-700 text-white text-sm rounded-lg hover:bg-amber-800"
        >
          {copiada ? "Copiada ✓" : "Copiar"}
        </button>
        <button onClick={onCerrar} className="px-3 py-2 text-sm text-amber-800 hover:text-amber-950">
          Ya la guardé
        </button>
      </div>
      <p className="text-xs text-amber-800 mt-2">
        No se volverá a mostrar: el sistema sólo guarda su versión cifrada. Entréguesela por un canal
        seguro; el usuario deberá cambiarla al entrar.
      </p>
    </div>
  );
}
