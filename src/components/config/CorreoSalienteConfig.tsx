"use client";

/**
 * Configuración → Correo saliente. Sólo para quien tiene `configuracion.correo`
 * (por omisión, SUPER_ADMIN).
 *
 * La contraseña nunca vuelve del servidor: el campo aparece vacío y dejarlo así
 * conserva la guardada. El botón de prueba envía un correo real con lo GUARDADO,
 * para descubrir un servidor mal configurado hoy y no el día de pago.
 */

import { useEffect, useState } from "react";
import { useAvisos } from "@/components/ui/Avisos";
import EstadoBadge from "@/components/ui/EstadoBadge";

interface Estado {
  configuracion: {
    host: string;
    puerto: number;
    seguro: boolean;
    usuario: string | null;
    tienePassword: boolean;
    remitenteNombre: string;
    remitenteCorreo: string;
    activo: boolean;
    actualizadoPor: string | null;
    updatedAt: string;
  } | null;
  origenVigente: "CONFIGURACION" | "ENTORNO" | null;
  cifradoDisponible: boolean;
}

/** Valores típicos de los proveedores más usados, para no teclearlos de memoria. */
const PRESETS: Record<string, { host: string; puerto: number; seguro: boolean }> = {
  "Gmail / Google Workspace": { host: "smtp.gmail.com", puerto: 587, seguro: false },
  "Outlook / Microsoft 365": { host: "smtp.office365.com", puerto: 587, seguro: false },
  "Zoho Mail": { host: "smtp.zoho.com", puerto: 465, seguro: true },
};

const campo = "input";
const etiqueta = "mb-1 block text-sm font-medium text-gray-800";

