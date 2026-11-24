"use client";

/**
 * Generar las planillas de un período de una vez: un borrador por cada sucursal que tiene
 * gente de esa frecuencia sin planilla en esas fechas (fase 2 de Planillas por período,
 * 2026-11-24). Se abre desde el botón de arriba (eligiendo el período) o desde «Falta
 * generar» de un período de la lista (`data-generar`, con su tipo y sus fechas).
 *
 * Cada borrador se crea con `POST /api/planillas`, una sucursal tras otra: la misma ruta y
 * las mismas validaciones que «Nueva planilla». Los borradores no cobran nada.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SelectorPeriodo, { periodoInicial } from "@/components/payroll/SelectorPeriodo";
import { ListaProceso, PieProceso, VentanaLote, resumenProceso, useProcesoLote, type Paso, type Resultado } from "@/components/payroll/ProcesoLote";
import { ETIQUETA_TIPO_PLANILLA, esFechaIso, type PeriodoPlanilla, type TipoPlanillaPeriodo } from "@/lib/payroll/periodos-planilla";
import { formatCurrency } from "@/lib/utils";

interface Unidad { clave: string; empresaId: string; sucursalId: string; divisionId: string | null; nombre: string; empleados: number; puedeGenerar: boolean }
interface Datos {
  nombre: string;
  faltan: Unidad[];
  fuera: Array<{ nombre: string; empleados: number; planillaId: string; estado: string }>;
  generadas: Array<{ id: string; nombre: string; estado: string }>;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const ESTADO: Record<string, string> = { BORRADOR: "en borrador", CALCULADA: "confirmada", APROBADA: "aprobada", PAGADA: "pagada" };
const TIPOS = Object.keys(ETIQUETA_TIPO_PLANILLA);

function DialogoGenerar({ inicial, fijo, solo, filtro, nombreFiltro, onCerrar }: {
  inicial: PeriodoPlanilla; fijo: boolean;
  /** Desde «Falta» del tablero: sólo esa sucursal marcada (las demás, a un clic). */
  solo: string | null;
  filtro: string; nombreFiltro: string | null; onCerrar: (cambio: boolean) => void;
}) {
  const [periodo, setPeriodo] = useState(inicial);
  // La respuesta lleva el período al que corresponde: al cambiarlo, la anterior deja de valer sola.
  const [respuesta, setRespuesta] = useState<{ clave: string; datos?: Datos; error?: string } | null>(null);
  // Lo que la persona marcó o desmarcó; lo demás sigue la regla: todas, o sólo `solo`.
  const [cambios, setCambios] = useState<Map<string, boolean>>(new Map());
  const marcada = (u: Unidad) => u.puedeGenerar && (cambios.get(u.clave) ?? (solo ? u.clave === solo : true));
  const p = useProcesoLote();

  const { tipo, desde, hasta } = periodo;
  const clave = `${tipo}|${desde}|${hasta}`;
  const fechasMal = !esFechaIso(desde) || !esFechaIso(hasta) || hasta <= desde;
  useEffect(() => {
    if (fechasMal) return;
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(`/api/planillas/periodo?${new URLSearchParams({ tipo, desde, hasta })}${filtro ? `&${filtro}` : ""}`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) throw new Error(d.error ?? "No se pudo revisar el período.");
        setRespuesta({ clave, datos: d as Datos });
      } catch (e) {
        if (vivo) setRespuesta({ clave, error: e instanceof Error ? e.message : "No se pudo revisar el período." });
      }
    })();
    return () => { vivo = false; };
  }, [clave, tipo, desde, hasta, fechasMal, filtro]);
  const vigente = !fechasMal && respuesta?.clave === clave ? respuesta : null;
  const datos = vigente?.datos ?? null;
  const error = fechasMal ? "Revise las fechas: la final debe ser posterior a la inicial." : vigente?.error ?? null;

  const elegidas = (datos?.faltan ?? []).filter(marcada);
  const frecuencia = ETIQUETA_TIPO_PLANILLA[periodo.tipo].toLowerCase();

  async function ejecutar(paso: Paso): Promise<Resultado> {
    const u = elegidas.find((x) => x.clave === paso.clave)!;
    const r = await fetch("/api/planillas?resumen=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: periodo.tipo, fechaInicio: periodo.desde, fechaFin: periodo.hasta, empresaId: u.empresaId, sucursalId: u.sucursalId, divisionId: u.divisionId ?? undefined }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) return { estado: "hecho", mensaje: `Borrador con ${plural(d.empleados, "empleado", "empleados")}, neto ${formatCurrency(Number(d.totalNeto))}.` };
    return { estado: r.status === 409 ? "revisar" : "error", mensaje: d.error ?? "No se pudo generar." };
  }

  const cerrar = () => onCerrar(p.fase !== "pregunta" && p.hechos > 0);
  const titulo = fijo && datos ? `Generar ${datos.nombre}` : "Generar período";
  return (
    <VentanaLote
      titulo={titulo}
      onEscape={p.fase === "procesando" ? undefined : cerrar}
      pie={<PieProceso p={p} textoAccion={`Generar ${plural(elegidas.length, "borrador", "borradores")}`} puede={elegidas.length > 0}
        onAccion={() => void p.correr(elegidas.map((u) => ({ clave: u.clave, nombre: u.nombre, detalle: plural(u.empleados, "empleado", "empleados") })), ejecutar)} onCerrar={cerrar} />}
    >
      {p.fase === "pregunta" ? (
        <div className="space-y-3" data-generar-periodo>
          {!fijo && <SelectorPeriodo id="gen" valor={periodo} onCambio={(x) => { setPeriodo(x); setCambios(new Map()); }} />}
          <p className="text-sm text-gray-600">Un borrador por sucursal, con su gente de planilla {frecuencia}. Los borradores no cobran nada hasta confirmarlos.</p>
          {nombreFiltro && <p className="text-sm text-gray-600" data-filtro-generar>Sólo de <span className="font-medium text-gray-900">{nombreFiltro}</span>, como la lista.</p>}
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
          {!datos && !error && <p className="text-sm text-gray-500">Revisando el período…</p>}
          {datos && (
            <>
              {datos.faltan.length > 0 ? (
                <fieldset className="space-y-1" data-faltan>
                  <legend className="mb-1 text-sm font-medium text-gray-800">Sin planilla de este período</legend>
                  <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 text-sm">
                    {datos.faltan.map((u) => (
                      <li key={u.clave}>
                        <label className="flex items-center gap-2.5 px-3 py-2">
                          <input type="checkbox" className="h-4 w-4" disabled={!u.puedeGenerar} checked={marcada(u)}
                            onChange={(e) => { const v = e.target.checked; setCambios((m) => new Map(m).set(u.clave, v)); }} />
                          <span className="min-w-0 flex-1 truncate font-medium text-gray-900">{u.nombre}</span>
                          <span className="shrink-0 text-xs text-gray-500">{u.puedeGenerar ? plural(u.empleados, "empleado", "empleados") : "Fuera del alcance de su cuenta"}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              ) : (
                <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" data-nada-que-generar>
                  Todas las sucursales con personal de planilla {frecuencia} ya tienen la de este período.
                </p>
              )}
              {datos.generadas.length > 0 && (
                <div className="text-sm" data-generadas>
                  <p className="text-gray-700">Ya {datos.generadas.length === 1 ? "tiene" : "tienen"} su planilla:</p>
                  <p className="mt-0.5 text-gray-500">{datos.generadas.map((g) => `${g.nombre} (${ESTADO[g.estado] ?? g.estado.toLowerCase()})`).join(", ")}.</p>
                </div>
              )}
              {datos.fuera.map((f) => (
                <p key={f.planillaId} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-fuera>
                  {f.nombre}: {plural(f.empleados, "empleado no está", "empleados no están")} en su planilla de este período (entró o cambió de sucursal después de generarla).
                  {f.estado === "BORRADOR" ? " Recalcule ese borrador para incluirlo." : ""}{" "}
                  <a href={`/planillas/${f.planillaId}`} className="font-medium underline">Abrir la planilla</a>
                </p>
              ))}
            </>
          )}
        </div>
      ) : (
        <>
          <ListaProceso p={p} />
          {p.fase === "listo" && <p className="text-sm font-medium text-gray-900" role="status" data-resumen-lote>{resumenProceso(p, ["generado", "generados"], ["borrador", "borradores"])}</p>}
        </>
      )}
    </VentanaLote>
  );
}

export default function GenerarPeriodo({ tipoInicial, filtro = "", nombreFiltro = null, abrirAlCargar = false }: {
  tipoInicial: TipoPlanillaPeriodo;
  /** `?generar=1` (desde Inicio): la ventana se abre sola. */
  abrirAlCargar?: boolean;
  /** El filtro de la lista (`sucursalId=…&divisionId=…`): genera y cuenta sólo lo de ahí. */
  filtro?: string;
  /** Su nombre, para decirlo en la ventana. */
  nombreFiltro?: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<{ periodo: PeriodoPlanilla; fijo: boolean; solo: string | null } | null>(null);

  // Desde Inicio: se abre después de montar (la fecha de hoy es la del navegador, no la del servidor).
  useEffect(() => {
    if (!abrirAlCargar) return;
    const t = setTimeout(() => setAbierto({ periodo: periodoInicial(tipoInicial), fijo: false, solo: null }), 0);
    return () => clearTimeout(t);
  }, [abrirAlCargar, tipoInicial]);

  // «Generar las que faltan» de cada período: botones que dibuja el servidor en la lista.
  useEffect(() => {
    function alPulsar(e: MouseEvent) {
      const b = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-generar]");
      if (!b) return;
      const { tipo, desde, hasta, unidad } = b.dataset;
      if (!tipo || !TIPOS.includes(tipo) || !esFechaIso(desde) || !esFechaIso(hasta)) return;
      setAbierto({ periodo: { tipo: tipo as TipoPlanillaPeriodo, desde, hasta }, fijo: true, solo: unidad || null });
    }
    document.addEventListener("click", alPulsar);
    return () => document.removeEventListener("click", alPulsar);
  }, []);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setAbierto({ periodo: periodoInicial(tipoInicial), fijo: false, solo: null })}>Generar período</button>
      {abierto && (
        <DialogoGenerar
          // Otro período, otra ventana: no arrastra lo marcado ni el avance.
          key={`${abierto.periodo.tipo}|${abierto.periodo.desde}|${abierto.periodo.hasta}|${abierto.fijo}|${abierto.solo ?? ""}`}
          inicial={abierto.periodo}
          fijo={abierto.fijo}
          solo={abierto.solo}
          filtro={filtro}
          nombreFiltro={nombreFiltro}
          onCerrar={(cambio) => {
            setAbierto(null);
            // Sin `?generar=1`, para que recargar la página no la vuelva a abrir.
            if (abrirAlCargar) {
              const u = new URL(window.location.href);
              u.searchParams.delete("generar");
              router.replace(`${u.pathname}${u.search}`, { scroll: false });
            } else if (cambio) router.refresh();
          }}
        />
      )}
    </>
  );
}
