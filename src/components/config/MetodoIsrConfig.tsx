"use client";

/**
 * Configuración → Parámetros de ley → Método de cálculo del ISR.
 *
 * ESTÁNDAR anualiza el mes. CÁLCULO PERSONALIZADO replica la hoja «Retención en
 * la fuente»: proyecta el año con lo pagado, promedia las comisiones y descuenta
 * lo ya retenido. Para empresas que empiezan a mitad de año, los meses anteriores
 * se importan de esa misma hoja.
 */

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";

type Metodo = "ESTANDAR" | "PERSONALIZADO";
interface TramoEdad { desdeEdad: number; monto: number }
interface Config { deduccionPorEdad: TramoEdad[]; deducirIvm: boolean; deducirRap: boolean; deducirAfp: boolean }
interface Estado { metodo: Metodo; personalizado: Config; acumulados: { anio: number; meses: number; empleados: number }[] }
interface FilaVista {
  fila: number; nombre: string; rtn: string; coincidencia: "RTN" | "IDENTIDAD" | "NOMBRE" | null;
  empleado: { id: string; codigo: string; nombre: string } | null;
  meses: { mes: number; sueldo: number; variables: number; isrRetenido: number }[];
  totalRetenido: number;
}
interface Vista { hoja: string; anio: number | null; mesArchivo: number | null; hastaMes: number; filas: FilaVista[]; avisos: string[]; sinEmpleado: number }

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const COINCIDENCIA = { RTN: "RTN", IDENTIDAD: "Identidad", NOMBRE: "Nombre" } as const;

async function error(r: Response) {
  const d = await r.json().catch(() => ({}));
  return d.error ?? "No se pudo completar la operación.";
}

