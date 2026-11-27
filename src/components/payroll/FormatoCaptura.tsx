"use client";

/**
 * Descargar el formato de captura de deducciones de una sucursal: los empleados por
 * departamento, como la planilla de la empresa, para escribir los montos a mano y
 * volver a importarlo. Ver `lib/importacion/formato-captura.ts`.
 *
 * Se elige el período, la sucursal, sus departamentos (todos marcados), si lleva las horas
 * extra del período (antes de las deducciones) y las columnas.
 * Las columnas y su orden quedan como el formato de la empresa si quien descarga puede
 * configurar deducciones.
 */

import { useEffect, useMemo, useState } from "react";
import { Campo, Modal } from "@/components/ui/ModalForm";
import SelectorPeriodo from "@/components/payroll/SelectorPeriodo";
import OpcionesFormato, { type ColumnaFormato as Columna } from "@/components/payroll/OpcionesFormato";
import { errorDePeriodo, frasePeriodo, type PeriodoPlanilla } from "@/lib/payroll/periodos-planilla";

interface Unidad {
  sucursalId: string;
  divisionId: string | null;
  grupo: string;
  nombre: string;
  departamentos: Array<{ id: string; nombre: string; empleados: number }>;
}
interface Opciones {
  etiquetas: { grupo: string; sucursal: string };
  unidades: Unidad[];
  columnas: Columna[];
  /** Lo recordado: si el formato lleva las horas extra. */
  horasExtra: boolean;
  puedeRecordar: boolean;
}

const clave = (u: Pick<Unidad, "sucursalId" | "divisionId">) => `${u.sucursalId}|${u.divisionId ?? ""}`;

