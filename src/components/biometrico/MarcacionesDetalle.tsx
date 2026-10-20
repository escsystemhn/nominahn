"use client";

/**
 * Marcaciones crudas del reloj, una fila por marca.
 *
 * Es la vista que contesta «¿de dónde salieron estas 8.5 horas?». `Marcaje`
 * guarda el agregado del día; aquí están las marcas que lo produjeron, con su
 * hora exacta, el PIN con que se registraron y el equipo que las reportó.
 *
 * Se carga bajo demanda y no desde el servidor de la página: un reloj acumula
 * miles de marcas y no tiene sentido enviarlas todas para mostrar las últimas
 * cien.
 */

import { useEffect, useState } from "react";

interface EventoDetalle {
  id: string;
  pin: string;
  ocurridoEn: string;
  fechaLocal: string;
  tipo: "ENTRADA" | "SALIDA" | "DESCONOCIDO";
  estado: "PENDIENTE" | "PROCESADO" | "CUARENTENA" | "DESCARTADO";
  verificacion: string | null;
  motivo: string | null;
  dispositivo: string;
  marca: string;
  empleado: string | null;
}

interface Props {
  dispositivos: { id: string; nombre: string }[];
  empleados: { id: string; etiqueta: string }[];
}

const POR_PAGINA = 100;

const COLOR_ESTADO: Record<EventoDetalle["estado"], string> = {
  PROCESADO: "bg-green-100 text-green-800",
  PENDIENTE: "bg-blue-100 text-blue-800",
  CUARENTENA: "bg-amber-100 text-amber-800",
  DESCARTADO: "bg-gray-100 text-gray-600",
};

const ETIQUETA_TIPO: Record<EventoDetalle["tipo"], string> = {
  ENTRADA: "Entrada",
  SALIDA: "Salida",
  DESCONOCIDO: "—",
};

/** Instante real: se muestra en hora de Honduras, que es lo que el usuario espera leer. */
function horaHN(iso: string) {
  return new Date(iso).toLocaleString("es-HN", { dateStyle: "short", timeStyle: "medium" });
}

/** `fechaLocal` es de CALENDARIO: vive en UTC y se formatea ahí. Ver lib/utils.ts. */
function diaCalendario(iso: string) {
  return new Intl.DateTimeFormat("es-HN", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
  }).format(new Date(iso));
}

