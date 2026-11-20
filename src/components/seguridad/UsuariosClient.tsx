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
import { useAvisos } from "@/components/ui/Avisos";
import { formatDateTime } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";
import type { NivelesEstructura } from "@/lib/organizacion/estructura";
import BuscadorEmpleado, { type EmpleadoBuscado } from "@/components/employees/BuscadorEmpleado";

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
  empleado: { id: string; codigo: string; primerNombre: string; primerApellido: string; estado: string; buscado: EmpleadoBuscado } | null;
}

interface Props {
  usuarios: Usuario[];
  perfiles: Array<{ id: string; nombre: string; alcance: Alcance }>;
  sucursales: Array<{ id: string; nombre: string; codigo: string }>;
  usuarioActualId: string;
  puedeGestionar: boolean;
  puedeResetear: boolean;
  puedeVerPerfiles: boolean;
  niveles: NivelesEstructura;
}

const ROLES = [
  "SUPER_ADMIN", "ADMIN_RRHH", "CONTADOR", "GERENTE", "SUPERVISOR", "AUDITOR", "EMPLEADO",
] as const;

const ETIQUETA_ROL: Record<string, string> = {
  SUPER_ADMIN: "Administrador general",
  ADMIN_RRHH: "Administrador de RRHH",
  CONTADOR: "Contador",
  GERENTE: "Gerente",
  SUPERVISOR: "Supervisor",
  AUDITOR: "Auditor",
  EMPLEADO: "Empleado",
};

const etiquetasAlcance = (niveles: NivelesEstructura): Record<Alcance, string> => ({
  TODO: niveles.todaLaEmpresa,
  SUCURSAL: `Sus ${niveles.sucursales.toLowerCase()}`,
  DEPARTAMENTO: "Su departamento",
  PROPIO: "Sólo su expediente",
});

const FORM_VACIO = {
  email: "",
  name: "",
  perfilId: "",
  role: "EMPLEADO",
  empleado: null as EmpleadoBuscado | null,
  sucursalesIds: [] as string[],
};

/** El rótulo del buscador de empleado: sólo hay una ventana de usuario abierta a la vez. */
const ID_ETIQUETA_EMPLEADO = "usuario-empleado-etiqueta";

