"use client";

/** Ventana de formulario de las pantallas de configuración y del expediente. */
export function Modal({ titulo, error, cargando, puedeGuardar, textoGuardar = "Guardar", onCerrar, onGuardar, children }: {
  titulo: string; error: string | null; cargando: boolean; puedeGuardar: boolean; textoGuardar?: string;
  onCerrar: () => void; onGuardar: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="panel max-h-full w-full max-w-md space-y-4 overflow-y-auto p-5 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">{titulo}</h3>
        <div className="space-y-3">{children}</div>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={cargando || !puedeGuardar} onClick={onGuardar}>{cargando ? "Guardando…" : textoGuardar}</button>
        </div>
      </div>
    </div>
  );
}

export function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="font-medium text-gray-800">{etiqueta}</span><div className="mt-1">{children}</div></label>;
}
