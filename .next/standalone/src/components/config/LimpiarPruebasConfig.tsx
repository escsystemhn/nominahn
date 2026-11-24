"use client";

/**
 * Configuración → Sistema → Limpiar pruebas: quitar las planillas de prueba y los montos
 * del período importados desde una fecha y hora, sin tocar el resto de los datos del
 * cliente. Ver `lib/payroll/limpiar-pruebas.ts`.
 */

import { useState } from "react";
import { useAvisos } from "@/components/ui/Avisos";
import EstadoBadge, { estadoDePlanilla } from "@/components/ui/EstadoBadge";
import { rangoPeriodo } from "@/lib/payroll/periodos-planilla";
import { formatCurrency } from "@/lib/utils";

interface Planilla {
  id: string; tipo: string; fechaInicio: string; fechaFin: string; estado: string; creada: string;
  ubicacion: string; lineas: number; totalNeto: string; motivo: string | null;
}
interface Datos {
  planillas: Planilla[];
  montos: Array<{ desde: string; hasta: string; cantidad: number; empleados: number }>;
  totalMontos: number;
  basesRap: number;
  horasExtra: number;
  montosCambiados: number;
}
interface Resultado {
  planillas: Array<{ id: string; cuotasDevueltas: number }>;
  omitidas: number; montos: number; montosEnUso: number; basesRap: number; horasExtra: number; respaldo: string | null;
}

