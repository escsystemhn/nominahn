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
import EstadoBadge from "@/components/ui/EstadoBadge";
import MetodoIsrConfig from "./MetodoIsrConfig";
import DistribucionQuincenalConfig from "./DistribucionQuincenalConfig";
import RapMesVencidoConfig from "./RapMesVencidoConfig";
import { ETIQUETA_MODO_QUINCENAL, type DistribucionQuincenal } from "@/lib/payroll/distribucion-quincenal";
import { leerMonto } from "@/lib/formato/monto-texto";

/**
 * Lo más que se le descuenta al trabajador al mes por un concepto: el monto fijo, o
 * el porcentaje sobre el techo. Son los valores que de verdad aplica el motor (la
 * API ya devuelve los de omisión cuando el concepto no está configurado).
 */
function maximoEmpleado(c: Concepto | undefined): number | null {
  if (!c) return null;
  if (c.modo === "MONTO_FIJO") return c.montoFijoEmpleado ?? 0;
  if (c.topeMaximo === null || c.porcentajeEmpleado === null) return null;
  // La API da el porcentaje como 2.5, no como 0.025.
  return Math.round(c.topeMaximo * c.porcentajeEmpleado) / 100;
}

/** IHSS máximo mensual del trabajador: Enfermedad y Maternidad + IVM. */
function ihssMaximo(conceptos: Concepto[]): { em: number; ivm: number; total: number } | null {
  const em = maximoEmpleado(conceptos.find((x) => x.codigo === "IHSS"));
  const ivm = maximoEmpleado(conceptos.find((x) => x.codigo === "IVM"));
  if (em === null || ivm === null) return null;
  return { em, ivm, total: Math.round((em + ivm) * 100) / 100 };
}

/** Qué opción de la planilla quincenal mira cada concepto (INFOP y Reserva siempre van divididos). */
const CLAVE_QUINCENAL: Partial<Record<string, keyof DistribucionQuincenal>> = { IHSS: "ihss", IVM: "ihss", RAP: "rap" };

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

const campo = "input";
const etiqueta = "mb-1 block text-sm font-medium text-gray-800";
const tarjeta = "panel p-5";
const botonPrimario = "btn btn-primary";

const txt = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/**
 * Campo de monto o porcentaje. Es de TEXTO a propósito: con `type="number"` la coma
 * decimal hacía que el navegador enviara el campo vacío («requerido») o lo leyera
 * como miles (297,58 → 29,758). Ver `leerMonto`.
 */
function CampoNumero({ label, nombre, valor, onChange }: { label: string; nombre: string; valor: string; onChange: (v: string) => void }) {
  const lectura = leerMonto(valor);
  const interpretado = lectura.ok && lectura.valor !== null && String(lectura.valor) !== valor.trim();
  return (
    <label className="block">
      <span className={etiqueta}>{label}</span>
      <input
        type="text" inputMode="decimal" autoComplete="off" value={valor} name={nombre} className={campo}
        aria-invalid={!lectura.ok} onChange={(e) => onChange(e.target.value)}
      />
      {!lectura.ok ? (
        <span className="mt-1 block text-xs text-red-700">{lectura.error}</span>
      ) : interpretado ? (
        <span className="mt-1 block text-xs text-gray-500" data-se-guarda>Se guarda como {lectura.valor}</span>
      ) : null}
    </label>
  );
}

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
  const [distribucion, setDistribucion] = useState<DistribucionQuincenal | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch("/api/configuracion/parametros");
        const d = await res.json().catch(() => ({}));
        if (!vivo) return;
        if (!res.ok) throw new Error(d.error ?? "No se pudieron cargar los parámetros");
        setDatos(d);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudieron cargar los parámetros");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [recarga]);

  if (error) {
    return <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">{error}</div>;
  }
  if (!datos) return <p className="text-sm text-gray-500">Cargando…</p>;

  const recargar = () => setRecarga((r) => r + 1);
  const maximo = ihssMaximo(datos.conceptos);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-900 space-y-1">
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
          {datos.conceptos.map((c) => {
            const clave = CLAVE_QUINCENAL[c.codigo];
            return (
              <ConceptoCard
                key={c.codigo}
                concepto={c}
                onGuardado={recargar}
                quincenal={clave && distribucion ? ETIQUETA_MODO_QUINCENAL[distribucion[clave]] : null}
                ihssMaximo={c.codigo === "IHSS" || c.codigo === "IVM" ? maximo : null}
              />
            );
          })}
        </div>
      </section>

      <DistribucionQuincenalConfig ihssMaximoMensual={maximo?.total ?? null} onCambio={setDistribucion} />
      <RapMesVencidoConfig />
      <TablaISR inicial={datos.isr} onGuardado={recargar} />
      <MetodoIsrConfig />
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
  montoFijoEmpleado: "Monto del trabajador",
  montoFijoEmpleador: "Monto del patrono",
};

