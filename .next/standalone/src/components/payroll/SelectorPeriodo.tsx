"use client";

/**
 * Elegir un período de planilla por su nombre («1.ª quincena de noviembre de 2026»)
 * en lugar de escribir fechas. «Otras fechas» deja escribirlas, para una planilla
 * que no va del 1 al 15 o del 16 al fin de mes.
 */

import { useState } from "react";
import {
  ETIQUETA_TIPO_PLANILLA,
  TIPOS_PLANILLA,
  etiquetaPeriodo,
  hoyLocalIso,
  periodoQueContiene,
  periodosSugeridos,
  type PeriodoPlanilla,
  type TipoPlanillaPeriodo,
} from "@/lib/payroll/periodos-planilla";

export function periodoInicial(tipo: TipoPlanillaPeriodo = "QUINCENAL"): PeriodoPlanilla {
  return periodoQueContiene(tipo, hoyLocalIso());
}

const OTRAS = "otras";

export default function SelectorPeriodo({ valor, onCambio, id }: {
  valor: PeriodoPlanilla;
  onCambio: (p: PeriodoPlanilla) => void;
  /** Prefijo de los id de los campos, único en la pantalla. */
  id: string;
}) {
  const sugeridos = periodosSugeridos(valor.tipo, hoyLocalIso());
  const clave = (p: { desde: string; hasta: string }) => `${p.desde}|${p.hasta}`;
  const enLista = sugeridos.some((p) => clave(p) === clave(valor));
  const [aMano, setAMano] = useState(!enLista);

  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
      <label className="block text-sm" htmlFor={`${id}-tipo`}>
        <span className="font-medium text-gray-800">Planilla</span>
        <select id={`${id}-tipo`} className="input mt-1" value={valor.tipo}
          onChange={(e) => { setAMano(false); onCambio(periodoInicial(e.target.value as TipoPlanillaPeriodo)); }}>
          {TIPOS_PLANILLA.map((t) => <option key={t} value={t}>{ETIQUETA_TIPO_PLANILLA[t]}</option>)}
        </select>
      </label>
      <label className="block text-sm" htmlFor={`${id}-periodo`}>
        <span className="font-medium text-gray-800">Período</span>
        <select id={`${id}-periodo`} className="input mt-1" value={aMano ? OTRAS : clave(valor)}
          onChange={(e) => {
            if (e.target.value === OTRAS) { setAMano(true); return; }
            setAMano(false);
            const p = sugeridos.find((s) => clave(s) === e.target.value);
            if (p) onCambio(p);
          }}>
          {sugeridos.map((p) => <option key={clave(p)} value={clave(p)}>{etiquetaPeriodo(p)}</option>)}
          <option value={OTRAS}>Otras fechas…</option>
        </select>
      </label>
      {aMano && (
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <label className="block text-sm" htmlFor={`${id}-desde`}>
            <span className="font-medium text-gray-800">Desde</span>
            <input id={`${id}-desde`} type="date" className="input mt-1" value={valor.desde} onChange={(e) => onCambio({ ...valor, desde: e.target.value })} />
          </label>
          <label className="block text-sm" htmlFor={`${id}-hasta`}>
            <span className="font-medium text-gray-800">Hasta</span>
            <input id={`${id}-hasta`} type="date" className="input mt-1" value={valor.hasta} onChange={(e) => onCambio({ ...valor, hasta: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}