export default function CorreoSalienteConfig() {
  const { avisar } = useAvisos();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [destinoPrueba, setDestinoPrueba] = useState("");
  const [form, setForm] = useState({
    host: "",
    puerto: "587",
    seguro: false,
    usuario: "",
    password: "",
    remitenteNombre: "Recursos Humanos",
    remitenteCorreo: "",
    activo: true,
  });

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch("/api/configuracion/correo");
        const d = await res.json().catch(() => ({}));
        if (!vivo) return;
        if (!res.ok) throw new Error(d.error ?? "No se pudo cargar la configuración");
        setEstado(d);
        if (d.configuracion) {
          const c = d.configuracion;
          setForm({
            host: c.host,
            puerto: String(c.puerto),
            seguro: c.seguro,
            usuario: c.usuario ?? "",
            password: "",
            remitenteNombre: c.remitenteNombre,
            remitenteCorreo: c.remitenteCorreo,
            activo: c.activo,
          });
        }
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudo cargar la configuración");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [recarga]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function aplicarPreset(nombre: string) {
    const p = PRESETS[nombre];
    if (p) setForm((f) => ({ ...f, host: p.host, puerto: String(p.puerto), seguro: p.seguro }));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/configuracion/correo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          puerto: Number(form.puerto),
          // Vacía = conservar la guardada.
          password: form.password === "" ? undefined : form.password,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const campos = d.detalles
          ? Object.entries(d.detalles).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`)
          : [];
        throw new Error([d.error ?? "No se pudo guardar", ...campos].join("\n"));
      }
      avisar.exito("Configuración de correo guardada.");
      setRecarga((r) => r + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function probar() {
    if (!destinoPrueba) {
      avisar.error("Escriba el correo al que enviar la prueba.");
      return;
    }
    setProbando(true);
    try {
      const res = await fetch("/api/configuracion/correo/prueba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destino: destinoPrueba }),
      });
      const d = await res.json().catch(() => ({}));
      if (d.ok) avisar.exito(d.detalle);
      else avisar.error(`No se pudo enviar.\n\n${d.error ?? "Error desconocido"}`);
    } catch {
      avisar.error("No se pudo contactar al servidor de la aplicación.");
    } finally {
      setProbando(false);
    }
  }

  if (!estado && !error) return <p className="text-sm text-gray-500">Cargando…</p>;

  const origen = estado?.origenVigente;
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="panel p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-800">Servidor de correo saliente (SMTP)</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Con este servidor se envían los comprobantes de pago a los empleados.
          </p>
          <p className="mt-2">
            {origen === "CONFIGURACION" && (
              <EstadoBadge valor="CONFIGURACION" tono="ok" etiqueta="En uso: esta configuración" />
            )}
            {origen === "ENTORNO" && (
              <EstadoBadge valor="ENTORNO" tono="aviso" etiqueta="En uso: variables de entorno del servidor. Al guardar aquí, esta configuración las reemplaza." className="whitespace-normal" />
            )}
            {!origen && (
              <EstadoBadge valor="SIN_SERVIDOR" tono="error" etiqueta="Sin servidor de correo: los comprobantes no se pueden enviar." className="whitespace-normal" />
            )}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 whitespace-pre-line">
            {error}
          </div>
        )}
        {estado && !estado.cifradoDisponible && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            Falta <code>CIFRADO_KEY</code> en el entorno del servidor: sin ella no se puede guardar la contraseña,
            porque no se almacena en claro.
          </div>
        )}

        <label className="block"><span className={etiqueta}>Proveedor (opcional)</span>
          <select defaultValue="" onChange={(e) => aplicarPreset(e.target.value)} className={campo}>
            <option value="">Otro / escribir los datos a mano</option>
            {Object.keys(PRESETS).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-3 gap-3">
          <label className="block col-span-2"><span className={etiqueta}>Servidor SMTP *</span>
            <input value={form.host} onChange={(e) => set("host", e.target.value)} className={campo}
              placeholder="smtp.suempresa.hn" />
          </label>
          <label className="block"><span className={etiqueta}>Puerto *</span>
            <input type="number" value={form.puerto} onChange={(e) => set("puerto", e.target.value)} className={campo} />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.seguro} onChange={(e) => set("seguro", e.target.checked)} />
          Conexión SSL/TLS directa (normalmente puerto 465). Sin marcar se usa STARTTLS (puerto 587).
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={etiqueta}>Usuario</span>
            <input value={form.usuario} onChange={(e) => set("usuario", e.target.value)} className={campo}
              placeholder="nomina@suempresa.hn" autoComplete="off" />
          </label>
          <label className="block"><span className={etiqueta}>Contraseña</span>
            <input type="password" value={form.password} onChange={(e) => set("password", e.target.value)}
              className={campo} autoComplete="new-password"
              placeholder={estado?.configuracion?.tienePassword ? "•••••• (sin cambios)" : ""} />
            <p className="text-xs text-gray-500 mt-1">
              Se guarda cifrada y nunca se muestra. En Gmail use una «contraseña de aplicación».
            </p>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={etiqueta}>Nombre del remitente *</span>
            <input value={form.remitenteNombre} onChange={(e) => set("remitenteNombre", e.target.value)} className={campo} />
          </label>
          <label className="block"><span className={etiqueta}>Correo del remitente *</span>
            <input type="email" value={form.remitenteCorreo} onChange={(e) => set("remitenteCorreo", e.target.value)}
              className={campo} placeholder="nomina@suempresa.hn" />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.activo} onChange={(e) => set("activo", e.target.checked)} />
          Usar esta configuración para enviar los comprobantes
        </label>

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-gray-500">
            {estado?.configuracion
              ? `Última modificación: ${new Date(estado.configuracion.updatedAt).toLocaleString("es-HN")}` +
                (estado.configuracion.actualizadoPor ? ` por ${estado.configuracion.actualizadoPor}` : "")
              : "Todavía no se ha guardado ninguna configuración."}
          </p>
          <button onClick={guardar} disabled={guardando} className="btn btn-primary">
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      <div className="panel p-6 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">Enviar un correo de prueba</h3>
        <p className="text-xs text-gray-500">
          Usa la configuración guardada. Guarde primero si hizo cambios.
        </p>
        <div className="flex gap-2">
          <input type="email" value={destinoPrueba} onChange={(e) => setDestinoPrueba(e.target.value)}
            className={campo} placeholder="su.correo@suempresa.hn" aria-label="Correo al que enviar la prueba" />
          <button onClick={probar} disabled={probando} className="btn btn-secondary">
            {probando ? "Enviando…" : "Enviar prueba"}
          </button>
        </div>
      </div>
    </div>
  );
}
