"use client";

/**
 * Configuración → Respaldos: respaldar ahora o automáticamente, a disco local, a un disco
 * extraíble, a una carpeta de red o a la nube (compatible con S3). Ver `lib/respaldos/`.
 * 2026-11-25: disco extraíble con «Preparar disco», retención GFS, «Respaldar ahora» en
 * segundo plano y la prueba de restauración semanal.
 */

import { useCallback, useEffect, useState } from "react";
import { useAvisos } from "@/components/ui/Avisos";
import {
  PROVEEDORES_S3,
  type ConfigEntrada,
  type ConfigPublica,
  type DestinoPublico,
  type PruebaRestauracion,
  type ProveedorS3,
} from "@/lib/respaldos/config";

interface Historial {
  id: string; tipo: string; estado: string; archivo: string | null; tamano: number | null; cifrado: boolean;
  destinos: Array<{ destinoId: string; nombre: string; tipo: string; ok: boolean; error?: string; ubicacion?: string; podados?: number }> | null;
  error: string | null; duracionMs: number | null; createdAt: string; descargable: boolean;
}
interface Datos {
  config: ConfigPublica;
  estado: { pgDump: { ok: boolean; mensaje: string }; cifradoDisponible: boolean; windows: boolean; proximo: string | null; carpetaSugerida: string | null; pruebaRestauracion: PruebaRestauracion | null };
  historial: Historial[];
}
/** Destino en edición: lo público más la clave que se escriba (vacía = dejar la guardada). */
type DestinoForm = DestinoPublico & { claveNueva: string };

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const TIPO: Record<string, string> = { LOCAL: "Disco local", EXTRAIBLE: "Disco extraíble", RED: "Carpeta de red", NUBE: "Nube (S3)" };
const ESTADO: Record<string, { texto: string; clase: string }> = {
  OK: { texto: "Correcto", clase: "bg-green-50 text-green-800" },
  PARCIAL: { texto: "Parcial", clase: "bg-amber-50 text-amber-900" },
  ERROR: { texto: "Falló", clase: "bg-red-50 text-red-800" },
  EN_CURSO: { texto: "En curso", clase: "bg-blue-50 text-blue-800" },
};

