"use client";

/**
 * Cambio de la propia contraseña.
 *
 * No existía ninguna forma de hacerlo desde la aplicación: una cuenta creada por
 * el seed se quedaba con `Admin1234!` para siempre. Es también el paso final del
 * ciclo de la clave temporal que fija un administrador.
 *
 * La política se comprueba EN VIVO mientras se escribe, además de en el
 * servidor: enterarse de los cinco requisitos de uno en uno, con un viaje al
 * servidor por intento, es la forma más rápida de que alguien acabe eligiendo lo
 * mínimo que el sistema le deje pasar.
 */

import { useState } from "react";

interface Props {
  /** Correo y nombre: la contraseña no puede contenerlos. */
  contexto?: string[];
  /** Se llega con una clave temporal y hay que cambiarla. */
  obligatorio?: boolean;
}

const REQUISITOS: Array<{ texto: string; cumple: (p: string) => boolean }> = [
  { texto: "Al menos 10 caracteres", cumple: (p) => p.length >= 10 },
  { texto: "Al menos una letra", cumple: (p) => /[a-záéíóúñ]/i.test(p) },
  { texto: "Al menos un número", cumple: (p) => /\d/.test(p) },
  { texto: "Al menos un símbolo", cumple: (p) => /[^A-Za-z0-9]/.test(p) },
];

export default function CambiarPassword({ contexto = [], obligatorio }: Props) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tono: "ok" | "error"; texto: string; detalles?: string[] } | null>(null);

  const cumplidos = REQUISITOS.map((r) => r.cumple(nueva));
  const contieneDatos = contexto.some((dato) =>
    dato
      .toLowerCase()
      .split(/[@.\s_-]+/)
      .some((f) => f.length >= 4 && nueva.toLowerCase().includes(f))
  );
  const coinciden = nueva.length > 0 && nueva === repetida;
  const listo = cumplidos.every(Boolean) && coinciden && !contieneDatos && actual.length > 0;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setMensaje(null);
    try {
      const res = await fetch("/api/mi-cuenta/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual, nueva }),
      });
      const datos = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMensaje({
          tono: "error",
          texto: datos.error ?? "No se pudo cambiar la contraseña.",
          detalles: datos.detalles,
        });
        return;
      }
      setMensaje({ tono: "ok", texto: "Contraseña actualizada." });
      setActual("");
      setNueva("");
      setRepetida("");
    } catch {
      setMensaje({ tono: "error", texto: "No se pudo conectar con el servidor." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form
      onSubmit={enviar}
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4 max-w-md"
    >
      <div>
        <h2 className="font-semibold text-gray-900">Cambiar contraseña</h2>
        {obligatorio && (
          <p className="text-sm text-amber-700 mt-1">
            Su contraseña actual es temporal. Cámbiela para que sólo usted la conozca.
          </p>
        )}
      </div>

      {mensaje && (
        <div
          className={`px-3 py-2 rounded-lg text-sm ${
            mensaje.tono === "ok"
              ? "bg-green-50 border border-green-200 text-green-800"
              : "bg-red-50 border border-red-200 text-red-800"
          }`}
        >
          {mensaje.texto}
          {mensaje.detalles && (
            <ul className="list-disc list-inside mt-1 text-xs">
              {mensaje.detalles.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label className="block">
        <span className="block text-xs text-gray-600 mb-1">Contraseña actual</span>
        <input
          type={mostrar ? "text" : "password"}
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          autoComplete="current-password"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
      </label>

      <label className="block">
        <span className="block text-xs text-gray-600 mb-1">Contraseña nueva</span>
        <input
          type={mostrar ? "text" : "password"}
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          autoComplete="new-password"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
      </label>

      <label className="block">
        <span className="block text-xs text-gray-600 mb-1">Repítala</span>
        <input
          type={mostrar ? "text" : "password"}
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
          autoComplete="new-password"
          className={`w-full px-3 py-2 border rounded-lg text-sm ${
            repetida && !coinciden ? "border-red-300" : "border-gray-300"
          }`}
        />
        {repetida && !coinciden && (
          <span className="block text-xs text-red-600 mt-1">Las dos contraseñas no coinciden.</span>
        )}
      </label>

      <label className="flex items-center gap-2 text-xs text-gray-600">
        <input type="checkbox" checked={mostrar} onChange={(e) => setMostrar(e.target.checked)} />
        Mostrar lo que escribo
      </label>

      <ul className="space-y-1 text-xs">
        {REQUISITOS.map((r, i) => (
          <li key={r.texto} className={cumplidos[i] ? "text-green-700" : "text-gray-500"}>
            {cumplidos[i] ? "✓" : "○"} {r.texto}
          </li>
        ))}
        <li className={contieneDatos ? "text-red-600" : "text-gray-500"}>
          {contieneDatos ? "✕" : "○"} No debe contener su nombre ni su correo
        </li>
      </ul>

      <button
        type="submit"
        disabled={!listo || enviando}
        className="w-full px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {enviando ? "Guardando…" : "Cambiar contraseña"}
      </button>
    </form>
  );
}
