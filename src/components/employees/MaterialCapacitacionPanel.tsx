"use client";

/**
 * Material de una capacitación, para quien la administra: subir (PDF, video, imagen),
 * ver en el visor, quitar, y cuántos inscritos lo abrieron.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAvisos } from "@/components/ui/Avisos";

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

/** Sube el archivo tal cual (no multipart), con su avance: un video grande tarda. */
function subir(capacitacionId: string, archivo: File, titulo: string, tipo: string, avance: (p: number) => void): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolver) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/capacitaciones/${capacitacionId}/material`);
    xhr.setRequestHeader("Content-Type", archivo.type || "application/octet-stream");
    xhr.setRequestHeader("x-titulo", encodeURIComponent(titulo));
    if (tipo) xhr.setRequestHeader("x-tipo", tipo);
    xhr.upload.onprogress = (e) => e.lengthComputable && avance(e.loaded / e.total);
    xhr.onload = () => {
      let error: string | undefined;
      try {
        error = JSON.parse(xhr.responseText).error;
      } catch {}
      resolver({ ok: xhr.status === 201, error });
    };
    xhr.onerror = () => resolver({ ok: false, error: "Se cortó la conexión al subir." });
    xhr.send(archivo);
  });
}

export default function MaterialCapacitacionPanel({ capacitacionId, puedeGestionar }: { capacitacionId: string; puedeGestionar: boolean }) {
  const { avisar, confirmar } = useAvisos();
  const [lista, setLista] = useState<Material[] | null>(null);
  const [version, setVersion] = useState(0);
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState("");
  const [avance, setAvance] = useState<number | null>(null);
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
    if (!f || !titulo.trim()) return;
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
          <input ref={archivo} type="file" accept="application/pdf,video/mp4,video/webm,image/png,image/jpeg" className="block text-sm" aria-label="Archivo del material" />
          <p className="text-xs text-gray-500">PDF, video MP4 o WebM, o imagen PNG o JPG; hasta 500 MB. Un Word o PowerPoint, guárdelo antes como PDF. Los inscritos lo ven en Mi espacio, sin poder descargarlo.</p>
          {avance !== null ? (
            <div className="h-2 w-full overflow-hidden rounded bg-gray-200" role="progressbar" aria-valuenow={Math.round(avance * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-2 bg-blue-600" style={{ width: `${Math.round(avance * 100)}%` }} />
            </div>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void enviar()} disabled={!titulo.trim()}>Subir material</button>
          )}
        </div>
      )}
    </div>
  );
}