export default function MetodoIsrConfig() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [form, setForm] = useState<{ metodo: Metodo; personalizado: Config } | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await fetch("/api/configuracion/parametros/isr-metodo", { cache: "no-store" });
      if (!vivo) return;
      if (!r.ok) { setAviso({ ok: false, texto: await error(r) }); return; }
      const d: Estado = await r.json();
      setEstado(d);
      setForm({ metodo: d.metodo, personalizado: d.personalizado });
    })();
    return () => { vivo = false; };
  }, [recarga]);

  if (!estado || !form) return <section className="panel p-5 text-sm text-gray-500">Cargando el método del ISR…</section>;

  const p = form.personalizado;
  const setP = (c: Partial<Config>) => setForm({ ...form, personalizado: { ...p, ...c } });
  const setTramo = (i: number, c: Partial<TramoEdad>) => setP({ deduccionPorEdad: p.deduccionPorEdad.map((t, j) => (j === i ? { ...t, ...c } : t)) });

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    const r = await fetch("/api/configuracion/parametros/isr-metodo", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    setGuardando(false);
    setAviso(r.ok ? { ok: true, texto: "Método del ISR guardado. Se aplica desde la próxima planilla que se calcule." } : { ok: false, texto: await error(r) });
    if (r.ok) setRecarga((x) => x + 1);
  }

  return (
    <section className="panel space-y-5 p-5" data-seccion="metodo-isr">
      <div>
        <h2 className="font-semibold text-gray-800">Método de cálculo del ISR</h2>
        <p className="mt-1 text-sm text-gray-600">Cómo se calcula la retención mensual del impuesto sobre la renta de cada empleado.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Método de cálculo del ISR">
        {([
          ["ESTANDAR", "Estándar", "Anualiza el ingreso del período (salario, horas extra y bonos × 12), resta IHSS, RAP, AFP y L40,000 de gastos médicos, y retiene el ISR anual ÷ 12 cada mes."],
          ["PERSONALIZADO", "Cálculo personalizado", "Como la hoja «Retención en la fuente»: proyecta el año con los sueldos realmente pagados, el promedio de comisiones × 12 y las deducciones de abajo, y reparte lo que falta por retener entre los meses que quedan."],
        ] as const).map(([valor, titulo, texto]) => (
          <label key={valor} className={`cursor-pointer rounded-lg border-2 p-4 ${form.metodo === valor ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
            <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <input type="radio" name="metodo-isr" value={valor} checked={form.metodo === valor} onChange={() => setForm({ ...form, metodo: valor })} />
              {titulo}
            </span>
            <span className="mt-1 block text-xs text-gray-600">{texto}</span>
          </label>
        ))}
      </div>

      {form.metodo === "PERSONALIZADO" && (
        <div className="space-y-4 rounded-lg border border-gray-200 p-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Gastos médicos según la edad</h3>
            <p className="text-xs text-gray-500">
              Deducción anual. Los valores de fábrica son los de la fórmula de la hoja (L40,000; L70,000 desde los 60;
              L460,000 desde los 65). La tabla oculta de esa misma hoja dice otra cosa: confírmelos con su contador.
            </p>
            <table className="table-base mt-2 max-w-md">
              <thead><tr><th>Desde la edad</th><th className="num">Deducción anual (L)</th><th /></tr></thead>
              <tbody>
                {p.deduccionPorEdad.map((t, i) => (
                  <tr key={i}>
                    <td><input type="number" min={0} max={120} className="input w-24" aria-label="Desde la edad" value={t.desdeEdad}
                      disabled={t.desdeEdad === 0 && i === 0} onChange={(e) => setTramo(i, { desdeEdad: Number(e.target.value) })} /></td>
                    <td className="num"><input type="number" min={0} step="0.01" className="input w-36 text-right" aria-label="Deducción anual" value={t.monto}
                      onChange={(e) => setTramo(i, { monto: Number(e.target.value) })} /></td>
                    <td>{i > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setP({ deduccionPorEdad: p.deduccionPorEdad.filter((_, j) => j !== i) })}>Quitar</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {p.deduccionPorEdad.length < 10 && (
              <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={() => setP({ deduccionPorEdad: [...p.deduccionPorEdad, { desdeEdad: 70, monto: 0 }] })}>Agregar tramo</button>
            )}
          </div>
          <div className="space-y-1.5 text-sm text-gray-800">
            <label className="flex items-center gap-2"><input type="checkbox" checked={p.deducirIvm} onChange={(e) => setP({ deducirIvm: e.target.checked })} />
              Restar el IVM del IHSS (techo × % del empleado por cada mes con sueldo, como la hoja)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={p.deducirAfp} onChange={(e) => setP({ deducirAfp: e.target.checked })} />
              Restar la AFP del empleado</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={p.deducirRap} onChange={(e) => setP({ deducirRap: e.target.checked })} />
              Restar el RAP del empleado (la hoja tiene la columna, pero vacía)</label>
          </div>
        </div>
      )}

      {aviso && <p className={`text-sm ${aviso.ok ? "text-green-700" : "text-red-700"}`} role={aviso.ok ? "status" : "alert"}>{aviso.texto}</p>}
      <button type="button" className="btn btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar método del ISR"}</button>

      {form.metodo === "PERSONALIZADO" && <Acumulados acumulados={estado.acumulados} onCambio={() => setRecarga((x) => x + 1)} />}
    </section>
  );
}

function Acumulados({ acumulados, onCambio }: { acumulados: Estado["acumulados"]; onCambio: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<Vista | null>(null);
  const [anio, setAnio] = useState<number>(new Date().getFullYear());
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  async function leer(hastaMes?: number) {
    if (!archivo) return;
    setOcupado(true);
    setAviso(null);
    const fd = new FormData();
    fd.append("archivo", archivo);
    if (hastaMes) fd.append("hastaMes", String(hastaMes));
    const r = await fetch("/api/configuracion/parametros/isr-acumulados", { method: "POST", body: fd });
    setOcupado(false);
    if (!r.ok) { setVista(null); setAviso({ ok: false, texto: await error(r) }); return; }
    const d: Vista = await r.json();
    setVista(d);
    if (d.anio) setAnio(d.anio);
  }

  async function importar() {
    if (!vista) return;
    const filas = vista.filas.filter((f) => f.empleado && f.meses.length).map((f) => ({ empleadoId: f.empleado!.id, meses: f.meses }));
    setOcupado(true);
    const r = await fetch("/api/configuracion/parametros/isr-acumulados", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anio, filas }),
    });
    setOcupado(false);
    if (!r.ok) { setAviso({ ok: false, texto: await error(r) }); return; }
    const d = await r.json();
    setAviso({ ok: true, texto: `Importados ${d.meses} meses de ${d.empleados} empleado(s) para ${d.anio}.` });
    setVista(null);
    setArchivo(null);
    onCambio();
  }

  async function borrar(a: number) {
    if (!confirm(`¿Borrar los acumulados importados de ${a}? El cálculo personalizado dejará de contar esos meses.`)) return;
    const r = await fetch(`/api/configuracion/parametros/isr-acumulados?anio=${a}`, { method: "DELETE" });
    setAviso(r.ok ? { ok: true, texto: `Acumulados de ${a} borrados.` } : { ok: false, texto: await error(r) });
    if (r.ok) onCambio();
  }

  const conEmpleado = vista?.filas.filter((f) => f.empleado && f.meses.length) ?? [];

  return (
    <div className="space-y-3 border-t border-gray-200 pt-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Meses anteriores pagados fuera de NominaHN</h3>
        <p className="text-xs text-gray-500">
          El cálculo personalizado necesita lo pagado y lo retenido desde enero. Si la empresa empezó a usar NominaHN
          a mitad de año, importe esos meses desde la hoja «Retención en la fuente» (.xlsx, hoja DATOS). Un mes
          importado reemplaza a las planillas de ese mes en el cálculo.
        </p>
      </div>

      {acumulados.length > 0 && (
        <ul className="text-sm text-gray-700">
          {acumulados.map((a) => (
            <li key={a.anio} className="flex items-center gap-3">
              <span>{a.anio}: {a.meses} meses de {a.empleados} empleado(s)</span>
              <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => borrar(a.anio)}>Borrar</button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".xlsx" aria-label="Hoja de retención en la fuente" className="text-sm"
          onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setVista(null); }} />
        <button type="button" className="btn btn-secondary btn-sm" disabled={!archivo || ocupado} onClick={() => leer()}>
          {ocupado && !vista ? "Leyendo…" : "Leer archivo"}
        </button>
      </div>

      {vista && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Hoja «{vista.hoja}», {vista.anio ?? "año sin indicar"}
            {vista.mesArchivo ? `, calculada a ${MESES[vista.mesArchivo - 1]}` : ""}. Se importan los meses de enero a{" "}
            <select aria-label="Importar hasta el mes" className="input inline-block w-auto" value={vista.hastaMes} onChange={(e) => leer(Number(e.target.value))}>
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            {" "}del año{" "}
            <input type="number" aria-label="Año" className="input inline-block w-24" value={anio} onChange={(e) => setAnio(Number(e.target.value))} />.
          </p>
          {vista.mesArchivo && vista.hastaMes >= vista.mesArchivo && (
            <p className="text-xs text-amber-700">Desde {MESES[vista.mesArchivo - 1]} la hoja tiene proyecciones, no lo retenido: impórtelos sólo si ya se pagaron así.</p>
          )}
          {vista.avisos.map((a) => <p key={a} className="text-xs text-amber-700">{a}</p>)}
          {vista.sinEmpleado > 0 && (
            <p className="text-xs text-red-700">{vista.sinEmpleado} fila(s) no coinciden con ningún empleado por RTN, identidad ni nombre: no se importarán.</p>
          )}
          <div className="max-h-80 overflow-auto rounded-lg border border-gray-200">
            <table className="table-base text-xs">
              <thead><tr><th>Fila</th><th>En el archivo</th><th>RTN</th><th>Empleado en NominaHN</th><th>Por</th><th className="num">Meses</th><th className="num">ISR retenido</th></tr></thead>
              <tbody>
                {vista.filas.map((f) => (
                  <tr key={f.fila} className={f.empleado ? "" : "bg-red-50"}>
                    <td>{f.fila}</td>
                    <td>{f.nombre}</td>
                    <td className="font-mono">{f.rtn || "—"}</td>
                    <td>{f.empleado ? `${f.empleado.nombre} (${f.empleado.codigo})` : <span className="text-red-700">Sin coincidencia</span>}</td>
                    <td>{f.coincidencia ? COINCIDENCIA[f.coincidencia] : ""}</td>
                    <td className="num">{f.meses.length}</td>
                    <td className="num">{formatCurrency(f.totalRetenido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-primary" disabled={ocupado || conEmpleado.length === 0} onClick={importar}>
            Importar {conEmpleado.length} empleado(s)
          </button>
        </div>
      )}

      {aviso && <p className={`text-sm ${aviso.ok ? "text-green-700" : "text-red-700"}`} role={aviso.ok ? "status" : "alert"}>{aviso.texto}</p>}
    </div>
  );
}
