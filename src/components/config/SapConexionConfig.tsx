"use client";

/**
 * Configuración → SAP - Conexión. Sólo para quien tiene `configuracion.sap`
 * (por omisión, SUPER_ADMIN).
 *
 * Cuatro partes: la conexión con el Service Layer, el comportamiento del
 * envío, el mapeo hacia SAP (catálogo, cuentas, centros de costo y
 * sucursales), y la bitácora de lo enviado. La contraseña nunca vuelve del
 * servidor: el campo aparece vacío y dejarlo así conserva la guardada.
 *
 * El catálogo contable puede REEMPLAZARSE por el plan de cuentas de SAP: a
 * partir de ahí SAP manda y el plan local es un espejo de sólo lectura.
 */

import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

type ModoEnvio = "MANUAL" | "AL_APROBAR" | "AL_PAGAR";
type FechaContable = "PAGO" | "FIN_PERIODO";

interface Configuracion {
  activo: boolean;
  urlBase: string;
  companyDb: string;
  usuario: string;
  tienePassword: boolean;
  modoEnvio: ModoEnvio;
  incluirProvisiones: boolean;
  porCentroCosto: boolean;
  dimensionCentro: number;
  fechaContable: FechaContable;
  codigoTransaccion: string | null;
  serie: number | null;
  memoPlantilla: string;
  longitudes: { memo: number; lineMemo: number; referencia: number };
  usaSucursales: boolean;
  sapBplIdPorDefecto: number | null;
  catalogoOrigen: "LOCAL" | "SAP";
  catalogoImportadoAt: string | null;
  catalogoCuentas: number | null;
  baseDatos: {
    servidor: string | null;
    puerto: number;
    instancia: string | null;
    usuario: string | null;
    tienePassword: boolean;
    cifrar: boolean;
    confiarCertificado: boolean;
    ultimaPruebaAt: string | null;
    ultimaPruebaOk: boolean | null;
    ultimaPruebaDetalle: string | null;
  };
  ultimaPruebaAt: string | null;
  ultimaPruebaOk: boolean | null;
  ultimaPruebaDetalle: string | null;
  versionSap: string | null;
  actualizadoPor: string | null;
  updatedAt: string;
}

interface EnvioResumen {
  id: string;
  planillaId: string;
  tipo: "ASIENTO" | "REVERSO";
  estado: "PENDIENTE" | "ENVIANDO" | "ENVIADO" | "ERROR" | "CANCELADO";
  intentos: number;
  sapNumero: number | null;
  sapTransId: number | null;
  errorTraducido: string | null;
  proximoIntentoAt: string | null;
  enviadoAt: string | null;
  updatedAt: string;
  planilla: { tipo: string; fechaInicio: string; fechaFin: string; estado: string };
}

interface Estado {
  configuracion: Configuracion | null;
  cifradoDisponible: boolean;
  cola: { pendientes: number; errores: number; enviados: number };
  envios: EnvioResumen[];
}

interface CuentaLocal {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
  esDetalle: boolean;
  sapAcctCode: string | null;
  sapNombre: string | null;
  sapActiva: boolean | null;
  sapVerificadaAt: string | null;
}

interface Mapeo {
  conceptos: Array<{ clave: string; concepto: string; naturaleza: "GASTO" | "PASIVO"; codigoPorOmision: string; cuenta: CuentaLocal | null }>;
  centros: Array<{ id: string; codigo: string; nombre: string; activo: boolean; sapCostingCode: string | null; sapProjectCode: string | null }>;
  sucursales: Array<{ id: string; codigo: string; nombre: string; activa: boolean; sapBplId: number | null; sapBplNombre: string | null }>;
  usaSucursales: boolean;
  sapBplIdPorDefecto: number | null;
  catalogo: { origen: string; importadoAt: string | null; cuentas: number | null };
}

interface CuentaSap {
  code: string;
  name: string;
  formatCode: string | null;
  activa: boolean;
}

interface SucursalSap {
  bplId: number;
  nombre: string;
  activa: boolean;
}

interface SinCuenta {
  clave: string;
  concepto: string;
  motivo: string;
}

interface VistaPrevia {
  catalogo: { avisos: string[]; resumen: { total: number; detalle: number; titulos: number; inactivas: number; porTipo: Record<string, number> } };
  muestra: Array<{ codigo: string; nombre: string; tipo: string; nivel: number; esDetalle: boolean }>;
  local: { cuentas: number; mapeosConCuenta: number; origen: "LOCAL" | "SAP" };
  mapeos: { asignaciones: Array<{ clave: string; codigo: string }>; sinCuenta: SinCuenta[] };
}

interface ResultadoReemplazo {
  cuentasAntes: number;
  cuentasDespues: number;
  reasignados: number;
  sinCuenta: SinCuenta[];
  avisos: string[];
}

interface ResultadoBd {
  servidor: string;
  versionSql: string;
  login: string;
  baseDatos: string;
  esBaseSap: boolean;
  empresa: string | null;
  moneda: string | null;
  versionB1: string | null;
  puedeEscribir: boolean;
  avisos: string[];
  ms: number;
}

interface EstadoBd {
  ocupado: "probar" | "empresas" | null;
  resultado: ResultadoBd | null;
  empresas: Array<{ baseDatos: string; nombre: string; version: string | null }> | null;
  origenEmpresas: "SBO-COMMON" | "SERVIDOR" | null;
  mensaje: { ok: boolean; texto: string; tecnico?: string | null } | null;
}

interface Importacion {
  cargando: boolean;
  vista: VistaPrevia | null;
  resultado: ResultadoReemplazo | null;
  error: string | null;
  confirmacion: string;
}

type Seccion = "conexion" | "comportamiento" | "mapeo" | "bitacora";

const SECCIONES: Array<{ key: Seccion; label: string }> = [
  { key: "conexion", label: "Conexión" },
  { key: "comportamiento", label: "Comportamiento" },
  { key: "mapeo", label: "Mapeo contable" },
  { key: "bitacora", label: "Bitácora" },
];

const ESTADO_ENVIO: Record<EnvioResumen["estado"], { label: string; punto: string }> = {
  PENDIENTE: { label: "Pendiente", punto: "bg-amber-500" },
  ENVIANDO: { label: "Enviando", punto: "bg-blue-500" },
  ENVIADO: { label: "Enviado", punto: "bg-green-600" },
  ERROR: { label: "Error", punto: "bg-red-600" },
  CANCELADO: { label: "Cancelado", punto: "bg-gray-400" },
};

const ETIQUETA_TIPO: Record<string, string> = {
  ACTIVO: "Activo",
  PASIVO: "Pasivo",
  PATRIMONIO: "Patrimonio",
  INGRESO: "Ingresos",
  COSTO: "Costos",
  GASTO: "Gastos",
};

const fechaHora = (s: string | null) => (s ? new Date(s).toLocaleString("es-HN", { dateStyle: "short", timeStyle: "short" }) : "");