/**
 * Monto fijo que corresponde al máximo legal: la tasa sobre el techo (sobre techo
 * menos piso, en el RAP). `null` si el concepto no tiene techo o falta un dato.
 */
function maximoLegal(tasaTexto: string, techoTexto: string, pisoTexto: string): number | null {
  const tasa = leerMonto(tasaTexto), techo = leerMonto(techoTexto), piso = leerMonto(pisoTexto);
  if (!tasa.ok || !techo.ok || !piso.ok || tasa.valor === null || techo.valor === null) return null;
  return Math.round((techo.valor - (piso.valor ?? 0)) * tasa.valor) / 100;
}

function ConceptoCard({ concepto: c, onGuardado, quincenal, ihssMaximo }: {
  concepto: Concepto;
  onGuardado: () => void;
  /** Cómo se deduce en planilla quincenal (IHSS, IVM y RAP); `null` en los demás. */
  quincenal: string | null;
  /** IHSS máximo del trabajador al mes, en las tarjetas de EM e IVM. */
  ihssMaximo: { em: number; ivm: number; total: number } | null;
}) {
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

  // Máximo legal de cada parte con los porcentajes y el techo de la tarjeta.
  const lecturaTecho = leerMonto(form.topeMaximo);
  const techoActual = lecturaTecho.ok ? lecturaTecho.valor : null;
  const sugeridoEmpleado = c.tieneEmpleado && c.tieneTope ? maximoLegal(form.porcentajeEmpleado, form.topeMaximo, c.tienePiso ? form.topeMinimo : "") : null;
  const sugeridoPatrono = c.tieneTope ? maximoLegal(form.porcentajeEmpleador, form.topeMaximo, c.tienePiso ? form.topeMinimo : "") : null;

  /** Al pasar a monto fijo con los campos vacíos, se proponen los máximos legales. */
  function elegirModo(m: Modo) {
    setOk(false);
    setError(null);
    setForm((f) => {
      if (m !== "MONTO_FIJO" || f.montoFijoEmpleado.trim() !== "" || f.montoFijoEmpleador.trim() !== "") return { ...f, modo: m };
      return {
        ...f,
        modo: m,
        montoFijoEmpleado: sugeridoEmpleado !== null ? sugeridoEmpleado.toFixed(2) : "",
        montoFijoEmpleador: sugeridoPatrono !== null ? sugeridoPatrono.toFixed(2) : "",
      };
    });
  }

  async function guardar() {
    setError(null);
    setOk(false);
    // Se lee cada campo antes de enviar: lo que no se entienda se dice aquí, en vez
    // de mandarlo vacío y recibir un «requerido» del servidor.
    const errores: string[] = [];
    const leer = (k: keyof typeof form, aplica = true) => {
      if (!aplica) return null;
      const r = leerMonto(form[k]);
      if (!r.ok) errores.push(`${NOMBRES_CAMPO[k] ?? k}: ${r.error}`);
      return r.ok ? r.valor : null;
    };
    const cuerpo = {
      modo: form.modo,
      porcentajeEmpleado: leer("porcentajeEmpleado", c.tieneEmpleado),
      porcentajeEmpleador: leer("porcentajeEmpleador"),
      topeMaximo: leer("topeMaximo", c.tieneTope),
      topeMinimo: leer("topeMinimo", c.tienePiso),
      montoFijoEmpleado: leer("montoFijoEmpleado", c.tieneEmpleado),
      montoFijoEmpleador: leer("montoFijoEmpleador"),
    };
    // En monto fijo hacen falta los dos montos: se dice aquí, con el valor sugerido.
    if (form.modo === "MONTO_FIJO") {
      const sugerencia = (v: number | null) => (v !== null ? ` Para el máximo legal son ${formatCurrency(v)}.` : "");
      if (c.tieneEmpleado && cuerpo.montoFijoEmpleado === null && !errores.length) {
        errores.push(`Falta el monto mensual del trabajador (lo que se le descuenta).${sugerencia(sugeridoEmpleado)}`);
      }
      if (cuerpo.montoFijoEmpleador === null && !errores.length) {
        errores.push(`Falta el monto mensual del patrono.${sugerencia(sugeridoPatrono)}`);
      }
    }
    if (errores.length > 0) {
      setError(errores.join("\n"));
      return;
    }
    setGuardando(true);
    try {
      const res = await fetch(`/api/configuracion/parametros/conceptos/${c.codigo}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(mensajeError(d, NOMBRES_CAMPO));
      setOk(true);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
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
          <EstadoBadge valor="DEFECTO" etiqueta="Valores por defecto" tono="aviso" className="shrink-0" />
        )}
      </div>

      <div className="flex gap-2" role="radiogroup" aria-label={`Cálculo de ${c.codigo}`}>
        {(["PORCENTAJE", "MONTO_FIJO"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={form.modo === m}
            onClick={() => elegirModo(m)}
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
              <CampoNumero label="Trabajador (L. al mes)" nombre="montoFijoEmpleado" valor={form.montoFijoEmpleado} onChange={(v) => set("montoFijoEmpleado", v)} />
            )}
            <CampoNumero label="Patrono (L. al mes)" nombre="montoFijoEmpleador" valor={form.montoFijoEmpleador} onChange={(v) => set("montoFijoEmpleador", v)} />
          </div>
          {(sugeridoEmpleado !== null || sugeridoPatrono !== null) && (
            <p className="text-xs text-gray-600" data-maximo-legal>
              Máximo legal con el techo de {formatCurrency(techoActual ?? 0)}:{" "}
              {sugeridoEmpleado !== null && <>trabajador <strong className="tnum">{formatCurrency(sugeridoEmpleado)}</strong>, </>}
              patrono <strong className="tnum">{formatCurrency(sugeridoPatrono ?? 0)}</strong>.{" "}
              <button
                type="button"
                className="text-blue-700 underline"
                onClick={() => {
                  if (sugeridoEmpleado !== null) set("montoFijoEmpleado", sugeridoEmpleado.toFixed(2));
                  if (sugeridoPatrono !== null) set("montoFijoEmpleador", sugeridoPatrono.toFixed(2));
                }}
              >
                Usar estos montos
              </button>
            </p>
          )}
          <p className="text-xs text-gray-500">
            Monto mensual, igual para todos los empleados sin importar su salario
            {c.tienePiso ? " (también a quien gana menos del piso)" : ""}. En la planilla mensual se descuenta completo;
            en la semanal se prorratea; en la quincenal, como diga la opción «Planilla quincenal» de abajo. Porcentajes
            guardados para volver a ese modo:{" "}
            {c.tieneEmpleado ? `${form.porcentajeEmpleado || "—"} % empleado / ` : ""}
            {form.porcentajeEmpleador || "—"} % patrono.
          </p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {c.tieneEmpleado && (
              <CampoNumero label="Empleado (%)" nombre="porcentajeEmpleado" valor={form.porcentajeEmpleado} onChange={(v) => set("porcentajeEmpleado", v)} />
            )}
            <CampoNumero label="Patrono (%)" nombre="porcentajeEmpleador" valor={form.porcentajeEmpleador} onChange={(v) => set("porcentajeEmpleador", v)} />
            {c.tienePiso && (
              <CampoNumero label="Piso de la base (L.)" nombre="topeMinimo" valor={form.topeMinimo} onChange={(v) => set("topeMinimo", v)} />
            )}
            {c.tieneTope && (
              <CampoNumero label="Techo de la base (L.)" nombre="topeMaximo" valor={form.topeMaximo} onChange={(v) => set("topeMaximo", v)} />
            )}
          </div>
          {c.tienePiso && (
            <p className="text-xs text-gray-500">
              Cotiza todo el excedente del salario sobre el piso, sin techo (Art. 43 de la Ley del RAP): a 95,000 son
              (95,000 − piso) × el porcentaje. Quien gana el piso o menos no aporta RAP.
            </p>
          )}
        </>
      )}

      {ihssMaximo && (
        <p className="text-xs px-2 py-1.5 rounded-lg bg-gray-50 text-gray-700" data-ihss-maximo>
          IHSS del trabajador al mes, como máximo: EM {formatCurrency(ihssMaximo.em)} + IVM {formatCurrency(ihssMaximo.ivm)} ={" "}
          <strong className="tnum">{formatCurrency(ihssMaximo.total)}</strong>. Son dos regímenes: un monto fijo se pone en
          cada uno.
        </p>
      )}

      {quincenal && (
        <p className="text-xs text-gray-600" data-quincenal>
          En planilla quincenal: <strong>{quincenal.toLowerCase()}</strong>.{" "}
          <a href="#planilla-quincenal" className="text-blue-700 underline">Cambiar</a>
        </p>
      )}

      {c.codigo === "RESERVA_LABORAL" && (
        // El Art. 6 del Decreto 47-2024 manda deducir el saldo del RAP del auxilio
        // de cesantía. El sistema no lleva ese saldo: decirlo aquí evita pagar dos veces.
        <p className="text-xs px-2 py-1.5 rounded-lg bg-amber-50 text-amber-800">
          La liquidación de prestaciones todavía no descuenta el saldo acumulado en el RAP: al liquidar, réstelo
          a mano del auxilio de cesantía con el estado de cuenta del trabajador.
        </p>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-800 whitespace-pre-line">{error}</div>
      )}

      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-gray-500">
          {ok
            ? "Guardado"
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
//
// Se escribe sólo lo que publica la autoridad —el «hasta» de cada tramo y su tasa
// o tarifa— y lo demás se calcula SIEMPRE: el «desde» de cada tramo sale del
// «hasta» del anterior (el primero empieza en 0) y, en el ISR, la cuota fija y el
// «excedente desde» salen de los rangos y las tasas (`derivarCuotasISR`). Así no
// puede quedar un hueco, un solape ni una cuota fija que no cuadre con las tasas.

interface FilaISR { hasta: string; porcentaje: string }
interface FilaVecinal { hasta: string; porMillar: string }

/** Lectura de una celda: número, `null` si está vacía, NaN si no se entiende. */
function celda(s: string): number | null {
  const r = leerMonto(s);
  return r.ok ? r.valor : NaN;
}

/** Celda numérica de las tablas: texto que acepta la coma decimal (ver `leerMonto`). */
function CeldaNumero({ valor, onChange, etiqueta: aria, placeholder }: {
  valor: string; onChange: (v: string) => void; etiqueta: string; placeholder?: string;
}) {
  const lectura = leerMonto(valor);
  return (
    <>
      <input
        type="text" inputMode="decimal" autoComplete="off" value={valor} onChange={(e) => onChange(e.target.value)}
        className={campo} aria-label={aria} aria-invalid={!lectura.ok} placeholder={placeholder}
      />
      {!lectura.ok && <span className="mt-0.5 block text-xs text-red-700">{lectura.error}</span>}
    </>
  );
}

/** Valor calculado, que no se edita. */
function Calculado({ valor, etiqueta: aria }: { valor: number | null; etiqueta: string }) {
  return (
    <span className="tnum block px-1 py-2 text-sm text-gray-700" aria-label={aria}>
      {valor === null || !Number.isFinite(valor) ? "—" : formatCurrency(valor)}
    </span>
  );
}

/** «Desde» de cada tramo: 0 el primero; el siguiente, el «hasta» anterior más `salto`. */
function desdes(hastas: Array<number | null>, salto: number): number[] {
  return hastas.map((_, i) => {
    if (i === 0) return 0;
    const anterior = hastas[i - 1];
    return anterior === null || !Number.isFinite(anterior) ? NaN : Math.round((anterior + salto) * 100) / 100;
  });
}

function TablaISR({ inicial, onGuardado }: { inicial: Datos["isr"]; onGuardado: () => void }) {
  const [anio, setAnio] = useState(String(inicial.anio));
  const [filas, setFilas] = useState<FilaISR[]>(
    inicial.tramos.map((t) => ({ hasta: txt(t.hasta), porcentaje: txt(t.porcentaje) }))
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // El SAR separa los tramos por un centavo: 228,324.32 → 228,324.33.
  const hastas = filas.map((f) => celda(f.hasta));
  const desde = desdes(hastas, 0.01);
  const derivados = derivarCuotasISR(
    filas.map((f, i) => ({ desde: desde[i], hasta: hastas[i], porcentaje: (celda(f.porcentaje) ?? NaN) / 100 }))
  );
  const ilegibles = filas.some((f) => !leerMonto(f.hasta).ok || !leerMonto(f.porcentaje).ok);
  const errores = [
    ...(ilegibles ? ["Hay valores que no se entienden: corrija los marcados en rojo."] : []),
    ...validarTramosISR(derivados),
  ];

  function editar(i: number, k: keyof FilaISR, v: string) {
    setOk(false);
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
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
          tramos: derivados.map((t) => ({
            desde: t.desde,
            hasta: t.hasta,
            porcentaje: Math.round(t.porcentaje * 10000) / 100,
            cuotaFija: t.cuotaFija,
            excedenteDesde: t.excedenteDesde,
          })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(mensajeError(d));
      setOk(true);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
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
            Tabla progresiva del SAR sobre la renta neta gravable anual. Escriba el «hasta» y la tasa de cada tramo: el
            «desde», la cuota fija y el «excedente desde» se calculan solos. La planilla usa la tabla del año más reciente
            que esté guardado.
          </p>
        </div>
        <label className="block w-28"><span className={etiqueta}>Año</span>
          <input type="text" inputMode="numeric" value={anio} onChange={(e) => { setOk(false); setAnio(e.target.value); }} className={campo} name="anioISR" />
        </label>
      </div>

      {inicial.porDefecto && (
        <p className="text-xs px-3 py-2 rounded-lg bg-amber-50 text-amber-800">
          No hay tabla guardada: se muestra la tabla 2026 que el sistema usa por defecto.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>#</th>
              <th>Desde (L.)</th>
              <th>Hasta (L.)</th>
              <th>Tasa (%)</th>
              <th>Cuota fija (L.)</th>
              <th>Excedente desde (L.)</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                <td className="text-xs text-gray-500">{i + 1}</td>
                <td><Calculado valor={desde[i]} etiqueta={`Desde del tramo ${i + 1}`} /></td>
                <td>
                  <CeldaNumero valor={f.hasta} onChange={(v) => editar(i, "hasta", v)} etiqueta={`Hasta del tramo ${i + 1}`}
                    placeholder={i === filas.length - 1 ? "En adelante" : ""} />
                </td>
                <td><CeldaNumero valor={f.porcentaje} onChange={(v) => editar(i, "porcentaje", v)} etiqueta={`Tasa del tramo ${i + 1}`} /></td>
                <td><Calculado valor={derivados[i].cuotaFija} etiqueta={`Cuota fija del tramo ${i + 1}`} /></td>
                <td><Calculado valor={derivados[i].excedenteDesde} etiqueta={`Excedente desde del tramo ${i + 1}`} /></td>
                <td className="text-right">
                  <button type="button" onClick={() => { setOk(false); setFilas((fs) => fs.filter((_, j) => j !== i)); }}
                    disabled={filas.length <= 1} className="btn btn-ghost btn-sm text-red-700" aria-label={`Quitar tramo ${i + 1}`}>
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" onClick={() => { setOk(false); setFilas((fs) => [...fs, { hasta: "", porcentaje: "" }]); }}
        className="btn btn-secondary btn-sm">
        Agregar tramo
      </button>

      <Avisos errores={errores} error={error} />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {ok ? "Tabla guardada" : "La cuota fija es el impuesto acumulado de los tramos anteriores."}
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
    inicial.tramos.map((t) => ({ hasta: txt(t.hasta), porMillar: txt(t.porMillar) }))
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // En el vecinal el siguiente tramo empieza exactamente donde acaba el anterior.
  const hastas = filas.map((f) => celda(f.hasta));
  const desde = desdes(hastas, 0);
  const tramos = filas.map((f, i) => ({ desde: desde[i], hasta: hastas[i], porMillar: celda(f.porMillar) ?? NaN }));
  const ilegibles = filas.some((f) => !leerMonto(f.hasta).ok || !leerMonto(f.porMillar).ok);
  const errores = [
    ...(ilegibles ? ["Hay valores que no se entienden: corrija los marcados en rojo."] : []),
    ...validarTramosVecinal(tramos),
  ];

  function editar(i: number, k: keyof FilaVecinal, v: string) {
    setOk(false);
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch("/api/configuracion/parametros/vecinal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ municipio, anio: Number(anio), tramos }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(mensajeError(d));
      setOk(true);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  // Ejemplo para que el administrador compruebe la tabla contra el Plan de Arbitrios.
  const ejemplo = 180000;
  const impuestoEjemplo = errores.length > 0 ? null : tramos.reduce((total, t) => {
    const techo = t.hasta === null ? ejemplo : Math.min(ejemplo, t.hasta);
    const porcion = techo - t.desde;
    return porcion > 0 ? total + (porcion / 1000) * t.porMillar : total;
  }, 0);

  return (
    <section className={`${tarjeta} space-y-3`} data-tabla="vecinal">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-800">Impuesto personal o vecinal</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Tabla del Plan de Arbitrios del municipio: cada porción del ingreso anual paga la tarifa por millar de su
            tramo. La base son los ingresos totales, sin deducciones. Escriba el «hasta» y la tarifa: el «desde» se
            calcula solo.
          </p>
        </div>
        <div className="flex gap-2">
          <label className="block w-44"><span className={etiqueta}>Municipio</span>
            <input value={municipio} onChange={(e) => { setOk(false); setMunicipio(e.target.value); }} className={campo} name="municipio" />
          </label>
          <label className="block w-24"><span className={etiqueta}>Año</span>
            <input type="text" inputMode="numeric" value={anio} onChange={(e) => { setOk(false); setAnio(e.target.value); }} className={campo} name="anioVecinal" />
          </label>
        </div>
      </div>

      {inicial.porDefecto && (
        <p className="text-xs px-3 py-2 rounded-lg bg-amber-50 text-amber-800">
          No hay tabla guardada: se muestra la de San Pedro Sula que el sistema usa por defecto.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="table-base max-w-2xl">
          <thead>
            <tr>
              <th>#</th>
              <th>Desde (L. anual)</th>
              <th>Hasta (L. anual)</th>
              <th>Tarifa (L. por millar)</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                <td className="text-xs text-gray-500">{i + 1}</td>
                <td><Calculado valor={desde[i]} etiqueta={`Desde del tramo ${i + 1}`} /></td>
                <td>
                  <CeldaNumero valor={f.hasta} onChange={(v) => editar(i, "hasta", v)} etiqueta={`Hasta del tramo ${i + 1}`}
                    placeholder={i === filas.length - 1 ? "En adelante" : ""} />
                </td>
                <td><CeldaNumero valor={f.porMillar} onChange={(v) => editar(i, "porMillar", v)} etiqueta={`Tarifa por millar del tramo ${i + 1}`} /></td>
                <td className="text-right">
                  <button type="button" onClick={() => { setOk(false); setFilas((fs) => fs.filter((_, j) => j !== i)); }}
                    disabled={filas.length <= 1} className="btn btn-ghost btn-sm text-red-700" aria-label={`Quitar tramo ${i + 1}`}>
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" onClick={() => { setOk(false); setFilas((fs) => [...fs, { hasta: "", porMillar: "" }]); }}
        className="btn btn-secondary btn-sm">
        Agregar tramo
      </button>

      <Avisos errores={errores} error={error} />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {ok
            ? "Tabla guardada; este municipio queda como el vigente"
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
      {errores.map((e) => <p key={e}>{e}</p>)}
    </div>
  );
}
