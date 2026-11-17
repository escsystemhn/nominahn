"use client";

/**
 * Configuración del sistema. Las secciones van en un menú lateral agrupado —Organización,
 * Parametrizaciones, Integraciones y Sistema— en vez de 11 pestañas en una fila que ya no
 * cabían (pedido de Edbin, 2026-11-16). Cada sección tiene su dirección (`?seccion=asistencia`),
 * para enlazarla; en pantallas angostas el menú es un selector.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import PageHeader from "@/components/ui/PageHeader";
import EstadoVacio from "@/components/ui/EstadoVacio";
import { formatCurrency } from "@/lib/utils";
import CorreoSalienteConfig from "./CorreoSalienteConfig";
import SapConexionConfig from "./SapConexionConfig";
import ParametrosLeyConfig from "./ParametrosLeyConfig";
import PoliticaAsistenciaConfig from "./PoliticaAsistenciaConfig";
import FormatosBancoConfig from "./FormatosBancoConfig";
import EstructuraOrganizacional, { type DepartamentoEstructura, type DivisionEstructura, type PuestoEstructura } from "./EstructuraOrganizacional";
import EmpresaConfig from "./EmpresaConfig";
import SeguridadConfig from "./SeguridadConfig";
import RespaldosConfig from "./RespaldosConfig";
import IconoSeccion from "./IconoSeccion";
import { useMenuCompacto } from "./menu-compacto";

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
  rtn: string | null;
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
  /** `?seccion=` de la dirección; si no existe o no se puede ver, la primera permitida. */
  seccionInicial?: string;
}

type Seccion = "empresa" | "estructura" | "parametros" | "salarios" | "asistencia" | "correo" | "sap" | "banco" | "seguridad" | "respaldos" | "valores";

