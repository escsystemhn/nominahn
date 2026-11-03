import { formatCurrency, formatDate } from "@/lib/utils";
import { CAMBIO_GRANDE, type PartidaPuente, type RevisionPlanilla as Revision } from "@/lib/payroll/revision-planilla";
import type { PlanillaAnterior } from "@/lib/payroll/revision-planilla-bd";
import type { Money } from "@/lib/payroll/money";

/** Cuántas personas se ven sin abrir nada: lo demás queda a un clic. */
const VISIBLES = 8;

/** Con signo siempre: en una conciliación el signo es el dato. */
const conSigno = (m: Money) => `${m.isNegative() ? "−" : "+"}${formatCurrency(m.abs())}`;
const personas = (n: number) => (n === 1 ? "1 persona" : `${n} personas`);

function textoPartida(p: PartidaPuente): string {
  switch (p.clave) {
    case "entran":
      return `${p.personas === 1 ? "Entra" : "Entran"} ${personas(p.personas ?? 0)}`;
    case "salen":
      return `${p.personas === 1 ? "Sale" : "Salen"} ${personas(p.personas ?? 0)}`;
    case "ingresos":
      return p.monto.isPositive() ? "Más ingresos de quienes siguen" : "Menos ingresos de quienes siguen";
    case "deducciones":
      return p.monto.isPositive() ? "Menos deducciones de quienes siguen" : "Más deducciones de quienes siguen";
    case "otros":
      return "Otros ajustes";
  }
}

function Nombres({ gente }: { gente: Array<{ empleadoId: string; nombre: string }> }) {
  return <p className="mt-1 text-xs text-gray-600">{gente.map((g) => g.nombre).join(", ")}.</p>;
}

/**
 * La conciliación de la planilla, como la haría un contador en papel: del neto anterior
 * al de ahora, partida por partida, con la raya simple y la doble bajo el total.
 */
