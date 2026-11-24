/**
 * Tablero de Planillas (fase 3 de Planillas por período, 2026-11-24): sucursales en filas,
 * los últimos períodos en columnas. Se dibuja en el servidor; «Falta» lleva `data-generar`
 * (con la unidad) y lo escucha `GenerarPeriodo`, que abre la ventana con esa sucursal marcada.
 */

import Link from "next/link";
import EstadoBadge, { estadoDePlanilla, etiquetaEstado } from "@/components/ui/EstadoBadge";
import DesplazarAlFinal from "@/components/ui/DesplazarAlFinal";
import { cn, formatCurrency } from "@/lib/utils";
import type { ColumnaTablero, FilaTablero } from "@/lib/payroll/tablero-planillas";

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export default function TableroPlanillas({ columnas, filas, puedeGenerar }: { columnas: ColumnaTablero[]; filas: FilaTablero[]; puedeGenerar: boolean }) {
  const tipo = columnas[0]?.tipo;
  const n = columnas.length;
  const cuales = tipo === "MENSUAL"
    ? (n === 1 ? "El último mes" : `Los últimos ${n} meses`)
    : tipo === "SEMANAL" ? (n === 1 ? "La última semana" : `Las últimas ${n} semanas`) : (n === 1 ? "La última quincena" : `Las últimas ${n} quincenas`);
  return (
    <div className="panel overflow-hidden" data-tablero>
      <DesplazarAlFinal className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-gray-50 px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Sucursal</th>
              {columnas.map((c) => (
                <th key={c.clave} scope="col" data-columna={c.clave} aria-current={c.enCurso ? "date" : undefined}
                  className={cn("px-3 py-2.5 text-center text-xs font-semibold", c.enCurso ? "bg-blue-50 text-blue-800" : "text-gray-600")}>
                  <span className="block whitespace-nowrap">{c.titulo}</span>
                  <span className={cn("block whitespace-nowrap font-normal", c.enCurso ? "text-blue-700" : "text-gray-500")}>{c.sub}{c.enCurso ? ", en curso" : ""}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.clave} className="border-t border-gray-100" data-fila-tablero>
                <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-2 text-left font-medium text-gray-900">{f.nombre}</th>
                {f.celdas.map((cel, i) => {
                  const c = columnas[i];
                  const donde = `${f.nombre}, ${c.titulo} ${c.sub}`;
                  return (
                    <td key={c.clave} className={cn("px-2 py-1.5 text-center", c.enCurso && "bg-blue-50/40")} data-celda={cel.tipo}>
                      {cel.tipo === "planilla" && (
                        <Link href={`/planillas/${cel.id}`} aria-label={`${donde}: ${etiquetaEstado(estadoDePlanilla(cel.estado))}, neto ${formatCurrency(cel.neto)}`}
                          className={cn("inline-flex flex-col items-center gap-0.5 rounded-md px-2 py-1 hover:bg-gray-100", cel.estado === "ANULADA" && "opacity-60")}>
                          <EstadoBadge valor={estadoDePlanilla(cel.estado)} />
                          <span className="num whitespace-nowrap text-xs text-gray-500">{formatCurrency(cel.neto)}</span>
                        </Link>
                      )}
                      {cel.tipo === "falta" && (puedeGenerar ? (
                        <button type="button" data-generar data-tipo={c.tipo} data-desde={c.desde} data-hasta={c.hasta} data-unidad={cel.unidad}
                          title={`${plural(cel.empleados, "empleado", "empleados")} sin planilla: generarla`} aria-label={`${donde}: falta, ${plural(cel.empleados, "empleado", "empleados")}. Generarla`}
                          className="rounded-md border border-dashed border-gray-400 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-blue-500 hover:text-blue-700">
                          Falta
                        </button>
                      ) : (
                        <span className="rounded-md border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500" title={`${plural(cel.empleados, "empleado", "empleados")} sin planilla`}>Falta</span>
                      ))}
                      {cel.tipo === "vacia" && <span className="text-gray-300" aria-label={`${donde}: sin planilla`}>–</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50">
              <th scope="row" className="sticky left-0 z-10 bg-gray-50 px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Neto</th>
              {columnas.map((c) => (
                <td key={c.clave} className={cn("num whitespace-nowrap px-3 py-2.5 text-center text-xs font-semibold text-gray-900", c.enCurso && "bg-blue-50")} data-neto-columna>
                  {formatCurrency(c.neto)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </DesplazarAlFinal>
      <p className="border-t border-gray-100 px-4 py-2.5 text-sm text-gray-500">
        {cuales}: de un vistazo, qué sucursal va atrasada.
        {" "}Pulse una celda para abrir su planilla{puedeGenerar ? " o «Falta» para generarla" : ""}.
      </p>
    </div>
  );
}
