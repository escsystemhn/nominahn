"use client";

/**
 * Descargar el formato de captura de TODO un grupo (2026-11-27, pedido de Edbin): un solo
 * Excel con una hoja por tipo de planilla (Quincenal y Mensual) y las sucursales del grupo
 * una debajo de otra. Se elige el mes y la quincena: la hoja quincenal es de esa quincena
 * y la mensual, del mes completo. Se sube entero por Importar → Montos del período.
 *
 * Es una opción más de Deducciones → Exportar: el formato por sucursal sigue igual. Las
 * columnas y su orden son las mismas (el formato de la empresa).
 */

import { useEffect, useState } from "react";
import { Campo, Modal } from "@/components/ui/ModalForm";
import OpcionesFormato, { type ColumnaFormato } from "@/components/payroll/OpcionesFormato";
import { etiquetaPeriodo, periodoQueContiene, rangoPeriodo, type PeriodoPlanilla } from "@/lib/payroll/periodos-planilla";

type Frecuencia = "QUINCENAL" | "MENSUAL";
interface Grupo { id: string; nombre: string; quincenal: number; mensual: number; sucursales: number }
interface Opciones {
  etiquetas: { grupo: string; sucursal: string; sucursales: string };
  grupos: Grupo[];
  columnas: ColumnaFormato[];
  horasExtra: boolean;
  puedeRecordar: boolean;
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const dos = (n: number) => String(n).padStart(2, "0");
const empleadosTexto = (n: number) => (n === 1 ? "1 empleado" : `${n} empleados`);

export default function FormatoGrupo({ fechaInicial, encabezado, onCerrar }: {
  /** AAAA-MM-DD: el mes y la quincena con que arranca (la del período que se estaba viendo). */
  fechaInicial: string;
  /** Lo que va arriba: la elección entre este formato, el de sucursal y la lista de empleados. */
  encabezado: React.ReactNode;
  onCerrar: () => void;
}) {
  const [opciones, setOpciones] = useState<Opciones | null>(null);
  const [anio, setAnio] = useState(Number(fechaInicial.slice(0, 4)));
  const [mes, setMes] = useState(Number(fechaInicial.slice(5, 7)));
  const [quincena, setQuincena] = useState<1 | 2>(Number(fechaInicial.slice(8, 10)) <= 15 ? 1 : 2);
  const [grupoId, setGrupoId] = useState("");
  const [frecuencias, setFrecuencias] = useState<ReadonlySet<Frecuencia>>(new Set<Frecuencia>(["QUINCENAL", "MENSUAL"]));
  const [columnas, setColumnas] = useState<ColumnaFormato[]>([]);
  const [conMontos, setConMontos] = useState(true);
  const [horasExtra, setHorasExtra] = useState(false);
  const [recordar, setRecordar] = useState(true);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch("/api/exportar/deducciones/formato-grupo", { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) throw new Error(d.error ?? "No se pudieron cargar los grupos.");
        const o = d as Opciones;
        setOpciones(o);
        setColumnas(o.columnas);
        setHorasExtra(!!o.horasExtra);
        setGrupoId(o.grupos[0]?.id ?? "");
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudieron cargar los grupos.");
      }
    })();
    return () => { vivo = false; };
  }, []);

  const aaaamm = `${anio}-${dos(mes)}`;
  const grupo = opciones?.grupos.find((g) => g.id === grupoId) ?? null;
  const hojas: Array<{ tipo: Frecuencia; etiqueta: string; periodo: PeriodoPlanilla; empleados: number }> = [
    { tipo: "QUINCENAL", etiqueta: "Quincenal", periodo: periodoQueContiene("QUINCENAL", `${aaaamm}-${quincena === 1 ? "01" : "16"}`), empleados: grupo?.quincenal ?? 0 },
    { tipo: "MENSUAL", etiqueta: "Mensual", periodo: periodoQueContiene("MENSUAL", `${aaaamm}-01`), empleados: grupo?.mensual ?? 0 },
  ];
  const elegidas = hojas.filter((h) => frecuencias.has(h.tipo) && h.empleados > 0);
  const empleados = elegidas.reduce((n, h) => n + h.empleados, 0);
  const incluidas = columnas.filter((c) => c.incluida);
  const puede = !!grupo && elegidas.length > 0 && (incluidas.length > 0 || horasExtra);
  const hoy = new Date().getFullYear();
  const anios = [hoy - 2, hoy - 1, hoy, hoy + 1].filter((a, i, l) => l.indexOf(a) === i);
  if (!anios.includes(anio)) anios.unshift(anio);

  function alternar(tipo: Frecuencia) {
    const nuevo = new Set(frecuencias);
    if (!nuevo.delete(tipo)) nuevo.add(tipo);
    setFrecuencias(nuevo);
  }

  async function descargar() {
    if (!grupo) return;
    setCargando(true);
    setError(null);
    try {
      const r = await fetch("/api/exportar/deducciones/formato-grupo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grupoId: grupo.id, mes: aaaamm, quincena,
          frecuencias: elegidas.map((h) => h.tipo),
          columnas: incluidas.map((c) => c.codigo),
          conMontos, horasExtra, recordar: !!opciones?.puedeRecordar && recordar,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? "No se pudo generar el formato. Intente de nuevo.");
      }
      const nombre = /filename="?([^";]+)/i.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "deducciones_grupo.xlsx";
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

  const et = opciones?.etiquetas ?? { grupo: "Grupo", sucursal: "Sucursal", sucursales: "Sucursales" };
  return (
    <Modal titulo="Exportar deducciones" error={error} cargando={cargando} puedeGuardar={puede} onCerrar={onCerrar} onGuardar={() => void descargar()}
      textoGuardar={`Descargar formato (${empleadosTexto(empleados)})`}>
      {encabezado}

      <div className="grid grid-cols-2 gap-3" data-formato-grupo-periodo={`${aaaamm}|${quincena}`}>
        <Campo etiqueta="Mes">
          <select className="input" value={mes} onChange={(e) => setMes(Number(e.target.value))} aria-label="Mes">
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Año">
          <select className="input" value={anio} onChange={(e) => setAnio(Number(e.target.value))} aria-label="Año">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Campo>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-gray-800">Quincena</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {([1, 2] as const).map((q) => (
            <label key={q} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-gray-900">
              <input type="radio" name="formato-grupo-quincena" className="h-4 w-4" checked={quincena === q} onChange={() => setQuincena(q)} />
              {q === 1 ? "1.ª quincena (del 1 al 15)" : "2.ª quincena (del 16 al fin de mes)"}
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500">La hoja mensual es del mes completo.</p>
      </fieldset>

      {opciones === null && !error && <p className="text-sm text-gray-500">Cargando grupos…</p>}
      {opciones && opciones.grupos.length === 0 && (
        <p className="text-sm text-gray-600">En su alcance no hay empleados en planilla quincenal ni mensual.</p>
      )}

      {opciones && opciones.grupos.length > 0 && (
        <>
          <Campo etiqueta={et.grupo}>
            <select className="input" value={grupoId} onChange={(e) => setGrupoId(e.target.value)} aria-label={et.grupo}>
              {opciones.grupos.map((g) => (
                <option key={g.id} value={g.id}>{g.nombre} · {g.sucursales} {(g.sucursales === 1 ? et.sucursal : et.sucursales).toLowerCase()}</option>
              ))}
            </select>
          </Campo>

          <div role="group" aria-labelledby="formato-grupo-hojas" className="space-y-1" data-hojas-grupo>
            <span id="formato-grupo-hojas" className="text-sm font-medium text-gray-800">Hojas del libro</span>
            <div className="divide-y divide-gray-200 rounded-lg border border-gray-300">
              {hojas.map((h) => (
                <label key={h.tipo} className={`flex min-h-11 items-start gap-2.5 px-3 py-2 text-sm ${h.empleados ? "cursor-pointer text-gray-900 hover:bg-gray-50" : "text-gray-400"}`} data-hoja={h.tipo}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300" disabled={!h.empleados}
                    checked={!!h.empleados && frecuencias.has(h.tipo)} onChange={() => alternar(h.tipo)} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{h.etiqueta}</span>: {etiquetaPeriodo(h.periodo)}
                    <span className="block text-xs text-gray-500">
                      {rangoPeriodo(h.periodo.desde, h.periodo.hasta)}, {h.empleados ? empleadosTexto(h.empleados) : "nadie en esta planilla"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <OpcionesFormato
            conMontos={conMontos} onConMontos={setConMontos} horasExtra={horasExtra} onHorasExtra={setHorasExtra}
            columnas={columnas} onColumnas={setColumnas} puedeRecordar={opciones.puedeRecordar} recordar={recordar} onRecordar={setRecordar} />

          <p className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Una hoja por planilla, con todas las {et.sucursales.toLowerCase()} una debajo de otra: cada una con sus departamentos y su total, y
            al final el total general. Súbalo entero en Importar → Montos del período: cada hoja se aplica a su período. La descarga queda
            registrada en la auditoría.
          </p>
        </>
      )}
    </Modal>
  );
}
