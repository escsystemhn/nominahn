"use client";

/**
 * Configuración → Parámetros de ley. Sólo para quien tiene
 * `configuracion.parametros` (por omisión, SUPER_ADMIN).
 *
 * IHSS (EM), IVM, RAP e INFOP se calculan por porcentaje o como un monto fijo
 * mensual igual para todos; las tablas del ISR y del impuesto vecinal se editan
 * tramo por tramo. Las tablas se validan aquí mismo mientras se escriben, con
 * las mismas reglas que aplica el servidor al guardar.
 */

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { derivarCuotasISR, validarTramosISR, validarTramosVecinal } from "@/lib/payroll/tramos";

type Modo = "PORCENTAJE" | "MONTO_FIJO";

interface Concepto {
  codigo: string;
  nombre: string;
  descripcion: string;
  tieneEmpleado: boolean;
  tieneTope: boolean;
  tienePiso: boolean;
  enBase: boolean;
  activo: boolean;
  modo: Modo;
  porcentajeEmpleado: number | null;
  porcentajeEmpleador: number;
  topeMaximo: number | null;
  topeMinimo: number | null;
  montoFijoEmpleado: number | null;
  montoFijoEmpleador: number | null;
  actualizado: string | null;
}

interface Datos {
  conceptos: Concepto[];
  isr: {
    anio: number;
    porDefecto: boolean;
    tramos: Array<{ desde: number; hasta: number | null; cuotaFija: number; porcentaje: number; excedenteDesde: number }>;
  };
  vecinal: {
    municipio: string;
    anio: number;
    porDefecto: boolean;
    tramos: Array<{ desde: number; hasta: number | null; porMillar: number }>;
  };
  empleadosConIhssFijo: number;
}

const campo =
  "w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400";
const etiqueta = "block text-xs font-medium text-gray-700 mb-1";
const tarjeta = "bg-white rounded-xl border border-gray-100 shadow-sm p-5";
const botonPrimario =
  "px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 disabled:opacity-50";

const txt = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
/** "" → null; lo demás a número (el servidor rechaza lo que no lo sea). */
const aNum = (s: string) => (s.trim() === "" ? null : Number(s));

/** Mensaje legible a partir de la respuesta de error de la API. */
function mensajeError(d: { error?: string; errores?: string[]; detalles?: Record<string, string[]> }, nombres: Record<string, string> = {}) {
  if (d.errores?.length) return d.errores.join("\n");
  const campos = d.detalles
    ? Object.entries(d.detalles).map(([k, v]) => `${nombres[k] ?? k}: ${v.join(", ")}`)
    : [];
  return [d.error ?? "No se pudo guardar", ...campos].join("\n");
}

export default function ParametrosLeyConfig() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch("/api/configuracion/parametros");
        const d = await res.json();
        if (!vivo) return;
        if (!res.ok) throw new Error(d.error ?? "No se pudieron cargar los parámetros");
        setDatos(d);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "Error al cargar");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [recarga]);

  if (error) {
    return <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">{error}</div>;
  }
  if (!datos) return <p className="text-sm text-gray-400">Cargando…</p>;

  const recargar = () => setRecarga((r) => r + 1);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-900 space-y-1">
        <p className="font-medium">Estos valores cambian lo que se descuenta a todos los empleados.</p>
        <p>
          Se aplican desde el próximo cálculo de planilla. Las planillas ya calculadas o cerradas conservan sus
          importes; para que una planilla en borrador tome los valores nuevos hay que recalcularla.
        </p>
        {datos.empleadosConIhssFijo > 0 && (
          <p>
            {datos.empleadosConIhssFijo} empleado(s) tienen un IHSS fijo en su ficha: para ellos ese monto prevalece
            sobre lo que se configure aquí en la parte del empleado.
          </p>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold text-gray-800">Aportaciones</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {datos.conceptos.map((c) => (
            <ConceptoCard key={c.codigo} concepto={c} onGuardado={recargar} />
          ))}
        </div>
      </section>

      <TablaISR inicial={datos.isr} onGuardado={recargar} />
      <TablaVecinal inicial={datos.vecinal} onGuardado={recargar} />
    </div>
  );
}

