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
import type { InformeValidacion, ModoImportacion, ResultadoImportacion } from "@/lib/importacion/tipos";

interface Props {
  /** "empleados" o "deducciones": completa las rutas de la API. */
  recurso: "empleados" | "deducciones";
  titulo: string;
  /** Se muestra en el primer paso, antes de elegir archivo. */
  ayuda: string;
  onCerrar: () => void;
}

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

export default function AsistenteImportacion({ recurso, titulo, ayuda, onCerrar }: Props) {
  const router = useRouter();
  const inputArchivo = useRef<HTMLInputElement>(null);

  const [paso, setPaso] = useState<Paso>("subir");
  const [modo, setModo] = useState<ModoImportacion>("CREAR_O_ACTUALIZAR");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [informe, setInforme] = useState<InformeValidacion | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);

  async function validar(archivo: File) {
    setCargando(true);
    setError(null);
    try {
      const cuerpo = new FormData();
      cuerpo.append("archivo", archivo);
      cuerpo.append("modo", modo);

      const res = await fetch(`/api/importar/${recurso}`, { method: "POST", body: cuerpo });
      const datos = await res.json();
      if (!res.ok) throw new Error(datos.error ?? "No se pudo leer el archivo.");

      setInforme(datos as InformeValidacion);
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
      const res = await fetch(`/api/importar/${recurso}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loteId: informe.loteId }),
      });
      const datos = await res.json();
      if (!res.ok) throw new Error(datos.error ?? "No se pudo aplicar la importación.");

      setResultado(datos as ResultadoImportacion);
      setPaso("hecho");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aplicar la importación.");
    } finally {
      setCargando(false);
    }
  }

  function reiniciar() {
    setPaso("subir");
    setInforme(null);
    setResultado(null);
    setError(null);
    if (inputArchivo.current) inputArchivo.current.value = "";
  }

  const errores = informe?.incidencias.filter((i) => i.severidad === "ERROR") ?? [];
  const avisos = informe?.incidencias.filter((i) => i.severidad === "AVISO") ?? [];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Cabecera */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{titulo}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {paso === "subir" && "Paso 1 de 3 · Elegir archivo"}
              {paso === "revisar" && "Paso 2 de 3 · Revisar antes de aplicar"}
              {paso === "hecho" && "Paso 3 de 3 · Listo"}
            </p>
          </div>
          <button
            onClick={onCerrar}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-2"
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
              <p className="text-sm text-gray-600">{ayuda}</p>

              <a
                href={`/api/exportar/${recurso}?plantilla=1`}
                className="inline-flex items-center gap-2 text-sm text-blue-700 hover:text-blue-900 font-medium"
              >
                ↓ Descargar plantilla con las columnas y un ejemplo
              </a>

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

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <input
                  ref={inputArchivo}
                  type="file"
                  accept=".csv,text/csv"
                  disabled={cargando}
                  onChange={(e) => {
                    const archivo = e.target.files?.[0];
                    if (archivo) validar(archivo);
                  }}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-700 file:text-white file:text-sm file:font-medium hover:file:bg-blue-800 file:cursor-pointer"
                />
                <p className="text-xs text-gray-400 mt-3">
                  Archivo .csv, hasta 5 MB. Se acepta separado por comas o por punto y coma,
                  y guardado desde Excel en cualquier codificación.
                </p>
              </div>

              {cargando && <p className="text-sm text-gray-500">Leyendo y validando…</p>}
            </div>
          )}

          {/* ─── PASO 2 ─────────────────────────────────────────────────── */}
          {paso === "revisar" && informe && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Contador etiqueta="Se crearán" valor={informe.totalCrear} tono="verde" />
                <Contador etiqueta="Se actualizarán" valor={informe.totalActualizar} tono="azul" />
                <Contador etiqueta="Se omitirán" valor={informe.totalOmitir} tono="gris" />
                <Contador etiqueta="Con errores" valor={informe.totalErrores} tono="rojo" />
              </div>

              {/* Nada se ha escrito todavía: el mensaje lo dice explícitamente
                  para que cerrar aquí no dé miedo. */}
              <p className="text-xs text-gray-500">
                Archivo <span className="font-medium">{informe.nombreArchivo}</span> ·{" "}
                {informe.totalFilas} fila(s) leídas. Todavía no se ha guardado ningún cambio.
              </p>

              {informe.columnasDesconocidas.length > 0 && (
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
                  titulo={`${avisos.length} advertencia(s) — no bloquean la importación`}
                  incidencias={avisos}
                  tono="ambar"
                />
              )}

              {informe.filas.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Detalle por fila</h3>
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr className="border-b border-gray-100">
                          <th className="text-left px-3 py-2 font-medium text-gray-600 w-16">Línea</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600 w-28">Acción</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Registro</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Cambios</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {informe.filas.map((fila) => (
                          <tr key={fila.linea} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono text-xs text-gray-400">{fila.linea}</td>
                            <td className="px-3 py-2">
                              <EtiquetaAccion accion={fila.accion} />
                            </td>
                            <td className="px-3 py-2 text-gray-800">{fila.referencia}</td>
                            <td className="px-3 py-2 text-xs text-gray-500">
                              {fila.cambios?.join(" · ") || "—"}
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
              <div className="text-4xl">✓</div>
              <h3 className="text-lg font-semibold text-gray-900">Importación aplicada</h3>
              <p className="text-sm text-gray-600">
                {resultado.creados} registro(s) creado(s) y {resultado.actualizados} actualizado(s).
              </p>
              <p className="text-xs text-gray-400">
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
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
              >
                Elegir otro archivo
              </button>
              <button
                onClick={confirmar}
                disabled={cargando || !informe?.aplicable}
                className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {cargando
                  ? "Aplicando…"
                  : informe?.aplicable
                    ? `Aplicar ${(informe.totalCrear + informe.totalActualizar).toLocaleString("es-HN")} cambio(s)`
                    : "Corrija los errores para continuar"}
              </button>
            </>
          )}
          {paso === "hecho" && (
            <>
              <button
                onClick={reiniciar}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Importar otro archivo
              </button>
              <button
                onClick={onCerrar}
                className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800"
              >
                Cerrar
              </button>
            </>
          )}
          {paso === "subir" && (
            <button onClick={onCerrar} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
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

function Contador({ etiqueta, valor, tono }: { etiqueta: string; valor: number; tono: keyof typeof TONOS }) {
  return (
    <div className={`px-3 py-2 rounded-lg border ${TONOS[tono]}`}>
      <div className="text-xl font-bold">{valor}</div>
      <div className="text-xs">{etiqueta}</div>
    </div>
  );
}

function EtiquetaAccion({ accion }: { accion: string }) {
  const estilos: Record<string, string> = {
    CREAR: "bg-green-100 text-green-800",
    ACTUALIZAR: "bg-blue-100 text-blue-800",
    OMITIR: "bg-gray-100 text-gray-500",
  };
  const texto: Record<string, string> = {
    CREAR: "Alta",
    ACTUALIZAR: "Actualizar",
    OMITIR: "Omitir",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${estilos[accion] ?? ""}`}>
      {texto[accion] ?? accion}
    </span>
  );
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
            {inc.columna && <span className="font-medium"> · {inc.columna}</span>}
            <span> — {inc.mensaje}</span>
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
