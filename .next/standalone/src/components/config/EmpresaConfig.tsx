"use client";

/**
 * Configuración → Empresa: nombre, RTN, dirección, teléfono y correo. Los ve
 * quien consulta la configuración; los modifica sólo quien tiene
 * `configuracion.empresa` (por omisión, el super administrador), porque salen
 * impresos en boletas, constancias, contratos y el archivo del banco.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface EmpresaEditable {
  id: string;
  nombre: string;
  rtn: string;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
}

const CAMPOS: { clave: keyof Omit<EmpresaEditable, "id">; etiqueta: string; ayuda?: string; tipo?: string }[] = [
  { clave: "nombre", etiqueta: "Nombre o razón social" },
  { clave: "rtn", etiqueta: "RTN", ayuda: "14 dígitos; puede escribirse con guiones." },
  { clave: "direccion", etiqueta: "Dirección" },
  { clave: "telefono", etiqueta: "Teléfono" },
  { clave: "email", etiqueta: "Correo", tipo: "email" },
];

export default function EmpresaConfig({ empresa, puedeEditar }: { empresa: EmpresaEditable | null; puedeEditar: boolean }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState(empresa);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  if (!empresa || !form) {
    return <section className="panel p-6 text-sm text-gray-500">No hay empresa configurada.</section>;
  }

  async function guardar() {
    if (!form) return;
    setGuardando(true);
    setAviso(null);
    const r = await fetch("/api/configuracion/empresa", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setGuardando(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      const campos = d.detalles ? Object.entries(d.detalles as Record<string, string[]>).map(([k, v]) => `${CAMPOS.find((c) => c.clave === k)?.etiqueta ?? k}: ${v.join(", ")}`) : [];
      setAviso({ ok: false, texto: campos.length ? campos.join(". ") : d.error ?? "No se pudo guardar." });
      return;
    }
    setEditando(false);
    setAviso({ ok: true, texto: "Datos de la empresa guardados. Las boletas y documentos nuevos ya los usan." });
    router.refresh();
  }

  return (
    <section className="panel space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Datos de la empresa</h2>
          <p className="mt-1 text-sm text-gray-500">
            Salen en las boletas de pago, constancias, contratos y el archivo para el banco.
          </p>
        </div>
        {puedeEditar && !editando && (
          <button type="button" className="btn btn-secondary" onClick={() => { setForm(empresa); setAviso(null); setEditando(true); }}>
            Editar datos
          </button>
        )}
      </div>

      {editando ? (
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          {CAMPOS.map((c) => (
            <label key={c.clave} className={`block text-sm ${c.clave === "nombre" || c.clave === "direccion" ? "sm:col-span-2" : ""}`}>
              <span className="font-medium text-gray-800">{c.etiqueta}</span>
              <input
                className="input mt-1"
                type={c.tipo ?? "text"}
                value={form[c.clave] ?? ""}
                required={c.clave === "nombre" || c.clave === "rtn"}
                onChange={(e) => setForm({ ...form, [c.clave]: e.target.value })}
              />
              {c.ayuda && <span className="mt-1 block text-xs text-gray-500">{c.ayuda}</span>}
            </label>
          ))}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className="btn btn-primary" disabled={guardando || !form.nombre.trim() || !form.rtn.trim()} onClick={guardar}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setEditando(false); setAviso(null); }}>Cancelar</button>
          </div>
        </div>
      ) : (
        <dl className="grid max-w-3xl gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          {CAMPOS.map((c) => (
            <div key={c.clave} className={c.clave === "nombre" || c.clave === "direccion" ? "sm:col-span-2" : ""}>
              <dt className="text-gray-500">{c.etiqueta}</dt>
              <dd className={`font-medium text-gray-900 ${c.clave === "rtn" ? "tnum" : ""}`}>{empresa[c.clave] || "—"}</dd>
            </div>
          ))}
        </dl>
      )}

      {aviso && <p className={`text-sm ${aviso.ok ? "text-green-700" : "text-red-700"}`} role={aviso.ok ? "status" : "alert"}>{aviso.texto}</p>}
      {!puedeEditar && <p className="text-xs text-gray-500">Sólo el administrador del sistema puede modificar estos datos.</p>}
    </section>
  );
}
