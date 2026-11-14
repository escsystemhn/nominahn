"use client";

/**
 * Visor de material de capacitación: se ve aquí y no se descarga.
 *
 * - PDF: pdf.js dibuja cada página en un lienzo; no hay visor del navegador con su
 *   botón de descarga ni de impresión.
 * - Video: sin «Descargar» en los controles, sin imagen en imagen.
 * - Menú contextual, arrastrar, Ctrl+S y Ctrl+P desactivados, y la impresión sale en blanco.
 * - Marca de agua con el nombre, el DNI y la fecha de quien mira.
 *
 * Ningún navegador impide una captura de pantalla o una grabación: la marca de agua es
 * lo que la desanima, porque deja a la vista de quién salió.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Acceso {
  titulo: string;
  visor: "pdf" | "video" | "imagen";
  url: string;
  marca: string;
}

async function pedirAcceso(materialId: string): Promise<Acceso> {
  const r = await fetch(`/api/capacitaciones/material/${materialId}/acceso`, { method: "POST" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof d.error === "string" ? d.error : "No se pudo abrir el material.");
  return d as Acceso;
}

function PaginasPdf({ url, onError }: { url: string; onError: (m: string) => void }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState("Cargando el documento…");

  useEffect(() => {
    let cancelado = false;
    let destruir: (() => void) | null = null;
    const nodo = contenedor.current;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      // El trabajador se sirve desde el propio sitio (la política de contenido no deja otro origen).
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
      // Todo de una vez, sin pedir por partes: el enlace vence en diez minutos.
      const tarea = pdfjs.getDocument({ url, withCredentials: true, disableRange: true, disableStream: true });
      destruir = () => void tarea.destroy();
      const doc = await tarea.promise;
      if (cancelado || !nodo) return;
      setEstado(`${doc.numPages} ${doc.numPages === 1 ? "página" : "páginas"}`);
      const ancho = nodo.clientWidth || 800;
      const densidad = Math.min(2, window.devicePixelRatio || 1);
      for (let i = 1; i <= doc.numPages && !cancelado; i++) {
        const pagina = await doc.getPage(i);
        const base = pagina.getViewport({ scale: 1 });
        const vista = pagina.getViewport({ scale: (ancho / base.width) * densidad });
        const lienzo = document.createElement("canvas");
        lienzo.width = Math.floor(vista.width);
        lienzo.height = Math.floor(vista.height);
        lienzo.style.width = "100%";
        lienzo.className = "mb-3 rounded bg-white shadow";
        lienzo.setAttribute("aria-label", `Página ${i}`);
        nodo.appendChild(lienzo);
        await pagina.render({ canvas: lienzo, canvasContext: lienzo.getContext("2d")!, viewport: vista }).promise;
      }
    })().catch((e: unknown) => {
      if (!cancelado) onError(`No se pudo mostrar el documento${e instanceof Error && e.message ? ` (${e.message})` : ""}.`);
    });
    return () => {
      cancelado = true;
      destruir?.();
      if (nodo) nodo.innerHTML = "";
    };
  }, [url, onError]);

  return (
    <>
      <p className="mb-2 text-xs text-gray-500" data-estado-pdf>{estado}</p>
      <div ref={contenedor} data-paginas-pdf />
    </>
  );
}

export default function VisorMaterial({ materialId, volver }: { materialId: string; volver: string }) {
  const [acceso, setAcceso] = useState<Acceso | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const reanudarEn = useRef<number | null>(null);

  useEffect(() => {
    let vivo = true;
    pedirAcceso(materialId)
      .then((a) => vivo && setAcceso(a))
      .catch((e: Error) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [materialId]);

  // Guardar o imprimir la página no deja el material: se bloquean los atajos.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ["s", "p"].includes(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  /** El enlace vence a los diez minutos: un video largo pide uno nuevo y sigue donde iba. */
  async function renovarVideo() {
    if (!video.current) return;
    reanudarEn.current = video.current.currentTime;
    try {
      setAcceso(await pedirAcceso(materialId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const bloquear = (e: React.SyntheticEvent) => e.preventDefault();

  return (
    <div className="space-y-4" data-visor-material onContextMenu={bloquear} onDragStart={bloquear}>
      <style>{"@media print { [data-visor-material] { display: none !important; } }"}</style>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{acceso?.titulo ?? "Material de capacitación"}</h1>
          <p className="text-xs text-gray-500">Material de consulta: se ve aquí y no se descarga.</p>
        </div>
        <Link href={volver} className="btn btn-secondary">Volver</Link>
      </div>

      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {!acceso && !error && <p className="text-sm text-gray-500">Abriendo…</p>}

      {acceso && (
        <div className="relative select-none overflow-hidden rounded-lg bg-gray-100 p-3">
          {acceso.visor === "pdf" && <PaginasPdf url={acceso.url} onError={setError} />}
          {acceso.visor === "video" && (
            <video
              ref={video}
              key={acceso.url}
              src={acceso.url}
              controls
              controlsList="nodownload noremoteplayback noplaybackrate"
              disablePictureInPicture
              playsInline
              className="w-full rounded bg-black"
              onLoadedMetadata={() => {
                if (video.current && reanudarEn.current !== null) {
                  video.current.currentTime = reanudarEn.current;
                  reanudarEn.current = null;
                  void video.current.play().catch(() => {});
                }
              }}
              onError={() => void renovarVideo()}
              data-video-material
            />
          )}
          {acceso.visor === "imagen" && (
            // eslint-disable-next-line @next/next/no-img-element -- archivo privado servido por la API, no por next/image
            <img src={acceso.url} alt={acceso.titulo} draggable={false} className="mx-auto max-h-[80vh] rounded" />
          )}
          {/* La marca de agua va encima de todo y no estorba al clic ni al desplazamiento. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-3 content-around overflow-hidden" data-marca-agua>
            {Array.from({ length: 18 }, (_, i) => (
              <span key={i} className="-rotate-[25deg] whitespace-nowrap text-center text-sm font-semibold text-gray-900/15">
                {acceso.marca}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
