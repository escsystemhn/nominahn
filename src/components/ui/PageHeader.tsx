import type { ReactNode } from "react";

/**
 * Cabecera de pantalla: título, una línea de contexto y las acciones a la
 * derecha, cerrada por un único filete. Es la misma en todas las pantallas
 * para que la persona reconozca dónde está sin tener que leerlo dos veces.
 */
export default function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Fila opcional bajo el título (pestañas, filtros). */
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-gray-200 pb-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight text-gray-900">{title}</h1>
          {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </header>
  );
}
