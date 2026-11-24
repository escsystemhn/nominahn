"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";
import CuarentenaPines, {
  type PinEnCuarentena,
  type OpcionEmpleado,
  type PinAsignado,
} from "./CuarentenaPines";
import MarcacionesDetalle from "./MarcacionesDetalle";
import type { NivelesEstructura } from "@/lib/organizacion/estructura";

type Marca = "ZKTECO" | "HIKVISION";

interface Dispositivo {
  id: string;
  nombre: string;
  marca: Marca;
  ip: string;
  puerto: number;
  usuario: string | null;
  sucursalId: string | null;
  activo: boolean;
  ultimaSync: string | null;
}

const CAMPO: Record<string, string> = { nombre: "nombre", marca: "marca", ip: "dirección IP", puerto: "puerto", usuario: "usuario", password: "contraseña", sucursalId: "grupo" };

/** El motivo que da el servidor (antes se cambiaba siempre por «Intente nuevamente», y no se sabía qué corregir). */
async function motivo(res: Response, porOmision: string): Promise<string> {
  const d = await res.json().catch(() => ({}));
  const campos = d.detalles ? Object.keys(d.detalles).map((k) => CAMPO[k] ?? k) : [];
  if (d.error && campos.length) return `${d.error}: revise ${campos.join(", ")}.`;
  return d.error ?? porOmision;
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
  niveles: NivelesEstructura;
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
  niveles,
}: Props) {
  const router = useRouter();
  const { confirmar, avisar } = useAvisos();
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
      // Antes llegaba en blanco y, al guardar, borraba el usuario del equipo.
      usuario: d.usuario ?? "",
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
      if (!res.ok) throw new Error(await motivo(res, "No se pudo guardar el dispositivo."));
      setModal(null);
      router.refresh();
    } catch (e) {
      avisar.error(e instanceof Error && e.message ? e.message : "No se pudo conectar con el servidor. Intente nuevamente.");
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
      if (!res.ok) throw new Error(await motivo(res, "No se pudo cambiar el estado."));
      router.refresh();
    } catch (e) {
      avisar.error(e instanceof Error && e.message ? e.message : "No se pudo conectar con el servidor. Intente nuevamente.");
    }
  }

  async function eliminar(id: string) {
    if (!(await confirmar({ titulo: "¿Eliminar este dispositivo?", accion: "Eliminar", peligro: true }))) return;
    try {
      const res = await fetch(`/api/biometrico/dispositivos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await motivo(res, "No se pudo eliminar."));
      router.refresh();
    } catch (e) {
      avisar.error(e instanceof Error && e.message ? e.message : "No se pudo conectar con el servidor. Intente nuevamente.");
    }
  }

  async function probar(id: string) {
    setProbandoId(id);
    try {
      const res = await fetch(`/api/biometrico/probar/${id}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo probar la conexión");

      const resultado =
        `${data.ok ? "Conexión correcta" : "Sin conexión"}\n\n` +
        `Equipo: ${data.dispositivo} (${ETIQUETA_MARCA[data.marca as Marca] ?? data.marca})\n` +
        `Destino: ${data.destino}\n` +
        `Tiempo: ${data.msTranscurridos} ms\n\n` +
        data.detalle;
      if (data.ok) avisar.exito(resultado);
      else avisar.error(resultado);
    } catch (e) {
      avisar.error(e instanceof Error ? e.message : "No se pudo probar la conexión.");
    } finally {
      setProbandoId(null);
    }
  }

  async function sincronizar(id: string) {
    setSyncingId(id);
    try {
      const res = await fetch(`/api/biometrico/sync/${id}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo sincronizar.");
      const enCuarentena =
        data.enCuarentena > 0
          ? `\n\n${data.enCuarentena} marca(s) con PIN sin asignar quedaron en cuarentena. ` +
            "Asigne el PIN a su empleado para que se conviertan en jornadas."
          : "";
      avisar.exito(
        `Sincronización de ${data.dispositivo}\n\n` +
          `Marcas leídas: ${data.eventosLeidos}\n` +
          `Nuevas: ${data.eventosNuevos}\n` +
          `Días registrados: ${data.agregacion.diasProcesados}` +
          enCuarentena
      );
      router.refresh();
    } catch (e) {
      avisar.error(e instanceof Error ? e.message : "No se pudo sincronizar. Intente nuevamente.");
    } finally {
      setSyncingId(null);
    }
  }

  function nombreSucursal(id: string | null) {
    if (!id) return niveles.todasSucursales;
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
    <div className="space-y-6">
      <PageHeader
        title="Reloj biométrico"
        description="Dispositivos ZKTeco y Hikvision, y sincronización de asistencia."
        actions={
          pestana === "dispositivos" && (
            <button onClick={abrirCrear} className="btn btn-primary">
              Agregar dispositivo
            </button>
          )
        }
      />

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
      {/* Aviso: falta conectar con el equipo */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="mb-1 font-medium">Hikvision ya se conecta; ZKTeco todavía no</p>
        <p>
          Con un reloj Hikvision, pulse &laquo;Probar conexión&raquo;: dice si el equipo contesta, si acepta el
          usuario y la contraseña y si entrega el historial de marcas. Después, &laquo;Sincronizar&raquo; trae las
          marcas: la primera vez, las del último mes. Una contraseña equivocada no se reintenta, porque
          el reloj bloquea la conexión tras varios intentos fallidos. Para ZKTeco falta la parte que habla
          con el equipo; hasta entonces responde diciendo qué falta.
        </p>
      </div>

      {/* Tabla dispositivos */}
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
        <table className="table-base tabla-tarjetas">
          <thead>
            <tr>
              <th>Dispositivo</th>
              <th>Marca</th>
              <th>Dirección</th>
              <th>{niveles.sucursal}</th>
              <th>Última sincronización</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {dispositivos.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EstadoVacio
                    titulo="No hay dispositivos configurados."
                    detalle="Agregue el primer reloj para traer las marcaciones de asistencia."
                    accion={
                      <button onClick={abrirCrear} className="btn btn-secondary">
                        Agregar dispositivo
                      </button>
                    }
                  />
                </td>
              </tr>
            ) : (
              dispositivos.map((d) => (
                <tr key={d.id}>
                  <td data-titulo className="font-medium text-gray-900">{d.nombre}</td>
                  <td data-etiqueta="Marca">{ETIQUETA_MARCA[d.marca] ?? d.marca}</td>
                  <td data-etiqueta="Dirección" className="font-mono text-xs text-blue-700">
                    {d.ip}:{d.puerto}
                  </td>
                  <td data-etiqueta={niveles.sucursal} className="text-gray-600">{nombreSucursal(d.sucursalId)}</td>
                  <td data-etiqueta="Última sincronización" className="text-xs text-gray-500">{formatSync(d.ultimaSync)}</td>
                  <td data-etiqueta="Estado">
                    <button
                      onClick={() => toggleActivo(d)}
                      title="Haga clic para activar o desactivar el dispositivo"
                      className="rounded px-1 py-0.5 hover:bg-gray-100"
                    >
                      <EstadoBadge valor={d.activo ? "ACTIVO" : "INACTIVO"} />
                    </button>
                  </td>
                  <td data-accion>
                    <div className="flex flex-wrap items-center gap-1">
                      {/* Antes de sincronizar: separa un fallo de red de uno de
                          credenciales o de ingesta. Se permite aun inactivo,
                          que es justo cuando se está diagnosticando. */}
                      <button
                        onClick={() => probar(d.id)}
                        disabled={probandoId === d.id}
                        className="btn btn-secondary btn-sm"
                      >
                        {probandoId === d.id ? "Probando…" : "Probar conexión"}
                      </button>
                      <button
                        onClick={() => sincronizar(d.id)}
                        disabled={syncingId === d.id || !d.activo}
                        className="btn btn-secondary btn-sm"
                      >
                        {syncingId === d.id ? "Sincronizando…" : "Sincronizar"}
                      </button>
                      <button
                        onClick={() => abrirEditar(d)}
                        className="btn btn-ghost btn-sm"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => eliminar(d.id)}
                        className="btn btn-sm border border-red-300 bg-white text-red-700 hover:bg-red-50"
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
      </div>

      {/* Guía de configuración */}
      <div className="panel p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">Pasos para conectar un reloj</h2>
        <ol className="space-y-2 text-sm text-gray-600 list-none">
          {[
            ["1", "Conecte el reloj a la misma red local que el servidor donde corre el sistema."],
            ["2", "Anote la IP del equipo: en ZKTeco, Menú, Comunicación, Ethernet; en Hikvision, Red, TCP/IP."],
            ["3", "Agregue el dispositivo aquí eligiendo su marca. Hikvision pide además usuario y contraseña del equipo."],
            ["4", "Presione «Probar conexión»: si el reloj contesta y acepta el usuario, «Sincronizar» trae las marcaciones (la primera vez, las del último mes)."],
            ["5", "Los PIN que el reloj reporte y no estén asignados quedan en cuarentena: asígnelos a su empleado y las marcas anteriores se procesan solas."],
            ["6", "Para que sea automático, pida a quien administra el servidor que programe una llamada periódica a POST /api/cron/biometrico con el encabezado x-cron-secret."],
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
          <div className="panel shadow-2xl p-6 w-full max-w-md space-y-4" role="dialog" aria-modal="true" aria-labelledby="dispositivo-titulo">
            <h3 id="dispositivo-titulo" className="font-semibold text-gray-900 text-lg">
              {modal === "crear" ? "Agregar dispositivo" : "Editar dispositivo"}
            </h3>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-800">Nombre del dispositivo</span>
              <input
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej.: Reloj principal Tegucigalpa"
                className="input"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-800">Marca</span>
              <select
                value={form.marca}
                onChange={(e) => cambiarMarca(e.target.value as Marca)}
                className="input"
              >
                <option value="ZKTECO">ZKTeco &mdash; protocolo propietario, puerto 4370</option>
                <option value="HIKVISION">Hikvision &mdash; ISAPI sobre HTTP, puerto 80</option>
              </select>
            </label>

            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-2 block text-sm">
                <span className="mb-1 block font-medium text-gray-800">Dirección IP</span>
                <input
                  value={form.ip}
                  onChange={(e) => setForm((f) => ({ ...f, ip: e.target.value }))}
                  placeholder="192.168.1.100"
                  className="input font-mono"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-800">Puerto</span>
                <input
                  type="number"
                  value={form.puerto}
                  onChange={(e) => setForm((f) => ({ ...f, puerto: e.target.value }))}
                  className="input font-mono"
                />
              </label>
            </div>

            {/* Hikvision autentica cada petición ISAPI con Digest; ZKTeco no. */}
            {form.marca === "HIKVISION" && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-gray-800">Usuario del equipo</span>
                  <input
                    value={form.usuario}
                    onChange={(e) => setForm((f) => ({ ...f, usuario: e.target.value }))}
                    placeholder="admin"
                    className="input"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-gray-800">Contraseña</span>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder={modal === "editar" ? "Sin cambios" : ""}
                    autoComplete="new-password"
                    className="input"
                  />
                  <span className="mt-1 block text-xs text-gray-500">
                    Se guarda cifrada y nunca se devuelve al navegador.
                  </span>
                </label>
              </div>
            )}

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-800">{niveles.sucursal} (opcional)</span>
              <select
                value={form.sucursalId}
                onChange={(e) => setForm((f) => ({ ...f, sucursalId: e.target.value }))}
                className="input"
              >
                <option value="">{niveles.todasSucursales}</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setModal(null)}
                className="btn btn-ghost"
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={loading || !form.nombre || !form.ip}
                className="btn btn-primary"
              >
                {loading ? "Guardando…" : modal === "crear" ? "Agregar" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
