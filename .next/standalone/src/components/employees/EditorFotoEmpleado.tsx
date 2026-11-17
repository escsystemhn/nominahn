"use client";

/**
 * Foto del empleado: tomarla con la cámara (frontal o trasera) o subir una imagen (también
 * arrastrándola), ajustar el recorte cuadrado y guardarla.
 *
 * Con `empleadoId` se guarda al momento (PUT /api/empleados/[id]/foto). Sin él —el alta, que
 * todavía no tiene id— la foto preparada se entrega a `onPreparada` y la sube el formulario
 * después de crear al empleado.
 *
 * La cámara exige conexión segura (https o localhost) y que la cabecera Permissions-Policy
 * la permita para el propio sitio (`camera=(self)`, next.config.ts).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import FotoAvatar from "./FotoAvatar";
import { recorteCuadrado } from "@/lib/empleados/foto";
import { abrirImagen, prepararFoto } from "@/lib/empleados/foto-navegador";

type Fuente = { imagen: CanvasImageSource; ancho: number; alto: number };
const VISTA = 288;
const limitar = (v: number) => Math.max(-1, Math.min(1, v));

function mensajeCamara(e: unknown): string {
  const n = e instanceof DOMException ? e.name : "";
  if (n === "NotAllowedError" || n === "SecurityError") return "El navegador no dio permiso para usar la cámara. Actívelo en el candado de la barra de direcciones y vuelva a intentarlo, o suba una imagen.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "No se encontró una cámara en este equipo. Puede subir una imagen.";
  if (n === "NotReadableError") return "La cámara está ocupada por otra aplicación (Teams, Zoom…). Ciérrela y vuelva a intentarlo.";
  return "No se pudo abrir la cámara. Puede subir una imagen.";
}

function Dialogo({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="panel max-h-full w-full max-w-xl space-y-4 overflow-y-auto p-5 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

export default function EditorFotoEmpleado({ empleadoId, version: versionInicial, nombre, puedeEditar = true, onPreparada }: {
  empleadoId?: string;
  version?: number | null;
  nombre: string;
  puedeEditar?: boolean;
  onPreparada?: (foto: Blob | null) => void;
}) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [version, setVersion] = useState<number | null>(versionInicial ?? null);
  const [local, setLocal] = useState<string | null>(null);
  const [vista, setVista] = useState<"nada" | "camara" | "recorte">("nada");
  const [frente, setFrente] = useState<"user" | "environment">("user");
  const [variasCamaras, setVariasCamaras] = useState(false);
  const [lista, setLista] = useState(false);
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const [zoom, setZoom] = useState(1);
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [encima, setEncima] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const flujo = useRef<MediaStream | null>(null);
  const arrastre = useRef<{ x: number; y: number } | null>(null);

  // La cámara se enciende al abrir su ventana y se apaga al cerrarla o al cambiar de cámara.
  useEffect(() => {
    if (vista !== "camara") return;
    let vivo = true;
    (async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("INSEGURO");
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: frente, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        if (!vivo) return s.getTracks().forEach((t) => t.stop());
        flujo.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => {});
        }
        const dispositivos = await navigator.mediaDevices.enumerateDevices();
        if (vivo) {
          setVariasCamaras(dispositivos.filter((d) => d.kind === "videoinput").length > 1);
          setLista(true);
        }
      } catch (e) {
        if (!vivo) return;
        setError(e instanceof Error && e.message === "INSEGURO"
          ? "La cámara sólo funciona en una conexión segura (https) o en el mismo equipo del servidor. Puede subir una imagen."
          : mensajeCamara(e));
        setVista("nada");
      }
    })();
    return () => {
      vivo = false;
      flujo.current?.getTracks().forEach((t) => t.stop());
      flujo.current = null;
    };
  }, [vista, frente]);

  // Vista previa del recorte, redonda como se verá.
  useEffect(() => {
    if (vista !== "recorte" || !fuente || !lienzo.current) return;
    const r = recorteCuadrado(fuente.ancho, fuente.alto, zoom, dx, dy);
    const ctx = lienzo.current.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, VISTA, VISTA);
    ctx.drawImage(fuente.imagen, r.x, r.y, r.lado, r.lado, 0, 0, VISTA, VISTA);
  }, [vista, fuente, zoom, dx, dy]);

  // La vista previa local (alta) se libera al cambiarla o al salir.
  useEffect(() => () => { if (local) URL.revokeObjectURL(local); }, [local]);

  function empezarRecorte(f: Fuente) {
    setFuente(f);
    setZoom(1);
    setDx(0);
    setDy(0);
    setError(null);
    setVista("recorte");
  }

  function capturar() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    empezarRecorte({ imagen: c, ancho: c.width, alto: c.height });
  }

  async function elegir(f: File | undefined) {
    if (!f) return;
    try {
      const img = await abrirImagen(f);
      empezarRecorte({ imagen: img, ancho: img.width, alto: img.height });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir la imagen.");
    }
  }

  async function usar() {
    if (!fuente) return;
    setOcupado(true);
    setError(null);
    try {
      const foto = await prepararFoto(fuente.imagen, recorteCuadrado(fuente.ancho, fuente.alto, zoom, dx, dy));
      if (empleadoId) {
        const r = await fetch(`/api/empleados/${empleadoId}/foto`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: foto });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "No se pudo guardar la foto.");
        setVersion(d.version);
        avisar.exito("Foto guardada.");
        router.refresh();
      } else {
        setLocal(URL.createObjectURL(foto));
        onPreparada?.(foto);
      }
      setVista("nada");
      setFuente(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo preparar la foto.");
    } finally {
      setOcupado(false);
    }
  }

  async function quitar() {
    setError(null);
    if (!empleadoId) {
      setLocal(null);
      onPreparada?.(null);
      return;
    }
    setOcupado(true);
    try {
      const r = await fetch(`/api/empleados/${empleadoId}/foto`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "No se pudo quitar la foto.");
      setVersion(null);
      avisar.exito("Foto quitada.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar la foto.");
    } finally {
      setOcupado(false);
    }
  }

  const recorte = fuente ? recorteCuadrado(fuente.ancho, fuente.alto, zoom, dx, dy) : null;
  const mover = (mx: number, my: number) => {
    if (!fuente || !recorte) return;
    const libreX = fuente.ancho - recorte.lado;
    const libreY = fuente.alto - recorte.lado;
    // Arrastrar la imagen hacia la derecha corre el recorte hacia la izquierda.
    if (libreX > 0) setDx((v) => limitar(v - (2 * mx * recorte.lado) / (VISTA * libreX)));
    if (libreY > 0) setDy((v) => limitar(v - (2 * my * recorte.lado) / (VISTA * libreY)));
  };

  return (
    <div className="flex flex-wrap items-center gap-4" data-editor-foto>
      <div
        className={`rounded-full ${encima ? "ring-4 ring-blue-300" : ""}`}
        onDragOver={(e) => { if (puedeEditar) { e.preventDefault(); setEncima(true); } }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => { if (!puedeEditar) return; e.preventDefault(); setEncima(false); void elegir(e.dataTransfer.files[0]); }}
      >
        {local
          // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob): el optimizador de Next no aplica.
          ? <img src={local} alt={`Foto de ${nombre}`} className="h-28 w-28 rounded-full object-cover" data-foto-local />
          : <FotoAvatar empleadoId={empleadoId ?? "nuevo"} version={version} nombre={nombre || "Nuevo empleado"} tamano="xl" />}
      </div>

      {puedeEditar && (
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary" disabled={ocupado} onClick={() => { setError(null); setLista(false); setVista("camara"); }} data-foto-camara>
              Tomar foto
            </button>
            <button type="button" className="btn btn-secondary" disabled={ocupado} onClick={() => archivo.current?.click()}>
              Subir imagen
            </button>
            {(version !== null || local) && (
              <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={() => void quitar()}>Quitar foto</button>
            )}
          </div>
          <p className="text-xs text-gray-500">JPG, PNG o WebP, o arrástrela sobre el círculo. Se guarda cuadrada, de 512 px, sin los datos de ubicación del teléfono.</p>
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
          <input ref={archivo} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { void elegir(e.target.files?.[0]); e.target.value = ""; }} data-foto-archivo />
        </div>
      )}

      {vista === "camara" && (
        <Dialogo titulo="Tomar foto" onCerrar={() => setVista("nada")}>
          <div className="relative mx-auto aspect-[4/3] w-full overflow-hidden rounded-lg bg-black">
            <video ref={video} playsInline muted className={`h-full w-full object-cover ${frente === "user" ? "-scale-x-100" : ""}`} data-foto-video />
            {/* Guía: la cara dentro del círculo. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="aspect-square h-[85%] rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] ring-2 ring-white/80" />
            </div>
            {!lista && <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white/90">Abriendo la cámara…</p>}
          </div>
          <p className="text-xs text-gray-500">Centre la cara en el círculo, con buena luz de frente. Después podrá ajustar el recorte.</p>
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              {variasCamaras && (
                <button type="button" className="btn btn-ghost" onClick={() => { setLista(false); setFrente((f) => (f === "user" ? "environment" : "user")); }}>
                  Cambiar cámara
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setVista("nada")}>Cancelar</button>
              <button type="button" className="btn btn-primary" disabled={!lista} onClick={capturar} data-foto-capturar>Capturar</button>
            </div>
          </div>
        </Dialogo>
      )}

      {vista === "recorte" && fuente && (
        <Dialogo titulo="Ajustar la foto" onCerrar={() => setVista("nada")}>
          <div className="flex flex-col items-center gap-3">
            <canvas
              ref={lienzo} width={VISTA} height={VISTA} tabIndex={0}
              className="cursor-grab touch-none rounded-full bg-gray-100 shadow-inner focus:outline-none focus:ring-2 focus:ring-blue-400 active:cursor-grabbing"
              aria-label="Vista previa del recorte. Arrástrela o use las flechas para moverla."
              onPointerDown={(e) => { arrastre.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }}
              onPointerMove={(e) => {
                const a = arrastre.current;
                if (!a) return;
                arrastre.current = { x: e.clientX, y: e.clientY };
                mover(e.clientX - a.x, e.clientY - a.y);
              }}
              onPointerUp={() => { arrastre.current = null; }}
              onKeyDown={(e) => {
                const paso = 0.1;
                if (e.key === "ArrowLeft") setDx((v) => limitar(v - paso));
                else if (e.key === "ArrowRight") setDx((v) => limitar(v + paso));
                else if (e.key === "ArrowUp") setDy((v) => limitar(v - paso));
                else if (e.key === "ArrowDown") setDy((v) => limitar(v + paso));
                else return;
                e.preventDefault();
              }}
              data-foto-recorte
            />
            <label className="flex w-full max-w-xs items-center gap-3 text-sm text-gray-700">
              Acercar
              <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1" aria-label="Acercar" data-foto-zoom />
            </label>
          </div>
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setVista("nada")}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={ocupado} onClick={() => void usar()} data-foto-usar>
              {ocupado ? "Guardando…" : "Usar esta foto"}
            </button>
          </div>
        </Dialogo>
      )}
    </div>
  );
}
