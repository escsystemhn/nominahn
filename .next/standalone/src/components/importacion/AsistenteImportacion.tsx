"use client";

/**
 * Asistente de importación en tres pasos: subir → revisar → confirmar.
 *
 * POR QUÉ TRES PASOS Y NO UN BOTÓN: entre subir y escribir hay una pantalla que
 * dice exactamente qué va a pasar —cuántas altas, cuántas actualizaciones, qué
 * cambia en cada fila y qué está mal, con el número de línea del archivo—. En
 * una carga masiva de nómina, esa pantalla es la diferencia entre corregir un
 * archivo y reconstruir media plantilla.
 *
 * El paso de revisión NO ha escrito nada todavía: el servidor guardó un lote a
 * la espera. Cerrar el asistente ahí no deja rastro en los datos.
 */

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import EstadoBadge from "@/components/ui/EstadoBadge";
import FranjaCifras from "@/components/ui/FranjaCifras";
import SelectorPeriodo, { periodoInicial } from "@/components/payroll/SelectorPeriodo";
import { errorDePeriodo, frasePeriodo, type TipoPlanillaPeriodo } from "@/lib/payroll/periodos-planilla";
import { CATEGORIAS } from "@/lib/deducciones/tipos";
import type { InformeValidacion, ModoImportacion, RecursoImportacion, ResultadoImportacion, TipoSugerido } from "@/lib/importacion/tipos";

interface Props {
  /** Completa las rutas de la API. */
  recurso: RecursoImportacion;
  titulo: string;
  /** Se muestra en el primer paso, antes de elegir archivo. */
  ayuda: string;
  /**
   * Ofrece además importar los montos de un período (deducciones por empleado), que
   * pasa a ser la opción inicial. `puedeDescargar`: puede bajar el archivo del período.
   */
  montosDelPeriodo?: { tipoPlanilla: TipoPlanillaPeriodo; puedeDescargar: boolean; puedeCrearTipos: boolean };
  /** Campos que se mandan con el archivo (el plan de horarios al que se importa). */
  extras?: Record<string, string>;
  /** Plantillas propias, en lugar de las genéricas del recurso (la del plan ya trae su gente). */
  plantillas?: { xlsx: string; csv: string; texto?: string };
  /** Tras aplicar: para pantallas que leen sus datos por su cuenta y no con router.refresh(). */
  onHecho?: () => void;
  onCerrar: () => void;
}

type Variante = "montos" | "filas";

type Paso = "subir" | "revisar" | "hecho";

const MODOS: Array<{ valor: ModoImportacion; etiqueta: string; detalle: string }> = [
  {
    valor: "CREAR_O_ACTUALIZAR",
    etiqueta: "Crear y actualizar",
    detalle: "Da de alta lo que no existe y actualiza lo que sí.",
  },
  {
    valor: "CREAR",
    etiqueta: "Sólo altas",
    detalle: "Omite los registros que ya existen. Es lo más seguro para una carga inicial.",
  },
  {
    valor: "ACTUALIZAR",
    etiqueta: "Sólo actualizaciones",
    detalle: "Omite lo que no existe. No da de alta nada.",
  },
];

