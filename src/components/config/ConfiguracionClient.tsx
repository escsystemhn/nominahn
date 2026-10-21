"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import CorreoSalienteConfig from "./CorreoSalienteConfig";
import SapConexionConfig from "./SapConexionConfig";
import ParametrosLeyConfig from "./ParametrosLeyConfig";
import FormatosBancoConfig from "./FormatosBancoConfig";
import EstructuraOrganizacional, { type DepartamentoEstructura, type DivisionEstructura } from "./EstructuraOrganizacional";
import EmpresaConfig from "./EmpresaConfig";

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
  nombre: string;
  codigo: string;
  direccion: string | null;
  activa: boolean;
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
  /** Opción del administrador: usar el nivel División (Sucursal → División → Departamento). */
  divisionesHabilitadas: boolean;
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
}

export default function ConfiguracionClient({
  empresa, sucursales, divisiones, departamentos, divisionesHabilitadas, salarioMinimo, configs,
  puedeVer, puedeEditar, puedeEditarEmpresa, puedeCorreo, puedeParametros, puedeSap, puedeBanco,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"empresa" | "sucursales" | "salarios" | "sistema" | "parametros" | "correo" | "sap" | "banco">(
    puedeVer ? "empresa" : puedeParametros ? "parametros" : puedeCorreo ? "correo" : "sap"
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
      alert("Ingrese un valor numérico válido.");
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
      alert(`Aumento aplicado a ${data.actualizados} empleados.`);
      router.refresh();
    } catch {
      alert("No se pudo aplicar el aumento. Intente nuevamente.");
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
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Configuración del sistema</h1>
        <p className="text-sm text-gray-500">Empresa, sucursales, salarios y parámetros de ley</p>
      </div>

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

      {/* Estructura organizacional: sucursales, divisiones (opcionales) y departamentos */}
      {tab === "sucursales" && (
        <EstructuraOrganizacional
          empresaId={empresa?.id ?? null}
          sucursales={sucursales}
          divisiones={divisiones}
          departamentos={departamentos}
          divisionesHabilitadas={divisionesHabilitadas}
          puedeEditar={puedeEditar}
        />
      )}

      {/* Salarios */}
      {tab === "salarios" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-semibold text-gray-800 mb-3">Salario mínimo vigente</h2>
            {salarioMinimo ? (
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-3xl font-bold text-blue-700">{formatCurrency(Number(salarioMinimo.monto))}</p>
                  <p className="text-sm text-gray-500">Año {salarioMinimo.anio} · {salarioMinimo.sector}</p>
                </div>
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Sin salario mínimo configurado</p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-semibold text-gray-800 mb-3">Aumento de salario colectivo</h2>
            <p className="text-sm text-gray-500 mb-4">Aplica un aumento de salario a todos o a un grupo de empleados en una sola operación.</p>
            <button onClick={() => setModalAumentoColectivo(true)} className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700">
              Aplicar Aumento Colectivo
            </button>
          </div>
        </div>
      )}

      {/* Sistema */}
      {tab === "sistema" && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-b"><th className="text-left px-4 py-3 font-medium text-gray-600">Configuración</th><th className="text-left px-4 py-3 font-medium text-gray-600">Valor</th><th className="text-left px-4 py-3 font-medium text-gray-600">Descripción</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {configs.map((c) => (
                <tr key={c.clave} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-blue-700">{c.clave}</td>
                  <td className="px-4 py-3 font-medium">{c.valor}</td>
                  <td className="px-4 py-3 text-gray-500">{c.descripcion ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal aumento colectivo */}
      {modalAumentoColectivo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-gray-900">Aumento colectivo de salario</h3>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Tipo de Aumento</label>
              <div className="flex gap-3">
                {["PORCENTAJE", "MONTO_FIJO"].map((t) => (
                  <button key={t} type="button" onClick={() => setFormAumento((f) => ({ ...f, tipo: t }))} className={`flex-1 py-2 border-2 rounded-lg text-sm font-medium ${formAumento.tipo === t ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600"}`}>
                    {t === "PORCENTAJE" ? "Porcentaje" : "Monto Fijo"}
                  </button>
                ))}
              </div>
            </div>
            {formAumento.tipo === "PORCENTAJE" ? (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Porcentaje de Aumento (%)</label>
                <input type="number" step="0.1" value={formAumento.porcentaje} onChange={(e) => setFormAumento((f) => ({ ...f, porcentaje: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Ej: 5.5" />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Monto Fijo a Agregar (L.)</label>
                <input type="number" step="0.01" value={formAumento.montoFijo} onChange={(e) => setFormAumento((f) => ({ ...f, montoFijo: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Aplicar a Sucursal (vacío = todas)</label>
              <select value={formAumento.sucursalId} onChange={(e) => setFormAumento((f) => ({ ...f, sucursalId: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Todas las sucursales</option>
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Motivo</label>
              <input value={formAumento.motivo} onChange={(e) => setFormAumento((f) => ({ ...f, motivo: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setModalAumentoColectivo(false)} className="flex-1 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button
                onClick={aplicarAumentoColectivo}
                disabled={loading || !(formAumento.tipo === "PORCENTAJE" ? formAumento.porcentaje : formAumento.montoFijo)}
                className="flex-1 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:bg-emerald-400"
              >
                {loading ? "Aplicando..." : "Aplicar Aumento"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