export default function ConfiguracionClient({
  empresa, sucursales, divisiones, departamentos, puestos, divisionesHabilitadas, jerarquiaHabilitada, salarioMinimo, configs,
  puedeVer, puedeEditar, puedeEditarEmpresa, puedeCorreo, puedeParametros, puedeSap, puedeBanco, puedeSeguridad, minutosInactividad, puedeRespaldos,
  seccionInicial,
}: Props) {
  const router = useRouter();
  const { avisar } = useAvisos();
  // Grupos y secciones del menú; cada una aparece sólo con su permiso, y un grupo vacío no se muestra.
  const todos: { titulo: string; secciones: { key: Seccion; label: string; ve: boolean }[] }[] = [
    { titulo: "Organización", secciones: [
      { key: "empresa", label: "Empresa", ve: puedeVer },
      { key: "estructura", label: "Estructura organizacional", ve: puedeVer },
    ] },
    // Las reglas que cambian lo que se paga y se descuenta.
    { titulo: "Parametrizaciones", secciones: [
      { key: "parametros", label: "Parámetros de ley", ve: puedeParametros },
      { key: "salarios", label: "Salarios", ve: puedeVer },
      { key: "asistencia", label: "Asistencia", ve: puedeParametros },
    ] },
    { titulo: "Integraciones", secciones: [
      // Quien controla el servidor de correo puede escribir a los empleados a nombre de la empresa.
      { key: "correo", label: "Correo saliente", ve: puedeCorreo },
      { key: "sap", label: "SAP Business One", ve: puedeSap },
      { key: "banco", label: "Formatos de banco", ve: puedeBanco },
    ] },
    { titulo: "Sistema", secciones: [
      // Política de sesión de todas las cuentas: quien administra los usuarios.
      { key: "seguridad", label: "Seguridad", ve: puedeSeguridad },
      { key: "respaldos", label: "Respaldos", ve: puedeRespaldos },
      { key: "valores", label: "Valores internos", ve: puedeVer },
    ] },
  ];
  const grupos = todos.map((g) => ({ ...g, secciones: g.secciones.filter((s) => s.ve) })).filter((g) => g.secciones.length > 0);
  const visibles = grupos.flatMap((g) => g.secciones.map((s) => s.key));
  const [compacto, setCompacto] = useMenuCompacto();
  const [tab, setTabEstado] = useState<Seccion>(
    visibles.includes(seccionInicial as Seccion) ? (seccionInicial as Seccion) : visibles[0] ?? "empresa"
  );
  // Cambia de sección sin recargar la página y deja la dirección lista para enlazarla.
  const setTab = (s: Seccion) => {
    setTabEstado(s);
    window.history.replaceState(null, "", `?seccion=${s}`);
  };
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

  return (
    <div className="space-y-6">
      <PageHeader title="Configuración del sistema" description="Organización, parametrizaciones, integraciones y sistema." />

      <div className={`grid gap-6 ${compacto ? "lg:grid-cols-[3.25rem_minmax(0,1fr)]" : "lg:grid-cols-[15.5rem_minmax(0,1fr)]"}`}>
        {/* Angosto: un selector con los mismos grupos. */}
        <label className="block lg:hidden">
          <span className="sr-only">Sección de la configuración</span>
          <select className="input" value={tab} onChange={(e) => setTab(e.target.value as Seccion)} data-config-selector>
            {grupos.map((g) => (
              <optgroup key={g.titulo} label={g.titulo}>
                {g.secciones.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>

        <nav aria-label="Secciones de la configuración" className="hidden self-start lg:sticky lg:top-4 lg:block" data-config-menu data-compacto={compacto ? "si" : "no"}>
          {/* Con nombres o sólo con íconos: en pantallas angostas el menú con nombres apretaba el
              contenido (pedido de Edbin, 2026-11-17). La elección queda en esta computadora. */}
          <button
            type="button"
            onClick={() => setCompacto(!compacto)}
            aria-pressed={compacto}
            title={compacto ? "Mostrar los nombres" : "Mostrar sólo íconos"}
            className={`mb-3 flex items-center gap-2 rounded-md text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 ${
              compacto ? "mx-auto h-9 w-9 justify-center" : "w-full px-2 py-1.5"
            }`}
            data-config-compacto
          >
            <IconoSeccion nombre={compacto ? "expandir" : "contraer"} className="h-4 w-4" />
            {compacto ? <span className="sr-only">Mostrar los nombres</span> : "Sólo íconos"}
          </button>

          {/* Los grupos, en el turquesa de acento con la barrita del cian del logo; sus secciones,
              debajo con sangría y una línea guía, para que se lean como jerarquía. Compacto, el
              grupo queda como una barrita de color y cada ícono dice su nombre al pasar o enfocar. */}
          {grupos.map((g) => (
            <div key={g.titulo} className={compacto ? "mb-3 last:mb-0" : "mb-5 last:mb-0"}>
              {compacto ? (
                <p className="mx-auto mb-1.5 h-1 w-6 rounded-full bg-blue-500" title={g.titulo} data-config-grupo>
                  <span className="sr-only">{g.titulo}</span>
                </p>
              ) : (
                <p className="mb-1.5 flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wider text-blue-700" data-config-grupo>
                  <span className="h-3.5 w-1 rounded-full bg-blue-500" aria-hidden="true" />
                  {g.titulo}
                </p>
              )}
              <ul className={compacto ? "space-y-1" : "ml-2.5 space-y-0.5 border-l border-gray-200 pl-2"}>
                {g.secciones.map((s) => {
                  const activa = tab === s.key;
                  return (
                    <li key={s.key}>
                      <button
                        type="button"
                        onClick={() => setTab(s.key)}
                        aria-current={activa ? "page" : undefined}
                        aria-label={compacto ? s.label : undefined}
                        className={
                          compacto
                            ? `group relative mx-auto flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                                activa ? "bg-blue-50 text-blue-700 shadow-[inset_3px_0_0_0_var(--color-blue-500)]" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                              }`
                            : `relative flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                                activa
                                  ? "bg-blue-50 font-semibold text-blue-800 before:absolute before:inset-y-1 before:left-[-10.5px] before:w-0.75 before:rounded-full before:bg-blue-500"
                                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                              }`
                        }
                      >
                        <IconoSeccion nombre={s.key} className={compacto ? "h-5 w-5" : `h-4 w-4 ${activa ? "text-blue-600" : "text-gray-400"}`} />
                        {compacto ? (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                          >
                            {s.label}
                          </span>
                        ) : (
                          s.label
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-6">

      {tab === "parametros" && puedeParametros && <ParametrosLeyConfig />}
      {tab === "asistencia" && puedeParametros && <PoliticaAsistenciaConfig />}
      {tab === "correo" && puedeCorreo && <CorreoSalienteConfig />}
      {tab === "sap" && puedeSap && <SapConexionConfig />}
      {tab === "banco" && puedeBanco && <FormatosBancoConfig />}

      {/* Empresa: la ve quien consulta la configuración; la edita sólo el administrador */}
      {tab === "empresa" && <EmpresaConfig empresa={empresa} puedeEditar={puedeEditarEmpresa} />}

      {/* Estructura organizacional: sucursales, divisiones (opcionales), departamentos y puestos */}
      {tab === "estructura" && (
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

      {tab === "valores" && (
        <div className="panel overflow-hidden">
          <p className="border-b border-gray-100 px-5 py-3 text-sm text-gray-600">
            Valores que el sistema guarda por su cuenta, como las opciones de la estructura o la política de sesión. Sólo se consultan aquí: cada uno se
            cambia en su sección.
          </p>
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
        </div>
      </div>

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
