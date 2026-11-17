"use client";

/**
 * Configuración → Asistencia: la política de deducciones por llegadas tarde, salidas
 * anticipadas, ausencias y séptimo día. Una sola para toda la instalación. El motor y la
 * base legal están en `lib/asistencia/deducciones`.
 */

import { useEffect, useState } from "react";
import { useAvisos } from "@/components/ui/Avisos";
import type { FrecuenciaPago, PoliticaAsistencia, ReglaSeptimo, ReglaTiempo } from "@/lib/asistencia/deducciones/politica";

const FRECUENCIAS: { f: FrecuenciaPago; nombre: string }[] = [
  { f: "SEMANAL", nombre: "Planilla semanal" },
  { f: "QUINCENAL", nombre: "Planilla quincenal" },
  { f: "MENSUAL", nombre: "Planilla mensual" },
];

/** Lo que pasa del tiempo real o no tiene base en el Código, para avisarlo antes de guardar. */
function riesgos(p: PoliticaAsistencia): string[] {
  const r: string[] = [];
  const permite = p.proteccion.excesoSobreTiempoReal === "PERMITIR_CON_ALERTA";
  if (permite) {
    if (p.descontarTiempo && (p.tardanzas.redondeo.modo === "BLOQUES" || p.salidasAnticipadas.redondeo.modo === "BLOQUES")) {
      r.push("El redondeo en bloques puede descontar más minutos de los no trabajados.");
    }
    if (p.descontarTiempo && p.umbralAusencia.activo) r.push("Convertir una llegada tarde en media jornada a quien trabajó descuenta tiempo trabajado.");
    if (p.ausencias.diaCorto.descuento === "DIA_COMPLETO") r.push("Descontar un día completo por faltar un sábado de 4 horas pasa de lo no trabajado (Art. 322: proporcional).");
    r.push("Descontar más que el tiempo no trabajado equivale a una multa, que el Art. 92, numeral 9, prohíbe.");
  }
  if (p.ausencias.feriadoAdyacente === "DESCONTAR_FERIADO") {
    r.push("Descontar el feriado por faltar el día anterior o posterior no está en el Código (el Art. 339 sólo enumera los feriados; con salario mensual o quincenal su pago ya va incluido).");
  }
  return r;
}

function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="block font-medium text-gray-800">{etiqueta}</span>
      <span className="mt-1 flex flex-wrap items-center gap-2">{children}</span>
      {ayuda && <span className="mt-1 block text-xs text-gray-500">{ayuda}</span>}
    </label>
  );
}

const minutos = (v: string, min = 1) => Math.max(min, Math.round(Number(v) || 0));

