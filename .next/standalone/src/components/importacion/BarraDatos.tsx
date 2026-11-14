"use client";

/**
 * Botones de exportar e importar, para colgar de la cabecera de un listado.
 *
 * Se dibuja según los permisos que le pasa la página (resueltos en el servidor):
 * quien no puede exportar no ve el botón. La comprobación de verdad la hace la
 * API —ocultar un botón no es una medida de seguridad—, pero mostrar acciones
 * que van a devolver 403 sólo genera desconcierto.
 *
 * La exportación arrastra los filtros activos de la pantalla para que el archivo
 * contenga lo que la persona está viendo, no la tabla entera.
 */

import { useState } from "react";
import AsistenteImportacion from "./AsistenteImportacion";
import ExportarSeleccion, { exportaConSeleccion } from "./ExportarSeleccion";
import type { RecursoImportacion } from "@/lib/importacion/tipos";
import type { TipoPlanillaPeriodo } from "@/lib/payroll/periodos-planilla";

interface Props {
  recurso: RecursoImportacion;
  puedeExportar: boolean;
  puedeImportar: boolean;
  /** Filtros activos, que se anexan a la descarga. */
  filtros?: Record<string, string | undefined>;
  /** Advierte de que el archivo llevará datos personales. */
  incluyePII?: boolean;
  /** Aclara qué lleva la exportación, si no es lo que se ve en pantalla. */
  notaExportar?: string;
  /**
   * Antes de descargar se marca qué filas exportar, con formato Excel o CSV (empleados,
   * deducciones). Sin marcar nada sale la plantilla vacía. Ver `ExportarSeleccion`.
   */
  elegirFilas?: boolean;
  /**
   * El recurso se exporta e importa también por período de planilla (deducciones por
   * empleado). Es el tipo de planilla con que arrancan los selectores de período.
   */
  periodoPlanilla?: TipoPlanillaPeriodo;
  /** Al importar montos del período, puede crear los tipos de deducción que falten. */
  puedeCrearTipos?: boolean;
  /** El menú de exportar ofrece también el archivo con datos en Excel. */
  exportaXlsx?: boolean;
  /** Textos de los botones, cuando hay más de una barra en la pantalla. */
  textoExportar?: string;
  textoImportar?: string;
  ayudaImportacion: string;
  tituloImportacion: string;
}

export default function BarraDatos({
  recurso,
  puedeExportar,
  puedeImportar,
  filtros,
  incluyePII,
  notaExportar,
  elegirFilas,
  periodoPlanilla,
  puedeCrearTipos = false,
  exportaXlsx = false,
  textoExportar = "Exportar",
  textoImportar = "Importar",
  ayudaImportacion,
  tituloImportacion,
}: Props) {
  const [asistente, setAsistente] = useState(false);
  const [menu, setMenu] = useState(false);
  const [eligiendo, setEligiendo] = useState(false);
  const conSeleccion = !!elegirFilas && exportaConSeleccion(recurso);

  if (!puedeExportar && !puedeImportar) return null;

  const query = (delimitador?: string) => {
    const params = new URLSearchParams();
    for (const [clave, valor] of Object.entries(filtros ?? {})) {
      if (valor) params.set(clave, valor);
    }
    if (delimitador) params.set("delimitador", delimitador);
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {puedeExportar && (
          <div className="relative">
            <button
              type="button"
              onClick={() => (conSeleccion ? setEligiendo(true) : setMenu((v) => !v))}
              className="btn btn-secondary"
            >
              {textoExportar}
            </button>

            {menu && (
              <>
                {/* Capa para cerrar al hacer clic fuera. */}
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  onClick={() => setMenu(false)}
                  className="fixed inset-0 cursor-default z-10"
                />
                <div className="absolute right-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                  {exportaXlsx && (
                    <a
                      href={`/api/exportar/${recurso}${query()}${query() ? "&" : "?"}formato=xlsx`}
                      onClick={() => setMenu(false)}
                      className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <span className="font-medium">Excel (.xlsx)</span>
                      <span className="block text-xs text-gray-500">
                        Con los datos de hoy, para corregirlos y volver a importarlos.
                      </span>
                    </a>
                  )}
                  <a
                    href={`/api/exportar/${recurso}${query()}`}
                    onClick={() => setMenu(false)}
                    className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <span className="font-medium">CSV estándar</span>
                    <span className="block text-xs text-gray-500">
                      Separado por comas. Para volver a importar o para otro sistema.
                    </span>
                  </a>
                  <a
                    href={`/api/exportar/${recurso}${query(";")}`}
                    onClick={() => setMenu(false)}
                    className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <span className="font-medium">CSV para Excel</span>
                    <span className="block text-xs text-gray-500">
                      Separado por punto y coma. Úselo si al abrirlo todo cae en una sola columna.
                    </span>
                  </a>
                  <div className="border-t border-gray-100 my-1" />
                  <a
                    href={`/api/exportar/${recurso}?plantilla=1&formato=xlsx`}
                    onClick={() => setMenu(false)}
                    className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <span className="font-medium">Plantilla de Excel</span>
                    <span className="block text-xs text-gray-500">
                      Vacía, con las columnas listas y una hoja de instrucciones.
                    </span>
                  </a>
                  <a
                    href={`/api/exportar/${recurso}?plantilla=1`}
                    onClick={() => setMenu(false)}
                    className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <span className="font-medium">Plantilla CSV</span>
                    <span className="block text-xs text-gray-500">
                      Para llenarla en otro programa.
                    </span>
                  </a>
                  {notaExportar && (
                    <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">{notaExportar}</p>
                  )}
                  {incluyePII && (
                    <p className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-t border-amber-100">
                      El archivo incluirá identidad, salario y cuenta bancaria. La descarga queda
                      registrada en la auditoría.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {puedeImportar && (
          <button
            type="button"
            onClick={() => setAsistente(true)}
            className="btn btn-secondary"
          >
            {textoImportar}
          </button>
        )}
      </div>

      {eligiendo && <ExportarSeleccion recurso={recurso} filtros={filtros} incluyePII={incluyePII} tipoPlanilla={periodoPlanilla} onCerrar={() => setEligiendo(false)} />}

      {asistente && (
        <AsistenteImportacion
          recurso={recurso}
          titulo={tituloImportacion}
          ayuda={ayudaImportacion}
          montosDelPeriodo={periodoPlanilla ? { tipoPlanilla: periodoPlanilla, puedeDescargar: puedeExportar, puedeCrearTipos } : undefined}
          onCerrar={() => setAsistente(false)}
        />
      )}
    </>
  );
}
