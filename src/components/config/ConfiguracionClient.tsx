"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import PageHeader from "@/components/ui/PageHeader";
import EstadoVacio from "@/components/ui/EstadoVacio";
import { formatCurrency } from "@/lib/utils";
import CorreoSalienteConfig from "./CorreoSalienteConfig";
import SapConexionConfig from "./SapConexionConfig";
import ParametrosLeyConfig from "./ParametrosLeyConfig";
import FormatosBancoConfig from "./FormatosBancoConfig";
import EstructuraOrganizacional, { type DepartamentoEstructura, type DivisionEstructura, type PuestoEstructura } from "./EstructuraOrganizacional";
import EmpresaConfig from "./EmpresaConfig";
import SeguridadConfig from "./SeguridadConfig";
import RespaldosConfig from "./RespaldosConfig";

// Formas mínimas que este componente realmente consume. Se declaran a mano en
// vez de reusar los modelos de Prisma porque al cruzar la frontera cliente/
// servidor los Decimal ya vienen serializados a number.
interface DatosEmpresa {
  id: string;
  nombre: string;
  rtn: string;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
}

interface SucursalConfig {
  id: string;
  empresaId: string;
  nombre: string;
  codigo: string;
  direccion: string | null;
  telefono: string | null;
  descripcion: string | null;
  activa: boolean;
  logoVersion: number | null;
}

interface SalarioMinimoConfig {
  monto: number;
  anio: number;
  sector: string;
}

interface Props {
  empresa: DatosEmpresa | null;
  sucursales: SucursalConfig[];
  divisiones: DivisionEstructura[];
  departamentos: DepartamentoEstructura[];
  puestos: PuestoEstructura[];
  /** Opción del administrador: usar el nivel División (Sucursal → División → Departamento). */
  divisionesHabilitadas: boolean;
  jerarquiaHabilitada: boolean;
  salarioMinimo: SalarioMinimoConfig | null;
  configs: Array<{ clave: string; valor: string; descripcion: string | null }>;
  /** Ve y edita la empresa, sucursales y parámetros (`configuracion.ver`/`.editar`). */
  puedeVer: boolean;
  /** Crea y edita sucursales, divisiones y departamentos, y enciende las divisiones (`configuracion.editar`). */
  puedeEditar: boolean;
  /** Modifica nombre, RTN y contacto de la empresa (`configuracion.empresa`, por omisión sólo SUPER_ADMIN). */
  puedeEditarEmpresa: boolean;
  /** Configura el correo saliente (`configuracion.correo`, por omisión sólo SUPER_ADMIN). */
  puedeCorreo: boolean;
  /** Edita IHSS, IVM, RAP, INFOP y las tablas ISR/vecinal (`configuracion.parametros`, por omisión sólo SUPER_ADMIN). */
  puedeParametros: boolean;
  /** Configura la conexión con SAP Business One (`configuracion.sap`, por omisión sólo SUPER_ADMIN). */
  puedeSap: boolean;
  /** Describe los formatos de archivo de pago de cada banco (`configuracion.editar`). */
  puedeBanco: boolean;
  /** Política de sesión, como el cierre por inactividad (`seguridad.usuarios_gestionar`). */
  puedeSeguridad: boolean;
  minutosInactividad: number;
  /** `configuracion.respaldos`: un respaldo es la base entera. */
  puedeRespaldos: boolean;
}