export default function AsistenteImportacion({ recurso, titulo, ayuda, montosDelPeriodo, extras, plantillas, onHecho, onCerrar }: Props) {
  const router = useRouter();
  const inputArchivo = useRef<HTMLInputElement>(null);

  const [paso, setPaso] = useState<Paso>("subir");
  const [modo, setModo] = useState<ModoImportacion>("CREAR_O_ACTUALIZAR");
  const [variante, setVariante] = useState<Variante>(montosDelPeriodo ? "montos" : "filas");
  const [periodo, setPeriodo] = useState(() => periodoInicial(montosDelPeriodo?.tipoPlanilla));
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [informe, setInforme] = useState<InformeValidacion | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  // El archivo de la última revisión: al crear los tipos que faltan se vuelve a revisar sin pedirlo otra vez.
  const [archivoActual, setArchivoActual] = useState<File | null>(null);
  const [nuevos, setNuevos] = useState<TipoSugerido[]>([]);

  const porPeriodo = variante === "montos";
  const ruta = porPeriodo ? `/api/importar/${recurso}/periodo` : `/api/importar/${recurso}`;
  const errorPeriodo = porPeriodo ? errorDePeriodo(periodo) : null;
  const archivoDelPeriodo = `/api/exportar/${recurso}?${new URLSearchParams({ tipoPlanilla: periodo.tipo, desde: periodo.desde, hasta: periodo.hasta })}`;

  async function validar(archivo: File) {
    setCargando(true);
    setError(null);
    try {
      const cuerpo = new FormData();
      cuerpo.append("archivo", archivo);
      if (porPeriodo) {
        cuerpo.append("tipoPlanilla", periodo.tipo);
        cuerpo.append("desde", periodo.desde);
        cuerpo.append("hasta", periodo.hasta);
      } else {
        cuerpo.append("modo", modo);
      }
      for (const [clave, valor] of Object.entries(extras ?? {})) cuerpo.append(clave, valor);

      const res = await fetch(ruta, { method: "POST", body: cuerpo });
      const datos = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(datos.error ?? "No se pudo leer el archivo.");

      setArchivoActual(archivo);
      setInforme(datos as InformeValidacion);
      setNuevos((datos as InformeValidacion).tiposNuevos ?? []);
      setPaso("revisar");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    } finally {
      setCargando(false);
    }
  }

  async function confirmar() {
    if (!informe?.loteId) return;
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`${ruta}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loteId: informe.loteId }),
      });
      const datos = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(datos.error ?? "No se pudo aplicar la importación.");

      setResultado(datos as ResultadoImportacion);
      setPaso("hecho");
      router.refresh();
      onHecho?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aplicar la importación.");
    } finally {
      setCargando(false);
    }
  }

  async function crearTiposYRevisar() {
    if (!archivoActual) return;
    const elegidos = nuevos.filter((t) => t.crear);
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/deducciones/tipos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipos: elegidos.map(({ nombre, codigo, tipo }) => ({ nombre, codigo, tipo })) }),
      });
      const datos = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(datos.error ?? "No se pudieron crear los tipos de deducción.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron crear los tipos de deducción.");
      setCargando(false);
      return;
    }
    await validar(archivoActual);
  }

  const cambiarNuevo = (i: number, cambio: Partial<TipoSugerido>) =>
    setNuevos((lista) => lista.map((t, j) => (j === i ? { ...t, ...cambio } : t)));

  function reiniciar() {
    setPaso("subir");
    setInforme(null);
    setResultado(null);
    setError(null);
    if (inputArchivo.current) inputArchivo.current.value = "";
  }

  // Columnas nuevas marcadas para crear: aplicar antes perdería sus montos sin que nadie lo note.
  const tiposPendientes = porPeriodo && !!montosDelPeriodo?.puedeCrearTipos && nuevos.some((t) => t.crear);
  const errores = informe?.incidencias.filter((i) => i.severidad === "ERROR") ?? [];
  const avisos = informe?.incidencias.filter((i) => i.severidad === "AVISO") ?? [];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="panel flex max-h-[90vh] w-full max-w-4xl flex-col shadow-xl">
        {/* Cabecera */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{titulo}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {paso === "subir" && "Paso 1 de 3: elegir archivo"}
              {paso === "revisar" && "Paso 2 de 3: revisar antes de aplicar"}
              {paso === "hecho" && "Paso 3 de 3: listo"}
            </p>
          </div>
          <button
            onClick={onCerrar}
            className="text-gray-500 hover:text-gray-600 text-2xl leading-none px-2"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              {error}
            </div>
          )}

          {/* ─── PASO 1 ─────────────────────────────────────────────────── */}
          {paso === "subir" && (
            <div className="space-y-5">
              {montosDelPeriodo && (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-gray-700 mb-2">¿Qué trae el archivo?</legend>
                  {([
                    {
                      valor: "montos" as const,
                      etiqueta: "Montos del período",
                      detalle: "Una fila por empleado y una columna por tipo de deducción, como el archivo que se exporta. Pone o corrige lo que se descuenta en una quincena o mes, sin tocar las deducciones de cada planilla. Sólo cuentan las filas con algún monto; una celda vacía no cambia nada y un 0 deja de cobrar ese tipo en el período.",
                    },
                    {
                      valor: "filas" as const,
                      etiqueta: "Deducciones a asignar",
                      detalle: "Una fila por deducción, con su forma de cobro: préstamos en cuotas, adelantos o descuentos de cada planilla.",
                    },
                  ]).map((v) => (
                    <label key={v.valor} className={`flex gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${variante === v.valor ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"}`}>
                      <input type="radio" name="variante" className="mt-1" checked={variante === v.valor} onChange={() => setVariante(v.valor)} />
                      <span>
                        <span className="block text-sm font-medium text-gray-900">{v.etiqueta}</span>
                        <span className="block text-xs text-gray-500">{v.detalle}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              {porPeriodo ? (
                <div className="space-y-3">
                  <SelectorPeriodo id="importar-periodo" valor={periodo} onCambio={setPeriodo} />
                  {errorPeriodo
                    ? <p className="text-sm text-red-700" role="alert">{errorPeriodo}</p>
                    : (
                      <p className="text-sm text-gray-600">
                        Los montos se aplican sólo <span className="font-medium">{frasePeriodo(periodo, "a")}</span>. Cada celda es lo que se
                        descuenta de ese tipo en el período: escribir otro monto lo reemplaza sólo en ese período, una celda vacía no descuenta
                        nada y lo que no cambie no se toca. Antes de aplicar verá qué cambia.
                      </p>
                    )}
                  {montosDelPeriodo?.puedeDescargar && !errorPeriodo && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <a href={`${archivoDelPeriodo}&formato=xlsx`} className="inline-flex items-center gap-2 text-blue-700 hover:text-blue-900 font-medium">
                        Descargar el archivo de este período, con sus empleados y montos
                      </a>
                      <a href={archivoDelPeriodo} className="text-gray-500 hover:text-gray-800">o en CSV</a>
                    </div>
                  )}
                </div>
              ) : (
              <>
              <p className="text-sm text-gray-600">{ayuda}</p>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <a
                  href={plantillas?.xlsx ?? `/api/exportar/${recurso}?plantilla=1&formato=xlsx`}
                  className="inline-flex items-center gap-2 text-blue-700 hover:text-blue-900 font-medium"
                >
                  {plantillas?.texto ?? "Descargar plantilla de Excel, con instrucciones"}
                </a>
                <a href={plantillas?.csv ?? `/api/exportar/${recurso}?plantilla=1`} className="text-gray-500 hover:text-gray-800">
                  o en CSV
                </a>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-gray-700 mb-2">
                  ¿Qué debe hacer con las filas?
                </legend>
                {MODOS.map((m) => (
                  <label
                    key={m.valor}
                    className={`flex gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      modo === m.valor ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="modo"
                      className="mt-1"
                      checked={modo === m.valor}
                      onChange={() => setModo(m.valor)}
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-900">{m.etiqueta}</span>
                      <span className="block text-xs text-gray-500">{m.detalle}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              </>
              )}

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <input
                  ref={inputArchivo}
                  type="file"
                  aria-label="Archivo a importar"
                  accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={cargando || !!errorPeriodo}
                  onChange={(e) => {
                    const archivo = e.target.files?.[0];
                    if (archivo) validar(archivo);
                  }}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-700 file:text-white file:text-sm file:font-medium hover:file:bg-blue-800 file:cursor-pointer"
                />
                <p className="text-xs text-gray-500 mt-3">
                  Archivo de Excel (.xlsx) o .csv, hasta 5 MB. El CSV puede venir separado por comas
                  o por punto y coma, y guardado en cualquier codificación.
                </p>
              </div>

              {cargando && <p className="text-sm text-gray-500">Leyendo y validando…</p>}
            </div>
          )}

          {/* ─── PASO 2 ─────────────────────────────────────────────────── */}
          {paso === "revisar" && informe && (
            <div className="space-y-5">
              <FranjaCifras
                etiqueta="Resultado de la revisión"
                cifras={informe.cifras ?? [
                  { label: "Se crearán", valor: informe.totalCrear },
                  { label: "Se actualizarán", valor: informe.totalActualizar },
                  { label: "Se omitirán", valor: informe.totalOmitir },
                  { label: "Con errores", valor: informe.totalErrores },
                ]}
              />

              {/* Nada se ha escrito todavía: el mensaje lo dice explícitamente
                  para que cerrar aquí no dé miedo. */}
              <p className="text-xs text-gray-500">
                Archivo <span className="font-medium">{informe.nombreArchivo}</span>:{" "}
                {informe.totalFilas} fila(s) leídas. Todavía no se ha guardado ningún cambio.
              </p>
              {informe.resumen && <p className="text-sm text-gray-700" data-resumen>{informe.resumen}</p>}

              {porPeriodo && nuevos.length > 0 && (
                <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" data-tipos-nuevos>
                  <div>
                    <p className="font-medium">
                      {nuevos.length === 1 ? "1 columna del archivo todavía no es" : `${nuevos.length} columnas del archivo todavía no son`} un tipo de deducción
                    </p>
                    <p className="mt-0.5 text-xs text-blue-900">
                      {montosDelPeriodo?.puedeCrearTipos
                        ? "Marque las que sí son descuentos y revise la categoría: decide hasta cuánto se cobra. Al crearlas se vuelve a revisar el archivo; nada se aplica todavía."
                        : `Mientras no existan, se ignoran: ${nuevos.map((t) => t.cabecera).join(", ")}. Pida a quien configura las deducciones que las cree (Tipos de deducción → Nuevo tipo o Importar tipos) y vuelva a subir el archivo.`}
                    </p>
                  </div>
                  {montosDelPeriodo?.puedeCrearTipos && (
                    <>
                      <ul className="divide-y divide-blue-100 rounded-md border border-blue-100 bg-white">
                        {nuevos.map((t, i) => {
                          const ayuda = CATEGORIAS.find((c) => c.valor === t.tipo)?.ayuda;
                          return (
                            <li key={t.cabecera} className="space-y-1.5 px-3 py-2" data-columna={t.cabecera}>
                              <div className="grid items-center gap-2 sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
                                <input type="checkbox" className="h-4 w-4" aria-label={`Crear «${t.cabecera}»`} checked={t.crear} onChange={(e) => cambiarNuevo(i, { crear: e.target.checked })} />
                                <input className="input h-8" aria-label={`Nombre de «${t.cabecera}»`} value={t.nombre} disabled={!t.crear} onChange={(e) => cambiarNuevo(i, { nombre: e.target.value })} />
                                <input className="input h-8 font-mono text-xs uppercase" aria-label={`Código de «${t.cabecera}»`} value={t.codigo} disabled={!t.crear} onChange={(e) => cambiarNuevo(i, { codigo: e.target.value.toUpperCase() })} />
                                <select className="input h-8" aria-label={`Categoría de «${t.cabecera}»`} value={t.tipo} disabled={!t.crear} onChange={(e) => cambiarNuevo(i, { tipo: e.target.value })}>
                                  {CATEGORIAS.map((c) => <option key={c.valor} value={c.valor}>{c.etiqueta}</option>)}
                                </select>
                              </div>
                              <p className="text-xs text-gray-500 sm:pl-6">
                                {t.conMontos} monto(s) en el archivo.{t.motivo && <span className="text-amber-800"> {t.motivo}</span>}{t.crear && ayuda && <> {ayuda}</>}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="flex justify-end">
                        <button type="button" className="btn btn-primary" disabled={cargando || !nuevos.some((t) => t.crear)} onClick={() => void crearTiposYRevisar()}>
                          {cargando ? "Creando…" : `Crear ${nuevos.filter((t) => t.crear).length} tipo(s) y volver a revisar`}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {informe.columnasDesconocidas.length > 0 && !(porPeriodo && nuevos.length > 0) && (
                <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                  <p className="font-medium">Columnas que no se reconocen y se ignorarán:</p>
                  <p className="mt-1">{informe.columnasDesconocidas.join(", ")}</p>
                  <p className="mt-1 text-xs">
                    Si esperaba que alguna se aplicara, revise que su nombre coincida con el de la plantilla.
                  </p>
                </div>
              )}

              {errores.length > 0 && (
                <ListaIncidencias
                  titulo={`${errores.length} error(es) que impiden aplicar el archivo`}
                  incidencias={errores}
                  tono="rojo"
                />
              )}

              {avisos.length > 0 && (
                <ListaIncidencias
                  titulo={`${avisos.length} advertencia(s), no bloquean la importación`}
                  incidencias={avisos}
                  tono="ambar"
                />
              )}

              {informe.filas.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Detalle por fila</h3>
                  <div className="panel max-h-72 overflow-hidden overflow-y-auto">
                    <table className="table-base">
                      <thead className="sticky top-0">
                        <tr>
                          <th className="w-16">Línea</th>
                          <th className="w-28">Acción</th>
                          <th>Registro</th>
                          <th>Cambios</th>
                        </tr>
                      </thead>
                      <tbody>
                        {informe.filas.map((fila, i) => (
                          <tr key={`${fila.linea}-${i}`}>
                            <td className="font-mono text-xs text-gray-500">{fila.linea}</td>
                            <td>
                              <EtiquetaAccion accion={fila.accion} porPeriodo={porPeriodo} />
                            </td>
                            <td className="text-gray-800">{fila.referencia}</td>
                            <td className="text-xs text-gray-500">
                              {fila.cambios?.join("; ") || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── PASO 3 ─────────────────────────────────────────────────── */}
          {paso === "hecho" && resultado && (
            <div className="py-6 text-center space-y-3">
              <h3 className="text-lg font-semibold text-gray-900">Importación aplicada</h3>
              <p className="text-sm text-gray-600">
                {resultado.mensaje ?? `${resultado.creados} registro(s) creado(s) y ${resultado.actualizados} actualizado(s).`}
              </p>
              <p className="text-xs text-gray-500">
                La operación quedó registrada en la auditoría del sistema.
              </p>
            </div>
          )}
        </div>

        {/* Pie */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 shrink-0">
          {paso === "revisar" && (
            <>
              <button
                onClick={reiniciar}
                disabled={cargando}
                className="btn btn-ghost"
              >
                Elegir otro archivo
              </button>
              <button
                onClick={confirmar}
                disabled={cargando || !informe?.aplicable || tiposPendientes}
                className="btn btn-primary"
              >
                {cargando
                  ? "Aplicando…"
                  : tiposPendientes
                    ? "Primero cree o desmarque las columnas nuevas"
                  : informe?.aplicable
                    ? `Aplicar ${(informe.totalCrear + informe.totalActualizar).toLocaleString("es-HN")} cambio(s)`
                    : informe && informe.totalErrores === 0 ? "No hay cambios que aplicar" : "Corrija los errores para continuar"}
              </button>
            </>
          )}
          {paso === "hecho" && (
            <>
              <button
                onClick={reiniciar}
                className="btn btn-ghost"
              >
                Importar otro archivo
              </button>
              <button
                onClick={onCerrar}
                className="btn btn-primary"
              >
                Cerrar
              </button>
            </>
          )}
          {paso === "subir" && (
            <button onClick={onCerrar} className="btn btn-ghost">
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const TONOS = {
  verde: "bg-green-50 border-green-200 text-green-900",
  azul: "bg-blue-50 border-blue-200 text-blue-900",
  gris: "bg-gray-50 border-gray-200 text-gray-700",
  rojo: "bg-red-50 border-red-200 text-red-900",
  ambar: "bg-amber-50 border-amber-200 text-amber-900",
} as const;

function EtiquetaAccion({ accion, porPeriodo }: { accion: string; porPeriodo?: boolean }) {
  const texto: Record<string, { etiqueta: string; tono: "ok" | "marca" | "neutro" }> = {
    CREAR: { etiqueta: porPeriodo ? "Nuevo" : "Alta", tono: "ok" },
    ACTUALIZAR: { etiqueta: porPeriodo ? "Cambia" : "Actualizar", tono: "marca" },
    OMITIR: { etiqueta: "Omitir", tono: "neutro" },
    QUITAR: { etiqueta: "Se quita", tono: "neutro" },
  };
  const t = texto[accion];
  return <EstadoBadge valor={accion} etiqueta={t?.etiqueta ?? accion} tono={t?.tono ?? "neutro"} />;
}

function ListaIncidencias({
  titulo,
  incidencias,
  tono,
}: {
  titulo: string;
  incidencias: Array<{ linea: number; columna?: string; mensaje: string }>;
  tono: "rojo" | "ambar";
}) {
  // Se muestran las primeras y se resume el resto: una lista de 400 errores no
  // se lee, y lo que hace falta es identificar el patrón para corregir el archivo.
  const VISIBLES = 30;
  return (
    <div className={`px-4 py-3 rounded-lg border text-sm ${TONOS[tono]}`}>
      <p className="font-medium mb-2">{titulo}</p>
      <ul className="space-y-1 max-h-52 overflow-y-auto">
        {incidencias.slice(0, VISIBLES).map((inc, i) => (
          <li key={`${inc.linea}-${i}`} className="text-xs">
            <span className="font-mono opacity-70">Línea {inc.linea}</span>
            {inc.columna && <span className="font-medium">, {inc.columna}</span>}
            <span>: {inc.mensaje}</span>
          </li>
        ))}
      </ul>
      {incidencias.length > VISIBLES && (
        <p className="text-xs mt-2 opacity-70">
          … y {incidencias.length - VISIBLES} más. Corrija estas primero: suelen repetir el mismo patrón.
        </p>
      )}
    </div>
  );
}
