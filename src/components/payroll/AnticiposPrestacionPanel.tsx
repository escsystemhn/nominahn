"use client";

/**
 * Deducciones → Anticipos de prestaciones: la negociación de prestaciones y los adelantos
 * del 13.º y 14.º, pagados APARTE de la planilla. No tocan el salario: se rebajan de la
 * cesantía al liquidar (negociación) o del décimo al pagarlo (adelantos).
 */
import { useEffect, useMemo, useState } from "react";
import { useAvisos } from "@/components/ui/Avisos";
import { Campo } from "@/components/ui/ModalForm";
import EstadoVacio from "@/components/ui/EstadoVacio";
import EstadoBadge from "@/components/ui/EstadoBadge";
import { formatCurrency, formatDate, nombreCompleto } from "@/lib/utils";

type Tipo = "NEGOCIACION_PRESTACIONES" | "ADELANTO_DECIMO_TERCERO" | "ADELANTO_DECIMO_CUARTO";

const ETIQUETA: Record<Tipo, string> = {
  NEGOCIACION_PRESTACIONES: "Negociación de prestaciones",
  ADELANTO_DECIMO_TERCERO: "Adelanto del 13.º mes",
  ADELANTO_DECIMO_CUARTO: "Adelanto del 14.º mes",
};
const SE_REBAJA: Record<Tipo, string> = {
  NEGOCIACION_PRESTACIONES: "Se rebaja del auxilio de cesantía al liquidar, hasta dejarlo en cero. Lo que exceda no se cobra de otros conceptos.",
  ADELANTO_DECIMO_TERCERO: "Se resta del décimo tercer mes de ese año al calcularlo en Prestaciones; si el empleado sale antes, del proporcional de su finiquito.",
  ADELANTO_DECIMO_CUARTO: "Se resta del décimo cuarto mes de ese año (se paga en junio) al calcularlo; si el empleado sale antes, del proporcional de su finiquito.",
};

interface Anticipo {
  id: string;
  tipo: Tipo;
  monto: number;
  montoAplicado: number | null;
  fechaPago: string;
  anioDecimo: number | null;
  periodoDesde: string | null;
  periodoHasta: string | null;
  referencia: string | null;
  observacion: string | null;
  estado: "VIGENTE" | "APLICADO" | "ANULADO";
  motivoAnulacion: string | null;
  empleado: { id: string; codigo: string; primerNombre: string; primerApellido: string; sucursal: { nombre: string } };
  liquidacionFinal: { id: string; estado: string; fechaSalida: string } | null;
  liquidacionDecimo: { id: string; tipo: string; anio: number; estado: string } | null;
}

interface Props {
  empleados: Array<{ id: string; codigo: string; primerNombre: string; segundoNombre?: string | null; primerApellido: string; segundoApellido?: string | null }>;
  puedeRegistrar: boolean;
}

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Tegucigalpa" });
/** Año de pago del décimo en curso a una fecha (el 14.º va de julio a junio). */
function anioEnCurso(tipo: Tipo, fecha: string): number {
  const [a, m] = fecha.split("-").map(Number);
  return tipo === "ADELANTO_DECIMO_CUARTO" && m >= 7 ? a + 1 : a;
}

const VACIO = { empleadoId: "", tipo: "NEGOCIACION_PRESTACIONES" as Tipo, monto: "", fechaPago: hoy(), anioDecimo: "", periodoDesde: "", periodoHasta: "", referencia: "", observacion: "" };