export default function ConfiguracionClient({
  empresa, sucursales, divisiones, departamentos, puestos, divisionesHabilitadas, jerarquiaHabilitada, salarioMinimo, configs,
  puedeVer, puedeEditar, puedeEditarEmpresa, puedeCorreo, puedeParametros, puedeSap, puedeBanco, puedeSeguridad, minutosInactividad, puedeRespaldos,
}: Props) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [tab, setTab] = useState<"empresa" | "sucursales" | "salarios" | "sistema" | "parametros" | "correo" | "sap" | "banco" | "seguridad" | "respaldos">(
    puedeVer ? "empresa" : puedeParametros ? "parametros" : puedeCorreo ? "correo" : puedeSap ? "sap" : puedeSeguridad ? "seguridad" : "respaldos"
  );
  const [loading, setLoading] = useState(false);
  const [modalAumentoColectivo, setModalAumentoColectivo] = useState(false);

  const [formAumento, setFormAumento] = useState({
    tipo: "PORCENTAJE",
    porcentaje: "",
    montoFijo: "",
    sucursalId: "",
    motivo: "Aumento de Salario Mínimo",
  });

  async function aplicarAumentoColectivo() {
    const valor = formAumento.tipo === "PORCENTAJE" ? formAumento.porcentaje : formAumento.montoFijo;
    if (!valor || isNaN(parseFloat(valor))) {
      avisar.error("Ingrese un valor numérico válido.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/salarios/aumento-colectivo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formAumento),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setModalAumentoColectivo(false);
      avisar.exito(`Aumento aplicado a ${data.actualizados} empleados.`);
      router.refresh();
    } catch {
      avisar.error("No se pudo aplicar el aumento. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  const tabs = [
    ...(puedeVer
      ? ([
          { key: "empresa", label: "Empresa" },
          { key: "sucursales", label: "Estructura organizacional" },
          { key: "salarios", label: "Salarios" },
          { key: "sistema", label: "Configuración general" },
        ] as const)
      : []),
    // Sólo administradores: cambian lo que se descuenta a todos los empleados.
    ...(puedeParametros ? ([{ key: "parametros", label: "Parámetros de ley" }] as const) : []),
    // Sólo administradores: quien controla el servidor de correo puede
    // escribir a los empleados a nombre de la empresa.
    ...(puedeCorreo ? ([{ key: "correo", label: "Correo saliente" }] as const) : []),
    // Sólo administradores: credenciales de SAP y qué se contabiliza allí.
    ...(puedeSap ? ([{ key: "sap", label: "SAP - Conexión" }] as const) : []),
    ...(puedeBanco ? ([{ key: "banco", label: "Formatos de banco" }] as const) : []),
    // Política de sesión de todas las cuentas: quien administra los usuarios.
    ...(puedeSeguridad ? ([{ key: "seguridad", label: "Seguridad" }] as const) : []),
    ...(puedeRespaldos ? ([{ key: "respaldos", label: "Respaldos" }] as const) : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Configuración del sistema" description="Empresa, sucursales, salarios y parámetros de ley." />

      <div className="flex gap-1 overflow-x-auto border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "parametros" && puedeParametros && <ParametrosLeyConfig />}
      {tab === "correo" && puedeCorreo && <CorreoSalienteConfig />}
      {tab === "sap" && puedeSap && <SapConexionConfig />}
      {tab === "banco" && puedeBanco && <FormatosBancoConfig />}

      {/* Empresa: la ve quien consulta la configuración; la edita sólo el administrador */}
      {tab === "empresa" && <EmpresaConfig empresa={empresa} puedeEditar={puedeEditarEmpresa} />}

      {/* Estructura organizacional: sucursales, divisiones (opcionales), departamentos y puestos */}
      {tab === "sucursales" && (
        <EstructuraOrganizacional
          empresaId={empresa?.id ?? null}
          empresaNombre={empresa?.nombre ?? null}
          empresaRtn={empresa?.rtn ?? null}
          sucursales={sucursales}
          divisiones={divisiones}
          departamentos={departamentos}
          puestos={puestos}
          divisionesHabilitadas={divisionesHabilitadas}
          jerarquiaHabilitada={jerarquiaHabilitada}
          puedeEditar={puedeEditar}
        />
      )}

      {/* Salarios */}
      {tab === "salarios" && (
        <div className="space-y-4">
          <div className="panel p-5">
            <h2 className="font-semibold text-gray-800 mb-3">Salario mínimo vigente</h2>
            {salarioMinimo ? (
              <div className="flex items-center gap-6">
                <div>
                  <p className="tnum text-3xl font-semibold text-gray-900">{formatCurrency(Number(salarioMinimo.monto))}</p>
                  <p className="text-sm text-gray-500">Año {salarioMinimo.anio}, {salarioMinimo.sector}</p>
                </div>
              </div>
            ) : (
              <p className="text-gray-500 text-sm">Sin salario mínimo configurado</p>
            )}
          </div>

          <div className="panel p-5">
            <h2 className="font-semibold text-gray-800 mb-3">Aumento de salario colectivo</h2>
            <p className="text-sm text-gray-500 mb-4">Aplica un aumento de salario a todos o a un grupo de empleados en una sola operación.</p>
            <button onClick={() => setModalAumentoColectivo(true)} className="btn btn-primary">
              Aplicar aumento colectivo
            </button>
          </div>
        </div>
      )}

      {/* Sistema */}
      {tab === "seguridad" && puedeSeguridad && <SeguridadConfig minutosInactividad={minutosInactividad} />}
      {tab === "respaldos" && puedeRespaldos && <RespaldosConfig />}

      {tab === "sistema" && (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Configuración</th><th>Valor</th><th>Descripción</th></tr></thead>
              <tbody>
                {configs.length === 0 ? (
                  <tr><td colSpan={3}><EstadoVacio titulo="No hay opciones generales guardadas." detalle="Aquí aparecerán las opciones que el sistema vaya registrando." /></td></tr>
                ) : configs.map((c) => (
                  <tr key={c.clave}>
                    <td className="font-mono text-xs text-blue-700">{c.clave}</td>
                    <td className="font-medium text-gray-900">{c.valor}</td>
                    <td className="text-gray-500">{c.descripcion ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal aumento colectivo */}
      {modalAumentoColectivo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="panel w-full max-w-md space-y-4 p-6 shadow-xl">
            <h3 className="font-semibold text-gray-900">Aumento colectivo de salario</h3>
            <div>
              <span className="mb-1 block text-sm font-medium text-gray-800">Tipo de aumento</span>
              <div className="flex gap-3">
                {["PORCENTAJE", "MONTO_FIJO"].map((t) => (
                  <button key={t} type="button" onClick={() => setFormAumento((f) => ({ ...f, tipo: t }))} className={`flex-1 py-2 border-2 rounded-lg text-sm font-medium ${formAumento.tipo === t ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600"}`}>
                    {t === "PORCENTAJE" ? "Porcentaje" : "Monto fijo"}
                  </button>
                ))}
              </div>
            </div>
            {formAumento.tipo === "PORCENTAJE" ? (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-800">Porcentaje de aumento (%)</span>
                <input type="number" step="0.1" value={formAumento.porcentaje} onChange={(e) => setFormAumento((f) => ({ ...f, porcentaje: e.target.value }))} className="input" placeholder="Ej.: 5.5" />
              </label>
            ) : (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-800">Monto fijo a agregar (L.)</span>
                <input type="number" step="0.01" value={formAumento.montoFijo} onChange={(e) => setFormAumento((f) => ({ ...f, montoFijo: e.target.value }))} className="input" />
              </label>
            )}
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-800">Aplicar a la sucursal (vacío = todas)</span>
              <select value={formAumento.sucursalId} onChange={(e) => setFormAumento((f) => ({ ...f, sucursalId: e.target.value }))} className="input">
                <option value="">Todas las sucursales</option>
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-800">Motivo</span>
              <input value={formAumento.motivo} onChange={(e) => setFormAumento((f) => ({ ...f, motivo: e.target.value }))} className="input" />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setModalAumentoColectivo(false)} className="btn btn-ghost">Cancelar</button>
              <button
                onClick={aplicarAumentoColectivo}
                disabled={loading || !(formAumento.tipo === "PORCENTAJE" ? formAumento.porcentaje : formAumento.montoFijo)}
                className="btn btn-primary"
              >
                {loading ? "Aplicando…" : "Aplicar aumento"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