const formVacio = {
  activo: false,
  urlBase: "",
  companyDb: "",
  usuario: "",
  password: "",
  modoEnvio: "MANUAL" as ModoEnvio,
  incluirProvisiones: true,
  porCentroCosto: false,
  dimensionCentro: "1",
  fechaContable: "PAGO" as FechaContable,
  codigoTransaccion: "",
  serie: "",
  memoPlantilla: "Planilla {tipo} {desde} al {hasta}",
  usaSucursales: false,
  sapBplIdPorDefecto: "",
  dbServidor: "",
  dbPuerto: "1433",
  dbInstancia: "",
  dbUsuario: "",
  dbPassword: "",
  dbCifrar: false,
  dbConfiarCertificado: true,
};

export default function SapConexionConfig() {
  const [seccion, setSeccion] = useState<Seccion>("conexion");
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [form, setForm] = useState(formVacio);

  const [mapeo, setMapeo] = useState<Mapeo | null>(null);
  const [codigosSap, setCodigosSap] = useState<Record<string, string>>({});
  const [centrosSap, setCentrosSap] = useState<Record<string, { costing: string; project: string }>>({});
  const [sucursalesMap, setSucursalesMap] = useState<Record<string, string>>({});
  const [sucursalesSap, setSucursalesSap] = useState<SucursalSap[] | null>(null);
  const [cargandoSucursales, setCargandoSucursales] = useState(false);
  const [busqueda, setBusqueda] = useState<{ cuentaId: string; resultados: CuentaSap[]; error: string | null; cargando: boolean } | null>(null);
  const [guardandoMapeo, setGuardandoMapeo] = useState(false);
  const [importacion, setImportacion] = useState<Importacion | null>(null);
  const [bd, setBd] = useState<EstadoBd>({ ocupado: null, resultado: null, empresas: null, origenEmpresas: null, mensaje: null });

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/configuracion/sap", { cache: "no-store" });
      const d: Estado & { error?: string } = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo cargar la configuración");
      setEstado(d);
      setError(null);
      const c = d.configuracion;
      if (c) {
        setForm({
          activo: c.activo,
          urlBase: c.urlBase,
          companyDb: c.companyDb,
          usuario: c.usuario,
          password: "",
          modoEnvio: c.modoEnvio,
          incluirProvisiones: c.incluirProvisiones,
          porCentroCosto: c.porCentroCosto,
          dimensionCentro: String(c.dimensionCentro),
          fechaContable: c.fechaContable,
          codigoTransaccion: c.codigoTransaccion ?? "",
          serie: c.serie === null ? "" : String(c.serie),
          memoPlantilla: c.memoPlantilla,
          usaSucursales: c.usaSucursales,
          sapBplIdPorDefecto: c.sapBplIdPorDefecto === null ? "" : String(c.sapBplIdPorDefecto),
          dbServidor: c.baseDatos.servidor ?? "",
          dbPuerto: String(c.baseDatos.puerto ?? 1433),
          dbInstancia: c.baseDatos.instancia ?? "",
          dbUsuario: c.baseDatos.usuario ?? "",
          dbPassword: "",
          dbCifrar: c.baseDatos.cifrar,
          dbConfiarCertificado: c.baseDatos.confiarCertificado,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    }
  }, []);

  const cargarMapeo = useCallback(async () => {
    try {
      const res = await fetch("/api/configuracion/sap/mapeo", { cache: "no-store" });
      const d: Mapeo & { error?: string } = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo cargar el mapeo");
      aplicarMapeo(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar el mapeo");
    }
  }, []);

  function aplicarMapeo(d: Mapeo) {
    setMapeo(d);
    const codigos: Record<string, string> = {};
    for (const c of d.conceptos) if (c.cuenta) codigos[c.cuenta.id] = c.cuenta.sapAcctCode ?? "";
    setCodigosSap(codigos);
    setCentrosSap(Object.fromEntries(d.centros.map((c) => [c.id, { costing: c.sapCostingCode ?? "", project: c.sapProjectCode ?? "" }])));
    setSucursalesMap(Object.fromEntries(d.sucursales.map((s) => [s.id, s.sapBplId === null ? "" : String(s.sapBplId)])));
  }

  // Las cargas se disparan desde un temporizador: el estado se fija cuando
  // responde el servidor, no en el cuerpo del efecto.
  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  useEffect(() => {
    if (seccion !== "mapeo" || mapeo) return;
    const t = setTimeout(() => void cargarMapeo(), 0);
    return () => clearTimeout(t);
  }, [seccion, mapeo, cargarMapeo]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/configuracion/sap", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          dimensionCentro: Number(form.dimensionCentro),
          serie: form.serie === "" ? null : Number(form.serie),
          codigoTransaccion: form.codigoTransaccion || null,
          sapBplIdPorDefecto: form.sapBplIdPorDefecto === "" ? null : Number(form.sapBplIdPorDefecto),
          // Vacía = conservar la guardada.
          password: form.password === "" ? undefined : form.password,
          dbServidor: form.dbServidor.trim() || null,
          dbPuerto: Number(form.dbPuerto) || 1433,
          dbInstancia: form.dbInstancia.trim() || null,
          dbUsuario: form.dbUsuario.trim() || null,
          dbPassword: form.dbPassword === "" ? undefined : form.dbPassword,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        const campos = d.detalles ? Object.entries(d.detalles).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`) : [];
        throw new Error([d.error ?? "No se pudo guardar", ...campos].join("\n"));
      }
      setAviso({ ok: true, texto: "Configuración guardada." });
      await cargar();
      if (mapeo) await cargarMapeo();
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "Error al guardar" });
    } finally {
      setGuardando(false);
    }
  }

  async function probar() {
    setProbando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/configuracion/sap/prueba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Si todavía no hay contraseña guardada, se prueba con la tecleada.
        body: JSON.stringify({ password: form.password || undefined }),
      });
      const d = await res.json();
      setAviso(d.ok ? { ok: true, texto: d.detalle } : { ok: false, texto: `${d.error ?? "No se pudo conectar."}${d.detalleTecnico ? `\n${d.detalleTecnico}` : ""}` });
      await cargar();
    } catch {
      setAviso({ ok: false, texto: "No se pudo contactar al servidor de la aplicación." });
    } finally {
      setProbando(false);
    }
  }

  async function accionBd(accion: "probar" | "empresas") {
    if (!form.dbServidor.trim() || !form.dbUsuario.trim()) {
      setBd((b) => ({ ...b, mensaje: { ok: false, texto: "Escriba el servidor y el usuario de SQL Server." } }));
      return;
    }
    setBd((b) => ({ ...b, ocupado: accion, mensaje: null, ...(accion === "probar" ? { resultado: null } : {}) }));
    try {
      const res = await fetch("/api/configuracion/sap/base-datos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion,
          servidor: form.dbServidor.trim(),
          puerto: Number(form.dbPuerto) || 1433,
          instancia: form.dbInstancia.trim() || null,
          usuario: form.dbUsuario.trim(),
          password: form.dbPassword || undefined,
          cifrar: form.dbCifrar,
          confiarCertificado: form.dbConfiarCertificado,
          companyDb: form.companyDb.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        const campos = d.detalles ? Object.entries(d.detalles).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`) : [];
        throw new Error([d.error ?? "No se pudo consultar la base", ...campos].join("\n"));
      }
      if (accion === "empresas") {
        setBd((b) => ({ ...b, ocupado: null, empresas: d.ok ? d.empresas : null, origenEmpresas: d.ok ? d.origen : null,
          mensaje: d.ok ? { ok: true, texto: d.empresas.length ? `${d.empresas.length} empresa(s) en el servidor${d.origen === "SERVIDOR" ? " (el usuario no ve SBO-COMMON: se listan las bases de SAP a las que tiene acceso)" : ""}.` : "El servidor no tiene empresas de SAP visibles para este usuario." }
            : { ok: false, texto: d.error, tecnico: d.detalleTecnico } }));
      } else {
        setBd((b) => ({ ...b, ocupado: null, resultado: d.resultado ?? null, mensaje: { ok: !!d.ok, texto: d.ok ? d.detalle : d.error ?? d.detalle, tecnico: d.detalleTecnico } }));
        await cargar();
      }
    } catch (e) {
      setBd((b) => ({ ...b, ocupado: null, mensaje: { ok: false, texto: e instanceof Error ? e.message : "Error" } }));
    }
  }

  async function cargarSucursalesSap() {
    setCargandoSucursales(true);
    try {
      const res = await fetch("/api/configuracion/sap/sucursales", { cache: "no-store" });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error ?? "No se pudieron leer las sucursales de SAP");
      setSucursalesSap(d.sucursales);
      setAviso({ ok: true, texto: `${d.sucursales.length} sucursal(es) leídas de SAP.` });
    } catch (e) {
      setSucursalesSap(null);
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "Error al leer sucursales" });
    } finally {
      setCargandoSucursales(false);
    }
  }

  async function buscarEnSap(cuentaId: string) {
    const q = (codigosSap[cuentaId] ?? "").trim();
    if (!q) {
      setBusqueda({ cuentaId, resultados: [], error: "Escriba el inicio del código de la cuenta en SAP y vuelva a buscar.", cargando: false });
      return;
    }
    setBusqueda({ cuentaId, resultados: [], error: null, cargando: true });
    try {
      const res = await fetch(`/api/configuracion/sap/cuentas?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error ?? "No se pudo buscar");
      setBusqueda({ cuentaId, resultados: d.cuentas, error: d.cuentas.length ? null : "Ninguna cuenta de SAP empieza así.", cargando: false });
    } catch (e) {
      setBusqueda({ cuentaId, resultados: [], error: e instanceof Error ? e.message : "Error al buscar", cargando: false });
    }
  }

  async function guardarMapeo(verificar: boolean) {
    if (!mapeo) return;
    setGuardandoMapeo(true);
    setAviso(null);
    try {
      const cuentas = Object.entries(codigosSap).map(([cuentaId, sapAcctCode]) => ({ cuentaId, sapAcctCode: sapAcctCode.trim() || null }));
      const centros = Object.entries(centrosSap).map(([id, v]) => ({ id, sapCostingCode: v.costing.trim() || null, sapProjectCode: v.project.trim() || null }));
      const sucursales = Object.entries(sucursalesMap).map(([id, v]) => {
        const bplId = v.trim() === "" ? null : Number(v);
        return { id, sapBplId: bplId, sapBplNombre: bplId ? (sucursalesSap?.find((s) => s.bplId === bplId)?.nombre ?? null) : null };
      });
      const res = await fetch("/api/configuracion/sap/mapeo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuentas, centros, sucursales, verificar }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo guardar el mapeo");
      aplicarMapeo(d);
      if (verificar) {
        const v = d.verificacion;
        if (!v) setAviso({ ok: false, texto: "Mapeo guardado, pero no se pudo verificar." });
        else if (!v.ok) setAviso({ ok: false, texto: `Mapeo guardado. La verificación falló: ${v.error}` });
        else {
          const faltan = (v.resultados as Array<{ existe: boolean; activa: boolean | null; sapAcctCode: string }>).filter((r) => !r.existe || r.activa === false);
          setAviso(
            faltan.length === 0
              ? { ok: true, texto: `Mapeo guardado. Las ${v.resultados.length} cuentas existen en SAP y reciben asientos.` }
              : { ok: false, texto: `Mapeo guardado. Revise: ${faltan.map((f) => `${f.sapAcctCode} ${f.existe ? "es de título" : "no existe"}`).join("; ")}.` }
          );
        }
      } else {
        setAviso({ ok: true, texto: "Mapeo guardado." });
      }
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "Error al guardar el mapeo" });
    } finally {
      setGuardandoMapeo(false);
    }
  }

  // ─── Importación del catálogo ────────────────────────────────────────────
  async function abrirImportacion() {
    setImportacion({ cargando: true, vista: null, resultado: null, error: null, confirmacion: "" });
    try {
      const res = await fetch("/api/configuracion/sap/catalogo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "previsualizar" }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error ?? "No se pudo leer el plan de cuentas de SAP");
      setImportacion({ cargando: false, vista: d.vista, resultado: null, error: null, confirmacion: "" });
    } catch (e) {
      setImportacion({ cargando: false, vista: null, resultado: null, error: e instanceof Error ? e.message : "Error", confirmacion: "" });
    }
  }

  async function confirmarImportacion() {
    if (!importacion || importacion.confirmacion !== "REEMPLAZAR") return;
    setImportacion({ ...importacion, cargando: true, error: null });
    try {
      const res = await fetch("/api/configuracion/sap/catalogo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "reemplazar", confirmacion: "REEMPLAZAR" }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error ?? "No se pudo reemplazar el catálogo");
      setImportacion({ cargando: false, vista: importacion.vista, resultado: d.resultado, error: null, confirmacion: "" });
      await Promise.all([cargar(), cargarMapeo()]);
    } catch (e) {
      setImportacion({ ...importacion, cargando: false, error: e instanceof Error ? e.message : "Error" });
    }
  }

  if (!estado && !error) return <p className="text-sm text-gray-400">Cargando…</p>;

  const c = estado?.configuracion ?? null;
  const resumen = !c
    ? { punto: "bg-gray-400", texto: "SAP no está configurado. Los asientos de nómina no salen de esta aplicación." }
    : !c.activo
      ? { punto: "bg-gray-400", texto: "Integración desactivada: nada se envía a SAP hasta activarla." }
      : c.ultimaPruebaOk === false
        ? { punto: "bg-red-600", texto: `Activa, pero la última prueba de conexión falló (${fechaHora(c.ultimaPruebaAt)}).` }
        : { punto: "bg-green-600", texto: `Activa. ${c.versionSap ? `SAP ${c.versionSap}. ` : ""}${c.ultimaPruebaAt ? `Última prueba correcta el ${fechaHora(c.ultimaPruebaAt)}.` : "Todavía sin probar la conexión."}` };

  const usaSucursales = form.usaSucursales || (mapeo?.usaSucursales ?? false);
  const opcionesSucursal = (actual: string) => {
    const lista = sucursalesSap ?? [];
    const faltante = actual && !lista.some((s) => String(s.bplId) === actual) ? [{ bplId: Number(actual), nombre: `Sucursal ${actual} (guardada)`, activa: true }] : [];
    return [...faltante, ...lista];
  };

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900">SAP Business One</h2>
          <p className="mt-1 flex items-start gap-2 text-sm text-gray-600">
            <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${resumen.punto}`} aria-hidden />
            <span>{resumen.texto}</span>
          </p>
        </div>
        {estado && (
          <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-gray-500">Enviados</dt>
              <dd className="tnum font-semibold text-gray-900">{estado.cola.enviados}</dd>
            </div>
            <div>
              <dt className="text-gray-500">En cola</dt>
              <dd className="tnum font-semibold text-gray-900">{estado.cola.pendientes}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Con error</dt>
              <dd className={`tnum font-semibold ${estado.cola.errores ? "text-red-700" : "text-gray-900"}`}>{estado.cola.errores}</dd>
            </div>
          </dl>
        )}
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-gray-200" aria-label="Partes de la configuración de SAP">
        {SECCIONES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSeccion(s.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${seccion === s.key ? "border-blue-600 font-medium text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 whitespace-pre-line">{error}</div>}
      {aviso && (
        <div className={`rounded-md border px-3 py-2 text-sm whitespace-pre-line ${aviso.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {aviso.texto}
        </div>
      )}

      {/* ─── Conexión ─────────────────────────────────────────────────────── */}
      {seccion === "conexion" && (
        <div className="space-y-5">
          {estado && !estado.cifradoDisponible && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Falta <code>CIFRADO_KEY</code> en el entorno del servidor: sin ella no se pueden guardar las contraseñas de SAP ni de la base de datos,
              porque no se almacenan en claro. Las pruebas sí funcionan con la contraseña tecleada.
            </div>
          )}

          <section className="panel space-y-4 p-6" aria-labelledby="sap-sl-titulo">
            <div>
              <h3 id="sap-sl-titulo" className="text-sm font-medium text-gray-800">Service Layer</h3>
              <p className="mt-1 text-xs text-gray-500">Por aquí se envían los asientos. Credenciales de un usuario de SAP Business One.</p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-url">URL del Service Layer *</label>
              <input id="sap-url" value={form.urlBase} onChange={(e) => set("urlBase", e.target.value)} className="input" placeholder="https://servidor-sap:50000/b1s/v1/" autoComplete="off" />
              <p className="mt-1 text-[11px] text-gray-500">
                Puerto 50000 por omisión. Si el certificado es propio de la empresa, el servidor de la aplicación necesita la CA en <code>NODE_EXTRA_CA_CERTS</code>.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-db">Base de datos de la empresa *</label>
              <div className="flex flex-wrap gap-2">
                <input id="sap-db" value={form.companyDb} onChange={(e) => set("companyDb", e.target.value)} className="input max-w-sm" placeholder="SBO_EMPRESA" autoComplete="off" />
                {bd.empresas && bd.empresas.length > 0 && (
                  <select
                    aria-label="Elegir la base de la empresa"
                    className="input max-w-sm"
                    value={bd.empresas.some((x) => x.baseDatos === form.companyDb) ? form.companyDb : ""}
                    onChange={(e) => e.target.value && set("companyDb", e.target.value)}
                  >
                    <option value="">Elegir de las empresas del servidor</option>
                    {bd.empresas.map((x) => (
                      <option key={x.baseDatos} value={x.baseDatos}>{x.nombre} ({x.baseDatos}{x.version ? `, ${x.version}` : ""})</option>
                    ))}
                  </select>
                )}
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                La misma base sirve para el Service Layer y para la conexión SQL Server de abajo. Con la base de datos configurada, «Listar empresas» la ofrece para elegir.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-usuario">Usuario de SAP *</label>
                <input id="sap-usuario" value={form.usuario} onChange={(e) => set("usuario", e.target.value)} className="input" placeholder="nomina" autoComplete="off" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-password">Contraseña de SAP</label>
                <input id="sap-password" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} className="input" autoComplete="new-password"
                  placeholder={c?.tienePassword ? "•••••• (sin cambios)" : ""} />
                <p className="mt-1 text-[11px] text-gray-500">Se guarda cifrada y nunca se muestra. Si cambia la URL hay que volver a escribirla.</p>
              </div>
            </div>

            <p className="text-xs text-gray-500">
              Use un usuario de SAP dedicado a la nómina, con licencia de acceso indirecto y autorización sólo sobre asientos de diario y plan de cuentas.
            </p>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.activo} onChange={(e) => set("activo", e.target.checked)} />
              Integración activa (sin esto no se envía nada, ni a mano ni automático)
            </label>

            {c?.ultimaPruebaDetalle && (
              <p className={`text-xs ${c.ultimaPruebaOk ? "text-gray-500" : "text-red-700"}`}>
                Última prueba ({fechaHora(c.ultimaPruebaAt)}): {c.ultimaPruebaDetalle}
              </p>
            )}

            <div className="flex justify-end">
              <button type="button" onClick={probar} disabled={probando || !c} className="btn btn-secondary" title={c ? "" : "Guarde primero"}>
                {probando ? "Probando…" : "Probar Service Layer"}
              </button>
            </div>
          </section>

          <section className="panel space-y-4 p-6" aria-labelledby="sap-bd-titulo">
            <div>
              <h3 id="sap-bd-titulo" className="text-sm font-medium text-gray-800">Base de datos (SQL Server)</h3>
              <p className="mt-1 text-xs text-gray-500">
                Opcional y de sólo lectura: comprueba que la base de la empresa es la correcta y lista las empresas del servidor. La aplicación nunca escribe en la base
                de SAP; los asientos van siempre por el Service Layer. Basta un usuario con permiso de lectura (db_datareader).
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-bd-servidor">Servidor</label>
                <input id="sap-bd-servidor" value={form.dbServidor} onChange={(e) => set("dbServidor", e.target.value)} className="input" placeholder="192.168.1.10 o SRV-SAP" autoComplete="off" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-bd-puerto">Puerto</label>
                <input id="sap-bd-puerto" type="number" min={1} max={65535} value={form.dbPuerto} onChange={(e) => set("dbPuerto", e.target.value)} className="input" disabled={!!form.dbInstancia.trim()} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-bd-instancia">Instancia (opcional)</label>
                <input id="sap-bd-instancia" value={form.dbInstancia} onChange={(e) => set("dbInstancia", e.target.value)} className="input" placeholder="SAPB1" autoComplete="off" />
              </div>
            </div>
            {form.dbInstancia.trim() && <p className="-mt-2 text-[11px] text-gray-500">Con instancia nombrada el puerto lo resuelve el servicio SQL Browser del servidor.</p>}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-bd-usuario">Usuario de SQL Server</label>
                <input id="sap-bd-usuario" value={form.dbUsuario} onChange={(e) => set("dbUsuario", e.target.value)} className="input" placeholder="nomina_lectura" autoComplete="off" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-bd-password">Contraseña de SQL Server</label>
                <input id="sap-bd-password" type="password" value={form.dbPassword} onChange={(e) => set("dbPassword", e.target.value)} className="input" autoComplete="new-password"
                  placeholder={c?.baseDatos.tienePassword ? "•••••• (sin cambios)" : ""} />
                <p className="mt-1 text-[11px] text-gray-500">Se guarda cifrada y nunca se muestra. Si cambia el servidor hay que volver a escribirla.</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-700">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.dbCifrar} onChange={(e) => set("dbCifrar", e.target.checked)} />
                Cifrar la conexión (TLS)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.dbConfiarCertificado} onChange={(e) => set("dbConfiarCertificado", e.target.checked)} />
                Confiar en el certificado del servidor (típico en instalaciones locales)
              </label>
            </div>

            {bd.mensaje && (
              <div className={`rounded-md border px-3 py-2 text-sm whitespace-pre-line ${bd.mensaje.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
                {bd.mensaje.texto}
                {bd.mensaje.tecnico && <span className="mt-1 block text-[11px] opacity-75">{bd.mensaje.tecnico}</span>}
              </div>
            )}

            {bd.resultado && (
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-gray-500">Servidor</dt><dd className="text-gray-900">{bd.resultado.servidor} · {bd.resultado.versionSql}</dd>
                <dt className="text-gray-500">Usuario</dt><dd className="text-gray-900">{bd.resultado.login}{bd.resultado.puedeEscribir ? " (puede escribir)" : " (sólo lectura)"}</dd>
                <dt className="text-gray-500">Base</dt><dd className="text-gray-900">{bd.resultado.baseDatos}{bd.resultado.esBaseSap ? "" : " (no es de SAP)"}</dd>
                {bd.resultado.empresa && (<><dt className="text-gray-500">Empresa</dt><dd className="text-gray-900">{bd.resultado.empresa}</dd></>)}
                {bd.resultado.moneda && (<><dt className="text-gray-500">Moneda local</dt><dd className="text-gray-900">{bd.resultado.moneda}</dd></>)}
                {bd.resultado.versionB1 && (<><dt className="text-gray-500">Versión de SAP</dt><dd className="text-gray-900">{bd.resultado.versionB1}</dd></>)}
                {bd.resultado.avisos.length > 0 && (
                  <><dt className="text-amber-700">Avisos</dt><dd className="text-amber-800"><ul className="list-disc pl-5">{bd.resultado.avisos.map((a) => <li key={a}>{a}</li>)}</ul></dd></>
                )}
              </dl>
            )}

            {!bd.resultado && c?.baseDatos.ultimaPruebaDetalle && (
              <p className={`text-xs ${c.baseDatos.ultimaPruebaOk ? "text-gray-500" : "text-red-700"}`}>
                Última prueba ({fechaHora(c.baseDatos.ultimaPruebaAt)}): {c.baseDatos.ultimaPruebaDetalle}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => void accionBd("empresas")} disabled={bd.ocupado !== null} className="btn btn-secondary">
                {bd.ocupado === "empresas" ? "Listando…" : "Listar empresas"}
              </button>
              <button type="button" onClick={() => void accionBd("probar")} disabled={bd.ocupado !== null} className="btn btn-secondary">
                {bd.ocupado === "probar" ? "Probando…" : "Probar base de datos"}
              </button>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-400">
              {c ? `Última modificación: ${fechaHora(c.updatedAt)}${c.actualizadoPor ? ` por ${c.actualizadoPor}` : ""}` : "Todavía no se ha guardado ninguna configuración."}
            </p>
            <button type="button" onClick={guardar} disabled={guardando} className="btn btn-primary">
              {guardando ? "Guardando…" : "Guardar conexión"}
            </button>
          </div>
        </div>
      )}

      {/* ─── Comportamiento ───────────────────────────────────────────────── */}
      {seccion === "comportamiento" && (
        <div className="panel space-y-5 p-6">
          <fieldset>
            <legend className="text-sm font-medium text-gray-800">Cuándo se envía el asiento</legend>
            <div className="mt-2 space-y-2 text-sm text-gray-700">
              {(
                [
                  ["MANUAL", "Sólo a mano, con el botón «Enviar a SAP» en la planilla"],
                  ["AL_APROBAR", "Automáticamente al aprobar la planilla"],
                  ["AL_PAGAR", "Automáticamente al marcarla como pagada"],
                ] as Array<[ModoEnvio, string]>
              ).map(([v, l]) => (
                <label key={v} className="flex items-center gap-2">
                  <input type="radio" name="modoEnvio" checked={form.modoEnvio === v} onChange={() => set("modoEnvio", v)} />
                  {l}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              En cualquier modo, una planilla que se anula después de enviada genera un asiento de reverso.
            </p>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-gray-800">Fecha contable del asiento</legend>
            <div className="mt-2 space-y-2 text-sm text-gray-700">
              <label className="flex items-center gap-2">
                <input type="radio" name="fechaContable" checked={form.fechaContable === "PAGO"} onChange={() => set("fechaContable", "PAGO")} />
                Fecha de pago de la planilla (si aún no se pagó, el fin del período)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="fechaContable" checked={form.fechaContable === "FIN_PERIODO"} onChange={() => set("fechaContable", "FIN_PERIODO")} />
                Último día del período de la planilla
              </label>
            </div>
          </fieldset>

          <div className="space-y-2 text-sm text-gray-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.incluirProvisiones} onChange={(e) => set("incluirProvisiones", e.target.checked)} />
              Incluir las provisiones (décimos, vacaciones, reserva laboral) en el asiento
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.porCentroCosto} onChange={(e) => set("porCentroCosto", e.target.checked)} />
              Repartir el gasto por centro de costo (una línea por cuenta y centro)
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-dimension">Dimensión de los centros en SAP</label>
              <select id="sap-dimension" value={form.dimensionCentro} onChange={(e) => set("dimensionCentro", e.target.value)} className="input" disabled={!form.porCentroCosto}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={String(n)}>Dimensión {n}{n === 1 ? " (CostingCode)" : ` (CostingCode${n})`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-trans">Código de transacción (opcional)</label>
              <input id="sap-trans" value={form.codigoTransaccion} onChange={(e) => set("codigoTransaccion", e.target.value)} className="input" maxLength={4} placeholder="NOM" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-serie">Serie de numeración (opcional)</label>
              <input id="sap-serie" type="number" value={form.serie} onChange={(e) => set("serie", e.target.value)} className="input" min={1} />
            </div>
          </div>

          <fieldset className="rounded-md border border-gray-200 p-4">
            <legend className="px-1 text-sm font-medium text-gray-800">Sucursales en SAP</legend>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.usaSucursales} onChange={(e) => set("usaSucursales", e.target.checked)} />
              SAP tiene varias sucursales: cada línea del asiento lleva la sucursal
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Una planilla de una sucursal va a su equivalente en SAP (se asigna en Mapeo contable). Las planillas de toda la empresa van a la sucursal elegida aquí.
            </p>
            {form.usaSucursales && (
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-bpl">Sucursal de SAP para planillas de toda la empresa</label>
                  <select id="sap-bpl" value={form.sapBplIdPorDefecto} onChange={(e) => set("sapBplIdPorDefecto", e.target.value)} className="input">
                    <option value="">Sin elegir</option>
                    {opcionesSucursal(form.sapBplIdPorDefecto).map((s) => (
                      <option key={s.bplId} value={String(s.bplId)}>{s.bplId}: {s.nombre}{s.activa ? "" : " (inactiva)"}</option>
                    ))}
                  </select>
                </div>
                <button type="button" onClick={() => void cargarSucursalesSap()} disabled={cargandoSucursales} className="btn btn-secondary">
                  {cargandoSucursales ? "Leyendo…" : "Leer sucursales de SAP"}
                </button>
              </div>
            )}
          </fieldset>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sap-memo">Texto del asiento (Memo)</label>
            <input id="sap-memo" value={form.memoPlantilla} onChange={(e) => set("memoPlantilla", e.target.value)} className="input" />
            <p className="mt-1 text-[11px] text-gray-500">
              Variables: {"{tipo}"} {"{desde}"} {"{hasta}"} {"{empresa}"}. SAP lo corta a {c?.longitudes.memo ?? 50} caracteres. La referencia del asiento lleva el
              período y, en la segunda referencia, el identificador de la planilla, con el que se evita enviarla dos veces.
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <button type="button" onClick={guardar} disabled={guardando} className="btn btn-primary">
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      )}

      {/* ─── Mapeo contable ───────────────────────────────────────────────── */}
      {seccion === "mapeo" && (
        <div className="space-y-5">
          <div className="panel p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-gray-800">Catálogo contable</h3>
                <p className="mt-1 text-xs text-gray-500">
                  {mapeo?.catalogo.origen === "SAP"
                    ? `El plan de cuentas local es un espejo del de SAP (${mapeo.catalogo.cuentas ?? "?"} cuentas, importado el ${fechaHora(mapeo.catalogo.importadoAt)}). SAP manda: en Plan de cuentas no se crean ni editan cuentas; si cambia en SAP, vuelva a importarlo aquí.`
                    : "El plan de cuentas es propio de esta aplicación. Puede reemplazarlo por el de SAP: se borra el local, se crea el de SAP con sus códigos ya asignados y los conceptos de la nómina se reenganchan donde haya equivalencia."}
                </p>
              </div>
              <button type="button" onClick={() => void abrirImportacion()} className="btn btn-secondary" disabled={!c}>
                {mapeo?.catalogo.origen === "SAP" ? "Volver a importar desde SAP" : "Importar el catálogo desde SAP"}
              </button>
            </div>
          </div>

          <div className="panel p-6">
            <h3 className="text-sm font-medium text-gray-800">Cuentas</h3>
            <p className="mt-1 text-xs text-gray-500">
              Cada concepto de la nómina ya tiene una cuenta del catálogo (Planillas, Plan de cuentas). Aquí se indica el código de esa cuenta en SAP
              (AcctCode). Si varios conceptos comparten cuenta, comparten código. Con el catálogo importado de SAP, el código ya viene puesto.
            </p>
            {!mapeo ? (
              <p className="mt-3 text-sm text-gray-400">Cargando…</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="table-base text-sm">
                  <thead>
                    <tr>
                      <th className="px-3">Concepto</th>
                      <th className="px-3">Cuenta del catálogo</th>
                      <th className="px-3">Cuenta en SAP</th>
                      <th className="px-3">Verificación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapeo.conceptos.map((cpt) => {
                      const cu = cpt.cuenta;
                      const abierto = busqueda?.cuentaId === cu?.id;
                      return (
                        <tr key={cpt.clave} className="align-top">
                          <td className="px-3 py-2">
                            <div className="text-gray-900">{cpt.concepto}</div>
                            <div className="text-[11px] text-gray-400">{cpt.naturaleza === "GASTO" ? "Gasto" : "Pasivo"}</div>
                          </td>
                          <td className="px-3 py-2">
                            {cu ? (
                              <>
                                <span className="font-mono text-gray-900">{cu.codigo}</span> <span className="text-gray-600">{cu.nombre}</span>
                                {!cu.activa && <span className="ml-1 text-[11px] text-red-700">(inactiva)</span>}
                              </>
                            ) : (
                              <span className="text-amber-700">Sin cuenta: asígnela en Configuración contable</span>
                            )}
                          </td>
                          <td className="relative px-3 py-2">
                            {cu && (
                              <div className="flex gap-1">
                                <input
                                  value={codigosSap[cu.id] ?? ""}
                                  onChange={(e) => setCodigosSap((m) => ({ ...m, [cu.id]: e.target.value }))}
                                  className="input w-36 font-mono"
                                  placeholder="_SYS00000000123"
                                  aria-label={`Cuenta en SAP para ${cpt.concepto}`}
                                />
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void buscarEnSap(cu.id)} disabled={busqueda?.cargando}>
                                  Buscar
                                </button>
                              </div>
                            )}
                            {cu && abierto && busqueda && (
                              <div className="absolute left-3 z-10 mt-1 w-80 rounded-md border border-gray-200 bg-white p-2 text-xs shadow-lg">
                                <div className="mb-1 flex items-center justify-between">
                                  <span className="text-gray-500">{busqueda.cargando ? "Buscando en SAP…" : "Cuentas de SAP"}</span>
                                  <button type="button" className="text-gray-400 hover:text-gray-700" onClick={() => setBusqueda(null)} aria-label="Cerrar">×</button>
                                </div>
                                {busqueda.error && <p className="text-red-700">{busqueda.error}</p>}
                                <ul className="max-h-56 overflow-y-auto">
                                  {busqueda.resultados.map((r) => (
                                    <li key={r.code}>
                                      <button
                                        type="button"
                                        className="flex w-full items-baseline gap-2 rounded px-1 py-1 text-left hover:bg-blue-50"
                                        onClick={() => {
                                          setCodigosSap((m) => ({ ...m, [cu.id]: r.code }));
                                          setBusqueda(null);
                                        }}
                                      >
                                        <span className="font-mono text-gray-900">{r.formatCode ?? r.code}</span>
                                        <span className="text-gray-600">{r.name}</span>
                                        {!r.activa && <span className="text-red-700">título</span>}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {cu?.sapVerificadaAt ? (
                              cu.sapActiva === false && !cu.sapNombre ? (
                                <span className="text-red-700">No existe en SAP ({fechaHora(cu.sapVerificadaAt)})</span>
                              ) : cu.sapActiva === false ? (
                                <span className="text-red-700">{cu.sapNombre}: cuenta de título en SAP, no recibe asientos</span>
                              ) : (
                                <span className="text-green-800">{cu.sapNombre} ({fechaHora(cu.sapVerificadaAt)})</span>
                              )
                            ) : codigosSap[cu?.id ?? ""] ? (
                              <span className="text-gray-400">Sin verificar</span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel p-6">
            <h3 className="text-sm font-medium text-gray-800">Centros de costo</h3>
            <p className="mt-1 text-xs text-gray-500">
              Sólo hace falta si el reparto por centro de costo está activado. El código es el del centro de beneficio en la dimensión elegida; el proyecto es opcional.
            </p>
            {mapeo && (
              <div className="mt-3 overflow-x-auto">
                <table className="table-base text-sm">
                  <thead>
                    <tr>
                      <th className="px-3">Centro</th>
                      <th className="px-3">Código en SAP</th>
                      <th className="px-3">Proyecto en SAP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapeo.centros.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-3 text-gray-500">No hay centros de costo definidos.</td>
                      </tr>
                    )}
                    {mapeo.centros.map((ce) => (
                      <tr key={ce.id}>
                        <td className="px-3 py-2">
                          <span className="font-mono text-gray-900">{ce.codigo}</span> <span className="text-gray-600">{ce.nombre}</span>
                          {!ce.activo && <span className="ml-1 text-[11px] text-gray-400">(inactivo)</span>}
                        </td>
                        <td className="px-3 py-2">
                          <input value={centrosSap[ce.id]?.costing ?? ""} onChange={(e) => setCentrosSap((m) => ({ ...m, [ce.id]: { costing: e.target.value, project: m[ce.id]?.project ?? "" } }))}
                            className="input w-36 font-mono" aria-label={`Código en SAP del centro ${ce.nombre}`} />
                        </td>
                        <td className="px-3 py-2">
                          <input value={centrosSap[ce.id]?.project ?? ""} onChange={(e) => setCentrosSap((m) => ({ ...m, [ce.id]: { costing: m[ce.id]?.costing ?? "", project: e.target.value } }))}
                            className="input w-36 font-mono" aria-label={`Proyecto en SAP del centro ${ce.nombre}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {usaSucursales && mapeo && (
            <div className="panel p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-gray-800">Sucursales</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    A qué sucursal de SAP va cada sucursal local. Una planilla de una sucursal sin equivalente no se puede enviar.
                  </p>
                </div>
                <button type="button" onClick={() => void cargarSucursalesSap()} disabled={cargandoSucursales} className="btn btn-ghost btn-sm">
                  {cargandoSucursales ? "Leyendo…" : "Leer sucursales de SAP"}
                </button>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="table-base text-sm">
                  <thead>
                    <tr>
                      <th className="px-3">Sucursal local</th>
                      <th className="px-3">Sucursal en SAP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapeo.sucursales.map((s) => (
                      <tr key={s.id}>
                        <td className="px-3 py-2">
                          <span className="font-mono text-gray-900">{s.codigo}</span> <span className="text-gray-600">{s.nombre}</span>
                          {!s.activa && <span className="ml-1 text-[11px] text-gray-400">(inactiva)</span>}
                        </td>
                        <td className="px-3 py-2">
                          {sucursalesSap ? (
                            <select
                              value={sucursalesMap[s.id] ?? ""}
                              onChange={(e) => setSucursalesMap((m) => ({ ...m, [s.id]: e.target.value }))}
                              className="input w-72"
                              aria-label={`Sucursal en SAP para ${s.nombre}`}
                            >
                              <option value="">Sin asignar</option>
                              {opcionesSucursal(sucursalesMap[s.id] ?? "").map((o) => (
                                <option key={o.bplId} value={String(o.bplId)}>{o.bplId}: {o.nombre}{o.activa ? "" : " (inactiva)"}</option>
                              ))}
                            </select>
                          ) : (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={1}
                                value={sucursalesMap[s.id] ?? ""}
                                onChange={(e) => setSucursalesMap((m) => ({ ...m, [s.id]: e.target.value }))}
                                className="input w-28"
                                placeholder="BPLID"
                                aria-label={`Sucursal en SAP para ${s.nombre}`}
                              />
                              {s.sapBplNombre && <span className="text-xs text-gray-500">{s.sapBplNombre}</span>}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => void guardarMapeo(true)} disabled={guardandoMapeo || !mapeo} className="btn btn-secondary">
              {guardandoMapeo ? "Guardando…" : "Guardar y verificar en SAP"}
            </button>
            <button type="button" onClick={() => void guardarMapeo(false)} disabled={guardandoMapeo || !mapeo} className="btn btn-primary">
              {guardandoMapeo ? "Guardando…" : "Guardar mapeo"}
            </button>
          </div>
        </div>
      )}

      {/* ─── Bitácora ─────────────────────────────────────────────────────── */}
      {seccion === "bitacora" && estado && (
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between px-6 pt-5">
            <div>
              <h3 className="text-sm font-medium text-gray-800">Últimos envíos</h3>
              <p className="mt-1 text-xs text-gray-500">Los pendientes se reintentan solos; los que quedan en error esperan una corrección y el botón de reintentar en la planilla.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cargar()}>Actualizar</button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="table-base text-sm">
              <thead>
                <tr>
                  <th className="px-3">Planilla</th>
                  <th className="px-3">Tipo</th>
                  <th className="px-3">Estado</th>
                  <th className="num px-3">N.º SAP</th>
                  <th className="num px-3">Intentos</th>
                  <th className="px-3">Detalle</th>
                  <th className="px-3">Actualizado</th>
                </tr>
              </thead>
              <tbody>
                {estado.envios.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-gray-500">Todavía no se ha enviado ningún asiento.</td>
                  </tr>
                )}
                {estado.envios.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2">
                      <a href={`/planillas/${e.planillaId}`} className="text-blue-700 hover:underline">
                        {e.planilla.tipo.charAt(0) + e.planilla.tipo.slice(1).toLowerCase()} {formatDate(e.planilla.fechaInicio)} al {formatDate(e.planilla.fechaFin)}
                      </a>
                    </td>
                    <td className="px-3 py-2">{e.tipo === "REVERSO" ? "Reverso" : "Asiento"}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`inline-block h-2 w-2 rounded-full ${ESTADO_ENVIO[e.estado].punto}`} aria-hidden />
                        {ESTADO_ENVIO[e.estado].label}
                      </span>
                    </td>
                    <td className="num px-3 py-2">{e.sapNumero ?? e.sapTransId ?? ""}</td>
                    <td className="num px-3 py-2">{e.intentos}</td>
                    <td className="max-w-md px-3 py-2 text-xs text-gray-600">
                      {e.estado === "ENVIADO" ? `Enviado el ${fechaHora(e.enviadoAt)}` : e.errorTraducido ?? ""}
                      {e.estado === "PENDIENTE" && e.proximoIntentoAt ? ` Próximo intento: ${fechaHora(e.proximoIntentoAt)}.` : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{fechaHora(e.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Modal: importar el catálogo desde SAP ───────────────────────── */}
      {importacion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4" role="dialog" aria-modal="true" aria-labelledby="importacion-titulo">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="importacion-titulo" className="text-lg font-semibold text-gray-900">
                  {importacion.resultado ? "Catálogo reemplazado" : "Reemplazar el catálogo por el de SAP"}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {importacion.resultado
                    ? "Desde ahora SAP manda: el plan de cuentas local es un espejo y se actualiza desde aquí."
                    : "Se borra el plan de cuentas local y se crea el de SAP. Los conceptos de la nómina se reenganchan donde haya equivalencia; el resto queda sin cuenta para que el contador lo asigne."}
                </p>
              </div>
              <button type="button" className="text-gray-400 hover:text-gray-700" onClick={() => setImportacion(null)} aria-label="Cerrar" disabled={importacion.cargando}>×</button>
            </div>

            {importacion.cargando && <p className="mt-4 text-sm text-gray-500">{importacion.vista ? "Reemplazando el catálogo…" : "Leyendo el plan de cuentas de SAP…"}</p>}
            {importacion.error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 whitespace-pre-line">{importacion.error}</div>}

            {importacion.resultado && (
              <div className="mt-4 space-y-3 text-sm">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                  <div><dt className="text-gray-500">Cuentas antes</dt><dd className="tnum font-semibold text-gray-900">{importacion.resultado.cuentasAntes}</dd></div>
                  <div><dt className="text-gray-500">Cuentas ahora (de SAP)</dt><dd className="tnum font-semibold text-gray-900">{importacion.resultado.cuentasDespues}</dd></div>
                  <div><dt className="text-gray-500">Conceptos reenganchados</dt><dd className="tnum font-semibold text-gray-900">{importacion.resultado.reasignados}</dd></div>
                </dl>
                {importacion.resultado.sinCuenta.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                    <p className="font-medium">Conceptos que quedaron sin cuenta ({importacion.resultado.sinCuenta.length}); asígnelos en Configuración contable:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {importacion.resultado.sinCuenta.map((s) => (
                        <li key={s.clave}>{s.concepto}: {s.motivo}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {importacion.resultado.avisos.length > 0 && (
                  <details className="text-xs text-gray-600">
                    <summary className="cursor-pointer">{importacion.resultado.avisos.length} aviso(s) de la importación</summary>
                    <ul className="mt-1 list-disc pl-5">{importacion.resultado.avisos.slice(0, 50).map((a, i) => <li key={i}>{a}</li>)}</ul>
                  </details>
                )}
                <div className="flex justify-end pt-2">
                  <button type="button" className="btn btn-primary" onClick={() => setImportacion(null)}>Cerrar</button>
                </div>
              </div>
            )}

            {importacion.vista && !importacion.resultado && (
              <div className="mt-4 space-y-4 text-sm">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-md border border-gray-200 p-3">
                    <p className="font-medium text-gray-800">Plan de cuentas de SAP</p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700">
                      <dt className="text-gray-500">Cuentas</dt><dd className="tnum">{importacion.vista.catalogo.resumen.total}</dd>
                      <dt className="text-gray-500">De detalle (reciben asientos)</dt><dd className="tnum">{importacion.vista.catalogo.resumen.detalle}</dd>
                      <dt className="text-gray-500">De título</dt><dd className="tnum">{importacion.vista.catalogo.resumen.titulos}</dd>
                      <dt className="text-gray-500">Inactivas</dt><dd className="tnum">{importacion.vista.catalogo.resumen.inactivas}</dd>
                      {Object.entries(importacion.vista.catalogo.resumen.porTipo).filter(([, n]) => n > 0).map(([t, n]) => (
                        <div key={t} className="contents"><dt className="text-gray-500">{ETIQUETA_TIPO[t] ?? t}</dt><dd className="tnum">{n}</dd></div>
                      ))}
                    </dl>
                  </div>
                  <div className="rounded-md border border-gray-200 p-3">
                    <p className="font-medium text-gray-800">Catálogo local que se reemplaza</p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700">
                      <dt className="text-gray-500">Cuentas</dt><dd className="tnum">{importacion.vista.local.cuentas}</dd>
                      <dt className="text-gray-500">Conceptos con cuenta</dt><dd className="tnum">{importacion.vista.local.mapeosConCuenta}</dd>
                      <dt className="text-gray-500">Se reenganchan</dt><dd className="tnum text-green-800">{importacion.vista.mapeos.asignaciones.length}</dd>
                      <dt className="text-gray-500">Quedan sin cuenta</dt><dd className={`tnum ${importacion.vista.mapeos.sinCuenta.length ? "text-amber-700" : ""}`}>{importacion.vista.mapeos.sinCuenta.length}</dd>
                    </dl>
                  </div>
                </div>

                {importacion.vista.mapeos.sinCuenta.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                    <p className="font-medium">Quedarían sin cuenta:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {importacion.vista.mapeos.sinCuenta.map((s) => (
                        <li key={s.clave}>{s.concepto}: {s.motivo}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {importacion.vista.catalogo.avisos.length > 0 && (
                  <details className="text-xs text-gray-600">
                    <summary className="cursor-pointer">{importacion.vista.catalogo.avisos.length} aviso(s) sobre el plan de SAP</summary>
                    <ul className="mt-1 list-disc pl-5">{importacion.vista.catalogo.avisos.slice(0, 50).map((a, i) => <li key={i}>{a}</li>)}</ul>
                  </details>
                )}

                <div>
                  <p className="text-xs text-gray-500">Primeras cuentas tal como quedarán:</p>
                  <table className="table-base mt-1 text-xs">
                    <thead>
                      <tr><th className="px-2">Código</th><th className="px-2">Nombre</th><th className="px-2">Tipo</th><th className="num px-2">Nivel</th></tr>
                    </thead>
                    <tbody>
                      {importacion.vista.muestra.map((m) => (
                        <tr key={m.codigo}>
                          <td className="px-2 py-1 font-mono">{m.codigo}</td>
                          <td className="px-2 py-1">{m.nombre}{m.esDetalle ? "" : <span className="ml-1 text-gray-400">(título)</span>}</td>
                          <td className="px-2 py-1">{ETIQUETA_TIPO[m.tipo] ?? m.tipo}</td>
                          <td className="num px-2 py-1">{m.nivel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-md border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-900">
                    Esta acción no se deshace desde la aplicación. Las {importacion.vista.local.cuentas} cuentas locales se borran y se sustituyen por las {importacion.vista.catalogo.resumen.total} de SAP.
                    Para confirmar, escriba <strong>REEMPLAZAR</strong>.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      value={importacion.confirmacion}
                      onChange={(e) => setImportacion({ ...importacion, confirmacion: e.target.value.toUpperCase() })}
                      className="input w-48 font-mono"
                      placeholder="REEMPLAZAR"
                      aria-label="Confirmación"
                      disabled={importacion.cargando}
                    />
                    <button type="button" className="btn btn-primary" onClick={() => void confirmarImportacion()} disabled={importacion.cargando || importacion.confirmacion !== "REEMPLAZAR"}>
                      {importacion.cargando ? "Reemplazando…" : "Reemplazar el catálogo"}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setImportacion(null)} disabled={importacion.cargando}>Cancelar</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