export default function RevisionPlanilla({ revision: r, anterior, accion }: { revision: Revision; anterior: PlanillaAnterior | null; accion: "confirmar" | "aprobar" }) {
  const gente = r.cambios.slice(0, VISIBLES);
  const resto = r.cambios.slice(VISIBLES);

  const filaCambio = (c: Revision["cambios"][number]) => (
    <tr key={c.empleadoId}>
      <td data-titulo className="font-medium text-gray-900">{c.nombre}</td>
      <td data-etiqueta="Antes" className="num whitespace-nowrap text-gray-500">{formatCurrency(c.antes)}</td>
      <td data-etiqueta="Ahora" className="num whitespace-nowrap">{formatCurrency(c.ahora)}</td>
      <td data-etiqueta="Diferencia" className="num whitespace-nowrap font-medium text-gray-900">{conSigno(c.diferencia)}</td>
      <td data-etiqueta="Por qué" className="text-gray-600">{c.motivos.join(". ")}.</td>
    </tr>
  );
  const encabezado = (
    <thead>
      <tr>
        <th>Empleado</th>
        <th className="num">Antes</th>
        <th className="num">Ahora</th>
        <th className="num">Diferencia</th>
        <th>Por qué</th>
      </tr>
    </thead>
  );

  return (
    <section aria-labelledby="revision-titulo" className="panel overflow-hidden">
      <div className="border-b border-gray-200 px-5 py-4">
        <h2 id="revision-titulo" className="text-base font-semibold text-gray-900">Revisar antes de {accion}</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          {anterior
            ? `Frente a la planilla del ${formatDate(anterior.fechaInicio)} al ${formatDate(anterior.fechaFin)}, de este mismo tipo y alcance.`
            : "Es la primera de este tipo y alcance: no hay con qué compararla."}
        </p>
      </div>

      <div className="grid grid-cols-1 divide-y divide-gray-200 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:divide-x lg:divide-y-0">
        {r.hayAnterior ? (
          <div className="px-5 py-4">
            <dl className="tnum text-sm">
              <div className="flex items-baseline justify-between gap-4 py-1">
                <dt className="text-gray-600">Neto de la planilla anterior</dt>
                <dd className="whitespace-nowrap text-gray-900">{formatCurrency(r.netoAnterior)}</dd>
              </div>
              {r.puente.map((p) => (
                <div key={p.clave} className="flex items-baseline justify-between gap-4 py-1">
                  <dt className="pl-3 text-gray-600">{textoPartida(p)}</dt>
                  <dd className="whitespace-nowrap text-gray-900">{conSigno(p.monto)}</dd>
                </div>
              ))}
              {r.puente.length === 0 && (
                <p className="py-1 pl-3 text-gray-500">Nadie entra, nadie sale y todos cobran lo mismo.</p>
              )}
              {/* Raya simple sobre el total y doble debajo: así se cierra una cuenta. */}
              <div className="mt-1 flex items-baseline justify-between gap-4 border-b-[3px] border-t border-double border-b-gray-900 border-t-gray-900 py-2">
                <dt className="font-semibold text-gray-900">Neto de esta planilla</dt>
                <dd className="whitespace-nowrap text-lg font-semibold text-gray-900">{formatCurrency(r.netoActual)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-gray-600">
              {r.diferencia.isZero()
                ? "El neto no cambia."
                : `El neto ${r.diferencia.isPositive() ? "sube" : "baja"} ${formatCurrency(r.diferencia.abs())}${r.proporcion === null ? "" : `, un ${(r.proporcion * 100).toFixed(1)} %`}.`}
            </p>
            {r.entran.length > 0 && (
              <div className="mt-3 text-sm">
                <p className="font-medium text-gray-900">Entran</p>
                <Nombres gente={r.entran} />
              </div>
            )}
            {r.salen.length > 0 && (
              <div className="mt-3 text-sm">
                <p className="font-medium text-gray-900">Salen</p>
                <Nombres gente={r.salen} />
              </div>
            )}
          </div>
        ) : (
          <div className="px-5 py-4 text-sm text-gray-600">
            <p>
              Neto de esta planilla: <span className="tnum font-semibold text-gray-900">{formatCurrency(r.netoActual)}</span>.
            </p>
            <p className="mt-1">Cuando exista una anterior, aquí se verá qué cambió y por qué.</p>
          </div>
        )}

        <div className="px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Para revisar</h3>
          {r.puntos.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">No encontramos nada fuera de lo normal.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {r.puntos.map((p) => (
                <li key={p.clave} className="text-sm">
                  <p className="text-gray-900">
                    <span className="tnum font-semibold">{p.personas.length}</span> {p.titulo}
                  </p>
                  {p.personas.length <= 5 ? (
                    <Nombres gente={p.personas} />
                  ) : (
                    <details className="mt-1 text-xs text-gray-600">
                      <summary className="cursor-pointer text-blue-600">Ver quiénes</summary>
                      <Nombres gente={p.personas} />
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {r.cambios.length > 0 && (
        <div className="border-t border-gray-200">
          <h3 className="px-5 pb-2 pt-4 text-sm font-semibold text-gray-900">
            Quién cobra distinto
            <span className="ml-2 font-normal text-gray-500">
              {r.cambios.length === 1 ? "1 persona" : `${r.cambios.length} personas`}
              {r.sinCambio > 0 && `, ${r.sinCambio} sin cambio`}
            </span>
          </h3>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Quién cobra distinto">
            <table className="table-base tabla-tarjetas">
              {encabezado}
              <tbody>{gente.map(filaCambio)}</tbody>
            </table>
          </div>
          {resto.length > 0 && (
            <details className="border-t border-gray-200">
              <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-blue-600">
                Ver {resto.length === 1 ? "la otra persona" : `las otras ${resto.length} personas`}
              </summary>
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Las demás personas que cobran distinto">
                <table className="table-base tabla-tarjetas">
                  {encabezado}
                  <tbody>{resto.map(filaCambio)}</tbody>
                </table>
              </div>
            </details>
          )}
          <p className="sr-only">Se marca para revisar un cambio de más de {CAMBIO_GRANDE * 100} % en el neto de una persona.</p>
        </div>
      )}
    </section>
  );
}
