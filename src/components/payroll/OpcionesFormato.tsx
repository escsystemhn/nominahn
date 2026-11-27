"use client";

/**
 * Lo que comparten el formato por sucursal y el formato por grupo: si sale con los montos
 * de hoy, si lleva las horas extra y qué columnas de deducción, en qué orden y si se
 * recuerdan. Ver `FormatoCaptura` y `FormatoGrupo`.
 */

export interface ColumnaFormato { codigo: string; etiqueta: string; incluida: boolean }

export default function OpcionesFormato({
  conMontos, onConMontos, horasExtra, onHorasExtra, columnas, onColumnas, puedeRecordar, recordar, onRecordar,
}: {
  conMontos: boolean;
  onConMontos: (v: boolean) => void;
  horasExtra: boolean;
  onHorasExtra: (v: boolean) => void;
  columnas: ColumnaFormato[];
  onColumnas: (c: ColumnaFormato[]) => void;
  puedeRecordar: boolean;
  recordar: boolean;
  onRecordar: (v: boolean) => void;
}) {
  const incluidas = columnas.filter((c) => c.incluida);

  function mover(i: number, paso: -1 | 1) {
    const j = i + paso;
    if (j < 0 || j >= columnas.length) return;
    const lista = [...columnas];
    [lista[i], lista[j]] = [lista[j], lista[i]];
    onColumnas(lista);
  }

  return (
    <>
      <label className="flex items-start gap-2 text-sm text-gray-800">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={conMontos} onChange={(e) => onConMontos(e.target.checked)} />
        <span>
          Con los montos que ya hay en el período
          <span className="block text-xs text-gray-500">Sin marcar, sale en blanco para llenarlo completo. Una celda vacía al importar no cambia nada.</span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm text-gray-800" data-opcion-horas-extra>
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={horasExtra} onChange={(e) => onHorasExtra(e.target.checked)} />
        <span>
          Incluir las horas extra del 25, 50, 75 y 100 %
          <span className="block text-xs text-gray-500">
            Cuatro columnas antes de las deducciones, en horas (no en Lempiras). En la planilla de este período reemplazan a las horas extra de los marcajes.
          </span>
        </span>
      </label>

      <details className="rounded-lg border border-gray-200 px-3 py-2 text-sm" data-columnas-formato>
        <summary className="cursor-pointer font-medium text-gray-800">Columnas: {incluidas.length} de {columnas.length}</summary>
        <p className="mt-1 text-xs text-gray-500">Marque las que lleva su planilla y póngalas en su orden. Las de ley no van: las calcula la planilla.</p>
        <ul className="mt-2 divide-y divide-gray-100">
          {columnas.map((c, i) => (
            <li key={c.codigo} className="flex items-center gap-2 py-1">
              <input type="checkbox" className="h-4 w-4 shrink-0" aria-label={`Incluir ${c.etiqueta}`} checked={c.incluida}
                onChange={(e) => onColumnas(columnas.map((x, j) => (j === i ? { ...x, incluida: e.target.checked } : x)))} />
              <span className={`min-w-0 flex-1 truncate ${c.incluida ? "text-gray-900" : "text-gray-400"}`}>{c.etiqueta}</span>
              <button type="button" data-toque className="btn btn-ghost btn-sm px-2" aria-label={`Subir ${c.etiqueta}`} disabled={i === 0} onClick={() => mover(i, -1)}>↑</button>
              <button type="button" data-toque className="btn btn-ghost btn-sm px-2" aria-label={`Bajar ${c.etiqueta}`} disabled={i === columnas.length - 1} onClick={() => mover(i, 1)}>↓</button>
            </li>
          ))}
        </ul>
        {puedeRecordar && (
          <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" className="h-4 w-4" checked={recordar} onChange={(e) => onRecordar(e.target.checked)} />
            Recordar estas columnas, su orden y si lleva horas extra para los próximos formatos
          </label>
        )}
      </details>
    </>
  );
}
