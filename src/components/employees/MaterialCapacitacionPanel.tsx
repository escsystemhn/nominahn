"use client";

/**
 * Material de una capacitación, para quien la administra: subir (PDF, video, imagen),
 * ver en el visor, quitar, y cuántos inscritos lo abrieron.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAvisos } from "@/components/ui/Avisos";
import { TAMANO_PARTE, nuevaSubida } from "@/lib/capacitaciones/subida";

interface Material {
  id: string;
  titulo: string;
  tipo: "MANUAL" | "VIDEO" | "DOCUMENTO";
  mime: string;
  tamano: number;
  vistos?: number;
  inscritos?: number;
}

const TIPO: Record<Material["tipo"], string> = { MANUAL: "Manual", VIDEO: "Video", DOCUMENTO: "Documento" };
const tamano = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Una parte del archivo, con su avance. */
function enviarParte(capacitacionId: string, subida: string, desde: number, parte: Blob, avance: (bytes: number) => void): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolver) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/capacitaciones/${capacitacionId}/material/partes`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("x-subida", subida);
    xhr.setRequestHeader("x-desde", String(desde));
    xhr.upload.onprogress = (e) => avance(e.loaded);
    xhr.onload = () => {
      let error: string | undefined;
      try {
        error = JSON.parse(xhr.responseText).error;
      } catch {}
      resolver({ ok: xhr.status === 200, error: error ?? (xhr.status === 413 ? "El servidor rechazó el tamaño de la parte." : undefined) });
    };
    xhr.onerror = () => resolver({ ok: false, error: "Se cortó la conexión al subir." });
    xhr.send(parte);
  });
}

/**
 * Sube el archivo por partes de 4 MB y después lo registra. De una sola vez, Next sólo dejaba
 * pasar los primeros 10 MB (y el Caddy de la edición instalable, 6 MB): ver lib/capacitaciones/subida.ts.
 */
async function subir(capacitacionId: string, archivo: File, titulo: string, tipo: string, avance: (p: number) => void): Promise<{ ok: boolean; error?: string }> {
  const subida = nuevaSubida();
  for (let desde = 0; desde < archivo.size; desde += TAMANO_PARTE) {
    const r = await enviarParte(capacitacionId, subida, desde, archivo.slice(desde, desde + TAMANO_PARTE), (b) => avance((desde + b) / archivo.size));
    if (!r.ok) return r;
  }
  const r = await fetch(`/api/capacitaciones/${capacitacionId}/material`, {
    method: "POST",
    headers: { "x-subida": subida, "x-total": String(archivo.size), "x-titulo": encodeURIComponent(titulo), ...(tipo ? { "x-tipo": tipo } : {}) },
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.status === 201, error: d.error };
}

export default function MaterialCapacitacionPanel({ capacitacionId, puedeGestionar }: { capacitacionId: string; puedeGestionar: boolean }) {
  const { avisar, confirmar } = useAvisos();
  const [lista, setLista] = useState<Material[] | null>(null);
  const [version, setVersion] = useState(0);
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState("");
  const [avance, setAvance] = useState<number | null>(null);
  const [elegido, setElegido] = useState<{ nombre: string; tamano: number } | null>(null);
  const archivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await fetch(`/api/capacitaciones/${capacitacionId}/material`);
      const d = r.ok ? await r.json() : [];
      if (vivo) setLista(d);
    })();
    return () => {
      vivo = false;
    };
  }, [capacitacionId, version]);

  async function enviar() {
    const f = archivo.current?.files?.[0];
    if (!f) {
      avisar.error("Elija el archivo que quiere subir.");
      return;
    }
    if (!titulo.trim()) {
      avisar.error("Ponga un título al material.");
      return;
    }
    if (f.size === 0) {
      avisar.error("El archivo está vacío.");
      return;
    }
    setAvance(0);
    const r = await subir(capacitacionId, f, titulo.trim(), tipo, setAvance);
    setAvance(null);
    if (!r.ok) {
      avisar.error(r.error ?? "No se pudo subir el material.");
      return;
    }
    avisar.exito("Material agregado.");
    setTitulo("");
    setTipo("");
    setElegido(null);
    if (archivo.current) archivo.current.value = "";
    setVersion((v) => v + 1);
  }

  async function quitar(m: Material) {
    if (!(await confirmar({ titulo: `¿Quitar «${m.titulo}»?`, detalle: "Se borra el archivo del servidor.", accion: "Quitar", peligro: true }))) return;
    const r = await fetch(`/api/capacitaciones/material/${m.id}`, { method: "DELETE" });
    if (!r.ok) avisar.error("No se pudo quitar.");
    setVersion((v) => v + 1);
  }

  return (
    <div className="space-y-2 border-t border-gray-100 pt-3" data-material-capacitacion>
      <p className="text-sm font-semibold text-gray-900">Material</p>
      {lista === null ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="text-sm text-gray-500">Sin material todavía.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {lista.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2" data-material={m.titulo}>
              <div>
                <p className="text-sm text-gray-900">{m.titulo}</p>
                <p className="text-xs text-gray-500">
                  {TIPO[m.tipo]} · {tamano(m.tamano)}
                  {m.inscritos !== undefined && ` · lo abrieron ${m.vistos} de ${m.inscritos}`}
                </p>
              </div>
              <div className="flex gap-1">
                <Link href={`/mi-espacio/material/${m.id}?volver=capacitaciones`} className="btn btn-sm btn-secondary">Ver</Link>
                {puedeGestionar && (
                  <button type="button" className="btn btn-sm border border-red-300 bg-white text-red-700 hover:bg-red-50" onClick={() => void quitar(m)}>Quitar</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {puedeGestionar && (
        <div className="space-y-2 rounded-lg bg-gray-50 p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input className="input" placeholder="Título del material" value={titulo} onChange={(e) => setTitulo(e.target.value)} aria-label="Título del material" />
            <select className="input w-auto!" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de material">
              <option value="">Tipo: según el archivo</option>
              <option value="MANUAL">Manual</option>
              <option value="DOCUMENTO">Documento</option>
              <option value="VIDEO">Video</option>
            </select>
          </div>
          <input
            ref={archivo}
            type="file"
            accept="application/pdf,video/mp4,video/webm,image/png,image/jpeg"
            aria-label="Archivo del material"
            disabled={avance !== null}
            onChange={(e) => {
              const f = e.target.files?.[0];
              setElegido(f ? { nombre: f.name, tamano: f.size } : null);
              // Sin título todavía: el nombre del archivo, sin la extensión.
              if (f && !titulo.trim()) setTitulo(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 200));
            }}
            className="block w-full text-sm text-gray-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-blue-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-800"
          />
          {elegido && <p className="text-xs text-gray-600">{elegido.nombre} · {tamano(elegido.tamano)}</p>}
          <p className="text-xs text-gray-500">PDF, video MP4 o WebM, o imagen PNG o JPG; hasta 500 MB. Un Word o PowerPoint, guárdelo antes como PDF. Los inscritos lo ven en Mi espacio, sin poder descargarlo.</p>
          {avance !== null ? (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded bg-gray-200" role="progressbar" aria-valuenow={Math.round(avance * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-2 bg-blue-600" style={{ width: `${Math.round(avance * 100)}%` }} />
              </div>
              <p className="text-xs text-gray-600">Subiendo… {Math.round(avance * 100)} %. No cierre esta página.</p>
            </div>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void enviar()} disabled={!titulo.trim() || !elegido}>Subir material</button>
          )}
        </div>
      )}
    </div>
  );
}
