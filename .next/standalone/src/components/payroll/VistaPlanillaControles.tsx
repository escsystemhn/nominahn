"use client";

/**
 * Cómo ver la planilla: el orden de los empleados dentro de cada departamento y si los
 * ingresos y las deducciones van con todas sus columnas o resumidos en su total. Se
 * aplica al momento (la tabla se dibuja en el servidor) y se recuerda en este navegador.
 * Ver `lib/payroll/vista-planilla.ts`.
 */

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  CAMPOS_ORDEN, COOKIE_VISTA_PLANILLA, direccionPorOmision, textoDireccion, textoVista, type CampoOrden, type VistaPlanilla,
} from "@/lib/payroll/vista-planilla";

const UN_ANIO = 60 * 60 * 24 * 365;

function guardar(v: VistaPlanilla) {
  const seguro = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${COOKIE_VISTA_PLANILLA}=${encodeURIComponent(textoVista(v))}; path=/; max-age=${UN_ANIO}; samesite=lax${seguro}`;
}

function Interruptor({ activo, etiqueta, onCambio, datos }: { activo: boolean; etiqueta: string; onCambio: (activo: boolean) => void; datos: string }) {
  return (
    <button type="button" role="switch" aria-checked={activo} onClick={() => onCambio(!activo)} data-interruptor={datos}
      className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm text-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:min-h-9">
      <span aria-hidden="true" className={cn("relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors motion-reduce:transition-none", activo ? "bg-blue-700" : "bg-gray-300")}>
        <span className={cn("absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none", activo && "translate-x-4")} />
      </span>
      {etiqueta}
    </button>
  );
}

export default function VistaPlanillaControles({ vista }: { vista: VistaPlanilla }) {
  const router = useRouter();
  const id = useId();
  const [actual, setActual] = useState(vista);
  const [aplicando, transicion] = useTransition();

  function aplicar(v: VistaPlanilla) {
    setActual(v);
    guardar(v);
    transicion(() => router.refresh());
  }

  const sentido = textoDireccion(actual.orden, actual.dir);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2" data-vista-planilla aria-busy={aplicando}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-orden`} className="text-sm text-gray-700">Ordenar por</label>
        <select id={`${id}-orden`} className="input w-auto" value={actual.orden}
          onChange={(e) => {
            const orden = e.target.value as CampoOrden;
            aplicar({ ...actual, orden, dir: direccionPorOmision(orden) });
          }}>
          {CAMPOS_ORDEN.map((c) => <option key={c.clave} value={c.clave}>{c.etiqueta}</option>)}
        </select>
        {/* El botón dice el sentido de hoy; al pulsarlo, lo invierte. */}
        <button type="button" className="btn btn-secondary" data-direccion
          aria-label={`Sentido del orden: ${sentido}. Pulse para invertirlo.`}
          onClick={() => aplicar({ ...actual, dir: actual.dir === "asc" ? "desc" : "asc" })}>
          {sentido}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-5">
        <Interruptor datos="ingresos" etiqueta="Detalle de ingresos" activo={actual.ingresos === "todo"}
          onCambio={(on) => aplicar({ ...actual, ingresos: on ? "todo" : "resumen" })} />
        <Interruptor datos="deducciones" etiqueta="Detalle de deducciones" activo={actual.deducciones === "todo"}
          onCambio={(on) => aplicar({ ...actual, deducciones: on ? "todo" : "resumen" })} />
      </div>
      {aplicando && <span role="status" className="text-xs text-gray-500">Aplicando…</span>}
    </div>
  );
}
