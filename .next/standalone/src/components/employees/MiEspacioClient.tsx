"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import { formatCurrency, formatDate } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge, { etiquetaEstado } from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";
import FranjaCifras from "@/components/ui/FranjaCifras";
import { Campo } from "@/components/ui/ModalForm";
import MisPrestamos from "@/components/portal/MisPrestamos";
import MisConstancias from "@/components/portal/MisConstancias";
import MisCapacitaciones from "@/components/portal/MisCapacitaciones";
import SaludFamilia from "@/components/employees/SaludFamilia";
import FotoAvatar from "@/components/employees/FotoAvatar";

interface Props {
  nombre: string;
  /** Para mostrar su foto; la cambia Recursos Humanos, no el empleado. */
  empleadoId?: string;
  fotoVersion?: number | null;
  puesto: string;
  diasDevengados: number;
  diasDisponibles: number;
  diasTomados: number;
  puedeAprobar: boolean;
  /** Cuenta sin empleado vinculado que aprueba permisos: no tiene boletas ni saldo que mostrar. */
  soloAprobaciones?: boolean;
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

type Tab = "solicitudes" | "boletas" | "prestamos" | "constancias" | "capacitaciones" | "datos" | "salud" | "aprobaciones";

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
async function obtenerEspacio(puedeAprobar: boolean, soloAprobaciones: boolean): Promise<DatosEspacio> {
  if (soloAprobaciones) {
    const r = await fetch("/api/permisos?scope=aprobaciones");
    return { permisos: [], boletas: [], datos: null, aprobaciones: r.ok ? await r.json() : [] };
  }
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

export default function MiEspacioClient({ nombre, empleadoId, fotoVersion = null, puesto, diasDevengados, diasDisponibles, diasTomados, puedeAprobar, soloAprobaciones = false }: Props) {
  const { avisar } = useAvisos();
  // ?tab=capacitaciones: el visor de material vuelve a la pestaña de donde salió.
  const pedida = useSearchParams().get("tab");
  const [tab, setTab] = useState<Tab>(
    soloAprobaciones ? "aprobaciones" : pedida === "capacitaciones" || pedida === "constancias" || pedida === "boletas" ? pedida : "solicitudes"
  );
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
      aplicar(await obtenerEspacio(puedeAprobar, soloAprobaciones));
    } finally {
      setLoading(false);
    }
  }, [puedeAprobar, soloAprobaciones, aplicar]);

  // Carga inicial. `vivo` descarta la respuesta si el componente ya se desmontó.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const d = await obtenerEspacio(puedeAprobar, soloAprobaciones);
      if (!vivo) return;
      aplicar(d);
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, [puedeAprobar, soloAprobaciones, aplicar]);

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
      setDatosMsg(res.ok ? "Datos actualizados." : ((await res.json().catch(() => ({}))).error ?? "No se pudo guardar."));
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
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "No se pudo enviar la solicitud."); return; }
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
    if (!res.ok) { avisar.error((await res.json().catch(() => ({}))).error ?? "No se pudo resolver la solicitud."); return; }
    avisar.exito(estado === "APROBADO" ? "Solicitud aprobada." : "Solicitud rechazada.");
    await cargar();
  }

  const tabs: [Tab, string][] = [
    ["solicitudes", "Solicitudes"],
    ["boletas", "Mis boletas"],
    ["prestamos", "Préstamos"],
    ["constancias", "Constancias"],
    ["capacitaciones", "Capacitaciones"],
    ["datos", "Mis datos"],
    ["salud", "Salud y familia"],
    ...(puedeAprobar ? ([["aprobaciones", `Aprobaciones${aprobaciones.length ? ` (${aprobaciones.length})` : ""}`]] as [Tab, string][]) : []),
  ];

  return (
    <div className="space-y-6">
      {soloAprobaciones ? (
        <PageHeader title="Aprobaciones" description="Permisos y vacaciones que esperan respuesta." />
      ) : (
      <>
      <PageHeader
        title={empleadoId ? <span className="flex items-center gap-3"><FotoAvatar empleadoId={empleadoId} version={fotoVersion} nombre={nombre} tamano="md" />Mi espacio</span> : "Mi espacio"}
        description={`${nombre}${puesto ? `, ${puesto}` : ""}`}
      >
        {/* En el celular sólo cabían 3 de las 7 pestañas, sin pista de las demás. */}
        <label className="block sm:hidden">
          <span className="sr-only">Sección de Mi espacio</span>
          <select className="input" value={tab} onChange={(e) => setTab(e.target.value as Tab)}>
            {tabs.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <div className="-mb-5 hidden gap-1 overflow-x-auto sm:flex">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${
                tab === key ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </PageHeader>

      {/* Resumen vacaciones */}
      <FranjaCifras
        etiqueta="Resumen de vacaciones"
        cifras={[
          { label: "Días disponibles", valor: diasDisponibles.toFixed(1), destacada: true },
          { label: "Devengados (total)", valor: diasDevengados.toFixed(1) },
          { label: "Tomados", valor: diasTomados.toFixed(1) },
        ]}
      />
      </>
      )}

      {tab === "solicitudes" && (
        <div className="grid gap-5 md:grid-cols-2">
          {/* Formulario */}
          <form onSubmit={enviarSolicitud} className="panel h-fit space-y-3 p-5">
            <h2 className="font-semibold text-gray-900">Nueva solicitud</h2>
            <Campo etiqueta="Tipo">
              <select
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                className="input"
              >
                {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Desde">
                <input type="date" value={form.fechaInicio}
                  onChange={(e) => setForm({ ...form, fechaInicio: e.target.value })}
                  className="input" />
              </Campo>
              <Campo etiqueta="Hasta">
                <input type="date" value={form.fechaFin}
                  onChange={(e) => setForm({ ...form, fechaFin: e.target.value })}
                  className="input" />
              </Campo>
            </div>
            <Campo etiqueta="Motivo (opcional)">
              <textarea value={form.motivo} rows={2}
                onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                className="input" />
            </Campo>
            {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
            <button type="submit" disabled={enviando} className="btn btn-primary">
              {enviando ? "Enviando…" : "Enviar solicitud"}
            </button>
          </form>

          {/* Mis solicitudes */}
          <div className="panel overflow-hidden">
            <div className="border-b border-gray-200 px-5 py-3 text-sm font-semibold text-gray-900">Mis solicitudes</div>
            {loading ? (
              <p className="p-5 text-sm text-gray-500">Cargando…</p>
            ) : permisos.length === 0 ? (
              <EstadoVacio titulo="Aún no ha registrado solicitudes." detalle="Llene el formulario de la izquierda para pedir vacaciones o un permiso." />
            ) : (
              <ul className="divide-y divide-gray-100">
                {permisos.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{TIPOS.find((t) => t.v === p.tipo)?.l ?? p.tipo}</p>
                      <p className="text-xs text-gray-500">
                        {formatDate(p.fechaInicio)} al {formatDate(p.fechaFin)}, {p.diasSolicitados} día(s)
                      </p>
                    </div>
                    <EstadoBadge valor={p.estado} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "boletas" && (
        <div className="panel overflow-hidden">
          {loading ? (
            <p className="p-5 text-sm text-gray-500">Cargando…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base tabla-tarjetas">
                <thead>
                  <tr>
                    <th>Período</th>
                    <th>Tipo</th>
                    <th className="num">Bruto</th>
                    <th className="num">Deducciones</th>
                    <th className="num">Neto</th>
                    <th>Boleta</th>
                  </tr>
                </thead>
                <tbody>
                  {boletas.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <EstadoVacio titulo="Todavía no hay boletas de pago." detalle="Cuando se pague una planilla, su boleta aparecerá aquí." />
                      </td>
                    </tr>
                  ) : boletas.map((b) => (
                    <tr key={b.id}>
                      <td data-titulo className="whitespace-nowrap font-medium text-gray-900">{formatDate(b.planilla.fechaInicio)} al {formatDate(b.planilla.fechaFin)}</td>
                      <td data-etiqueta="Tipo">{etiquetaEstado(b.planilla.tipo)}</td>
                      <td data-etiqueta="Bruto" className="num whitespace-nowrap">{formatCurrency(Number(b.totalBruto))}</td>
                      <td data-etiqueta="Deducciones" className="num whitespace-nowrap text-gray-500">{formatCurrency(Number(b.totalDeducciones))}</td>
                      <td data-etiqueta="Neto" className="num whitespace-nowrap font-medium text-gray-900">{formatCurrency(Number(b.salarioNeto))}</td>
                      <td data-accion className="whitespace-nowrap">
                        <a href={`/api/mis-boletas/${b.id}?modo=ver`} target="_blank" rel="noopener noreferrer"
                          className="mr-3 text-sm font-medium text-blue-700 hover:underline">Ver</a>
                        <a href={`/api/mis-boletas/${b.id}`}
                          className="text-sm text-gray-600 hover:underline">Descargar PDF</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "prestamos" && <MisPrestamos />}

      {tab === "constancias" && <MisConstancias />}

      {tab === "capacitaciones" && <MisCapacitaciones />}

      {tab === "salud" && <SaludFamilia endpoint="/api/mi-espacio/salud-familia" descripcionPropia />}

      {tab === "datos" && (
        <div className="panel max-w-2xl p-5">
          <h2 className="mb-1 font-semibold text-gray-900">Mis datos personales</h2>
          <p className="mb-4 text-sm text-gray-500">
            Puede actualizar sus datos de contacto. Para cambios de salario, puesto o
            identidad contacte a Recursos Humanos.
          </p>
          {loading || !datos ? (
            <p className="text-sm text-gray-500">Cargando…</p>
          ) : (
            <form onSubmit={guardarDatos} className="grid gap-4 sm:grid-cols-2">
              {CAMPOS_DATOS.map(({ k, l }) => (
                <div key={k} className={k === "direccion" ? "sm:col-span-2" : ""}>
                  <Campo etiqueta={l}>
                    <input
                      type="text"
                      value={datos[k] ?? ""}
                      onChange={(e) => setDatos({ ...datos, [k]: e.target.value })}
                      className="input"
                    />
                  </Campo>
                </div>
              ))}
              <div className="flex items-center gap-3 sm:col-span-2">
                <button type="submit" disabled={guardandoDatos} className="btn btn-primary">
                  {guardandoDatos ? "Guardando…" : "Guardar cambios"}
                </button>
                {datosMsg && <span className="text-sm text-gray-600">{datosMsg}</span>}
              </div>
            </form>
          )}
        </div>
      )}

      {tab === "aprobaciones" && puedeAprobar && (
        <div className="panel overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-3 text-sm font-semibold text-gray-900">Solicitudes pendientes de aprobación</div>
          {loading ? (
            <p className="p-5 text-sm text-gray-500">Cargando…</p>
          ) : aprobaciones.length === 0 ? (
            <EstadoVacio titulo="No hay solicitudes pendientes." detalle="Cuando alguien pida un permiso o vacaciones, aparecerá aquí para su respuesta." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {aprobaciones.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {p.empleado ? `${p.empleado.primerNombre} ${p.empleado.primerApellido}` : "Empleado"}
                      <span className="font-normal text-gray-500">, {p.empleado?.codigo}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      {TIPOS.find((t) => t.v === p.tipo)?.l ?? p.tipo}, {formatDate(p.fechaInicio)} al {formatDate(p.fechaFin)}, {p.diasSolicitados} día(s)
                    </p>
                    {p.motivo && <p className="mt-0.5 text-xs text-gray-500">“{p.motivo}”</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => resolver(p.id, "APROBADO")}
                      className="btn btn-secondary btn-sm">Aprobar</button>
                    <button onClick={() => resolver(p.id, "RECHAZADO")}
                      className="btn btn-sm border border-red-300 bg-white text-red-700 hover:bg-red-50">Rechazar</button>
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
