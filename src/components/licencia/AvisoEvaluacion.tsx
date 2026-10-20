import Link from "next/link";
import { textoAviso, type Evaluacion } from "@/lib/licencia/evaluacion";

/**
 * Aviso de los últimos días de la evaluación (del 25 al 30). Va en todas las
 * pantallas del panel, bajo la barra superior, y lleva directo a activar.
 */
export default function AvisoEvaluacion({ evaluacion }: { evaluacion: Evaluacion }) {
  const ultimo = evaluacion.diasRestantes === 1;
  return (
    <div
      role="status"
      className={`flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-6 py-2.5 text-sm ${
        ultimo ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      <p>
        <span className="font-semibold">Versión de evaluación.</span> {textoAviso(evaluacion)} Después, el sistema se
        detiene hasta activar una licencia; sus datos se conservan.
      </p>
      <Link href="/licencia" className="font-medium underline underline-offset-2 hover:no-underline">
        Activar licencia
      </Link>
    </div>
  );
}
