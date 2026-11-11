"use client";

/**
 * Asignar un tipo de deducción a varios empleados a la vez: se elige el tipo y la
 * forma de cobro, se marcan empleados (con búsqueda y filtros por sucursal y
 * departamento) y se pone un monto igual para todos o uno por persona. Quien ya lo
 * tiene se salta, o se le cambia el monto, según se elija (ver
 * `lib/payroll/asignacion-masiva.ts`, que decide lo mismo en el servidor).
 *
 * Para cargar montos que cambian cada quincena, lo indicado es el archivo de montos
 * del período (Importar), no esta ventana.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import { claveNombre } from "@/lib/organizacion/puestos";
import { leerMonto } from "@/lib/formato/monto-texto";
import { hoyLocalIso, esFechaIso } from "@/lib/payroll/periodos-planilla";
import { formatCurrency } from "@/lib/utils";

type FormaCobro = "SIEMPRE" | "UNA_VEZ" | "CUOTAS";
type SiYaLaTiene = "SALTAR" | "ACTUALIZAR" | "AGREGAR";

interface Tipo { id: string; nombre: string; codigo: string; esLegal: boolean; activo: boolean; montoFijo?: number | null }

interface EmpleadoLista {
  id: string;
  codigo: string;
  nombre: string;
  sucursal: { id: string; nombre: string };
  departamento: { id: string; nombre: string };
  cadaPlanilla: string | null;
  pendiente: string | null;
}

interface Resultado {
  creadas: number;
  actualizadas: number;
  saltados: Array<{ codigo: string; nombre: string; motivo: string }>;
}

const FORMAS: Array<{ valor: FormaCobro; etiqueta: string }> = [
  { valor: "SIEMPRE", etiqueta: "Cada planilla, sin fin" },
  { valor: "UNA_VEZ", etiqueta: "Una sola vez" },
  { valor: "CUOTAS", etiqueta: "En cuotas" },
];

const OPCIONES: Record<FormaCobro, Array<{ valor: SiYaLaTiene; etiqueta: string }>> = {
  SIEMPRE: [{ valor: "SALTAR", etiqueta: "Saltarlo" }, { valor: "ACTUALIZAR", etiqueta: "Cambiarle el monto" }],
  UNA_VEZ: [{ valor: "SALTAR", etiqueta: "Saltarlo" }, { valor: "AGREGAR", etiqueta: "Agregarle otra" }],
  CUOTAS: [{ valor: "SALTAR", etiqueta: "Saltarlo" }, { valor: "AGREGAR", etiqueta: "Agregarle otra" }],
};

function montoValido(texto: string): boolean {
  const r = leerMonto(texto);
  return r.ok && r.valor !== null && r.valor > 0;
}

export default function AsignarVarios({ tipos, etiquetaSucursal, onCerrar }: {
  tipos: Tipo[];
  etiquetaSucursal: string;
  onCerrar: () => void;
}) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const elegibles = tipos.filter((t) => t.activo && !t.esLegal);

  const [tipoId, setTipoId] = useState("");
  const [forma, setForma] = useState<FormaCobro>("SIEMPRE");
  const [cuotas, setCuotas] = useState("");
  const [fechaInicio, setFechaInicio] = useState(hoyLocalIso);
  const [observacion, setObservacion] = useState("");
  const [porPersona, setPorPersona] = useState(false);
  const [montoIgual, setMontoIgual] = useState("");
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [siYaLaTiene, setSiYaLaTiene] = useState<SiYaLaTiene>("SALTAR");

  const [empleados, setEmpleados] = useState<Array<EmpleadoLista & { clave: string }> | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [sucursal, setSucursal] = useState("");
  const [departamento, setDepartamento] = useState("");
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  // Al elegir el tipo se vuelve a pedir la lista, para saber quién ya lo tiene. Lo
  // marcado se conserva: son los mismos empleados.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(`/api/deducciones/empleados${tipoId ? `?tipoDeduccionId=${encodeURIComponent(tipoId)}` : ""}`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) throw new Error(d.error ?? "No se pudo cargar la lista de empleados.");
        setEmpleados((d.empleados as EmpleadoLista[]).map((e) => ({ ...e, clave: claveNombre(`${e.nombre} ${e.codigo} ${e.departamento.nombre} ${e.sucursal.nombre}`) })));
      } catch (e) {
        if (vivo) { setEmpleados([]); setError(e instanceof Error ? e.message : "No se pudo cargar la lista de empleados."); }
      }
    })();
    return () => { vivo = false; };
  }, [tipoId]);

  const sucursales = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of empleados ?? []) m.set(e.sucursal.id, e.sucursal.nombre);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [empleados]);
  const departamentos = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of empleados ?? []) if (!sucursal || e.sucursal.id === sucursal) m.set(e.departamento.id, e.departamento.nombre);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [empleados, sucursal]);

  const visibles = useMemo(() => {
    const palabras = claveNombre(busqueda).split(" ").filter(Boolean);
    return (empleados ?? []).filter((e) =>
      (!sucursal || e.sucursal.id === sucursal) &&
      (!departamento || e.departamento.id === departamento) &&
      palabras.every((p) => e.clave.includes(p)));
  }, [empleados, busqueda, sucursal, departamento]);

  const yaLaTiene = (e: EmpleadoLista) => (forma === "SIEMPRE" ? e.cadaPlanilla : e.pendiente) !== null;
  const montoDe = (e: EmpleadoLista) => (porPersona ? montos[e.id] ?? "" : montoIgual);
  const lista = (empleados ?? []).filter((e) => marcados.has(e.id));
  const sinMonto = lista.filter((e) => !montoValido(montoDe(e)));
  const conExistente = tipoId ? lista.filter(yaLaTiene).length : 0;
  const cuotasOk = forma !== "CUOTAS" || (/^\d+$/.test(cuotas.trim()) && Number(cuotas) >= 1 && Number(cuotas) <= 600);
  const todasVisibles = visibles.length > 0 && visibles.every((e) => marcados.has(e.id));
  const n = marcados.size;

  const falta = !tipoId ? "Elija el tipo de deducción."
    : n === 0 ? "Marque al menos un empleado."
      : !cuotasOk ? "Escriba en cuántas cuotas (de 1 a 600)."
        : !esFechaIso(fechaInicio) ? "Elija la fecha de inicio."
          : sinMonto.length ? (porPersona ? `Falta un monto válido para ${sinMonto.length === 1 ? sinMonto[0].nombre : `${sinMonto.length} empleados`}.` : "Escriba el monto, como 1000.00.")
            : null;

  function alternarVisibles() {
    const nuevo = new Set(marcados);
    for (const e of visibles) {
      if (todasVisibles) nuevo.delete(e.id);
      else nuevo.add(e.id);
    }
    setMarcados(nuevo);
  }

  function alternar(id: string) {
    const nuevo = new Set(marcados);
    if (!nuevo.delete(id)) nuevo.add(id);
    setMarcados(nuevo);
  }

  function cambiarForma(f: FormaCobro) {
    setForma(f);
    if (!OPCIONES[f].some((o) => o.valor === siYaLaTiene)) setSiYaLaTiene("SALTAR");
  }

  async function asignar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch("/api/deducciones/masiva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipoDeduccionId: tipoId,
          forma,
          ...(forma === "CUOTAS" ? { cuotasMeses: Number(cuotas) } : {}),
          fechaInicio,
          observacion: observacion.trim() || undefined,
          siYaLaTiene,
          filas: lista.map((e) => ({ empleadoId: e.id, monto: montoDe(e) })),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "No se pudo asignar la deducción.");
      const res = d as Resultado;
      setResultado(res);
      avisar.exito(`Deducción asignada a ${res.creadas + res.actualizadas} empleado(s).`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo asignar la deducción.");
    } finally {
      setEnviando(false);
    }
  }

  const tipoElegido = elegibles.find((t) => t.id === tipoId);
  const existenteTexto = (e: EmpleadoLista) =>
    forma === "SIEMPRE"
      ? e.cadaPlanilla && `Ya: ${formatCurrency(e.cadaPlanilla)} c/planilla`
      : e.pendiente && `Saldo: ${formatCurrency(e.pendiente)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Asignar deducción a varios empleados">
      <div className="panel flex max-h-[92vh] w-full max-w-3xl flex-col shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Asignar deducción a varios empleados</h3>
            <p className="mt-0.5 text-xs text-gray-500">Para montos que cambian cada quincena, use Importar → Montos del período.</p>
          </div>
          <button type="button" onClick={onCerrar} className="px-2 text-2xl leading-none text-gray-500 hover:text-gray-700" aria-label="Cerrar">×</button>
        </div>

        {resultado ? (
          <div className="space-y-3 overflow-y-auto px-5 py-5" data-resultado>
            <p className="text-sm text-gray-800">
              «{tipoElegido?.nombre}»: asignada a <span className="font-semibold">{resultado.creadas}</span> empleado(s)
              {resultado.actualizadas > 0 && <>, con monto cambiado a <span className="font-semibold">{resultado.actualizadas}</span></>}.
              {resultado.saltados.length > 0 && <> Se saltaron <span className="font-semibold">{resultado.saltados.length}</span>.</>}
            </p>
            {resultado.saltados.length > 0 && (
              <ul className="max-h-60 divide-y divide-gray-200 overflow-y-auto rounded-lg border border-gray-200 text-sm">
                {resultado.saltados.map((s) => (
                  <li key={s.codigo} className="px-3 py-2"><span className="font-medium text-gray-900">{s.nombre}</span> <span className="text-gray-500">({s.codigo}): {s.motivo}</span></li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-500">Quedó registrado en la auditoría. La próxima planilla del período las toma; si ya está calculada, vuelva a calcularla.</p>
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm" htmlFor="masiva-tipo">
                <span className="font-medium text-gray-800">Tipo de deducción</span>
                <select id="masiva-tipo" className="input mt-1" value={tipoId} onChange={(e) => {
                  setTipoId(e.target.value);
                  // Su monto habitual se propone, si todavía no escribió uno.
                  const habitual = elegibles.find((t) => t.id === e.target.value)?.montoFijo;
                  if (habitual && montoIgual.trim() === "") setMontoIgual(habitual.toFixed(2));
                }}>
                  <option value="">Seleccione…</option>
                  {elegibles.map((t) => <option key={t.id} value={t.id}>{t.nombre} ({t.codigo})</option>)}
                </select>
              </label>
              <label className="block text-sm" htmlFor="masiva-forma">
                <span className="font-medium text-gray-800">Forma de cobro</span>
                <select id="masiva-forma" className="input mt-1" value={forma} onChange={(e) => cambiarForma(e.target.value as FormaCobro)}>
                  {FORMAS.map((f) => <option key={f.valor} value={f.valor}>{f.etiqueta}</option>)}
                </select>
              </label>
              {forma === "CUOTAS" && (
                <label className="block text-sm" htmlFor="masiva-cuotas">
                  <span className="font-medium text-gray-800">Número de cuotas</span>
                  <input id="masiva-cuotas" className="input mt-1" inputMode="numeric" value={cuotas} onChange={(e) => setCuotas(e.target.value)} placeholder="Ej: 6" />
                </label>
              )}
              <label className="block text-sm" htmlFor="masiva-inicio">
                <span className="font-medium text-gray-800">Fecha de inicio</span>
                <input id="masiva-inicio" type="date" className="input mt-1" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
              </label>
              <label className="block text-sm sm:col-span-2" htmlFor="masiva-observacion">
                <span className="font-medium text-gray-800">Observación <span className="font-normal text-gray-500">(opcional)</span></span>
                <input id="masiva-observacion" className="input mt-1" value={observacion} maxLength={500} onChange={(e) => setObservacion(e.target.value)} />
              </label>
            </div>

            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-medium text-gray-800">{forma === "CUOTAS" ? "Monto total a repartir" : forma === "SIEMPRE" ? "Monto por planilla" : "Monto"}</legend>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="masiva-modo-monto" checked={!porPersona} onChange={() => setPorPersona(false)} /> Igual para todos</label>
                <label className="flex items-center gap-2"><input type="radio" name="masiva-modo-monto" checked={porPersona} onChange={() => setPorPersona(true)} /> Uno por persona</label>
              </div>
              {!porPersona && (
                <input className="input" inputMode="decimal" aria-label="Monto para todos" placeholder="Ej: 1000.00" value={montoIgual} onChange={(e) => setMontoIgual(e.target.value)} />
              )}
            </fieldset>

            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,12rem)]">
                <input className="input" type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, código o departamento" aria-label="Buscar empleados" />
                <select className="input" aria-label={etiquetaSucursal} value={sucursal} onChange={(e) => { setSucursal(e.target.value); setDepartamento(""); }}>
                  <option value="">{etiquetaSucursal}: todas</option>
                  {sucursales.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
                </select>
                <select className="input" aria-label="Departamento" value={departamento} onChange={(e) => setDepartamento(e.target.value)}>
                  <option value="">Departamento: todos</option>
                  {departamentos.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
                </select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-800">Empleados{empleados ? ` (${n} de ${empleados.length} marcados)` : ""}</span>
                {visibles.length > 0 && (
                  <button type="button" className="-my-1 py-1 text-sm font-medium text-blue-700 hover:underline" onClick={alternarVisibles}>
                    {todasVisibles ? "Quitar los de la lista" : `Marcar los ${visibles.length} de la lista`}
                  </button>
                )}
              </div>
              <div className="h-64 divide-y divide-gray-200 overflow-y-auto rounded-lg border border-gray-300" data-lista-masiva>
                {empleados === null && <p className="px-3 py-3 text-sm text-gray-500">Cargando empleados…</p>}
                {empleados !== null && visibles.length === 0 && <p className="px-3 py-3 text-sm text-gray-500">{empleados.length ? "Nadie coincide con la búsqueda." : "No hay empleados activos en su alcance."}</p>}
                {visibles.map((e) => {
                  const marcado = marcados.has(e.id);
                  const existente = tipoId ? existenteTexto(e) : null;
                  return (
                    <div key={e.id} className="flex min-h-11 items-center gap-2.5 px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-50" data-empleado={e.codigo}>
                      <input id={`masiva-${e.id}`} type="checkbox" className="h-4 w-4 shrink-0 rounded border-gray-300" checked={marcado} onChange={() => alternar(e.id)} />
                      <label htmlFor={`masiva-${e.id}`} className="min-w-0 flex-1 cursor-pointer">
                        <span className="block truncate">{e.nombre}</span>
                        <span className="block truncate text-xs text-gray-500">{e.codigo}, {e.departamento.nombre}, {e.sucursal.nombre}</span>
                      </label>
                      {existente && <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">{existente}</span>}
                      {porPersona && marcado && (
                        <input className="input h-8 w-28 shrink-0 text-right" inputMode="decimal" aria-label={`Monto para ${e.nombre}`}
                          value={montos[e.id] ?? ""} placeholder="0.00"
                          onChange={(ev) => setMontos((m) => ({ ...m, [e.id]: ev.target.value }))} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {conExistente > 0 && (
              <fieldset className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <legend className="sr-only">Si ya la tiene</legend>
                <p className="font-medium">
                  {conExistente === 1 ? "1 marcado ya tiene" : `${conExistente} marcados ya tienen`} {forma === "SIEMPRE" ? "esta deducción en cada planilla" : "un saldo pendiente de este tipo"}. ¿Qué hago con {conExistente === 1 ? "él" : "ellos"}?
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {OPCIONES[forma].map((o) => (
                    <label key={o.valor} className="flex items-center gap-2">
                      <input type="radio" name="masiva-existentes" checked={siYaLaTiene === o.valor} onChange={() => setSiYaLaTiene(o.valor)} /> {o.etiqueta}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-5 py-3">
          {error && <p className="mr-auto text-sm text-red-700" role="alert">{error}</p>}
          {!error && !resultado && falta && n > 0 && <p className="mr-auto text-xs text-gray-500">{falta}</p>}
          {!error && !resultado && !falta && conExistente > 0 && (
            <p className="mr-auto text-xs text-amber-800" data-resumen-existentes>
              {conExistente} ya la {conExistente === 1 ? "tiene" : "tienen"}: {siYaLaTiene === "SALTAR" ? "se saltará" : siYaLaTiene === "ACTUALIZAR" ? "se le cambiará el monto" : "se le agregará otra"}.
            </p>
          )}
          {resultado ? (
            <button type="button" className="btn btn-primary" onClick={onCerrar}>Cerrar</button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
              <button type="button" className="btn btn-primary" disabled={enviando || !!falta} onClick={() => void asignar()}>
                {enviando ? "Asignando…" : n <= 1 ? "Asignar" : `Asignar a ${n} empleados`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
