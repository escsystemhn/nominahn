import Link from "next/link";

/** Pie de una lista larga. Si todo cabe en una página, no se dibuja. */
export default function Paginacion({ pagina, totalPaginas, enlace }: { pagina: number; totalPaginas: number; enlace: (n: number) => string }) {
  if (totalPaginas <= 1) return null;
  return (
    <nav aria-label="Páginas de la lista" className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm text-gray-500">
      <span>
        Página {pagina} de {totalPaginas}
      </span>
      <div className="flex gap-2">
        {pagina > 1 && (
          <Link href={enlace(pagina - 1)} className="btn btn-secondary btn-sm">
            Anterior
          </Link>
        )}
        {pagina < totalPaginas && (
          <Link href={enlace(pagina + 1)} className="btn btn-secondary btn-sm">
            Siguiente
          </Link>
        )}
      </div>
    </nav>
  );
}
