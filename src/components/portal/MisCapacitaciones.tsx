"use client";

/** Mi espacio → Capacitaciones: en cuáles está inscrito, su resultado y el material para ver. */
import { useEffect, useState } from "react";
import Link from "next/link";
import EstadoVacio from "@/components/ui/EstadoVacio";
import EstadoBadge, { type Tono } from "@/components/ui/EstadoBadge";
import { formatDate } from "@/lib/utils";

interface Material {
  id: string;
  titulo: string;
  descripcion: string | null;
  tipo: "MANUAL" | "VIDEO" | "DOCUMENTO";
  mime: string;
  tamano: number;
  visto: string | null;
}

interface Capacitacion {
  id: string;
  nombre: string;
  descripcion: string | null;
  proveedor: string | null;
  fechaInicio: string;
  fechaFin: string | null;
  estado: string;
  asistio: boolean;
  aprobado: boolean | null;
  calificacion: number | null;
  materiales: Material[];
}

const ESTADO: Record<string, { etiqueta: string; tono: Tono }> = {
  PLANIFICADA: { etiqueta: "Planificada", tono: "marca" },
  EN_CURSO: { etiqueta: "En curso", tono: "aviso" },
  FINALIZADA: { etiqueta: "Finalizada", tono: "ok" },
};
const TIPO: Record<Material["tipo"], string> = { MANUAL: "Manual", VIDEO: "Video", DOCUMENTO: "Documento" };
const tamano = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function MisCapacitaciones() {
  const [lista, setLista] = useState<Capacitacion[] | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await fetch("/api/mi-espacio/capacitaciones");
      const d = r.ok ? await r.json() : [];
      if (vivo) setLista(d);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  if (lista === null) return <p className="text-sm text-gray-500">Cargando…</p>;
  if (lista.length === 0) {
    return (
      <div className="panel">
        <EstadoVacio titulo="No está inscrito en ninguna capacitación." detalle="Cuando Recursos Humanos lo inscriba, aquí verá el programa y su material." />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-mis-capacitaciones>
      {lista.map((c) => {
        const est = ESTADO[c.estado] ?? { etiqueta: c.estado, tono: "neutro" as Tono };
        const vistos = c.materiales.filter((m) => m.visto).length;
        return (
          <section key={c.id} className="panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-900">{c.nombre}</h3>
                <p className="text-xs text-gray-500">
                  {formatDate(c.fechaInicio)}{c.fechaFin ? ` al ${formatDate(c.fechaFin)}` : ""}{c.proveedor ? ` · ${c.proveedor}` : ""}
                </p>
                {c.descripcion && <p className="mt-1 text-sm text-gray-600">{c.descripcion}</p>}
              </div>
              <div className="text-right text-sm">
                <EstadoBadge valor={c.estado} etiqueta={est.etiqueta} tono={est.tono} />
                {c.estado === "FINALIZADA" && (
                  <p className="mt-1 text-xs text-gray-600">
                    {c.aprobado === true ? "Aprobada" : c.aprobado === false ? "No aprobada" : c.asistio ? "Asistió" : "Sin asistencia"}
                    {c.calificacion !== null ? ` · nota ${c.calificacion}` : ""}
                  </p>
                )}
              </div>
            </div>

            {c.materiales.length > 0 ? (
              <>
                <p className="mt-4 text-xs font-medium text-gray-500">Material ({vistos} de {c.materiales.length} visto{c.materiales.length === 1 ? "" : "s"})</p>
                <ul className="mt-1 divide-y divide-gray-100">
                  {c.materiales.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                      <div>
                        <p className="text-sm text-gray-900">{m.titulo}</p>
                        <p className="text-xs text-gray-500">{TIPO[m.tipo]} · {tamano(m.tamano)}{m.visto ? ` · visto el ${formatDate(m.visto)}` : ""}</p>
                      </div>
                      <Link href={`/mi-espacio/material/${m.id}`} className="btn btn-sm btn-secondary" data-ver-material={m.id}>
                        {m.tipo === "VIDEO" ? "Ver video" : "Abrir"}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-3 text-sm text-gray-500">Esta capacitación todavía no tiene material.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