function ReglaTiempoCampos({ titulo, regla, onCambiar, prefijo }: { titulo: string; regla: ReglaTiempo; onCambiar: (r: ReglaTiempo) => void; prefijo: string }) {
  const t = regla.tolerancia;
  return (
    <fieldset className="space-y-3 rounded-lg border border-gray-200 p-4" data-regla-tiempo={prefijo}>
      <legend className="px-1 text-sm font-semibold text-gray-900">{titulo}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Tiempo de gracia">
          <select className="input" aria-label={`${titulo}: tiempo de gracia`} value={t.modo} onChange={(e) => {
            const modo = e.target.value as ReglaTiempo["tolerancia"]["modo"];
            onCambiar({ ...regla, tolerancia: modo === "POR_EVENTO" ? { modo, minutos: 5, descontarCompletoSiExcede: false } : modo === "BOLSA_PERIODO" ? { modo, minutos: 30, alAgotarse: "SOLO_EXCEDENTE" } : { modo } });
          }}>
            <option value="NINGUNA">Sin gracia: todo minuto cuenta</option>
            <option value="POR_EVENTO">Minutos de gracia cada vez</option>
            <option value="BOLSA_PERIODO">Bolsa de gracia en el período</option>
          </select>
        </Campo>
        <Campo etiqueta="Cómo se cuentan los minutos">
          <select className="input" aria-label={`${titulo}: redondeo`} value={regla.redondeo.modo} onChange={(e) => onCambiar({ ...regla, redondeo: e.target.value === "BLOQUES" ? { modo: "BLOQUES", minutos: 15 } : { modo: "MINUTO_EXACTO" } })}>
            <option value="MINUTO_EXACTO">Al minuto exacto</option>
            <option value="BLOQUES">En bloques, hacia arriba</option>
          </select>
          {regla.redondeo.modo === "BLOQUES" && (
            <>
              <input className="input w-20" type="number" min={1} aria-label={`${titulo}: minutos del bloque`} value={regla.redondeo.minutos}
                onChange={(e) => onCambiar({ ...regla, redondeo: { modo: "BLOQUES", minutos: minutos(e.target.value) } })} />
              <span className="text-gray-600">min</span>
            </>
          )}
        </Campo>
        {t.modo === "POR_EVENTO" && (
          <>
            <Campo etiqueta="Minutos de gracia">
              <input className="input w-20" type="number" min={1} aria-label={`${titulo}: minutos de gracia`} value={t.minutos} onChange={(e) => onCambiar({ ...regla, tolerancia: { ...t, minutos: minutos(e.target.value) } })} />
            </Campo>
            <Campo etiqueta="Si se pasa de la gracia">
              <select className="input" value={t.descontarCompletoSiExcede ? "TODO" : "EXCEDENTE"} onChange={(e) => onCambiar({ ...regla, tolerancia: { ...t, descontarCompletoSiExcede: e.target.value === "TODO" } })}>
                <option value="EXCEDENTE">Se descuenta sólo lo que pasa (12 con 10 de gracia → 2)</option>
                <option value="TODO">Se descuenta todo (12 con 10 de gracia → 12)</option>
              </select>
            </Campo>
          </>
        )}
        {t.modo === "BOLSA_PERIODO" && (
          <>
            <Campo etiqueta="Minutos de la bolsa" ayuda="Se gastan vez por vez dentro del mismo período de pago.">
              <input className="input w-20" type="number" min={1} aria-label={`${titulo}: minutos de la bolsa`} value={t.minutos} onChange={(e) => onCambiar({ ...regla, tolerancia: { ...t, minutos: minutos(e.target.value) } })} />
            </Campo>
            <Campo etiqueta="Al agotarse la bolsa">
              <select className="input" value={t.alAgotarse} onChange={(e) => onCambiar({ ...regla, tolerancia: { ...t, alAgotarse: e.target.value as "SOLO_EXCEDENTE" | "TOTAL_ACUMULADO" } })}>
                <option value="SOLO_EXCEDENTE">Se descuenta sólo lo que pasa</option>
                <option value="TOTAL_ACUMULADO">Se descuenta todo lo acumulado</option>
              </select>
            </Campo>
          </>
        )}
      </div>
    </fieldset>
  );
}

const valorSeptimo = (r: ReglaSeptimo) => (r.modo === "PROPORCIONAL" ? `PROPORCIONAL_${r.diasSemana}` : r.modo);
const leerSeptimo = (v: string): ReglaSeptimo =>
  v === "PROPORCIONAL_5" ? { modo: "PROPORCIONAL", diasSemana: 5 } : v === "PROPORCIONAL_6" ? { modo: "PROPORCIONAL", diasSemana: 6 } : { modo: v as "DIA_COMPLETO" | "NINGUNO" };