export default function MarcacionesDetalle({ dispositivos, empleados }: Props) {
  const [filtros, setFiltros] = useState({
    dispositivoId: "",
    empleadoId: "",
    estado: "",
    pin: "",
    desde: "",
    hasta: "",
  });
  const [eventos, setEventos] = useState<EventoDetalle[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Se incrementa para forzar una recarga con los mismos filtros. */
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    // `vivo` descarta la respuesta de una consulta que ya no interesa. Sin él,
    // cambiar de filtro rápido puede hacer que la respuesta LENTA del filtro
    // viejo llegue después y pise a la del nuevo.
    let vivo = true;

    (async () => {
      const q = new URLSearchParams({
        limite: String(POR_PAGINA),
        salto: String(pagina * POR_PAGINA),
      });
      for (const [k, v] of Object.entries(filtros)) if (v) q.set(k, v);

      try {
        const res = await fetch(`/api/biometrico/eventos?${q}`);
        const data = await res.json();
        if (!vivo) return;

        if (!res.ok) throw new Error(data.error ?? "No se pudieron cargar las marcaciones");
        setEventos(data.eventos);
        setTotal(data.total);
        setError(null);
      } catch (e) {
        if (!vivo) return;
        setError(e instanceof Error ? e.message : "Error al cargar");
        setEventos([]);
        setTotal(0);
      } finally {
        if (vivo) setCargando(false);
      }
    })();

    return () => {
      vivo = false;
    };
  }, [filtros, pagina, recarga]);

  /** Cambiar un filtro vuelve a la primera página: si no, se queda en una vacía. */
  function filtrar(campo: keyof typeof filtros, valor: string) {
    setCargando(true);
    setFiltros((f) => ({ ...f, [campo]: valor }));
    setPagina(0);
  }

  function irAPagina(p: number) {
    setCargando(true);
    setPagina(p);
  }

  function recargar() {
    setCargando(true);
    setRecarga((r) => r + 1);
  }

  const desde = total === 0 ? 0 : pagina * POR_PAGINA + 1;
  const hasta = Math.min((pagina + 1) * POR_PAGINA, total);
  const campoClase =
    "px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <select
            value={filtros.dispositivoId}
            onChange={(e) => filtrar("dispositivoId", e.target.value)}
            className={campoClase}
          >
            <option value="">Todos los equipos</option>
            {dispositivos.map((d) => (
              <option key={d.id} value={d.id}>{d.nombre}</option>
            ))}
          </select>

          <select
            value={filtros.empleadoId}
            onChange={(e) => filtrar("empleadoId", e.target.value)}
            className={`${campoClase} col-span-2`}
          >
            <option value="">Todos los empleados</option>
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>{e.etiqueta}</option>
            ))}
          </select>

          <select
            value={filtros.estado}
            onChange={(e) => filtrar("estado", e.target.value)}
            className={campoClase}
          >
            <option value="">Todos los estados</option>
            <option value="PROCESADO">Procesado</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="CUARENTENA">En cuarentena</option>
            <option value="DESCARTADO">Descartado</option>
          </select>

          <input
            type="date"
            value={filtros.desde}
            onChange={(e) => filtrar("desde", e.target.value)}
            className={campoClase}
            aria-label="Desde"
          />
          <input
            type="date"
            value={filtros.hasta}
            onChange={(e) => filtrar("hasta", e.target.value)}
            className={campoClase}
            aria-label="Hasta"
          />
        </div>

        <div className="flex items-center justify-between mt-3">
          <input
            value={filtros.pin}
            onChange={(e) => filtrar("pin", e.target.value)}
            placeholder="Filtrar por PIN exacto…"
            className={`${campoClase} font-mono w-56`}
          />
          <button
            onClick={recargar}
            disabled={cargando}
            className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {cargando ? "Cargando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 text-sm">
            Marcaciones del reloj
            {total > 0 && (
              <span className="ml-2 font-normal text-gray-500">
                {desde}–{hasta} de {total}
              </span>
            )}
          </h2>
          {total > POR_PAGINA && (
            <div className="flex gap-2">
              <button
                onClick={() => irAPagina(Math.max(pagina - 1, 0))}
                disabled={pagina === 0 || cargando}
                className="px-3 py-1 border border-gray-300 text-xs rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => irAPagina(pagina + 1)}
                disabled={hasta >= total || cargando}
                className="px-3 py-1 border border-gray-300 text-xs rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Marca</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Día laboral</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Empleado</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">PIN</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Equipo</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Verificación</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {eventos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-gray-400">
                    {cargando
                      ? "Cargando marcaciones…"
                      : "No hay marcaciones con estos filtros. Sincronice un dispositivo para traerlas."}
                  </td>
                </tr>
              ) : (
                eventos.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-900 whitespace-nowrap">
                      {horaHN(e.ocurridoEn)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                      {diaCalendario(e.fechaLocal)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-900">
                      {e.empleado ?? <span className="text-amber-700 italic">Sin asignar</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-blue-700">{e.pin}</td>
                    <td className="px-4 py-2.5 text-gray-600">{e.dispositivo}</td>
                    <td className="px-4 py-2.5 text-gray-600">{ETIQUETA_TIPO[e.tipo]}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{e.verificacion ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${COLOR_ESTADO[e.estado]}`}
                        title={e.motivo ?? undefined}
                      >
                        {e.estado === "CUARENTENA" ? "En cuarentena" : e.estado.toLowerCase()}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        <strong>Marca</strong> es el instante exacto que reportó el equipo, en hora de Honduras.{" "}
        <strong>Día laboral</strong> es la jornada a la que se imputa: no siempre coinciden, porque
        una marca de las 23:40 pertenece al día que termina, no al que empieza.
      </p>
    </div>
  );
}