export default function UsuariosClient({
  usuarios,
  perfiles,
  sucursales,
  usuarioActualId,
  puedeGestionar,
  puedeResetear,
  puedeVerPerfiles,
  niveles,
}: Props) {
  const etiquetaAlcance = etiquetasAlcance(niveles);
  const router = useRouter();
  const { confirmar } = useAvisos();
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
        empleadoId: form.empleado?.id || undefined,
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
        empleadoId: form.empleado?.id || null,
        sucursalesIds: form.sucursalesIds,
      }),
    });
    if (ok) setEditando(null);
  }

  async function alternarActivo(u: Usuario) {
    if (u.activo) {
      const confirmado = await confirmar({
        titulo: `¿Desactivar la cuenta de ${u.name ?? u.email}?`,
        detalle: "No podrá iniciar sesión y su sesión abierta se cerrará en pocos minutos. La cuenta no se elimina: su rastro en la auditoría se conserva.",
        accion: "Desactivar",
      });
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
    const confirmado = await confirmar({
      titulo: `¿Restablecer la contraseña de ${u.name ?? u.email}?`,
      detalle: "Se generará una clave temporal que deberá entregarle por un canal seguro. Su sesión actual se cerrará.",
      accion: "Restablecer",
    });
    if (!confirmado) return;
    const datos = await llamar(`/api/usuarios/${u.id}/password`, { method: "POST" });
    if (datos) setTemporal({ email: u.email, password: String(datos.passwordTemporal) });
  }

  function abrirEdicion(u: Usuario) {
    setError(null);
    setEditando(u);
    setForm({
      email: u.email,
      name: u.name ?? "",
      perfilId: u.perfil?.id ?? "",
      role: u.role,
      empleado: u.empleado?.buscado ?? null,
      sucursalesIds: u.sucursalesIds,
    });
  }

  /**
   * Elegir al empleado primero ahorra escribir: en una cuenta nueva, el nombre y el correo
   * corporativo salen de su ficha si todavía están vacíos. Lo ya escrito no se pisa.
   */
  function elegirEmpleado(e: EmpleadoBuscado | null) {
    setForm((f) => ({
      ...f,
      empleado: e,
      name: !editando && e && !f.name.trim() ? e.nombre : f.name,
      email: !editando && e?.correo && !f.email.trim() ? e.correo : f.email,
    }));
  }

  const alcanceSeleccionado =
    perfiles.find((p) => p.id === form.perfilId)?.alcance ?? "TODO";
  const pideSucursales = alcanceSeleccionado === "SUCURSAL";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuarios"
        description={`${usuarios.filter((u) => u.activo).length} cuenta(s) activa(s) de ${usuarios.length}.`}
        actions={
          <>
            {puedeVerPerfiles && (
              <Link href="/usuarios/perfiles" className="btn btn-secondary">
                Perfiles de acceso
              </Link>
            )}
            {puedeGestionar && (
              <button
                onClick={() => {
                  setForm(FORM_VACIO);
                  setError(null);
                  setModalNuevo(true);
                }}
                className="btn btn-primary"
              >
                Nuevo usuario
              </button>
            )}
          </>
        }
      />

      {/* Con una ventana abierta, el error va dentro de ella: aquí quedaba detrás, oscurecido. */}
      {error && !(modalNuevo || editando) && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      {temporal && <PanelPasswordTemporal datos={temporal} onCerrar={() => setTemporal(null)} />}

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por nombre o correo…"
        aria-label="Buscar usuario"
        className="input max-w-sm"
      />

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base tabla-tarjetas">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Perfil / Rol</th>
                <th>Alcance</th>
                <th>Empleado</th>
                <th>Último acceso</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EstadoVacio
                      titulo="No hay usuarios que coincidan."
                      detalle={busqueda.trim() ? "Pruebe con otra parte del nombre o del correo." : "Cuando se cree una cuenta, aparecerá aquí."}
                    />
                  </td>
                </tr>
              ) : (
                visibles.map((u) => {
                  const esYo = u.id === usuarioActualId;
                  return (
                    <tr key={u.id} className={!u.activo ? "opacity-60" : ""}>
                      <td data-titulo>
                        <div className="font-medium text-gray-900">
                          {u.name ?? "—"}
                          {esYo && (
                            <span className="ml-2 text-xs font-normal text-blue-700">(usted)</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">{u.email}</div>
                      </td>
                      <td data-etiqueta="Perfil / Rol">
                        {u.perfil ? (
                          <span className="font-medium text-gray-900">{u.perfil.nombre}</span>
                        ) : (
                          <span
                            className="text-gray-600"
                            title="Sin perfil asignado: los permisos se derivan del rol."
                          >
                            {ETIQUETA_ROL[u.role] ?? u.role}
                          </span>
                        )}
                      </td>
                      <td data-etiqueta="Alcance" className="text-xs text-gray-600">
                        {etiquetaAlcance[u.perfil?.alcance ?? "TODO"]}
                        {u.perfil?.alcance === "SUCURSAL" && (
                          <span className="block text-gray-500">
                            {u.sucursalesIds.length === 0
                              ? `sin ${niveles.sucursales.toLowerCase()}`
                              : `${u.sucursalesIds.length} ${(u.sucursalesIds.length === 1 ? niveles.sucursal : niveles.sucursales).toLowerCase()}`}
                          </span>
                        )}
                      </td>
                      <td data-etiqueta="Empleado" className="text-xs text-gray-600">
                        {u.empleado ? `${u.empleado.codigo}, ${u.empleado.primerNombre} ${u.empleado.primerApellido}` : "—"}
                        {u.empleado?.estado === "INACTIVO" && (
                          <span className="block text-amber-700" title="La cuenta no puede entrar, salvo que sea la única que puede administrar accesos.">
                            Dado de baja: sin acceso
                          </span>
                        )}
                      </td>
                      <td data-etiqueta="Último acceso" className="text-xs text-gray-500">
                        {u.ultimoAcceso ? formatDateTime(u.ultimoAcceso) : "Nunca"}
                      </td>
                      <td data-etiqueta="Estado">
                        <EstadoBadge valor={u.activo ? "ACTIVO" : "INACTIVO"} />
                        {u.debeCambiarPassword && u.activo && (
                          <span
                            className="block mt-1 text-xs text-amber-700"
                            title="Tiene una contraseña temporal y deberá cambiarla al entrar."
                          >
                            clave temporal
                          </span>
                        )}
                      </td>
                      <td data-accion>
                        <div className="flex flex-wrap gap-1">
                          {puedeGestionar && (
                            <button
                              onClick={() => abrirEdicion(u)}
                              className="btn btn-ghost btn-sm"
                            >
                              Editar
                            </button>
                          )}
                          {puedeResetear && u.activo && (
                            <button
                              onClick={() => resetear(u)}
                              disabled={cargando}
                              className="btn btn-ghost btn-sm"
                            >
                              Restablecer clave
                            </button>
                          )}
                          {puedeGestionar && (
                            <button
                              onClick={() => alternarActivo(u)}
                              disabled={cargando || esYo}
                              title={esYo ? "No puede desactivar su propia cuenta." : undefined}
                              className={`btn btn-sm ${
                                u.activo ? "border border-red-300 bg-white text-red-700 hover:bg-red-50" : "btn-ghost"
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
            setError(null);
          }}
          onGuardar={editando ? guardarEdicion : crear}
          cargando={cargando}
          error={error}
        >
          <div className="space-y-4">
            {/* Primero el empleado: elegido, completa el nombre y el correo de abajo. */}
            <div>
              <span id={ID_ETIQUETA_EMPLEADO} className="mb-1 block text-sm font-medium text-gray-800">
                Empleado vinculado <span className="font-normal text-gray-500">(opcional)</span>
              </span>
              <BuscadorEmpleado
                etiquetaId={ID_ETIQUETA_EMPLEADO}
                valor={form.empleado}
                onCambio={elegirEmpleado}
                endpoint="/api/usuarios/empleados-vinculables"
                sugerencia={editando ? undefined : form.name}
                vacio="Ningún empleado sin cuenta coincide. Los que ya tienen cuenta o están de baja no aparecen."
              />
              <span className="mt-1 block text-xs text-gray-500">
                {editando
                  ? "Le da acceso a Mi espacio y a sus comprobantes de pago."
                  : "Elíjalo primero: completa el nombre y el correo corporativo. Le da acceso a Mi espacio y a sus comprobantes de pago."}
              </span>
            </div>

            <Campo etiqueta="Nombre completo">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input"
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
                className="input disabled:bg-gray-50 disabled:text-gray-500"
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
                className="input"
              >
                <option value="">Sin perfil — usar el rol</option>
                {perfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}, {etiquetaAlcance[p.alcance]}
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
                className="input"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ETIQUETA_ROL[r]}</option>
                ))}
              </select>
            </Campo>

            {pideSucursales && (
              <Campo
                etiqueta={`${niveles.sucursales} que puede ver`}
                ayuda={`El perfil elegido sólo deja ver el personal de cada ${niveles.sucursal.toLowerCase()} que marque aquí. Si no marca nada, no verá personal.`}
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
                      {s.nombre} <span className="text-xs text-gray-500">({s.codigo})</span>
                    </label>
                  ))}
                </div>
              </Campo>
            )}

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
  error,
}: {
  titulo: string;
  children: React.ReactNode;
  onCerrar: () => void;
  onGuardar: () => void;
  cargando: boolean;
  error?: string | null;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="panel shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">{titulo}</h2>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        {error && (
          <p role="alert" className="mx-6 mb-3 shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
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
          className="btn btn-secondary"
        >
          {copiada ? "Copiada" : "Copiar"}
        </button>
        <button onClick={onCerrar} className="btn btn-ghost">
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