export default function PoliticaAsistenciaConfig() {
  const { avisar } = useAvisos();
  const [p, setP] = useState<PoliticaAsistencia | null>(null);
  const [guardada, setGuardada] = useState<PoliticaAsistencia | null>(null);
  const [porOmision, setPorOmision] = useState<PoliticaAsistencia | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/configuracion/asistencia")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "No se pudo leer la política.");
        if (vivo) { setP(d.politica); setGuardada(d.politica); setPorOmision(d.porOmision); }
      })
      .catch((e) => vivo && setError(e instanceof Error ? e.message : "No se pudo leer la política."));
    return () => { vivo = false; };
  }, []);

  if (!p) return <div className="panel p-5 text-sm text-gray-600">{error ?? "Cargando la política de asistencia…"}</div>;
  const cambia = JSON.stringify(p) !== JSON.stringify(guardada);
  const avisos = riesgos(p);
  const a = p.ausencias;

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch("/api/configuracion/asistencia", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ politica: p }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error([d.error, ...(d.detalle ?? [])].filter(Boolean).join(" ") || "No se pudo guardar.");
      setGuardada(d.politica);
      setP(d.politica);
      avisar.exito("Política de asistencia guardada. Rige para las planillas que se calculen desde ahora.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="max-w-4xl space-y-5" data-politica-asistencia>
      <div className="panel space-y-2 p-5">
        <h2 className="text-base font-semibold text-gray-900">Deducciones por asistencia</h2>
        <p className="text-sm text-gray-600">
          Qué se descuenta en la planilla por ausencias, séptimo día, permisos sin goce y, si lo enciende, llegadas tarde y salidas
          anticipadas. Rige para toda la empresa y para las planillas que se calculen después de guardar; una planilla cerrada no cambia.
        </p>
        <label className="mt-2 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={p.descontarTiempo} onChange={(e) => setP({ ...p, descontarTiempo: e.target.checked })} data-interruptor-tiempo />
          <span>
            <span className="block font-medium text-gray-900">Descontar llegadas tarde y salidas anticipadas</span>
            <span className="block text-gray-600">
              {p.descontarTiempo
                ? "Encendido: se miden contra el horario del turno de cada día y se descuentan con las reglas de abajo."
                : "Apagado: sólo se descuentan ausencias y permisos sin goce. Las reglas de abajo quedan listas para cuando lo encienda."}
            </span>
          </span>
        </label>
        <p className="text-xs text-gray-500">
          La compensación es automática: si alguien llega tarde y se queda después hasta completar su jornada, esos minutos no se
          descuentan, porque ya los trabajó y no se le pagan como extra.
        </p>
      </div>

      <div className={`space-y-4 ${p.descontarTiempo ? "" : "opacity-70"}`}>
        <ReglaTiempoCampos titulo="Llegadas tarde" prefijo="tardanzas" regla={p.tardanzas} onCambiar={(r) => setP({ ...p, tardanzas: r })} />
        <ReglaTiempoCampos titulo="Salidas anticipadas" prefijo="salidas" regla={p.salidasAnticipadas} onCambiar={(r) => setP({ ...p, salidasAnticipadas: r })} />
        <fieldset className="space-y-3 rounded-lg border border-gray-200 p-4">
          <legend className="px-1 text-sm font-semibold text-gray-900">Llegada muy tarde</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={p.umbralAusencia.activo} onChange={(e) => setP({ ...p, umbralAusencia: { ...p.umbralAusencia, activo: e.target.checked } })} />
            Convertirla en ausencia cuando pase de
            <input className="input w-20" type="number" min={1} aria-label="Minutos del umbral" value={p.umbralAusencia.minutos} onChange={(e) => setP({ ...p, umbralAusencia: { ...p.umbralAusencia, minutos: minutos(e.target.value) } })} />
            minutos
          </label>
          {p.umbralAusencia.activo && (
            <Campo etiqueta="Si se le dejó trabajar el resto del día, se descuenta" ayuda="Si no se le dejó entrar, es ausencia del día completo. Lo que pase del tiempo no trabajado se topa (ver Protección).">
              <select className="input" value={p.umbralAusencia.siTrabajo} onChange={(e) => setP({ ...p, umbralAusencia: { ...p.umbralAusencia, siTrabajo: e.target.value as "MEDIA_JORNADA" | "DIA_COMPLETO" } })}>
                <option value="MEDIA_JORNADA">Media jornada</option>
                <option value="DIA_COMPLETO">Día completo</option>
              </select>
            </Campo>
          )}
        </fieldset>
      </div>

      <fieldset className="space-y-4 rounded-lg border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-900">Ausencias y séptimo día</legend>
        <p className="text-sm text-gray-600">
          Sólo la falta injustificada toca el séptimo, y una vez por semana como máximo. El permiso con goce y la incapacidad no se
          descuentan aquí; el permiso sin goce descuenta el día, sin séptimo.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {FRECUENCIAS.map(({ f, nombre }) => (
            <Campo key={f} etiqueta={nombre}>
              <select className="input" aria-label={`Séptimo: ${nombre}`} value={valorSeptimo(a.septimo[f])} onChange={(e) => setP({ ...p, ausencias: { ...a, septimo: { ...a.septimo, [f]: leerSeptimo(e.target.value) } } })}>
                <option value="DIA_COMPLETO">Día faltado + séptimo completo</option>
                <option value="NINGUNO">Sólo el día faltado</option>
                <option value="PROPORCIONAL_6">Día + 1/6 de séptimo por falta</option>
                <option value="PROPORCIONAL_5">Día + 1/5 de séptimo por falta</option>
              </select>
            </Campo>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo etiqueta="Media jornada injustificada">
            <select className="input" value={a.fraccionMinimaParaSeptimo < 1 ? "SI" : "NO"} onChange={(e) => setP({ ...p, ausencias: { ...a, fraccionMinimaParaSeptimo: e.target.value === "SI" ? 0.5 : 1 } })}>
              <option value="NO">No toca el séptimo</option>
              <option value="SI">También toca el séptimo</option>
            </select>
          </Campo>
          <Campo etiqueta="Falta en día corto (sábado de 4 h)">
            <select className="input" value={a.diaCorto.descuento} onChange={(e) => setP({ ...p, ausencias: { ...a, diaCorto: { ...a.diaCorto, descuento: e.target.value as "PROPORCIONAL" | "DIA_COMPLETO" } } })}>
              <option value="PROPORCIONAL">Sus horas (4 de 8 = medio día)</option>
              <option value="DIA_COMPLETO">Un día completo</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={a.diaCorto.cuentaParaSeptimo} onChange={(e) => setP({ ...p, ausencias: { ...a, diaCorto: { ...a.diaCorto, cuentaParaSeptimo: e.target.checked } } })} />
              toca el séptimo
            </label>
          </Campo>
          <Campo etiqueta="Falta junto a un feriado">
            <select className="input" value={a.feriadoAdyacente} onChange={(e) => setP({ ...p, ausencias: { ...a, feriadoAdyacente: e.target.value as PoliticaAsistencia["ausencias"]["feriadoAdyacente"] } })}>
              <option value="IGNORAR">No hacer nada especial</option>
              <option value="ALERTAR">Avisar para revisarla</option>
              <option value="DESCONTAR_FERIADO">Descontar también el feriado</option>
            </select>
          </Campo>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-900">Valor del día y protección</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Salario mensual dividido entre" ayuda="El valor de la hora es el del día entre las horas de la jornada del turno.">
            <select className="input" value={p.divisor.tipo} onChange={(e) => setP({ ...p, divisor: e.target.value === "LABORABLES" ? { tipo: "LABORABLES", dias: 26 } : { tipo: e.target.value as "TREINTA" | "DIAS_REALES" } })}>
              <option value="TREINTA">30 días</option>
              <option value="DIAS_REALES">Los días del mes (28 a 31)</option>
              <option value="LABORABLES">Días laborables fijos</option>
            </select>
            {p.divisor.tipo === "LABORABLES" && (
              <input className="input w-20" type="number" min={1} max={31} aria-label="Días laborables" value={p.divisor.dias} onChange={(e) => setP({ ...p, divisor: { tipo: "LABORABLES", dias: Math.min(31, minutos(e.target.value)) } })} />
            )}
          </Campo>
          <Campo etiqueta="Si una regla descontaría más que el tiempo no trabajado">
            <select className="input" value={p.proteccion.excesoSobreTiempoReal} onChange={(e) => setP({ ...p, proteccion: { excesoSobreTiempoReal: e.target.value as "TOPAR" | "PERMITIR_CON_ALERTA" } })} data-proteccion>
              <option value="TOPAR">Descontar sólo el tiempo no trabajado (recomendado)</option>
              <option value="PERMITIR_CON_ALERTA">Descontarlo igual y dejar una alerta</option>
            </select>
          </Campo>
        </div>
      </fieldset>

      {avisos.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert" data-riesgos>
          <p className="font-semibold">Riesgo legal con esta política</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">{avisos.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
        <button type="button" className="btn btn-secondary" disabled={!porOmision} onClick={() => porOmision && setP(porOmision)}>
          Volver a los valores por omisión
        </button>
        <button type="button" className="btn btn-primary" disabled={guardando || !cambia} onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </section>
  );
}