// ─── CONCEPTOS ────────────────────────────────────────────────────────────────

const NOMBRES_CAMPO: Record<string, string> = {
  porcentajeEmpleado: "% empleado",
  porcentajeEmpleador: "% patrono",
  topeMaximo: "Techo",
  topeMinimo: "Piso",
  montoFijoEmpleado: "Monto empleado",
  montoFijoEmpleador: "Monto patrono",
};

function ConceptoCard({ concepto: c, onGuardado }: { concepto: Concepto; onGuardado: () => void }) {
  const [form, setForm] = useState({
    modo: c.modo,
    porcentajeEmpleado: txt(c.porcentajeEmpleado),
    porcentajeEmpleador: txt(c.porcentajeEmpleador),
    topeMaximo: txt(c.topeMaximo),
    topeMinimo: txt(c.topeMinimo),
    montoFijoEmpleado: txt(c.montoFijoEmpleado),
    montoFijoEmpleador: txt(c.montoFijoEmpleador),
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const set = (k: keyof typeof form, v: string) => {
    setOk(false);
    setForm((f) => ({ ...f, [k]: v }));
  };

  async function guardar() {
    setGuardando(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch(`/api/configuracion/parametros/conceptos/${c.codigo}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modo: form.modo,
          porcentajeEmpleado: c.tieneEmpleado ? aNum(form.porcentajeEmpleado) : null,
          porcentajeEmpleador: aNum(form.porcentajeEmpleador),
          topeMaximo: c.tieneTope ? aNum(form.topeMaximo) : null,
          topeMinimo: c.tienePiso ? aNum(form.topeMinimo) : null,
          montoFijoEmpleado: c.tieneEmpleado ? aNum(form.montoFijoEmpleado) : null,
          montoFijoEmpleador: aNum(form.montoFijoEmpleador),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(mensajeError(d, NOMBRES_CAMPO));
      setOk(true);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  const fijo = form.modo === "MONTO_FIJO";

  return (
    <div className={`${tarjeta} space-y-3`} data-concepto={c.codigo}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-800 text-sm">{c.nombre}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{c.descripcion}</p>
        </div>
        {(!c.enBase || !c.activo) && (
          <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px]">
            Valores por defecto
          </span>
        )}
      </div>

      <div className="flex gap-2" role="radiogroup" aria-label={`Cálculo de ${c.codigo}`}>
        {(["PORCENTAJE", "MONTO_FIJO"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={form.modo === m}
            onClick={() => set("modo", m)}
            className={`flex-1 py-1.5 border-2 rounded-lg text-xs font-medium ${
              form.modo === m ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:border-gray-300"
            }`}
          >
            {m === "PORCENTAJE" ? "Porcentaje" : "Monto fijo"}
          </button>
        ))}
      </div>

      {fijo ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {c.tieneEmpleado && (
              <div>
                <label className={etiqueta}>Empleado (L. mensual)</label>
                <input type="number" step="0.01" min="0" value={form.montoFijoEmpleado}
                  onChange={(e) => set("montoFijoEmpleado", e.target.value)} className={campo} name="montoFijoEmpleado" />
              </div>
            )}
            <div>
              <label className={etiqueta}>Patrono (L. mensual)</label>
              <input type="number" step="0.01" min="0" value={form.montoFijoEmpleador}
                onChange={(e) => set("montoFijoEmpleador", e.target.value)} className={campo} name="montoFijoEmpleador" />
            </div>
          </div>
          <p className="text-[11px] text-gray-500">
            Se aplica igual a todos los empleados, sin importar su salario
            {c.tienePiso ? " (también a quien gana menos del piso)" : ""}. En planillas quincenales o semanales se
            prorratea al período. Porcentajes guardados para volver a ese modo:{" "}
            {c.tieneEmpleado ? `${form.porcentajeEmpleado || "—"} % empleado / ` : ""}
            {form.porcentajeEmpleador || "—"} % patrono.
          </p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {c.tieneEmpleado && (
              <div>
                <label className={etiqueta}>Empleado (%)</label>
                <input type="number" step="0.01" min="0" max="100" value={form.porcentajeEmpleado}
                  onChange={(e) => set("porcentajeEmpleado", e.target.value)} className={campo} name="porcentajeEmpleado" />
              </div>
            )}
            <div>
              <label className={etiqueta}>Patrono (%)</label>
              <input type="number" step="0.01" min="0" max="100" value={form.porcentajeEmpleador}
                onChange={(e) => set("porcentajeEmpleador", e.target.value)} className={campo} name="porcentajeEmpleador" />
            </div>
            {c.tienePiso && (
              <div>
                <label className={etiqueta}>Piso de la base (L.)</label>
                <input type="number" step="0.01" min="0" value={form.topeMinimo}
                  onChange={(e) => set("topeMinimo", e.target.value)} className={campo} name="topeMinimo" />
              </div>
            )}
            {c.tieneTope && (
              <div>
                <label className={etiqueta}>Techo de la base (L.)</label>
                <input type="number" step="0.01" min="0" value={form.topeMaximo}
                  onChange={(e) => set("topeMaximo", e.target.value)} className={campo} name="topeMaximo" />
              </div>
            )}
          </div>
          {c.tienePiso && (
            <p className="text-[11px] text-gray-500">
              Cotiza el excedente del salario sobre el piso, hasta el techo. Quien gana el piso o menos no aporta RAP.
            </p>
          )}
        </>
      )}

      {c.codigo === "RESERVA_LABORAL" && (
        // El Art. 6 del Decreto 47-2024 manda deducir el saldo del RAP del auxilio
        // de cesantía. El sistema no lleva ese saldo: decirlo aquí evita pagar dos veces.
        <p className="text-[11px] px-2 py-1.5 rounded-lg bg-amber-50 text-amber-800">
          La liquidación de prestaciones todavía no descuenta el saldo acumulado en el RAP: al liquidar, réstelo
          a mano del auxilio de cesantía con el estado de cuenta del trabajador.
        </p>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-800 whitespace-pre-line">{error}</div>
      )}

      <div className="flex items-center justify-between pt-1">
        <p className="text-[11px] text-gray-400">
          {ok
            ? "✓ Guardado"
            : c.actualizado
              ? `Modificado: ${new Date(c.actualizado).toLocaleString("es-HN")}`
              : ""}
        </p>
        <button onClick={guardar} disabled={guardando} className={botonPrimario}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}

// ─── TABLAS POR TRAMOS ────────────────────────────────────────────────────────

interface FilaISR { desde: string; hasta: string; porcentaje: string; cuotaFija: string; excedenteDesde: string }
interface FilaVecinal { desde: string; hasta: string; porMillar: string }

/** Convierte una fila de texto en números; `hasta` vacío = sin techo. */
const n0 = (s: string) => (s.trim() === "" ? NaN : Number(s));
const nHasta = (s: string) => (s.trim() === "" ? null : Number(s));

function TablaISR({ inicial, onGuardado }: { inicial: Datos["isr"]; onGuardado: () => void }) {
  const [anio, setAnio] = useState(String(inicial.anio));
  const [filas, setFilas] = useState<FilaISR[]>(
    inicial.tramos.map((t) => ({
      desde: txt(t.desde),
      hasta: txt(t.hasta),
      porcentaje: txt(t.porcentaje),
      cuotaFija: txt(t.cuotaFija),
      excedenteDesde: txt(t.excedenteDesde),
    }))
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const numericas = filas.map((f) => ({
    desde: n0(f.desde),
    hasta: nHasta(f.hasta),
    porcentaje: n0(f.porcentaje) / 100,
    cuotaFija: n0(f.cuotaFija),
    excedenteDesde: n0(f.excedenteDesde),
  }));
  const errores = validarTramosISR(numericas);

  // Si se cambia la tasa de un tramo, la cuota fija de los tramos de arriba
  // deja de cuadrar y quienes están en ellos siguen pagando como antes. No se
  // bloquea —la tabla del SAR se copia tal cual y redondea a su manera— pero se
  // avisa con el valor esperado.
  const descuadre = errores.length > 0 ? null : (() => {
    const esperada = derivarCuotasISR(numericas);
    const i = numericas.findIndex(
      (t, j) =>
        Math.abs(t.cuotaFija - esperada[j].cuotaFija) > 0.05 ||
        Math.abs(t.excedenteDesde - esperada[j].excedenteDesde) > 0.05
    );
    return i < 0 ? null : { tramo: i + 1, cuota: esperada[i].cuotaFija, excedente: esperada[i].excedenteDesde };
  })();

  function editar(i: number, k: keyof FilaISR, v: string) {
    setOk(false);
    setFilas((fs) => {
      const copia = fs.map((f) => ({ ...f }));
      copia[i][k] = v;
      // El SAR separa los tramos por un centavo: al fijar el techo de un tramo
      // se propone el inicio del siguiente.
      if (k === "hasta" && copia[i + 1] && v.trim() !== "" && Number.isFinite(Number(v))) {
        copia[i + 1].desde = (Math.round((Number(v) + 0.01) * 100) / 100).toFixed(2);
      }
      return copia;
    });
  }

  function calcularCuotas() {
    setOk(false);
    const derivada = derivarCuotasISR(
      filas.map((f) => ({ desde: n0(f.desde), hasta: nHasta(f.hasta), porcentaje: n0(f.porcentaje) / 100 }))
    );
    setFilas((fs) =>
      fs.map((f, i) => ({
        ...f,
        cuotaFija: derivada[i].cuotaFija.toFixed(2),
        excedenteDesde: derivada[i].excedenteDesde.toFixed(2),
      }))
    );
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch("/api/configuracion/parametros/isr", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anio: Number(anio),
          tramos: filas.map((f) => ({
            desde: aNum(f.desde),
            hasta: nHasta(f.hasta),
            porcentaje: aNum(f.porcentaje),
            cuotaFija: aNum(f.cuotaFija),
            excedenteDesde: aNum(f.excedenteDesde),
          })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(mensajeError(d));
      setOk(true);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className={`${tarjeta} space-y-3`} data-tabla="isr">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-800">Tabla del ISR (anual)</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Tabla progresiva del SAR sobre la renta neta gravable anual. La planilla usa la tabla del año más
            reciente que esté guardado.
          </p>
        </div>
        <div className="w-28">
          <label className={etiqueta}>Año</label>
          <input type="number" value={anio} onChange={(e) => { setOk(false); setAnio(e.target.value); }} className={campo} name="anioISR" />
        </div>
      </div>

      {inicial.porDefecto && (
        <p className="text-xs px-3 py-2 rounded-lg bg-amber-50 text-amber-800">
          No hay tabla guardada: se muestra la tabla 2026 que el sistema usa por defecto.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b">
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Desde (L.)</th>
              <th className="py-2 pr-2 font-medium">Hasta (L.)</th>
              <th className="py-2 pr-2 font-medium">Tasa (%)</th>
              <th className="py-2 pr-2 font-medium">Cuota fija (L.)</th>
              <th className="py-2 pr-2 font-medium">Excedente desde (L.)</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="py-1.5 pr-2 text-xs text-gray-400">{i + 1}</td>
                <td className="py-1.5 pr-2"><input type="number" step="0.01" value={f.desde} onChange={(e) => editar(i, "desde", e.target.value)} className={campo} /></td>
                <td className="py-1.5 pr-2">
                  <input type="number" step="0.01" value={f.hasta} onChange={(e) => editar(i, "hasta", e.target.value)}
                    className={campo} placeholder={i === filas.length - 1 ? "En adelante" : ""} />
                </td>
                <td className="py-1.5 pr-2"><input type="number" step="0.01" value={f.porcentaje} onChange={(e) => editar(i, "porcentaje", e.target.value)} className={campo} /></td>
                <td className="py-1.5 pr-2"><input type="number" step="0.01" value={f.cuotaFija} onChange={(e) => editar(i, "cuotaFija", e.target.value)} className={campo} /></td>
                <td className="py-1.5 pr-2"><input type="number" step="0.01" value={f.excedenteDesde} onChange={(e) => editar(i, "excedenteDesde", e.target.value)} className={campo} /></td>
                <td className="py-1.5 text-right">
                  <button type="button" onClick={() => { setOk(false); setFilas((fs) => fs.filter((_, j) => j !== i)); }}
                    disabled={filas.length <= 1} className="text-xs text-red-600 hover:underline disabled:text-gray-300" aria-label={`Quitar tramo ${i + 1}`}>
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setOk(false); setFilas((fs) => [...fs, { desde: "", hasta: "", porcentaje: "", cuotaFija: "", excedenteDesde: "" }]); }}
          className="px-3 py-1.5 border border-gray-300 text-xs rounded-lg hover:bg-gray-50">
          Agregar tramo
        </button>
        <button type="button" onClick={calcularCuotas}
          className="px-3 py-1.5 border border-blue-200 text-blue-700 text-xs rounded-lg hover:bg-blue-50"
          title="Calcula la cuota fija y el excedente de cada tramo a partir de los rangos y las tasas">
          Calcular cuotas fijas desde las tasas
        </button>
      </div>

      <Avisos errores={errores} error={error} />
      {descuadre && (
        <p className="text-xs px-3 py-2 rounded-lg bg-amber-50 text-amber-800" data-aviso="cuotas">
          Las cuotas fijas no corresponden a las tasas de los tramos anteriores: en el tramo {descuadre.tramo} se
          esperaba cuota {formatCurrency(descuadre.cuota)} y excedente desde {formatCurrency(descuadre.excedente)}. Si
          cambió una tasa, pulse «Calcular cuotas fijas desde las tasas»; si copió la tabla del SAR tal cual, revise
          que coincida con la publicada.
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-400">
          {ok ? "✓ Tabla guardada" : "La cuota fija es el impuesto acumulado de los tramos anteriores."}
        </p>
        <button onClick={guardar} disabled={guardando || errores.length > 0} className={botonPrimario}>
          {guardando ? "Guardando…" : "Guardar tabla ISR"}
        </button>
      </div>
    </section>
  );
}

function TablaVecinal({ inicial, onGuardado }: { inicial: Datos["vecinal"]; onGuardado: () => void }) {
  const [municipio, setMunicipio] = useState(inicial.municipio);
  const [anio, setAnio] = useState(String(inicial.anio));
  const [filas, setFilas] = useState<FilaVecinal[]>(
    inicial.tramos.map((t) => ({ desde: txt(t.desde), hasta: txt(t.hasta), porMillar: txt(t.porMillar) }))
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const errores = validarTramosVecinal(
    filas.map((f) => ({ desde: n0(f.desde), hasta: nHasta(f.hasta), porMillar: n0(f.porMillar) }))
  );

  function editar(i: number, k: keyof FilaVecinal, v: string) {
    setOk(false);
    setFilas((fs) => {
      const copia = fs.map((f) => ({ ...f }));
      copia[i][k] = v;
      // En el vecinal el siguiente tramo empieza exactamente donde acaba éste.
      if (k === "hasta" && copia[i + 1] && v.trim() !== "") copia[i + 1].desde = v;
      return copia;
    });
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch("/api/configuracion/parametros/vecinal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          municipio,
          anio: Number(anio),
          tramos: filas.map((f) => ({ desde: aNum(f.desde), hasta: nHasta(f.hasta), porMillar: aNum(f.porMillar) })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(mensajeError(d));
      setOk(true);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  // Ejemplo para que el administrador compruebe la tabla contra el Plan de Arbitrios.
  const ejemplo = 180000;
  const impuestoEjemplo = errores.length > 0 ? null : filas.reduce((total, f) => {
    const desde = Number(f.desde);
    const techo = f.hasta.trim() === "" ? ejemplo : Math.min(ejemplo, Number(f.hasta));
    const porcion = techo - desde;
    return porcion > 0 ? total + (porcion / 1000) * Number(f.porMillar) : total;
  }, 0);

  return (
    <section className={`${tarjeta} space-y-3`} data-tabla="vecinal">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-800">Impuesto personal o vecinal</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Tabla del Plan de Arbitrios del municipio: cada porción del ingreso anual paga la tarifa por millar de su
            tramo. La base son los ingresos totales, sin deducciones.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="w-44">
            <label className={etiqueta}>Municipio</label>
            <input value={municipio} onChange={(e) => { setOk(false); setMunicipio(e.target.value); }} className={campo} name="municipio" />
          </div>
          <div className="w-24">
            <label className={etiqueta}>Año</label>
            <input type="number" value={anio} onChange={(e) => { setOk(false); setAnio(e.target.value); }} className={campo} name="anioVecinal" />
          </div>
        </div>
      </div>

      {inicial.porDefecto && (
        <p className="text-xs px-3 py-2 rounded-lg bg-amber-50 text-amber-800">
          No hay tabla guardada: se muestra la de San Pedro Sula que el sistema usa por defecto.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm max-w-2xl">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b">
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Desde (L. anual)</th>
              <th className="py-2 pr-2 font-medium">Hasta (L. anual)</th>
              <th className="py-2 pr-2 font-medium">Tarifa (L. por millar)</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="py-1.5 pr-2 text-xs text-gray-400">{i + 1}</td>
                <td className="py-1.5 pr-2"><input type="number" step="0.01" value={f.desde} onChange={(e) => editar(i, "desde", e.target.value)} className={campo} /></td>
                <td className="py-1.5 pr-2">
                  <input type="number" step="0.01" value={f.hasta} onChange={(e) => editar(i, "hasta", e.target.value)}
                    className={campo} placeholder={i === filas.length - 1 ? "En adelante" : ""} />
                </td>
                <td className="py-1.5 pr-2"><input type="number" step="0.01" value={f.porMillar} onChange={(e) => editar(i, "porMillar", e.target.value)} className={campo} /></td>
                <td className="py-1.5 text-right">
                  <button type="button" onClick={() => { setOk(false); setFilas((fs) => fs.filter((_, j) => j !== i)); }}
                    disabled={filas.length <= 1} className="text-xs text-red-600 hover:underline disabled:text-gray-300" aria-label={`Quitar tramo ${i + 1}`}>
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" onClick={() => { setOk(false); setFilas((fs) => [...fs, { desde: fs[fs.length - 1]?.hasta ?? "", hasta: "", porMillar: "" }]); }}
        className="px-3 py-1.5 border border-gray-300 text-xs rounded-lg hover:bg-gray-50">
        Agregar tramo
      </button>

      <Avisos errores={errores} error={error} />

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-400">
          {ok
            ? "✓ Tabla guardada; este municipio queda como el vigente"
            : impuestoEjemplo !== null
              ? `Ejemplo: un ingreso anual de ${formatCurrency(ejemplo)} paga ${formatCurrency(Math.round(impuestoEjemplo * 100) / 100)} al año.`
              : ""}
        </p>
        <button onClick={guardar} disabled={guardando || errores.length > 0} className={botonPrimario}>
          {guardando ? "Guardando…" : "Guardar tabla vecinal"}
        </button>
      </div>
    </section>
  );
}

function Avisos({ errores, error }: { errores: string[]; error: string | null }) {
  if (errores.length === 0 && !error) return null;
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 space-y-0.5 whitespace-pre-line">
      {error && <p>{error}</p>}
      {errores.map((e) => <p key={e}>• {e}</p>)}
    </div>
  );
}
