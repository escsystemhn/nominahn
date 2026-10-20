"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CuarentenaPines, {
  type PinEnCuarentena,
  type OpcionEmpleado,
  type PinAsignado,
} from "./CuarentenaPines";
import MarcacionesDetalle from "./MarcacionesDetalle";

type Marca = "ZKTECO" | "HIKVISION";

interface Dispositivo {
  id: string;
  nombre: string;
  marca: Marca;
  ip: string;
  puerto: number;
  sucursalId: string | null;
  activo: boolean;
  ultimaSync: string | null;
}

/** Puerto por defecto de cada marca: ZKTeco usa 4370; Hikvision habla ISAPI sobre HTTP. */
const PUERTO_POR_MARCA: Record<Marca, string> = { ZKTECO: "4370", HIKVISION: "80" };
const ETIQUETA_MARCA: Record<Marca, string> = { ZKTECO: "ZKTeco", HIKVISION: "Hikvision" };

interface Sucursal {
  id: string;
  nombre: string;
}

interface Props {
  dispositivos: Dispositivo[];
  sucursales: Sucursal[];
  cuarentena: PinEnCuarentena[];
  empleados: OpcionEmpleado[];
  asignados: PinAsignado[];
}

const formInicial = {
  nombre: "",
  marca: "ZKTECO" as Marca,
  ip: "",
  puerto: "4370",
  usuario: "",
  password: "",
  sucursalId: "",
};

