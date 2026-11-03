"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import { formatDate } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";
import { Campo } from "@/components/ui/ModalForm";

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
  const { avisar } = useAvisos();
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
      avisar.error("No se pudo publicar. Intente nuevamente.");
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
      avisar.error("No se pudo agregar el contacto. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  const tabs = [
    { key: "anuncios", label: "Anuncios", count: anuncios.length },
    { key: "blog", label: "Blog / Noticias", count: posts.length },
    { key: "contactos", label: "Contactos RRHH", count: contactos.length },
    { key: "documentos", label: "Mis documentos", count: 0 },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portal del empleado"
        description="Blog, anuncios, documentos y contactos de RRHH."
        actions={
          <>
            {tab === "anuncios" && (
              <button onClick={() => setModal("anuncio")} className="btn btn-primary">
                Nuevo anuncio
              </button>
            )}
            {tab === "blog" && (
              <button onClick={() => setModal("post")} className="btn btn-primary">
                Nueva publicación
              </button>
            )}
            {tab === "contactos" && (
              <button onClick={() => setModal("contacto")} className="btn btn-primary">
                Agregar contacto
              </button>
            )}
          </>
        }
      >
        <div className="-mb-5 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
              {t.count > 0 && <span className="tnum text-xs text-gray-500">{t.count}</span>}
            </button>
          ))}
        </div>
      </PageHeader>

      {/* Anuncios */}
      {tab === "anuncios" && (
        <div className="space-y-3">
          {anuncios.length === 0 ? (
            <div className="panel">
              <EstadoVacio titulo="Todavía no hay anuncios publicados." detalle="Publique el primero con el botón «Nuevo anuncio»." />
            </div>
          ) : anuncios.map((a) => (
            <div key={a.id} className={`panel p-5 ${a.urgente ? "border-l-4 border-l-red-500" : ""}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    {a.urgente && <EstadoBadge valor="URGENTE" etiqueta="Urgente" tono="error" />}
                    <h3 className="font-semibold text-gray-900">{a.titulo}</h3>
                  </div>
                  <p className="text-sm text-gray-600">{a.contenido}</p>
                </div>
                <p className="ml-4 shrink-0 text-xs text-gray-500">{formatDate(a.createdAt)}</p>
              </div>
              <p className="mt-2 text-xs text-gray-500">Publicado por: {a.autor.primerNombre} {a.autor.primerApellido}</p>
            </div>
          ))}
        </div>
      )}

      {/* Blog */}
      {tab === "blog" && (
        posts.length === 0 ? (
          <div className="panel">
            <EstadoVacio titulo="Todavía no hay publicaciones en el blog." detalle="Publique la primera con el botón «Nueva publicación»." />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {posts.map((p) => (
              <div key={p.id} className="panel p-5">
                <h3 className="mb-2 font-semibold text-gray-900">{p.titulo}</h3>
                <p className="line-clamp-3 text-sm text-gray-600">{p.contenido}</p>
                <p className="mt-3 text-xs text-gray-500">{p.autor.primerNombre} {p.autor.primerApellido}, {formatDate(p.createdAt)}</p>
              </div>
            ))}
          </div>
        )
      )}

      {/* Contactos RRHH */}
      {tab === "contactos" && (
        contactos.length === 0 ? (
          <div className="panel">
            <EstadoVacio titulo="Todavía no hay contactos registrados." detalle="Agregue a quien los empleados deban buscar en Recursos Humanos." />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {contactos.map((c) => (
              <div key={c.id} className="panel p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700">
                  {c.nombre[0]}
                </div>
                <h3 className="font-semibold text-gray-900">{c.nombre}</h3>
                <p className="text-sm text-blue-700">{c.cargo}</p>
                {c.email && <p className="mt-2 text-sm text-gray-500">Correo: {c.email}</p>}
                {c.telefono && <p className="text-sm text-gray-500">Teléfono: {c.telefono}{c.extension ? `, ext. ${c.extension}` : ""}</p>}
              </div>
            ))}
          </div>
        )
      )}

      {/* Documentos (espacio para el empleado) */}
      {tab === "documentos" && (
        <div className="panel">
          <EstadoVacio
            titulo="Espacio de documentos"
            detalle="Suba y consulte sus documentos personales: DPI, RTN, títulos, etc."
            accion={
              <label className="btn btn-secondary cursor-pointer">
                Subir documento
                <input type="file" className="hidden" />
              </label>
            }
          />
        </div>
      )}

      {/* Modales */}
      {(modal === "post" || modal === "anuncio") && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="panel w-full max-w-lg space-y-4 p-6 shadow-xl">
            <h3 className="font-semibold text-gray-900">{modal === "anuncio" ? "Nuevo anuncio" : "Nueva publicación"}</h3>
            {modal === "anuncio" && (
              <div className="flex items-center gap-2">
                <input type="checkbox" id="urgente" checked={form.urgente} onChange={(e) => setForm((f) => ({ ...f, urgente: e.target.checked }))} />
                <label htmlFor="urgente" className="text-sm font-medium text-gray-800">Marcar como urgente</label>
              </div>
            )}
            <Campo etiqueta="Título">
              <input value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} className="input" />
            </Campo>
            <Campo etiqueta="Contenido">
              <textarea value={form.contenido} onChange={(e) => setForm((f) => ({ ...f, contenido: e.target.value }))} rows={4} className="input" />
            </Campo>
            <Campo etiqueta="Autor">
              <select value={autorId} onChange={(e) => setAutorId(e.target.value)} className="input">
                {empleados.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.primerNombre} {emp.primerApellido}</option>
                ))}
              </select>
            </Campo>
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="btn btn-ghost">Cancelar</button>
              <button onClick={crearPost} disabled={loading || !form.titulo || !autorId} className="btn btn-primary">
                {loading ? "Publicando…" : "Publicar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "contacto" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="panel w-full max-w-md space-y-4 p-6 shadow-xl">
            <h3 className="font-semibold text-gray-900">Agregar contacto de RRHH</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Campo etiqueta="Nombre completo">
                  <input value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} className="input" />
                </Campo>
              </div>
              <div className="col-span-2">
                <Campo etiqueta="Cargo">
                  <input value={form.cargo} onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))} className="input" />
                </Campo>
              </div>
              <Campo etiqueta="Correo electrónico">
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="input" />
              </Campo>
              <Campo etiqueta="Teléfono">
                <input value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} className="input" />
              </Campo>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="btn btn-ghost">Cancelar</button>
              <button onClick={crearContacto} disabled={loading || !form.nombre} className="btn btn-primary">
                {loading ? "Guardando…" : "Agregar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