const dos = (n: number) => String(n).padStart(2, "0");
/** Hoy a las 00:00 en la hora del equipo, como lo pide un campo datetime-local. */
function inicioDeHoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T00:00`;
}
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-HN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export default function LimpiarPruebasConfig() {
  const { confirmar } = useAvisos();
  const [desde, setDesde] = useState(inicioDeHoy);
  const [buscadoDesde, setBuscadoDesde] = useState<string | null>(null);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [conMontos, setConMontos] = useState(true);
  const [respaldo, setRespaldo] = useState(true);
  const [ocupado, setOcupado] = useState<"buscar" | "limpiar" | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  async function buscar(mantenerAviso = false) {
    const iso = new Date(desde).toISOString();
    setOcupado("buscar");
    if (!mantenerAviso) setAviso(null);
    const r = await fetch(`/api/configuracion/limpiar-pruebas?${new URLSearchParams({ desde: iso })}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    setOcupado(null);
    if (!r.ok) { setDatos(null); setAviso({ ok: false, texto: d.error ?? "No se pudo buscar." }); return; }
    const x = d as Datos;
    setDatos(x);
    setBuscadoDesde(iso);
    setMarcadas(new Set(x.planillas.filter((p) => !p.motivo).map((p) => p.id)));
    setConMontos(x.totalMontos + x.basesRap + x.horasExtra > 0);
  }

  async function limpiar() {
    if (!datos || !buscadoDesde) return;
    const n = marcadas.size;
    const partes = [
      n ? plural(n, "planilla de prueba", "planillas de prueba") : "",
      conMontos && datos.totalMontos ? plural(datos.totalMontos, "monto del período", "montos del período") : "",
      conMontos && datos.basesRap ? plural(datos.basesRap, "base del RAP", "bases del RAP") : "",
      conMontos && datos.horasExtra ? plural(datos.horasExtra, "registro de horas extra", "registros de horas extra") : "",
    ].filter(Boolean);
    if (!(await confirmar({
      titulo: `¿Quitar ${partes.join(", ")}?`,
      detalle: `No se puede deshacer${respaldo ? ", salvo restaurando el respaldo que se hace antes" : ""}. Las cuotas de préstamos y los bonos que cobraron las planillas vuelven a como estaban. Lo demás no se toca.`,
      accion: "Quitar",
      peligro: true,
    }))) return;
    setOcupado("limpiar");
    setAviso(null);
    const r = await fetch("/api/configuracion/limpiar-pruebas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ desde: buscadoDesde, planillaIds: [...marcadas], montos: conMontos, respaldo }),
    });
    const d = await r.json().catch(() => ({}));
    setOcupado(null);
    if (!r.ok) { setAviso({ ok: false, texto: d.error ?? "No se pudo limpiar." }); return; }
    const x = d as Resultado;
    const cuotas = x.planillas.reduce((s, p) => s + p.cuotasDevueltas, 0);
    setAviso({
      ok: true,
      texto: [
        `Se quitaron ${plural(x.planillas.length, "planilla", "planillas")}${cuotas ? ` (${plural(cuotas, "cuota devuelta", "cuotas devueltas")})` : ""}`,
        x.montos || x.basesRap || x.horasExtra ? ` y ${plural(x.montos, "monto del período", "montos del período")}${x.basesRap ? `, más ${plural(x.basesRap, "base del RAP", "bases del RAP")}` : ""}${x.horasExtra ? `, más ${plural(x.horasExtra, "registro de horas extra", "registros de horas extra")}` : ""}` : "",
        ".",
        x.omitidas ? ` ${plural(x.omitidas, "planilla cambió", "planillas cambiaron")} de estado mientras revisaba y no se tocó.` : "",
        x.montosEnUso ? ` ${plural(x.montosEnUso, "monto sigue", "montos siguen")}: lo cobra una planilla que se queda.` : "",
        x.respaldo ? ` Respaldo previo: ${x.respaldo}.` : "",
      ].join(""),
    });
    await buscar(true);
  }

  const limpiables = datos?.planillas.filter((p) => !p.motivo) ?? [];
  const cerradas = datos?.planillas.filter((p) => p.motivo) ?? [];
  const hayAlgo = marcadas.size > 0 || (conMontos && !!datos && datos.totalMontos + datos.basesRap + datos.horasExtra > 0);

  function alternar(id: string) {
    const nuevo = new Set(marcadas);
    if (!nuevo.delete(id)) nuevo.add(id);
    setMarcadas(nuevo);
  }

  return (
    <section className="panel space-y-5 p-5" data-seccion="limpiar-pruebas">
      <div>
        <h2 className="font-semibold text-gray-800">Limpiar pruebas</h2>
        <p className="mt-1 text-sm text-gray-600">
          Quita lo que se hizo para probar desde la fecha y hora que indique: las planillas en borrador o confirmadas, y los montos del período
          importados. Las cuotas de préstamos y los bonos que cobraron vuelven a como estaban. No toca empleados, deducciones de cada planilla,
          configuración ni las planillas aprobadas, pagadas o anuladas.
        </p>
        <p className="mt-1 text-xs text-gray-500">Anote cuándo empieza a probar y, al terminar, indique esa hora aquí.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm" htmlFor="limpiar-desde">
          <span className="font-medium text-gray-800">Lo creado desde</span>
          <input id="limpiar-desde" type="datetime-local" className="input mt-1" value={desde} onChange={(e) => { setDesde(e.target.value); setDatos(null); }} />
        </label>
        <button type="button" className="btn btn-secondary" disabled={!desde || ocupado !== null} onClick={() => void buscar()}>
          {ocupado === "buscar" ? "Buscando…" : "Buscar"}
        </button>
      </div>

      {datos && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Planillas creadas desde entonces</h3>
            {datos.planillas.length === 0 ? (
              <p className="mt-1 text-sm text-gray-600">Ninguna.</p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                <table className="table-base text-sm" data-planillas-prueba>
                  <thead>
                    <tr><th className="w-10"><span className="sr-only">Quitar</span></th><th>Período</th><th>Ubicación</th><th>Estado</th><th>Creada</th><th className="num">Líneas</th><th className="num">Neto</th></tr>
                  </thead>
                  <tbody>
                    {[...limpiables, ...cerradas].map((p) => (
                      <tr key={p.id} data-planilla={p.id}>
                        <td>
                          <input type="checkbox" className="h-4 w-4" aria-label={`Quitar la planilla ${rangoPeriodo(p.fechaInicio, p.fechaFin)}`}
                            disabled={!!p.motivo} checked={marcadas.has(p.id)} onChange={() => alternar(p.id)} />
                        </td>
                        <td>
                          <span className="block">{rangoPeriodo(p.fechaInicio, p.fechaFin)}</span>
                          <span className="block text-xs text-gray-500">{p.tipo.charAt(0) + p.tipo.slice(1).toLowerCase()}</span>
                        </td>
                        <td>{p.ubicacion}</td>
                        <td>
                          <EstadoBadge valor={estadoDePlanilla(p.estado)} />
                          {p.motivo && <span className="block text-xs text-gray-500">{p.motivo}</span>}
                        </td>
                        <td className="whitespace-nowrap">{fechaHora(p.creada)}</td>
                        <td className="num">{p.lineas}</td>
                        <td className="num">{formatCurrency(Number(p.totalNeto))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900">Montos importados desde entonces</h3>
            {datos.totalMontos + datos.basesRap + datos.horasExtra === 0 ? (
              <p className="mt-1 text-sm text-gray-600">Ninguno.</p>
            ) : (
              <label className="mt-2 flex items-start gap-2 text-sm text-gray-800" data-montos-prueba>
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={conMontos} onChange={(e) => setConMontos(e.target.checked)} />
                <span>
                  Quitar {plural(datos.totalMontos, "monto del período", "montos del período")}
                  {datos.basesRap > 0 && <> y {plural(datos.basesRap, "base del RAP", "bases del RAP")}</>}
                  {datos.horasExtra > 0 && <> y {plural(datos.horasExtra, "registro de horas extra", "registros de horas extra")}</>}
                  <span className="block text-xs text-gray-500">
                    {datos.montos.map((m) => `${rangoPeriodo(m.desde, m.hasta)}: ${plural(m.cantidad, "monto", "montos")} de ${plural(m.empleados, "empleado", "empleados")}`).join(". ")}
                    {datos.montos.length > 0 && "."} Las deducciones de cada planilla vuelven a cobrarse como siempre.
                  </span>
                </span>
              </label>
            )}
            {datos.montosCambiados > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                {plural(datos.montosCambiados, "monto del período de antes se cambió", "montos del período de antes se cambiaron")} durante este tiempo:
                no se pueden devolver solos. Revíselos en Deducciones (Exportar el archivo del período).
              </p>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm text-gray-800">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={respaldo} onChange={(e) => setRespaldo(e.target.checked)} />
            <span>
              Sacar un respaldo antes (recomendado)
              <span className="block text-xs text-gray-500">Con los destinos de Respaldos. Si no se puede hacer, no se quita nada.</span>
            </span>
          </label>

          <button type="button" className="btn border border-red-300 bg-white text-red-700 hover:bg-red-50" disabled={!hayAlgo || ocupado !== null} onClick={() => void limpiar()}>
            {ocupado === "limpiar" ? "Quitando…" : "Quitar lo marcado"}
          </button>
        </div>
      )}

      {aviso && <p className={`text-sm ${aviso.ok ? "text-green-700" : "text-red-700"}`} role={aviso.ok ? "status" : "alert"}>{aviso.texto}</p>}
    </section>
  );
}
