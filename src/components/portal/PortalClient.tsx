"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";

// `createdAt` es `Date | string` a propósito: llega como Date cuando lo pasa el
// server component y como string ISO cuando viene del JSON de la API. formatDate
// admite ambos, así que se tipa tal cual en vez de mentir con `string`.
type FechaSerializable = Date | string;

interface Post { id: string; titulo: string; contenido: string; categoria: string; destacado: boolean; createdAt: FechaSerializable; autor: { primerNombre: string; primerApellido: string }; }
interface Anuncio { id: string; titulo: string; contenido: string; urgente: boolean; createdAt: FechaSerializable; autor: { primerNombre: string; primerApellido: string }; }
interface ContactoRRHH { id: string; nombre: string; cargo: string; email: string | null; telefono: string | null; extension: string | null; }
interface Empleado { id: string; codigo: string; primerNombre: string; primerApellido: string; }

interface Props {
  posts: Post[];
  anuncios: Anuncio[];
  contactos: ContactoRRHH[];
  empleados: Empleado[];
}

export default function PortalClient({ posts, anuncios, contactos, empleados }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"blog" | "anuncios" | "documentos" | "contactos">("anuncios");
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<null | "post" | "anuncio" | "contacto">(null);
  const [form, setForm] = useState({ titulo: "", contenido: "", urgente: false, nombre: "", cargo: "", email: "", telefono: "" });
  const [autorId, setAutorId] = useState(empleados[0]?.id ?? "");

  async function crearPost() {
    setLoading(true);
    try {
      const res = await fetch("/api/portal/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo: form.titulo, contenido: form.contenido, categoria: modal === "anuncio" ? "ANUNCIO" : "BLOG", autorId, urgente: form.urgente }),
      });
      if (!res.ok) throw new Error();
      setModal(null);
      router.refresh();
    } catch {
      alert("No se pudo publicar. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  async function crearContacto() {
    setLoading(true);
    try {
      const res = await fetch("/api/portal/contactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: form.nombre, cargo: form.cargo, email: form.email, telefono: form.telefono }),
      });
      if (!res.ok) throw new Error();
      setModal(null);
      router.refresh();
    } catch {
      alert("No se pudo agregar el contacto. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  const tabs = [
    { key: "anuncios", label: "Anuncios", count: anuncios.length },
    { key: "blog", label: "Blog / Noticias", count: posts.length },
    { key: "contactos", label: "Contactos RRHH", count: contactos.length },
    { key: "documentos", label: "Mis Documentos", count: 0 },
  ] as const;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Portal del empleado</h1>
          <p className="text-sm text-gray-500">Blog, anuncios, documentos y contactos de RRHH</p>
        </div>
        <div className="flex gap-2">
          {tab === "anuncios" && (
            <button onClick={() => setModal("anuncio")} className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700">
              Nuevo anuncio
            </button>
          )}
          {tab === "blog" && (
            <button onClick={() => setModal("post")} className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800">
              Nueva publicación
            </button>
          )}
          {tab === "contactos" && (
            <button onClick={() => setModal("contacto")} className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800">
              Agregar contacto
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors flex items-center gap-2 ${
              tab === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
            {t.count > 0 && <span className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Anuncios */}
      {tab === "anuncios" && (
        <div className="space-y-3">
          {anuncios.length === 0 ? (
            <p className="text-gray-400 text-sm py-6 text-center">No hay anuncios publicados</p>
          ) : anuncios.map((a) => (
            <div key={a.id} className={`bg-white rounded-xl border shadow-sm p-5 ${a.urgente ? "border-red-200 border-l-4 border-l-red-500" : "border-gray-100"}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {a.urgente && <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded">URGENTE</span>}
                    <h3 className="font-semibold text-gray-900">{a.titulo}</h3>
                  </div>
                  <p className="text-sm text-gray-600">{a.contenido}</p>
                </div>
                <p className="text-xs text-gray-400 shrink-0 ml-4">{formatDate(a.createdAt)}</p>
              </div>
              <p className="text-xs text-gray-400 mt-2">Publicado por: {a.autor.primerNombre} {a.autor.primerApellido}</p>
            </div>
          ))}
        </div>
      )}

      {/* Blog */}
      {tab === "blog" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {posts.length === 0 ? (
            <p className="text-gray-400 text-sm col-span-2 py-6 text-center">No hay publicaciones en el blog</p>
          ) : posts.map((p) => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 mb-2">{p.titulo}</h3>
              <p className="text-sm text-gray-600 line-clamp-3">{p.contenido}</p>
              <p className="text-xs text-gray-400 mt-3">{p.autor.primerNombre} {p.autor.primerApellido} · {formatDate(p.createdAt)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Contactos RRHH */}
      {tab === "contactos" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {contactos.length === 0 ? (
            <p className="text-gray-400 text-sm col-span-3 py-6 text-center">Sin contactos registrados</p>
          ) : contactos.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold mb-3">
                {c.nombre[0]}
              </div>
              <h3 className="font-semibold text-gray-900">{c.nombre}</h3>
              <p className="text-sm text-blue-600">{c.cargo}</p>
              {c.email && <p className="text-sm text-gray-500 mt-2">📧 {c.email}</p>}
              {c.telefono && <p className="text-sm text-gray-500">📞 {c.telefono}{c.extension ? ` ext. ${c.extension}` : ""}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Documentos (espacio para el empleado) */}
      {tab === "documentos" && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-center">
          <div className="text-5xl mb-3">📁</div>
          <h3 className="font-semibold text-gray-900 mb-1">Espacio de documentos</h3>
          <p className="text-sm text-gray-500 mb-4">Sube y consulta tus documentos personales: DPI, RTN, títulos, etc.</p>
          <label className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 cursor-pointer">
            Subir Documento
            <input type="file" className="hidden" />
          </label>
        </div>
      )}

      {/* Modales */}
      {(modal === "post" || modal === "anuncio") && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg space-y-4">
            <h3 className="font-semibold text-gray-900">{modal === "anuncio" ? "Nuevo Anuncio" : "Nueva Publicación"}</h3>
            {modal === "anuncio" && (
              <div className="flex items-center gap-2">
                <input type="checkbox" id="urgente" checked={form.urgente} onChange={(e) => setForm((f) => ({ ...f, urgente: e.target.checked }))} />
                <label htmlFor="urgente" className="text-sm text-red-600 font-medium">Marcar como URGENTE</label>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Título</label>
              <input value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Contenido</label>
              <textarea value={form.contenido} onChange={(e) => setForm((f) => ({ ...f, contenido: e.target.value }))} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Autor</label>
              <select value={autorId} onChange={(e) => setAutorId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {empleados.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.primerNombre} {emp.primerApellido}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setModal(null)} className="flex-1 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={crearPost} disabled={loading || !form.titulo || !autorId} className="flex-1 py-2 bg-blue-700 text-white text-sm rounded-lg hover:bg-blue-800 disabled:bg-blue-400">
                {loading ? "Publicando..." : "Publicar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "contacto" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-gray-900">Agregar contacto de RRHH</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Nombre Completo</label>
                <input value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Cargo</label>
                <input value={form.cargo} onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Teléfono</label>
                <input value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setModal(null)} className="flex-1 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={crearContacto} disabled={loading || !form.nombre} className="flex-1 py-2 bg-blue-700 text-white text-sm rounded-lg hover:bg-blue-800 disabled:bg-blue-400">
                {loading ? "Guardando..." : "Agregar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