export default function AnticiposPrestacionPanel({ empleados, puedeRegistrar }: Props) {
  const { avisar } = useAvisos();
  const [filas, setFilas] = useState<Anticipo[] | null>(null);
  const [tipo, setTipo] = useState<"" | Tipo>("");
  const [estado, setEstado] = useState<"" | Anticipo["estado"]>("VIGENTE");
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Sube al registrar o anular: vuelve a leer la lista.
  const [version, setVersion] = useState(0);
  const cargar = async () => setVersion((v) => v + 1);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const q = new URLSearchParams();
      if (tipo) q.set("tipo", tipo);
      if (estado) q.set("estado", estado);
      const r = await fetch(`/api/anticipos-prestacion?${q}`);
      const d = r.ok ? await r.json() : [];
      if (vivo) setFilas(d);
    })();
    return () => {
      vivo = false;
    };
  }, [tipo, estado, version]);

  const totales = useMemo(() => {
    const t: Record<Tipo, number> = { NEGOCIACION_PRESTACIONES: 0, ADELANTO_DECIMO_TERCERO: 0, ADELANTO_DECIMO_CUARTO: 0 };
    for (const f of filas ?? []) if (f.estado === "VIGENTE") t[f.tipo] += f.monto;
    return t;
  }, [filas]);

  async function registrar() {
    setError(null);
    setGuardando(true);
    try {
      const esAdelanto = form.tipo !== "NEGOCIACION_PRESTACIONES";
      const r = await fetch("/api/anticipos-prestacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empleadoId: form.empleadoId,
          tipo: form.tipo,
          monto: Number(form.monto),
          fechaPago: form.fechaPago,
          ...(esAdelanto && form.anioDecimo ? { anioDecimo: Number(form.anioDecimo) } : {}),
          ...(!esAdelanto && form.periodoDesde ? { periodoDesde: form.periodoDesde } : {}),
          ...(!esAdelanto && form.periodoHasta ? { periodoHasta: form.periodoHasta } : {}),
          referencia: form.referencia || undefined,
          observacion: form.observacion || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(typeof d.error === "string" ? d.error : "No se pudo registrar. Revise los datos.");
        return;
      }
      setAbierto(false);
      avisar.exito(d.aviso ? `Registrado. ${d.aviso}` : "Anticipo registrado.");
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function anular(a: Anticipo) {
    const motivo = window.prompt(`Motivo para anular el registro de ${formatCurrency(a.monto)} de ${a.empleado.primerNombre} ${a.empleado.primerApellido}:`);
    if (!motivo) return;
    const r = await fetch(`/api/anticipos-prestacion/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "ANULADO", motivo }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) avisar.error(typeof d.error === "string" ? d.error : "No se pudo anular.");
    else {
      avisar.exito("Registro anulado.");
      await cargar();
    }
  }

  const destino = (a: Anticipo) => {
    if (a.estado === "ANULADO") return a.motivoAnulacion ? `Anulado: ${a.motivoAnulacion}` : "Anulado";
    if (a.liquidacionFinal) return `Rebajado ${formatCurrency(a.montoAplicado ?? 0)} en la liquidación final (salida ${formatDate(a.liquidacionFinal.fechaSalida)})`;
    if (a.liquidacionDecimo) return `Rebajado ${formatCurrency(a.montoAplicado ?? 0)} del ${a.liquidacionDecimo.tipo === "DECIMO_TERCERO" ? "13.º" : "14.º"} de ${a.liquidacionDecimo.anio}`;
    return null;
  };

  return (
    <div className="space-y-4" data-anticipos-prestacion>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-gray-600">
          Pagos hechos <b>aparte de la planilla</b> (cheque o transferencia) a cuenta de prestaciones. No se descuentan del salario:
          la negociación de prestaciones se rebaja de la <b>cesantía</b> al liquidar al empleado, y el adelanto de un décimo se resta
          de ese <b>décimo</b> al calcularlo en Prestaciones.
        </p>
        {puedeRegistrar && (
          <button className="btn btn-primary" onClick={() => { setForm({ ...VACIO, fechaPago: hoy() }); setError(null); setAbierto(true); }}>
            Registrar anticipo
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(ETIQUETA) as Tipo[]).map((t) => (
          <div key={t} className="panel p-4">
            <p className="text-xs text-gray-500">{ETIQUETA[t]} por rebajar</p>
            <p className="tnum text-lg font-semibold text-gray-900">{formatCurrency(totales[t])}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <select className="input w-auto!" value={tipo} onChange={(e) => setTipo(e.target.value as "" | Tipo)} aria-label="Concepto">
          <option value="">Todos los conceptos</option>
          {(Object.keys(ETIQUETA) as Tipo[]).map((t) => <option key={t} value={t}>{ETIQUETA[t]}</option>)}
        </select>
        <select className="input w-auto!" value={estado} onChange={(e) => setEstado(e.target.value as "" | Anticipo["estado"])} aria-label="Estado">
          <option value="VIGENTE">Por rebajar</option>
          <option value="APLICADO">Ya rebajados</option>
          <option value="ANULADO">Anulados</option>
          <option value="">Todos</option>
        </select>
      </div>

      {filas === null ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : filas.length === 0 ? (
        <div className="panel">
          <EstadoVacio titulo="No hay anticipos con ese filtro." detalle={puedeRegistrar ? "Registre uno con «Registrar anticipo» cuando el pago ya se haya hecho." : undefined} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base tabla-tarjetas">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Concepto</th>
                <th className="num">Monto</th>
                <th>Pagado el</th>
                <th>Corresponde a</th>
                <th>Estado</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <tr key={a.id} data-anticipo={a.id}>
                  <td data-titulo>
                    <div className="text-gray-900">{a.empleado.primerNombre} {a.empleado.primerApellido}</div>
                    <div className="text-xs text-gray-500">{a.empleado.codigo} · {a.empleado.sucursal.nombre}</div>
                  </td>
                  <td data-etiqueta="Concepto">{ETIQUETA[a.tipo]}</td>
                  <td data-etiqueta="Monto" className="num whitespace-nowrap">{formatCurrency(a.monto)}</td>
                  <td data-etiqueta="Pagado el" className="whitespace-nowrap">
                    {formatDate(a.fechaPago)}
                    {a.referencia && <span className="block text-xs text-gray-500">{a.referencia}</span>}
                  </td>
                  <td data-etiqueta="Corresponde a" className="text-sm">
                    {a.tipo === "NEGOCIACION_PRESTACIONES"
                      ? a.periodoDesde && a.periodoHasta ? `Servicio del ${formatDate(a.periodoDesde)} al ${formatDate(a.periodoHasta)}` : "Cesantía"
                      : `${a.tipo === "ADELANTO_DECIMO_TERCERO" ? "13.º" : "14.º"} de ${a.anioDecimo}`}
                  </td>
                  <td data-etiqueta="Estado" className="text-sm">
                    <EstadoBadge valor={a.estado} etiqueta={a.estado === "VIGENTE" ? "Por rebajar" : a.estado === "APLICADO" ? "Rebajado" : "Anulado"} tono={a.estado === "VIGENTE" ? "aviso" : a.estado === "APLICADO" ? "ok" : "neutro"} />
                    {destino(a) && <span className="block text-xs text-gray-500">{destino(a)}</span>}
                  </td>
                  <td data-accion className="text-right">
                    {puedeRegistrar && a.estado === "VIGENTE" && (
                      <button className="btn btn-sm border border-red-300 bg-white text-red-700 hover:bg-red-50" onClick={() => void anular(a)}>Anular</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Registrar anticipo">
          <div className="panel max-h-full w-full max-w-lg space-y-4 overflow-y-auto p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">Registrar anticipo de prestaciones</h3>
            <Campo etiqueta="Empleado">
              <select className="input" value={form.empleadoId} onChange={(e) => setForm({ ...form, empleadoId: e.target.value })}>
                <option value="">Seleccione…</option>
                {empleados.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {nombreCompleto(e)}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Concepto">
              <select className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Tipo, anioDecimo: "" })}>
                {(Object.keys(ETIQUETA) as Tipo[]).map((t) => <option key={t} value={t}>{ETIQUETA[t]}</option>)}
              </select>
            </Campo>
            <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">{SE_REBAJA[form.tipo]}</p>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Monto pagado (L)">
                <input className="input" type="number" min="0.01" step="0.01" inputMode="decimal" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
              </Campo>
              <Campo etiqueta="Fecha del pago">
                <input className="input" type="date" max={hoy()} value={form.fechaPago} onChange={(e) => setForm({ ...form, fechaPago: e.target.value })} />
              </Campo>
            </div>
            {form.tipo === "NEGOCIACION_PRESTACIONES" ? (
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Servicio que cubre: desde (opcional)">
                  <input className="input" type="date" value={form.periodoDesde} onChange={(e) => setForm({ ...form, periodoDesde: e.target.value })} />
                </Campo>
                <Campo etiqueta="Hasta (opcional)">
                  <input className="input" type="date" value={form.periodoHasta} onChange={(e) => setForm({ ...form, periodoHasta: e.target.value })} />
                </Campo>
              </div>
            ) : (
              <Campo etiqueta={`Año del ${form.tipo === "ADELANTO_DECIMO_TERCERO" ? "13.º (se paga en diciembre)" : "14.º (se paga en junio)"}`}>
                <input
                  className="input w-32!"
                  type="number"
                  min="2000"
                  max="2100"
                  placeholder={form.fechaPago ? String(anioEnCurso(form.tipo, form.fechaPago)) : ""}
                  value={form.anioDecimo}
                  onChange={(e) => setForm({ ...form, anioDecimo: e.target.value })}
                />
              </Campo>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Cheque o transferencia (opcional)">
                <input className="input" value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} />
              </Campo>
              <Campo etiqueta="Observación (opcional)">
                <input className="input" value={form.observacion} onChange={(e) => setForm({ ...form, observacion: e.target.value })} />
              </Campo>
            </div>
            {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setAbierto(false)}>Cancelar</button>
              <button className="btn btn-primary" disabled={guardando || !form.empleadoId || !(Number(form.monto) > 0) || !form.fechaPago} onClick={() => void registrar()}>
                {guardando ? "Guardando…" : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
