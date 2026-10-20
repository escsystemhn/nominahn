"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";
import MisPrestamos from "@/components/portal/MisPrestamos";
import MisConstancias from "@/components/portal/MisConstancias";
import SaludFamilia from "@/components/employees/SaludFamilia";

interface Props {
  nombre: string;
  puesto: string;
  diasDevengados: number;
  diasDisponibles: number;
  diasTomados: number;
  puedeAprobar: boolean;
}

interface MisDatos {
  telefonoPersonal: string | null;
  telefonoEmergencia: string | null;
  contactoEmergencia: string | null;
  direccion: string | null;
  estadoCivil: string | null;
}

interface Permiso {
  id: string;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  diasSolicitados: number;
  diasAprobados: number | null;
  motivo: string | null;
  estado: string;
  empleado?: { primerNombre: string; primerApellido: string; codigo: string };
}

interface Boleta {
  id: string;
  totalBruto: string | number;
  totalDeducciones: string | number;
  salarioNeto: string | number;
  planilla: { tipo: string; fechaInicio: string; fechaFin: string; estado: string };
}

const TIPOS = [
  { v: "VACACIONES", l: "Vacaciones" },
  { v: "ENFERMEDAD", l: "Enfermedad" },
  { v: "PERSONAL", l: "Personal" },
  { v: "MATERNIDAD", l: "Maternidad" },
  { v: "PATERNIDAD", l: "Paternidad" },
  { v: "DUELO", l: "Duelo" },
  { v: "SIN_GOCE", l: "Sin goce de sueldo" },
  { v: "OTRO", l: "Otro" },
];

const badge: Record<string, string> = {
  PENDIENTE: "bg-amber-100 text-amber-800",
  APROBADO: "bg-green-100 text-green-800",
  RECHAZADO: "bg-red-100 text-red-700",
};

type Tab = "solicitudes" | "boletas" | "prestamos" | "constancias" | "datos" | "salud" | "aprobaciones";

const CAMPOS_DATOS: { k: keyof MisDatos; l: string }[] = [
  { k: "telefonoPersonal", l: "Teléfono personal" },
  { k: "direccion", l: "Dirección" },
  { k: "estadoCivil", l: "Estado civil" },
  { k: "contactoEmergencia", l: "Contacto de emergencia" },
  { k: "telefonoEmergencia", l: "Teléfono de emergencia" },
];

interface DatosEspacio {
  permisos: Permiso[];
  boletas: Boleta[];
  datos: MisDatos | null;
  /** `null` cuando el usuario no aprueba permisos: no se pidió ese recurso. */
  aprobaciones: Permiso[] | null;
}

// Petición pura (no toca estado de React), reutilizable desde el efecto de carga
// inicial y desde el refresco manual.
async function obtenerEspacio(puedeAprobar: boolean): Promise<DatosEspacio> {
  const reqs: Promise<Response>[] = [fetch("/api/permisos"), fetch("/api/mis-boletas"), fetch("/api/mis-datos")];
  if (puedeAprobar) reqs.push(fetch("/api/permisos?scope=aprobaciones"));
  const [rPer, rBol, rDat, rApr] = await Promise.all(reqs);
  return {
    permisos: rPer.ok ? await rPer.json() : [],
    boletas: rBol.ok ? await rBol.json() : [],
    datos: rDat.ok ? await rDat.json() : null,
    aprobaciones: rApr ? (rApr.ok ? await rApr.json() : []) : null,
  };
}

