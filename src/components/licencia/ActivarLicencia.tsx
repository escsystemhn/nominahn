"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Formularios de activación. Con servidor de licencias configurado se ofrece
 * primero la llave (lo normal con internet); el archivo .lic queda siempre
 * disponible para servidores sin salida a internet.
 */
export default function ActivarLicencia({ enLinea, codigoEquipo }: { enLinea: boolean; codigoEquipo: string | null }) {
  const router = useRouter();
  const [via, setVia] = useState<"llave" | "archivo">(enLinea ? "llave" : "archivo");
  const [llave, setLlave] = useState("");
  const [archivo, setArchivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function cargarArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setArchivo((await f.text()).trim());
  }

  async function activar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError("");
    try {
      const r = await fetch("/api/licencia/activar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(via === "llave" ? { llave } : { archivo }),
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(datos.error ?? "No se pudo activar la licencia.");
        return;
      }
      setListo(true);
      router.refresh();
    } catch {
      setError("No se pudo contactar al servidor de Gestión360.");
    } finally {
      setEnviando(false);
    }
  }

  async function copiar() {
    if (!codigoEquipo) return;
    try {
      await navigator.clipboard.writeText(codigoEquipo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin portapapeles (HTTP sin TLS): el código sigue visible para copiarlo a mano */
    }
  }

  if (listo) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-semibold">Licencia activada.</p>
        <p className="mt-1">
          Ya puede seguir trabajando.{" "}
          <a href="/dashboard" className="font-medium underline underline-offset-2">
            Ir al sistema
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {codigoEquipo && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Código de este equipo</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="rounded-md bg-gray-100 px-3 py-1.5 font-mono text-base tracking-wider text-gray-900">
              {codigoEquipo}
            </code>
            <button type="button" onClick={copiar} className="btn btn-secondary btn-sm">
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            ESC System lo necesita para emitir la licencia de este servidor.
          </p>
        </div>
      )}

      <div role="tablist" className="flex gap-1 border-b border-gray-200">
        {enLinea && (
          <button
            role="tab"
            type="button"
            aria-selected={via === "llave"}
            onClick={() => setVia("llave")}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${via === "llave" ? "border-blue-700 font-medium text-blue-800" : "border-transparent text-gray-500 hover:text-gray-800"}`}
          >
            Tengo una llave
          </button>
        )}
        <button
          role="tab"
          type="button"
          aria-selected={via === "archivo"}
          onClick={() => setVia("archivo")}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${via === "archivo" ? "border-blue-700 font-medium text-blue-800" : "border-transparent text-gray-500 hover:text-gray-800"}`}
        >
          Tengo un archivo de activación
        </button>
      </div>

      <form onSubmit={activar} className="space-y-3">
        {via === "llave" ? (
          <label className="block text-sm">
            <span className="font-medium text-gray-800">Llave de licencia</span>
            <input
              className="input mt-1 font-mono uppercase tracking-wider"
              value={llave}
              onChange={(e) => setLlave(e.target.value)}
              placeholder="NOMI-XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              required
            />
            <span className="mt-1 block text-xs text-gray-500">
              El servidor necesita salida a internet para canjearla.
            </span>
          </label>
        ) : (
          <div className="space-y-2 text-sm">
            <label className="block">
              <span className="font-medium text-gray-800">Archivo .lic</span>
              <input type="file" accept=".lic,.txt" onChange={cargarArchivo} className="mt-1 block text-sm" />
            </label>
            <label className="block">
              <span className="text-gray-600">o pegue su contenido (empieza con «SDL1.»)</span>
              <textarea
                className="input mt-1 font-mono text-xs"
                rows={4}
                value={archivo}
                onChange={(e) => setArchivo(e.target.value)}
                spellCheck={false}
                required
              />
            </label>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={enviando}>
          {enviando ? "Activando…" : "Activar"}
        </button>
      </form>
    </div>
  );
}