export default function FormatoCaptura({ titulo, periodo, onPeriodo, encabezado, onCerrar }: {
  titulo: string;
  periodo: PeriodoPlanilla;
  onPeriodo: (p: PeriodoPlanilla) => void;
  /** Lo que va arriba: la elección entre este formato y la lista de empleados. */
  encabezado: React.ReactNode;
  onCerrar: () => void;
}) {
  // Las opciones son de un tipo de planilla: al cambiarlo, hasta que lleguen las nuevas, no hay.
  const [cargadas, setCargadas] = useState<{ tipo: string; o: Opciones } | null>(null);
  const opciones = cargadas?.tipo === periodo.tipo ? cargadas.o : null;
  const [unidad, setUnidad] = useState("");
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const [columnas, setColumnas] = useState<Columna[]>([]);
  const [conMontos, setConMontos] = useState(true);
  const [horasExtra, setHorasExtra] = useState(false);
  const [recordar, setRecordar] = useState(true);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorPeriodo = errorDePeriodo(periodo);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(`/api/exportar/deducciones/formato?tipoPlanilla=${periodo.tipo}`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) throw new Error(d.error ?? "No se pudieron cargar las sucursales.");
        const o = d as Opciones;
        setCargadas({ tipo: periodo.tipo, o });
        setColumnas(o.columnas);
        setHorasExtra(!!o.horasExtra);
        const primera = o.unidades[0];
        setUnidad(primera ? clave(primera) : "");
        setMarcados(new Set(primera?.departamentos.map((x) => x.id) ?? []));
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudieron cargar las sucursales.");
      }
    })();
    return () => { vivo = false; };
  }, [periodo.tipo]);

  const elegida = opciones?.unidades.find((u) => clave(u) === unidad) ?? null;
  const empleados = useMemo(
    () => (elegida?.departamentos ?? []).filter((d) => marcados.has(d.id)).reduce((n, d) => n + d.empleados, 0),
    [elegida, marcados],
  );
  const incluidas = columnas.filter((c) => c.incluida);
  // Grupos para el selector: con la estructura de grupos, cada uno con sus sucursales.
  const porGrupo = useMemo(() => {
    const m = new Map<string, Unidad[]>();
    for (const u of opciones?.unidades ?? []) m.set(u.grupo, [...(m.get(u.grupo) ?? []), u]);
    return [...m.entries()];
  }, [opciones]);

  function elegirUnidad(k: string) {
    setUnidad(k);
    const u = opciones?.unidades.find((x) => clave(x) === k);
    setMarcados(new Set(u?.departamentos.map((x) => x.id) ?? []));
  }

  function alternar(id: string) {
    const nuevo = new Set(marcados);
    if (!nuevo.delete(id)) nuevo.add(id);
    setMarcados(nuevo);
  }

  async function descargar() {
    if (!elegida) return;
    setCargando(true);
    setError(null);
    try {
      const r = await fetch("/api/exportar/deducciones/formato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipoPlanilla: periodo.tipo, desde: periodo.desde, hasta: periodo.hasta,
          sucursalId: elegida.sucursalId, divisionId: elegida.divisionId,
          departamentoIds: elegida.departamentos.filter((d) => marcados.has(d.id)).map((d) => d.id),
          columnas: incluidas.map((c) => c.codigo),
          conMontos, horasExtra, recordar: !!opciones?.puedeRecordar && recordar,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? "No se pudo generar el formato. Intente de nuevo.");
      }
      const nombre = /filename="?([^";]+)/i.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "deducciones.xlsx";
      const enlace = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = enlace;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(enlace);
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el formato. Intente de nuevo.");
      setCargando(false);
    }
  }

  const et = opciones?.etiquetas ?? { grupo: "Grupo", sucursal: "Sucursal" };
  const puede = !!elegida && marcados.size > 0 && (incluidas.length > 0 || horasExtra) && !errorPeriodo;
  return (
    <Modal titulo={titulo} error={error ?? errorPeriodo} cargando={cargando} puedeGuardar={puede} onCerrar={onCerrar} onGuardar={() => void descargar()}
      textoGuardar={empleados === 1 ? "Descargar formato (1 empleado)" : `Descargar formato (${empleados} empleados)`}>
      {encabezado}
      <div className="space-y-1" data-periodo={`${periodo.desde}|${periodo.hasta}`}>
        <SelectorPeriodo id="formato-captura-periodo" valor={periodo} onCambio={onPeriodo} />
        {!errorPeriodo && <p className="text-xs text-gray-500">Montos que se descuentan {frasePeriodo(periodo, "en")}.</p>}
      </div>

      {opciones === null && !error && <p className="text-sm text-gray-500">Cargando sucursales…</p>}
      {opciones && opciones.unidades.length === 0 && (
        <p className="text-sm text-gray-600">Ninguna {et.sucursal.toLowerCase()} de su alcance tiene empleados en este tipo de planilla.</p>
      )}

      {opciones && opciones.unidades.length > 0 && (
        <>
          <Campo etiqueta={et.sucursal}>
            <select className="input" value={unidad} onChange={(e) => elegirUnidad(e.target.value)} aria-label={et.sucursal}>
              {porGrupo.map(([grupo, us]) => (
                <optgroup key={grupo} label={`${et.grupo}: ${grupo}`}>
                  {us.map((u) => <option key={clave(u)} value={clave(u)}>{u.nombre}</option>)}
                </optgroup>
              ))}
            </select>
          </Campo>

          {elegida && (
            <div role="group" aria-labelledby="formato-deptos" className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <span id="formato-deptos" className="text-sm font-medium text-gray-800">
                  Departamentos ({marcados.size} de {elegida.departamentos.length})
                </span>
                <button type="button" className="-my-1 py-1 text-sm font-medium text-blue-700 hover:underline"
                  onClick={() => setMarcados(marcados.size === elegida.departamentos.length ? new Set() : new Set(elegida.departamentos.map((d) => d.id)))}>
                  {marcados.size === elegida.departamentos.length ? "Quitar todos" : "Marcar todos"}
                </button>
              </div>
              <div className="mt-1 max-h-44 divide-y divide-gray-200 overflow-y-auto rounded-lg border border-gray-300">
                {elegida.departamentos.map((d) => (
                  <label key={d.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-50">
                    <input type="checkbox" className="h-4 w-4 shrink-0 rounded border-gray-300" checked={marcados.has(d.id)} onChange={() => alternar(d.id)} />
                    <span className="min-w-0 flex-1 truncate">{d.nombre}</span>
                    <span className="shrink-0 text-xs text-gray-500">{d.empleados === 1 ? "1 empleado" : `${d.empleados} empleados`}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <OpcionesFormato
            conMontos={conMontos} onConMontos={setConMontos} horasExtra={horasExtra} onHorasExtra={setHorasExtra}
            columnas={columnas} onColumnas={setColumnas} puedeRecordar={opciones.puedeRecordar} recordar={recordar} onRecordar={setRecordar} />

          <p className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Los empleados van por departamento y ordenados por código, que es la referencia al importar. La hoja va protegida: sólo se escriben las cantidades.
            Llénela y súbala en Importar → Montos del período. La descarga queda registrada en la auditoría.
          </p>
        </>
      )}
    </Modal>
  );
}
