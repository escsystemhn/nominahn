"use client";

import { useState } from "react";

const CAMPO_TRAMPA = "sitio_web"; // igual que en src/lib/talento/empleos.ts

export default function FormularioPostulacion({ vacanteId, empresa, maxMb }: { vacanteId: string; empresa: string; maxMb: number }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [listo, setListo] = useState<string | null>(null);
  const [archivo, setArchivo] = useState<string | null>(null);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setErrores({});
    const form = new FormData(e.currentTarget);
    const cv = form.get("cv");
    if (cv instanceof File && cv.size > maxMb * 1024 * 1024) {
      setErrores({ cv: [`El archivo pasa de ${maxMb} MB.`] });
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch(`/api/empleos/${vacanteId}/postular`, { method: "POST", body: form });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? "No se pudo enviar la postulación.");
        setErrores(d.detalles ?? {});
        return;
      }
      setListo(d.mensaje ?? "Recibimos su postulación.");
    } catch {
      setError("No hay conexión. Intente de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <div className="border-l-4 border-[#20B1D2] bg-blue-50 px-5 py-4" role="status">
        <p className="font-medium text-blue-900">Postulación enviada</p>
        <p className="mt-1 text-sm text-gray-700">{listo}</p>
      </div>
    );
  }

  const err = (k: string) =>
    errores[k]?.length ? <p id={`err-${k}`} className="mt-1 text-xs text-red-700">{errores[k].join(" ")}</p> : null;
  const descr = (k: string) => (errores[k]?.length ? { "aria-invalid": true, "aria-describedby": `err-${k}` } : {});

  return (
    <form onSubmit={enviar} className="space-y-4 border border-gray-200 p-5" noValidate>
      <h2 className="text-base font-semibold text-gray-900">Postularse</h2>
      <div>
        <label htmlFor="p-nombre" className="mb-1 block text-sm font-medium text-gray-700">Nombre completo</label>
        <input id="p-nombre" name="nombre" required autoComplete="name" className="input" {...descr("nombre")} />
        {err("nombre")}
      </div>
      <div>
        <label htmlFor="p-email" className="mb-1 block text-sm font-medium text-gray-700">Correo</label>
        <input id="p-email" name="email" type="email" required autoComplete="email" className="input" {...descr("email")} />
        {err("email")}
      </div>
      <div>
        <label htmlFor="p-tel" className="mb-1 block text-sm font-medium text-gray-700">Teléfono <span className="font-normal text-gray-500">(opcional)</span></label>
        <input id="p-tel" name="telefono" type="tel" autoComplete="tel" className="input" {...descr("telefono")} />
        {err("telefono")}
      </div>
      <div>
        <span id="p-cv-titulo" className="mb-1 block text-sm font-medium text-gray-700">Currículo en PDF</span>
        {/* El botón nativo dice «Choose File» o «Elegir archivo» según el navegador: se dibuja uno propio. */}
        <div className="flex items-center gap-3">
          <label className="btn btn-secondary btn-sm cursor-pointer focus-within:ring-2 focus-within:ring-blue-500/40">
            Elegir archivo
            <input id="p-cv" name="cv" type="file" accept="application/pdf,.pdf" required className="sr-only" aria-labelledby="p-cv-titulo" onChange={(e) => setArchivo(e.target.files?.[0]?.name ?? null)} {...descr("cv")} />
          </label>
          <span className="min-w-0 truncate text-sm text-gray-600">{archivo ?? "Ningún archivo elegido"}</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">Hasta {maxMb} MB.</p>
        {err("cv")}
      </div>
      <div>
        <label htmlFor="p-msg" className="mb-1 block text-sm font-medium text-gray-700">Mensaje <span className="font-normal text-gray-500">(opcional)</span></label>
        <textarea id="p-msg" name="mensaje" rows={4} maxLength={1500} className="input" />
      </div>
      {/* Campo trampa: fuera de la vista y del orden de tabulación. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="p-web">No llene este campo</label>
        <input id="p-web" name={CAMPO_TRAMPA} tabIndex={-1} autoComplete="off" />
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" name="consentimiento" value="si" required className="mt-1" {...descr("consentimiento")} />
        <span>Acepto que {empresa} guarde mis datos y mi currículo para sus procesos de selección de personal.</span>
      </label>
      {err("consentimiento")}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={enviando}>
        {enviando ? "Enviando…" : "Enviar postulación"}
      </button>
    </form>
  );
}
