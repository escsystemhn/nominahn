import { cn, formatDate } from "@/lib/utils";

const PASOS = [
  { estado: "BORRADOR", titulo: "Borrador" },
  { estado: "CALCULADA", titulo: "Confirmada" },
  { estado: "APROBADA", titulo: "Aprobada" },
  { estado: "PAGADA", titulo: "Pagada" },
] as const;

/** Lo que significa estar en cada paso: qué ya pasó y qué falta. */
const SIGNIFICA: Record<string, string> = {
  BORRADOR: "Se puede recalcular. Todavía no ha cobrado nada.",
  CALCULADA: "Ya cobró cuotas y bonos. Falta aprobarla.",
  APROBADA: "Cerrada y sellada. Falta registrar el pago.",
  PAGADA: "Pago registrado. El proceso terminó.",
};

/**
 * Dónde va la planilla en su camino. Los pasos son una secuencia de verdad: cada uno
 * dice quién lo dio y cuándo, si el sistema lo registró.
 */
export default function BarraEstadoPlanilla({
  estado,
  creada,
  aprobada,
  pagada,
}: {
  estado: string;
  creada: Date;
  aprobada?: { por?: string | null; el?: Date | null };
  pagada?: { por?: string | null; el?: Date | null };
}) {
  const actual = PASOS.findIndex((p) => p.estado === estado);
  const detalle: Record<string, string | undefined> = {
    BORRADOR: `Generada el ${formatDate(creada)}`,
    APROBADA: aprobada?.el ? [formatDate(aprobada.el), aprobada.por].filter(Boolean).join(", ") : undefined,
    PAGADA: pagada?.el ? [formatDate(pagada.el), pagada.por].filter(Boolean).join(", ") : undefined,
  };

  return (
    <nav aria-label="Estado de la planilla">
      <ol className="grid grid-cols-4">
        {PASOS.map((p, i) => {
          const hecho = i < actual;
          const enCurso = i === actual;
          return (
            <li key={p.estado} aria-current={enCurso ? "step" : undefined} className="relative min-w-0 pr-2">
              {/* La línea va hasta el paso siguiente; ya recorrida, con el color de la marca. */}
              {i < PASOS.length - 1 && (
                <span aria-hidden="true" className={cn("absolute left-3 right-0 top-3 h-0.5 -translate-y-1/2", hecho ? "bg-blue-700" : "bg-gray-200")} />
              )}
              <span
                aria-hidden="true"
                className={cn(
                  "relative flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                  hecho && "bg-blue-700 text-white",
                  enCurso && "bg-blue-700 text-white ring-4 ring-blue-200",
                  !hecho && !enCurso && "border-2 border-gray-300 bg-white text-gray-500"
                )}
              >
                {i + 1}
              </span>
              <p className={cn("mt-2 truncate text-sm", enCurso ? "font-semibold text-gray-900" : hecho ? "text-gray-700" : "text-gray-500")}>
                {p.titulo}
                {hecho && <span className="sr-only"> (hecho)</span>}
                {enCurso && <span className="sr-only"> (estado actual)</span>}
              </p>
              {(hecho || enCurso) && detalle[p.estado] && <p className="hidden truncate text-xs text-gray-500 sm:block">{detalle[p.estado]}</p>}
            </li>
          );
        })}
      </ol>
      {SIGNIFICA[estado] && <p className="mt-3 text-sm text-gray-600">{SIGNIFICA[estado]}</p>}
    </nav>
  );
}