const nuevoId = () => Math.random().toString(36).slice(2, 10);
const fechaHN = (iso: string) => new Date(iso).toLocaleString("es-HN", { timeZone: "America/Tegucigalpa", dateStyle: "medium", timeStyle: "short" });
function tamano(b: number | null): string {
  if (b === null) return "—";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function destinoVacio(tipo: "LOCAL" | "EXTRAIBLE" | "RED" | "NUBE", carpetaSugerida: string | null): DestinoForm {
  const base = { id: nuevoId(), activo: true, claveNueva: "" };
  if (tipo === "LOCAL") return { ...base, tipo, nombre: "Disco local", carpeta: carpetaSugerida ?? "" };
  if (tipo === "EXTRAIBLE") return { ...base, tipo, nombre: "Disco extraíble", carpeta: "" };
  if (tipo === "RED") return { ...base, tipo, nombre: "Carpeta de red", ruta: "", usuario: null, tieneClave: false };
  const p = PROVEEDORES_S3.B2;
  return { ...base, tipo, nombre: "Nube", proveedor: "B2", endpoint: p.endpoint(p.region), region: p.region, bucket: "", prefijo: "nomina/", accessKeyId: "", estiloRuta: p.estiloRuta, tieneClave: false };
}

/** Lo que se manda al servidor: una clave vacía es «dejar la guardada». */
function aEntrada(d: DestinoForm): ConfigEntrada["destinos"][number] {
  const { claveNueva, ...resto } = d;
  if (resto.tipo === "LOCAL" || resto.tipo === "EXTRAIBLE") return { id: resto.id, nombre: resto.nombre, activo: resto.activo, tipo: resto.tipo, carpeta: resto.carpeta };
  if (resto.tipo === "RED") return { id: resto.id, nombre: resto.nombre, activo: resto.activo, tipo: "RED", ruta: resto.ruta, usuario: resto.usuario || null, clave: claveNueva || null };
  return {
    id: resto.id, nombre: resto.nombre, activo: resto.activo, tipo: "NUBE", proveedor: resto.proveedor, endpoint: resto.endpoint, region: resto.region,
    bucket: resto.bucket, prefijo: resto.prefijo, accessKeyId: resto.accessKeyId, secretAccessKey: claveNueva || null, estiloRuta: resto.estiloRuta,
  };
}

export default function RespaldosConfig() {
  const { avisar, confirmar } = useAvisos();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [form, setForm] = useState<{ cfg: Omit<ConfigPublica, "destinos">; destinos: DestinoForm[]; clave: string } | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"guardar" | "respaldar" | null>(null);
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pruebas, setPruebas] = useState<Record<string, { ok: boolean; mensaje: string } | "probando">>({});
  const [cambios, setCambios] = useState(false);

  const aplicar = useCallback((d: Datos) => {
    setDatos(d);
    const { destinos, ...cfg } = d.config;
    setForm({ cfg, destinos: destinos.map((x) => ({ ...x, claveNueva: "" })), clave: "" });
    setCambios(false);
  }, []);
  const traer = async (): Promise<Datos | { error: string }> => {
    const r = await fetch("/api/configuracion/respaldos", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    return r.ok ? d : { error: d.error ?? "No se pudo cargar la configuración de respaldos." };
  };
  const cargar = async () => {
    const d = await traer();
    if ("error" in d) setError(d.error);
    else aplicar(d);
  };
  useEffect(() => {
    let vivo = true;
    void traer().then((d) => {
      if (!vivo) return;
      if ("error" in d) setError(d.error);
      else aplicar(d);
    });
    return () => { vivo = false; };
  }, [aplicar]);

  if (!datos || !form) return <p className="text-sm text-gray-500">{error ?? "Cargando…"}</p>;

  const cfg = form.cfg;
  const setCfg = (c: Partial<typeof cfg>) => { setForm({ ...form, cfg: { ...cfg, ...c } }); setCambios(true); };
  const setAuto = (a: Partial<typeof cfg.automatico>) => setCfg({ automatico: { ...cfg.automatico, ...a } });
  const setDestino = (id: string, cambio: Partial<DestinoForm>) => {
    setForm({ ...form, destinos: form.destinos.map((d) => (d.id === id ? ({ ...d, ...cambio } as DestinoForm) : d)) });
    setCambios(true);
  };
  // La nube y el disco extraíble exigen cifrado (este último, pedido de Edbin del 2026-11-25).
  const exigeCifrado = form.destinos.some((d) => (d.tipo === "NUBE" || d.tipo === "EXTRAIBLE") && d.activo);
  const ultimo = datos.historial[0];

  async function guardar(): Promise<boolean> {
    setOcupado("guardar"); setError(null);
    const cuerpo: ConfigEntrada = {
      automatico: { activo: cfg.automatico.activo, frecuencia: cfg.automatico.frecuencia, hora: cfg.automatico.hora, diaSemana: cfg.automatico.diaSemana },
      retencion: cfg.retencion, incluirAdjuntos: cfg.incluirAdjuntos, cifrar: cfg.cifrar,
      claveCifrado: form!.clave || null,
      destinos: form!.destinos.map(aEntrada),
    };
    const r = await fetch("/api/configuracion/respaldos", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    const d = await r.json().catch(() => ({}));
    setOcupado(null);
    if (!r.ok) {
      const detalle = d.detalles ? Object.values(d.detalles as Record<string, string[]>).flat().join(" ") : "";
      setError([d.error, detalle].filter(Boolean).join(" ") || "No se pudo guardar.");
      return false;
    }
    avisar.exito("Configuración de respaldos guardada.");
    setEditando(null);
    await cargar();
    return true;
  }

  async function respaldarAhora() {
    if (cambios && !(await confirmar({ titulo: "Hay cambios sin guardar", detalle: "El respaldo se hace con la configuración guardada. ¿Guardar primero?", accion: "Guardar y respaldar" }))) return;
    if (cambios && !(await guardar())) return;
    setOcupado("respaldar"); setError(null);
    const r = await fetch("/api/configuracion/respaldos/ejecutar", { method: "POST" });
    const inicio = await r.json().catch(() => ({}));
    if (!r.ok || !inicio.id) {
      setOcupado(null);
      setError(inicio.error ?? "No se pudo empezar el respaldo.");
      return;
    }
    // Corre en el servidor: aquí sólo se consulta cómo va (seguiría aunque se cierre la pantalla).
    setEnCurso(inicio.id);
    await cargar();
    let d: { estado?: string; tamano?: number | null; destinos?: unknown[] | null; error?: string | null } = {};
    for (;;) {
      await new Promise((res) => setTimeout(res, 2000));
      const e = await fetch(`/api/configuracion/respaldos/${inicio.id}`, { cache: "no-store" });
      d = await e.json().catch(() => ({}));
      if (!e.ok || d.estado !== "EN_CURSO") break;
    }
    setEnCurso(null);
    setOcupado(null);
    if (d.estado === "OK") avisar.exito(`Respaldo listo (${tamano(d.tamano ?? null)}) en ${d.destinos?.length ?? 0} destino(s).`);
    else avisar.error(`El respaldo ${d.estado === "PARCIAL" ? "no llegó a todos los destinos" : "falló"}: ${d.error ?? "sin detalle"}`);
    await cargar();
  }

  async function prepararDisco(d: DestinoForm) {
    setPruebas((p) => ({ ...p, [d.id]: "probando" }));
    const r = await fetch("/api/configuracion/respaldos/preparar-disco", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destino: aEntrada(d) }) });
    const x = await r.json().catch(() => ({}));
    const detalle = x.detalles ? Object.values(x.detalles as Record<string, string[]>).flat().join(" ") : "";
    setPruebas((p) => ({ ...p, [d.id]: r.ok ? x : { ok: false, mensaje: [x.error, detalle].filter(Boolean).join(" ") || "No se pudo preparar el disco." } }));
  }

  async function probar(d: DestinoForm) {
    setPruebas((p) => ({ ...p, [d.id]: "probando" }));
    const r = await fetch("/api/configuracion/respaldos/probar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destino: aEntrada(d) }) });
    const x = await r.json().catch(() => ({}));
    const detalle = x.detalles ? Object.values(x.detalles as Record<string, string[]>).flat().join(" ") : "";
    setPruebas((p) => ({ ...p, [d.id]: r.ok ? x : { ok: false, mensaje: [x.error, detalle].filter(Boolean).join(" ") || "No se pudo probar." } }));
  }

  return (
    <div className="max-w-5xl space-y-6" data-respaldos>
      {/* ─── Estado ─────────────────────────────────────────────────────── */}
      <section className="panel space-y-4 p-5" aria-labelledby="resp-estado">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="resp-estado" className="font-semibold text-gray-900">Respaldos de la base de datos</h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">
              Un respaldo es un solo archivo con toda la base (empleados, planillas, salarios) y, si se elige, los documentos
              adjuntos. Se comprueba antes de enviarlo y se guarda en cada destino activo, conservando los más recientes.
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void respaldarAhora()} disabled={!!ocupado || !datos.estado.pgDump.ok || !form.destinos.some((d) => d.activo)} data-respaldar-ahora>
            {ocupado === "respaldar" ? "Respaldando…" : "Respaldar ahora"}
          </button>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-gray-500">Último respaldo</dt>
            <dd className="text-gray-900" data-ultimo-respaldo>
              {ultimo ? (<>{fechaHN(ultimo.createdAt)} <span className={`ml-1 rounded px-1.5 py-0.5 text-xs ${ESTADO[ultimo.estado]?.clase ?? ""}`}>{ESTADO[ultimo.estado]?.texto ?? ultimo.estado}</span></>) : "Todavía ninguno"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Próximo automático</dt>
            <dd className="text-gray-900">{datos.estado.proximo ? fechaHN(datos.estado.proximo) : "Apagado"}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Herramienta de respaldo</dt>
            <dd className={datos.estado.pgDump.ok ? "text-gray-900" : "text-red-700"} title={datos.estado.pgDump.mensaje}>
              {datos.estado.pgDump.ok ? datos.estado.pgDump.mensaje.replace(/^pg_dump \(PostgreSQL\) /, "PostgreSQL ") : datos.estado.pgDump.mensaje}
            </dd>
          </div>
        </dl>
        <PruebaDeRestauracion p={datos.estado.pruebaRestauracion} />
        {enCurso && (
          <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900" role="status" data-respaldo-en-curso>
            Armando el respaldo y enviándolo a los destinos. Sigue en el servidor aunque cierre esta pantalla.
          </p>
        )}
        {error && <p className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p>}
      </section>

      {/* ─── Programación y opciones ────────────────────────────────────── */}
      <section className="panel space-y-4 p-5" aria-labelledby="resp-programa">
        <h2 id="resp-programa" className="font-semibold text-gray-900">Automático y opciones</h2>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <input type="checkbox" checked={cfg.automatico.activo} onChange={(e) => setAuto({ activo: e.target.checked })} /> Respaldar automáticamente
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-gray-700">Frecuencia</span>
            <select className="input mt-1 w-36" value={cfg.automatico.frecuencia} onChange={(e) => setAuto({ frecuencia: e.target.value as "DIARIA" | "SEMANAL" })} disabled={!cfg.automatico.activo}>
              <option value="DIARIA">Cada día</option>
              <option value="SEMANAL">Cada semana</option>
            </select>
          </label>
          {cfg.automatico.frecuencia === "SEMANAL" && (
            <label className="text-sm">
              <span className="block text-xs font-medium text-gray-700">Día</span>
              <select className="input mt-1 w-36" value={cfg.automatico.diaSemana} onChange={(e) => setAuto({ diaSemana: Number(e.target.value) })} disabled={!cfg.automatico.activo}>
                {DIAS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
          )}
          <label className="text-sm">
            <span className="block text-xs font-medium text-gray-700">Hora (Honduras)</span>
            <input type="time" className="input mt-1 w-32" value={cfg.automatico.hora} onChange={(e) => setAuto({ hora: e.target.value })} disabled={!cfg.automatico.activo} />
          </label>
        </div>
        <fieldset className="space-y-2" data-retencion>
          <legend className="text-sm font-medium text-gray-800">Conservar en cada destino</legend>
          <div className="flex flex-wrap gap-4">
            {([
              ["diarios", "Días", 1, 365, "Los automáticos de los últimos días."],
              ["semanales", "Semanas", 0, 104, "Uno por semana, el último de cada una."],
              ["mensuales", "Meses", 0, 120, "Uno por mes, el último de cada uno."],
              ["manuales", "Manuales", 0, 100, "Los de «Respaldar ahora», aparte."],
            ] as const).map(([k, etiqueta, min, max, ayuda]) => (
              <div key={k} className="text-sm">
                <label className="block">
                  <span className="block text-xs font-medium text-gray-700">{etiqueta}</span>
                  <input type="number" min={min} max={max} className="input mt-1 w-24" value={cfg.retencion[k]}
                    onChange={(e) => setCfg({ retencion: { ...cfg.retencion, [k]: Math.max(min, Math.min(max, Math.trunc(Number(e.target.value)) || min)) } })} />
                </label>
                <p className="mt-0.5 max-w-[11rem] text-xs text-gray-500">{ayuda}</p>
              </div>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-gray-500">
          Si el equipo está apagado a la hora elegida, el respaldo se hace al encenderlo. Si un envío falla, se reintenta
          hasta 3 veces, con una hora entre cada intento.
        </p>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={cfg.incluirAdjuntos} onChange={(e) => setCfg({ incluirAdjuntos: e.target.checked })} /> Incluir los documentos adjuntos (contratos, constancias, fotos)
        </label>

        <div className="space-y-2 rounded-lg border border-gray-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <input type="checkbox" checked={cfg.cifrar} onChange={(e) => setCfg({ cifrar: e.target.checked })} /> Cifrar los respaldos con contraseña
            {exigeCifrado && <span className="text-xs font-normal text-gray-500">(obligatorio para la nube y el disco extraíble)</span>}
          </label>
          {cfg.cifrar && (
            <>
              <input type="password" autoComplete="new-password" className="input max-w-sm" aria-label="Contraseña de cifrado"
                placeholder={cfg.tieneClaveCifrado ? "•••••••• guardada (escriba para cambiarla)" : "Contraseña de cifrado (12 caracteres o más)"}
                value={form.clave} onChange={(e) => { setForm({ ...form, clave: e.target.value }); setCambios(true); }} />
              <p className="text-xs text-amber-800">
                Guárdela en un lugar seguro fuera de este equipo: sin ella el respaldo no se puede abrir, y nadie puede recuperarla.
                Formato estándar de OpenSSL (AES-256).
              </p>
            </>
          )}
          {!datos.estado.cifradoDisponible && (
            <p className="text-xs text-red-700">Falta CIFRADO_KEY en el servidor: no se pueden guardar contraseñas (de red, de la nube ni de cifrado).</p>
          )}
        </div>
      </section>

      {/* ─── Destinos ───────────────────────────────────────────────────── */}
      <section className="panel space-y-4 p-5" aria-labelledby="resp-destinos">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="resp-destinos" className="font-semibold text-gray-900">Destinos</h2>
          <div className="flex flex-wrap gap-2">
            {(["LOCAL", "EXTRAIBLE", "RED", "NUBE"] as const).map((t) => (
              <button key={t} type="button" className="btn btn-secondary btn-sm" disabled={form.destinos.length >= 6}
                onClick={() => { const d = destinoVacio(t, datos.estado.carpetaSugerida); setForm({ ...form, destinos: [...form.destinos, d] }); setEditando(d.id); setCambios(true); }}>
                + {TIPO[t]}
              </button>
            ))}
          </div>
        </div>
        {form.destinos.length === 0 && <p className="text-sm text-gray-500">Agregue al menos uno. Lo recomendable es dos: uno en este edificio (disco extraíble o red) y otro fuera (nube).</p>}
        <ul className="space-y-3">
          {form.destinos.map((d) => {
            const prueba = pruebas[d.id];
            const abierto = editando === d.id;
            return (
              <li key={d.id} className="rounded-lg border border-gray-200 p-3" data-destino={d.tipo}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{d.nombre} <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-600">{TIPO[d.tipo]}</span>{!d.activo && <span className="ml-1 text-xs text-gray-500">(inactivo)</span>}</p>
                    <p className="truncate text-xs text-gray-500">
                      {d.tipo === "LOCAL" || d.tipo === "EXTRAIBLE" ? d.carpeta || "Sin carpeta" : d.tipo === "RED" ? `${d.ruta || "Sin ruta"}${d.usuario ? ` · usuario ${d.usuario}` : ""}` : `${PROVEEDORES_S3[d.proveedor].nombre} · ${d.bucket ? `${d.bucket}/${d.prefijo}` : "sin bucket"}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {d.tipo === "EXTRAIBLE" && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void prepararDisco(d)} disabled={prueba === "probando"} data-preparar-disco>Preparar disco</button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void probar(d)} disabled={prueba === "probando"}>{prueba === "probando" ? "Probando…" : "Probar"}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditando(abierto ? null : d.id)}>{abierto ? "Cerrar" : "Editar"}</button>
                    <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => { setForm({ ...form, destinos: form.destinos.filter((x) => x.id !== d.id) }); setCambios(true); }}>Quitar</button>
                  </div>
                </div>
                {prueba && prueba !== "probando" && (
                  <p className={`mt-2 text-sm ${prueba.ok ? "text-green-800" : "text-red-700"}`} role="status" data-prueba-destino>{prueba.mensaje}</p>
                )}
                {abierto && <EditorDestino d={d} windows={datos.estado.windows} onCambio={(c) => setDestino(d.id, c)} />}
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-3">
          {cambios && <span className="text-sm text-amber-800">Hay cambios sin guardar.</span>}
          <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!!ocupado || !cambios}>{ocupado === "guardar" ? "Guardando…" : "Guardar cambios"}</button>
        </div>
      </section>

      {/* ─── Historial ──────────────────────────────────────────────────── */}
      <section className="panel overflow-hidden" aria-labelledby="resp-historial">
        <h2 id="resp-historial" className="px-5 pt-5 font-semibold text-gray-900">Historial</h2>
        {datos.historial.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">Todavía no hay respaldos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Estado</th><th className="num">Tamaño</th><th>Destinos</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {datos.historial.map((h) => {
                  const enDisco = h.destinos?.some((x) => x.ok && x.tipo !== "NUBE");
                  return (
                    <tr key={h.id} data-respaldo={h.estado}>
                      <td className="whitespace-nowrap">{fechaHN(h.createdAt)}</td>
                      <td>{h.tipo === "AUTOMATICO" ? "Automático" : "Manual"}{h.cifrado ? " · cifrado" : ""}</td>
                      <td><span className={`rounded px-1.5 py-0.5 text-xs ${ESTADO[h.estado]?.clase ?? ""}`}>{ESTADO[h.estado]?.texto ?? h.estado}</span></td>
                      <td className="num whitespace-nowrap">{tamano(h.tamano)}</td>
                      <td className="text-xs">
                        {h.destinos?.map((x) => (
                          <span key={x.destinoId} className={`mr-2 inline-block ${x.ok ? "text-green-800" : "text-red-700"}`} title={x.error ?? x.ubicacion}>{x.ok ? "✓" : "✗"} {x.nombre}</span>
                        ))}
                        {!h.destinos?.length && h.error && <span className="text-red-700">{h.error}</span>}
                        {h.destinos?.some((x) => !x.ok) && <span className="block text-red-700">{h.error}</span>}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {h.descargable
                          ? <a className="btn btn-ghost btn-sm" href={`/api/configuracion/respaldos/${h.id}/descargar`}>Descargar</a>
                          : enDisco && <span className="text-xs text-gray-500" title="Se conservan los de los últimos días, uno por semana y uno por mes, según «Conservar en cada destino». Un disco extraíble desconectado tampoco se puede descargar.">Ya no está en disco</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <details className="border-t border-gray-100 px-5 py-4 text-sm text-gray-700">
          <summary className="cursor-pointer font-medium text-gray-900">Cómo restaurar un respaldo</summary>
          <p className="mt-2">Se restaura en el servidor, con un comando: reemplaza toda la base, así que no hay botón en la aplicación.</p>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li>En la instalación de Windows, abra «Símbolo del sistema» <strong>como administrador</strong> y ejecute (si está cifrado, le pide la contraseña de cifrado):<br />
              <code className="break-all text-xs">&quot;C:\Program Files\ESC System\Gestion360 Nomina\restaurar.cmd&quot; &quot;RUTA\g360-nomina_….tar.gz.enc&quot;</code></li>
            <li>Antes de tocar nada saca un respaldo de la base actual; detiene el servicio, restaura en una base nueva, la pone en lugar de la actual (la anterior queda guardada con otro nombre), aplica las actualizaciones de la versión instalada, devuelve los adjuntos y vuelve a iniciar.</li>
            <li>En un servidor Linux: <code className="text-xs">deploy/restaurar.sh ARCHIVO</code> (ver <code>docs/RESPALDOS.md</code>).</li>
          </ol>
          <p className="mt-2 text-xs text-gray-500">Cada domingo la instalación restaura el último respaldo en una base aparte para comprobar que se puede recuperar, y la borra. El resultado sale arriba.</p>
        </details>
      </section>
    </div>
  );
}

/** La última prueba de restauración (la tarea semanal de la instalación): si el último respaldo de verdad se recupera. */
function PruebaDeRestauracion({ p }: { p: PruebaRestauracion | null }) {
  if (!p) {
    return <p className="text-xs text-gray-500" data-prueba-restauracion="ninguna">Prueba de restauración: todavía ninguna. La hace cada domingo la tarea de la instalación (también a mano: <code>probar-restauracion.cmd</code>, como administrador).</p>;
  }
  return (
    <p className={`rounded-md border px-3 py-2 text-sm ${p.ok ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-800"}`} data-prueba-restauracion={p.ok ? "ok" : "error"}>
      <span className="font-medium">Prueba de restauración del {fechaHN(p.fecha)}: {p.ok ? "correcta" : "falló"}.</span>{" "}
      {p.detalle}
    </p>
  );
}

function EditorDestino({ d, windows, onCambio }: { d: DestinoForm; windows: boolean; onCambio: (c: Partial<DestinoForm>) => void }) {
  // La ayuda va fuera de la etiqueta: si no, el lector de pantalla la lee como parte del nombre del campo.
  const campo = (etiqueta: string, hijo: React.ReactNode, ayuda?: string) => (
    <div className="text-sm">
      <label className="block">
        <span className="block text-xs font-medium text-gray-700">{etiqueta}</span>
        <span className="mt-1 block">{hijo}</span>
      </label>
      {ayuda && <p className="mt-0.5 text-xs text-gray-500">{ayuda}</p>}
    </div>
  );
  return (
    <div className="mt-3 grid gap-3 border-t border-gray-100 pt-3 sm:grid-cols-2" data-editor-destino>
      {campo("Nombre", <input className="input" value={d.nombre} onChange={(e) => onCambio({ nombre: e.target.value })} />)}
      <label className="flex items-center gap-2 self-end text-sm text-gray-800"><input type="checkbox" checked={d.activo} onChange={(e) => onCambio({ activo: e.target.checked })} /> Activo</label>
      {d.tipo === "LOCAL" && campo("Carpeta", <input className="input" placeholder="D:\Respaldos\Nomina" value={d.carpeta} onChange={(e) => onCambio({ carpeta: e.target.value })} />,
        "Mejor en otro disco que el de la base. En la instalación de Windows, la cuenta «NT SERVICE\\G360NominaApp» debe poder escribir en ella.")}
      {d.tipo === "EXTRAIBLE" && campo("Carpeta en el disco", <input className="input" placeholder={windows ? "E:\Respaldos" : "/mnt/respaldos"} value={d.carpeta} onChange={(e) => onCambio({ carpeta: e.target.value })} />,
        windows
          ? "Un disco USB o externo. Conéctelo y pulse «Preparar disco»: así se reconoce que es el disco de este destino. Si no está conectado, ese día el respaldo queda en los demás destinos. Va siempre cifrado."
          : "Un disco o una carpeta de red (CIFS o NFS) montados en esta ruta. Con la unidad montada, pulse «Preparar disco»: si un día no está montada, no se escribe en el disco del sistema. Va siempre cifrado.")}
      {d.tipo === "RED" && (
        <>
          {campo("Ruta de red", <input className="input" placeholder="\\servidor\respaldos\nomina" value={d.ruta} onChange={(e) => onCambio({ ruta: e.target.value })} />,
            windows ? "Una carpeta compartida de otro equipo o de un NAS." : "Sólo en la instalación de Windows.")}
          {campo("Usuario (opcional)", <input className="input" placeholder="NAS\respaldos" value={d.usuario ?? ""} onChange={(e) => onCambio({ usuario: e.target.value || null })} />,
            "Sin usuario se entra con la cuenta del equipo (en un dominio).")}
          {d.usuario && campo("Contraseña", <input type="password" autoComplete="new-password" className="input" placeholder={d.tieneClave ? "•••••••• guardada" : ""} value={d.claveNueva} onChange={(e) => onCambio({ claveNueva: e.target.value })} />)}
        </>
      )}
      {d.tipo === "NUBE" && (
        <>
          {campo("Proveedor", (
            <select className="input" value={d.proveedor} onChange={(e) => {
              const p = e.target.value as ProveedorS3;
              const pre = PROVEEDORES_S3[p];
              onCambio({ proveedor: p, region: pre.region, endpoint: pre.endpoint(pre.region), estiloRuta: pre.estiloRuta });
            }}>
              {(Object.keys(PROVEEDORES_S3) as ProveedorS3[]).map((p) => <option key={p} value={p}>{PROVEEDORES_S3[p].nombre}</option>)}
            </select>
          ), PROVEEDORES_S3[d.proveedor].ayuda)}
          {campo("Región", <input className="input" value={d.region} onChange={(e) => {
            const pre = PROVEEDORES_S3[d.proveedor];
            onCambio({ region: e.target.value, ...(d.proveedor !== "R2" && d.proveedor !== "OTRO" ? { endpoint: pre.endpoint(e.target.value) } : {}) });
          }} />)}
          {campo("Endpoint", <input className="input" value={d.endpoint} onChange={(e) => onCambio({ endpoint: e.target.value })} />)}
          {campo("Bucket", <input className="input" value={d.bucket} onChange={(e) => onCambio({ bucket: e.target.value.trim() })} />)}
          {campo("Carpeta dentro del bucket", <input className="input" placeholder="nomina/" value={d.prefijo} onChange={(e) => onCambio({ prefijo: e.target.value })} />)}
          {campo("Clave de acceso (Access Key ID)", <input className="input" autoComplete="off" value={d.accessKeyId} onChange={(e) => onCambio({ accessKeyId: e.target.value.trim() })} />)}
          {campo("Clave secreta", <input type="password" autoComplete="new-password" className="input" placeholder={d.tieneClave ? "•••••••• guardada" : ""} value={d.claveNueva} onChange={(e) => onCambio({ claveNueva: e.target.value.trim() })} />)}
          <label className="flex items-center gap-2 self-end text-sm text-gray-800">
            <input type="checkbox" checked={d.estiloRuta} onChange={(e) => onCambio({ estiloRuta: e.target.checked })} /> Direcciones con el bucket en la ruta
          </label>
        </>
      )}
    </div>
  );
}