export default function MiEspacioClient({ nombre, puesto, diasDevengados, diasDisponibles, diasTomados, puedeAprobar }: Props) {
  const [tab, setTab] = useState<Tab>("solicitudes");
  const [permisos, setPermisos] = useState<Permiso[]>([]);
  const [aprobaciones, setAprobaciones] = useState<Permiso[]>([]);
  const [boletas, setBoletas] = useState<Boleta[]>([]);
  // Arranca en true: el efecto de carga inicial lo baja al recibir los datos.
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({ tipo: "VACACIONES", fechaInicio: "", fechaFin: "", motivo: "" });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const [datos, setDatos] = useState<MisDatos | null>(null);
  const [guardandoDatos, setGuardandoDatos] = useState(false);
  const [datosMsg, setDatosMsg] = useState("");

  // Vuelca en el estado lo que devuelve `obtenerEspacio`. Se usa tanto en el
  // efecto de carga inicial como en el refresco manual.
  const aplicar = useCallback((d: DatosEspacio) => {
    setPermisos(d.permisos);
    setBoletas(d.boletas);
    setDatos(d.datos);
    if (d.aprobaciones) setAprobaciones(d.aprobaciones);
  }, []);

  // Refresco manual tras una mutación (desde manejadores de eventos).
  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      aplicar(await obtenerEspacio(puedeAprobar));
    } finally {
      setLoading(false);
    }
  }, [puedeAprobar, aplicar]);

  // Carga inicial. `vivo` descarta la respuesta si el componente ya se desmontó.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const d = await obtenerEspacio(puedeAprobar);
      if (!vivo) return;
      aplicar(d);
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, [puedeAprobar, aplicar]);

  async function guardarDatos(e: React.FormEvent) {
    e.preventDefault();
    if (!datos) return;
    setDatosMsg("");
    setGuardandoDatos(true);
    try {
      const res = await fetch("/api/mis-datos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });
      setDatosMsg(res.ok ? "Datos actualizados." : ((await res.json()).error ?? "No se pudo guardar."));
    } finally {
      setGuardandoDatos(false);
    }
  }

  async function enviarSolicitud(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.fechaInicio || !form.fechaFin) { setError("Indique las fechas."); return; }
    if (form.fechaFin < form.fechaInicio) { setError("La fecha fin no puede ser anterior a la fecha inicio."); return; }
    setEnviando(true);
    try {
      const res = await fetch("/api/permisos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) { setError((await res.json()).error ?? "No se pudo enviar la solicitud."); return; }
      setForm({ tipo: "VACACIONES", fechaInicio: "", fechaFin: "", motivo: "" });
      await cargar();
    } finally {
      setEnviando(false);
    }
  }

  async function resolver(id: string, estado: "APROBADO" | "RECHAZADO") {
    const res = await fetch(`/api/permisos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado }),
    });
    if (!res.ok) { alert((await res.json()).error ?? "No se pudo resolver."); return; }
    await cargar();
  }

  const tabs: [Tab, string][] = [
    ["solicitudes", "Solicitudes"],
    ["boletas", "Mis boletas"],
    ["prestamos", "Préstamos"],
    ["constancias", "Constancias"],
    ["datos", "Mis datos"],
    ["salud", "Salud y familia"],
    ...(puedeAprobar ? ([["aprobaciones", `Aprobaciones${aprobaciones.length ? ` (${aprobaciones.length})` : ""}`]] as [Tab, string][]) : []),
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Mi espacio</h1>
        <p className="text-sm text-gray-500">{nombre}{puesto ? ` · ${puesto}` : ""}</p>
      </div>

      {/* Resumen vacaciones */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500">Días disponibles</p>
          <p className="text-2xl font-bold mt-1 text-green-700">{diasDisponibles.toFixed(1)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500">Devengados (total)</p>
          <p className="text-2xl font-bold mt-1 text-gray-900">{diasDevengados.toFixed(1)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500">Tomados</p>
          <p className="text-2xl font-bold mt-1 text-gray-900">{diasTomados.toFixed(1)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              tab === key ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "solicitudes" && (
        <div className="grid md:grid-cols-2 gap-5">
          {/* Formulario */}
          <form onSubmit={enviarSolicitud} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3 h-fit">
            <h2 className="font-semibold text-gray-900">Nueva solicitud</h2>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Tipo</label>
              <select
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Desde</label>
                <input type="date" value={form.fechaInicio}
                  onChange={(e) => setForm({ ...form, fechaInicio: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Hasta</label>
                <input type="date" value={form.fechaFin}
                  onChange={(e) => setForm({ ...form, fechaFin: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Motivo (opcional)</label>
              <textarea value={form.motivo} rows={2}
                onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button type="submit" disabled={enviando}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {enviando ? "Enviando…" : "Enviar solicitud"}
            </button>
          </form>

          {/* Mis solicitudes */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">Mis solicitudes</div>
            {loading ? (
              <p className="p-5 text-sm text-gray-400">Cargando…</p>
            ) : permisos.length === 0 ? (
              <p className="p-5 text-sm text-gray-400">Aún no ha registrado solicitudes.</p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {permisos.map((p) => (
                  <li key={p.id} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{TIPOS.find((t) => t.v === p.tipo)?.l ?? p.tipo}</p>
                      <p className="text-xs text-gray-500">
                        {formatDate(p.fechaInicio)} – {formatDate(p.fechaFin)} · {p.diasSolicitados} día(s)
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${badge[p.estado] ?? "bg-gray-100 text-gray-600"}`}>
                      {p.estado}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "boletas" && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <p className="p-5 text-sm text-gray-400">Cargando…</p>
          ) : boletas.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">No hay boletas de pago disponibles todavía.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-gray-600 text-xs">
                  <th className="text-left px-4 py-3 font-medium">Período</th>
                  <th className="text-left px-4 py-3 font-medium">Tipo</th>
                  <th className="text-right px-4 py-3 font-medium">Bruto</th>
                  <th className="text-right px-4 py-3 font-medium">Deducciones</th>
                  <th className="text-right px-4 py-3 font-medium">Neto</th>
                  <th className="text-center px-4 py-3 font-medium">Boleta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {boletas.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">{formatDate(b.planilla.fechaInicio)} – {formatDate(b.planilla.fechaFin)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{b.planilla.tipo}</td>
                    <td className="px-4 py-2.5 text-right">{formatCurrency(Number(b.totalBruto))}</td>
                    <td className="px-4 py-2.5 text-right text-red-600">{formatCurrency(Number(b.totalDeducciones))}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-green-700">{formatCurrency(Number(b.salarioNeto))}</td>
                    <td className="px-4 py-2.5 text-center">
                      <a href={`/api/mis-boletas/${b.id}?modo=ver`} target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-xs font-medium mr-3">Ver</a>
                      <a href={`/api/mis-boletas/${b.id}`}
                        className="text-gray-500 hover:underline text-xs">Descargar</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "prestamos" && <MisPrestamos />}

      {tab === "constancias" && <MisConstancias />}

      {tab === "salud" && <SaludFamilia endpoint="/api/mi-espacio/salud-familia" descripcionPropia />}

      {tab === "datos" && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 max-w-2xl">
          <h2 className="font-semibold text-gray-900 mb-1">Mis datos personales</h2>
          <p className="text-xs text-gray-500 mb-4">
            Puede actualizar sus datos de contacto. Para cambios de salario, puesto o
            identidad contacte a Recursos Humanos.
          </p>
          {loading || !datos ? (
            <p className="text-sm text-gray-400">Cargando…</p>
          ) : (
            <form onSubmit={guardarDatos} className="grid sm:grid-cols-2 gap-4">
              {CAMPOS_DATOS.map(({ k, l }) => (
                <div key={k} className={k === "direccion" ? "sm:col-span-2" : ""}>
                  <label className="block text-xs text-gray-600 mb-1">{l}</label>
                  <input
                    type="text"
                    value={datos[k] ?? ""}
                    onChange={(e) => setDatos({ ...datos, [k]: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              ))}
              <div className="sm:col-span-2 flex items-center gap-3">
                <button type="submit" disabled={guardandoDatos}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {guardandoDatos ? "Guardando…" : "Guardar cambios"}
                </button>
                {datosMsg && <span className="text-xs text-gray-600">{datosMsg}</span>}
              </div>
            </form>
          )}
        </div>
      )}

      {tab === "aprobaciones" && puedeAprobar && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">Solicitudes pendientes de aprobación</div>
          {loading ? (
            <p className="p-5 text-sm text-gray-400">Cargando…</p>
          ) : aprobaciones.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">No hay solicitudes pendientes.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {aprobaciones.map((p) => (
                <li key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {p.empleado ? `${p.empleado.primerNombre} ${p.empleado.primerApellido}` : "Empleado"}
                      <span className="text-gray-400 font-normal"> · {p.empleado?.codigo}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      {TIPOS.find((t) => t.v === p.tipo)?.l ?? p.tipo} · {formatDate(p.fechaInicio)} – {formatDate(p.fechaFin)} · {p.diasSolicitados} día(s)
                    </p>
                    {p.motivo && <p className="text-xs text-gray-400 mt-0.5">“{p.motivo}”</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => resolver(p.id, "APROBADO")}
                      className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700">Aprobar</button>
                    <button onClick={() => resolver(p.id, "RECHAZADO")}
                      className="px-3 py-1.5 border border-red-300 text-red-700 text-xs font-medium rounded-lg hover:bg-red-50">Rechazar</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