export default function BiometricoClient({
  dispositivos,
  sucursales,
  cuarentena,
  empleados,
  asignados,
}: Props) {
  const router = useRouter();
  const [pestana, setPestana] = useState<"dispositivos" | "pines" | "marcaciones">("dispositivos");
  const [loading, setLoading] = useState(false);
  const [probandoId, setProbandoId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "crear" | "editar">(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(formInicial);

  function abrirCrear() {
    setForm(formInicial);
    setEditId(null);
    setModal("crear");
  }

  function abrirEditar(d: Dispositivo) {
    setForm({
      nombre: d.nombre,
      marca: d.marca,
      ip: d.ip,
      puerto: String(d.puerto),
      usuario: "",
      // Nunca llega del servidor: se deja en blanco y sólo se envía si la
      // reescriben. En blanco significa «no la cambies».
      password: "",
      sucursalId: d.sucursalId ?? "",
    });
    setEditId(d.id);
    setModal("editar");
  }

  /** Al cambiar de marca se ajusta el puerto por defecto, salvo que lo hayan tocado. */
  function cambiarMarca(marca: Marca) {
    setForm((f) => ({
      ...f,
      marca,
      puerto: f.puerto === PUERTO_POR_MARCA[f.marca] ? PUERTO_POR_MARCA[marca] : f.puerto,
    }));
  }

  async function guardar() {
    setLoading(true);
    try {
      const url = modal === "editar" ? `/api/biometrico/dispositivos/${editId}` : "/api/biometrico/dispositivos";
      const method = modal === "editar" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      setModal(null);
      router.refresh();
    } catch {
      alert("No se pudo guardar el dispositivo. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActivo(d: Dispositivo) {
    try {
      const res = await fetch(`/api/biometrico/dispositivos/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !d.activo }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      alert("No se pudo cambiar el estado. Intente nuevamente.");
    }
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar este dispositivo?")) return;
    try {
      const res = await fetch(`/api/biometrico/dispositivos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      alert("No se pudo eliminar. Intente nuevamente.");
    }
  }

  async function probar(id: string) {
    setProbandoId(id);
    try {
      const res = await fetch(`/api/biometrico/probar/${id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo probar la conexión");

      alert(
        `${data.ok ? "✅ Conexión correcta" : "❌ Sin conexión"}\n\n` +
          `Equipo: ${data.dispositivo} (${ETIQUETA_MARCA[data.marca as Marca] ?? data.marca})\n` +
          `Destino: ${data.destino}\n` +
          `Tiempo: ${data.msTranscurridos} ms\n\n` +
          data.detalle
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo probar la conexión.");
    } finally {
      setProbandoId(null);
    }
  }

  async function sincronizar(id: string) {
    setSyncingId(id);
    try {
      const res = await fetch(`/api/biometrico/sync/${id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      const enCuarentena =
        data.enCuarentena > 0
          ? `\n\n${data.enCuarentena} marca(s) con PIN sin asignar quedaron en cuarentena. ` +
            "Asigne el PIN a su empleado para que se conviertan en jornadas."
          : "";
      alert(
        `Sincronización de ${data.dispositivo}\n\n` +
          `Marcas leídas: ${data.eventosLeidos}\n` +
          `Nuevas: ${data.eventosNuevos}\n` +
          `Días registrados: ${data.agregacion.diasProcesados}` +
          enCuarentena
      );
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo sincronizar. Intente nuevamente.");
    } finally {
      setSyncingId(null);
    }
  }

  function nombreSucursal(id: string | null) {
    if (!id) return "Todas";
    return sucursales.find((s) => s.id === id)?.nombre ?? "—";
  }

  function nombreDispositivo(id: string) {
    return dispositivos.find((d) => d.id === id)?.nombre ?? "—";
  }

  function formatSync(fecha: string | null) {
    if (!fecha) return "Nunca";
    return new Date(fecha).toLocaleString("es-HN", { dateStyle: "short", timeStyle: "short" });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reloj biométrico</h1>
          <p className="text-sm text-gray-500">Dispositivos ZKTeco y Hikvision, y sincronización de asistencia</p>
        </div>
        {pestana === "dispositivos" && (
          <button
            onClick={abrirCrear}
            className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800"
          >
            Agregar dispositivo
          </button>
        )}
      </div>

      {/* Pestañas */}
      <div className="flex gap-1 border-b border-gray-200">
        {([
          ["dispositivos", "Dispositivos", 0],
          ["pines", "Conciliación de PIN", cuarentena.length],
          ["marcaciones", "Marcaciones", 0],
        ] as const).map(([id, etiqueta, pendientes]) => (
          <button
            key={id}
            onClick={() => setPestana(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              pestana === id
                ? "border-blue-700 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {etiqueta}
            {pendientes > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs">
                {pendientes}
              </span>
            )}
          </button>
        ))}
      </div>

      {pestana === "pines" && (
        <CuarentenaPines
          cuarentena={cuarentena}
          empleados={empleados}
          asignados={asignados}
          nombreDispositivo={nombreDispositivo}
        />
      )}

      {pestana === "marcaciones" && (
        <MarcacionesDetalle
          dispositivos={dispositivos.map((d) => ({ id: d.id, nombre: d.nombre }))}
          empleados={empleados}
        />
      )}

      {pestana === "dispositivos" && (
      <>
      {/* Info banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
        <span className="text-amber-500 text-xl shrink-0">⚠️</span>
        <div className="text-sm text-amber-800">
          <p className="font-medium mb-1">Falta el driver de comunicación con el equipo</p>
          <p>
            La tubería completa ya funciona: ingesta idempotente, cuarentena de PIN sin asignar,
            reparto de jornada y registro en Asistencia. Lo que falta es la pieza que habla con cada
            marca &mdash; <strong>ISAPI</strong> para Hikvision y{" "}
            <code className="bg-amber-100 px-1 rounded">node-zklib</code> para ZKTeco &mdash; y para
            escribirla hace falta el modelo exacto del equipo. Hasta entonces, &laquo;Sincronizar&raquo;
            responde diciendo qué driver falta.
          </p>
        </div>
      </div>

      {/* Tabla dispositivos */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Dispositivo</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Marca</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Dirección</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Sucursal</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Última Sync</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {dispositivos.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-gray-400">
                  No hay dispositivos configurados. Agregue el primero.
                </td>
              </tr>
            ) : (
              dispositivos.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${d.activo ? "bg-green-400" : "bg-gray-300"}`} />
                      <span className="font-medium text-gray-900">{d.nombre}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                      {ETIQUETA_MARCA[d.marca] ?? d.marca}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-blue-700">
                    {d.ip}:{d.puerto}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{nombreSucursal(d.sucursalId)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatSync(d.ultimaSync)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActivo(d)}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                        d.activo
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {d.activo ? "Activo" : "Inactivo"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {/* Antes de sincronizar: separa un fallo de red de uno de
                          credenciales o de ingesta. Se permite aun inactivo,
                          que es justo cuando se está diagnosticando. */}
                      <button
                        onClick={() => probar(d.id)}
                        disabled={probandoId === d.id}
                        className="px-3 py-1 border border-blue-200 text-blue-700 text-xs rounded-lg hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {probandoId === d.id ? "Probando…" : "Probar conexión"}
                      </button>
                      <button
                        onClick={() => sincronizar(d.id)}
                        disabled={syncingId === d.id || !d.activo}
                        className="px-3 py-1 bg-blue-700 text-white text-xs rounded-lg hover:bg-blue-800 disabled:bg-blue-300 disabled:cursor-not-allowed"
                      >
                        {syncingId === d.id ? "Sync..." : "Sincronizar"}
                      </button>
                      <button
                        onClick={() => abrirEditar(d)}
                        className="px-3 py-1 border border-gray-200 text-gray-600 text-xs rounded-lg hover:bg-gray-50"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => eliminar(d.id)}
                        className="px-3 py-1 border border-red-200 text-red-600 text-xs rounded-lg hover:bg-red-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Guía de configuración */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">Pasos para conectar un reloj</h2>
        <ol className="space-y-2 text-sm text-gray-600 list-none">
          {[
            ["1", "Conecte el reloj a la misma red local que el servidor donde corre NominaHN."],
            ["2", "Anote la IP del equipo: en ZKTeco, Menú → Comunicación → Ethernet; en Hikvision, Red → TCP/IP."],
            ["3", "Agregue el dispositivo aquí eligiendo su marca. Hikvision pide además usuario y contraseña del equipo."],
            ["4", 'Presione "Sincronizar" para traer las marcaciones.'],
            ["5", "Los PIN que el reloj reporte y no estén asignados quedan en cuarentena: asígnelos a su empleado y las marcas anteriores se procesan solas."],
            ["6", "Para que sea automático, programe un cron que llame a POST /api/cron/biometrico con el encabezado x-cron-secret."],
          ].map(([n, text]) => (
            <li key={n} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">{n}</span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </div>
      </>
      )}

      {/* Modal crear/editar */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-gray-900 text-lg">
              {modal === "crear" ? "Agregar Dispositivo" : "Editar Dispositivo"}
            </h3>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Nombre del dispositivo</label>
              <input
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Reloj Principal Tegucigalpa"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Marca</label>
              <select
                value={form.marca}
                onChange={(e) => cambiarMarca(e.target.value as Marca)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ZKTECO">ZKTeco &mdash; protocolo propietario, puerto 4370</option>
                <option value="HIKVISION">Hikvision &mdash; ISAPI sobre HTTP, puerto 80</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Dirección IP</label>
                <input
                  value={form.ip}
                  onChange={(e) => setForm((f) => ({ ...f, ip: e.target.value }))}
                  placeholder="192.168.1.100"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Puerto</label>
                <input
                  type="number"
                  value={form.puerto}
                  onChange={(e) => setForm((f) => ({ ...f, puerto: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Hikvision autentica cada petición ISAPI con Digest; ZKTeco no. */}
            {form.marca === "HIKVISION" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Usuario del equipo</label>
                  <input
                    value={form.usuario}
                    onChange={(e) => setForm((f) => ({ ...f, usuario: e.target.value }))}
                    placeholder="admin"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Contraseña</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder={modal === "editar" ? "Sin cambios" : ""}
                    autoComplete="new-password"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Se guarda cifrada y nunca se devuelve al navegador.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Sucursal (opcional)</label>
              <select
                value={form.sucursalId}
                onChange={(e) => setForm((f) => ({ ...f, sucursalId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todas las sucursales</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setModal(null)}
                className="flex-1 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={loading || !form.nombre || !form.ip}
                className="flex-1 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 disabled:bg-blue-400"
              >
                {loading ? "Guardando..." : modal === "crear" ? "Agregar" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
