import type { ReactNode } from "react";

/**
 * Lo que se ve cuando una lista no tiene nada que mostrar: qué pasa y qué se puede
 * hacer. Una pantalla vacía es una invitación a actuar, no un error.
 */
export default function EstadoVacio({ titulo, detalle, accion }: { titulo: ReactNode; detalle?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-medium text-gray-900">{titulo}</p>
      {detalle && <p className="mt-1 text-sm text-gray-500">{detalle}</p>}
      {accion && <div className="mt-5 flex flex-wrap justify-center gap-2">{accion}</div>}
    </div>
  );
}
