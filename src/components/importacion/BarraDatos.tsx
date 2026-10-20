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

interface Props {
  recurso: "empleados" | "deducciones";
  puedeExportar: boolean;
  puedeImportar: boolean;
  /** Filtros activos, que se anexan a la descarga. */
  filtros?: Record<string, string | undefined>;
  /** Advierte de que el archivo llevará datos personales. */
  incluyePII?: boolean;
  ayudaImportacion: string;
  tituloImportacion: string;
}

export default function BarraDatos({
  recurso,
  puedeExportar,
  puedeImportar,
  filtros,
  incluyePII,
  ayudaImportacion,
  tituloImportacion,
}: Props) {
  const [asistente, setAsistente] = useState(false);
  const [menu, setMenu] = useState(false);

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
              onClick={() => setMenu((v) => !v)}
              className="btn btn-secondary"
            >
              Exportar
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
                    href={`/api/exportar/${recurso}?plantilla=1`}
                    onClick={() => setMenu(false)}
                    className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <span className="font-medium">Plantilla vacía</span>
                    <span className="block text-xs text-gray-500">
                      Sólo las cabeceras y una fila de ejemplo.
                    </span>
                  </a>
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
            Importar
          </button>
        )}
      </div>

      {asistente && (
        <AsistenteImportacion
          recurso={recurso}
          titulo={tituloImportacion}
          ayuda={ayudaImportacion}
          onCerrar={() => setAsistente(false)}
        />
      )}
    </>
  );
}
