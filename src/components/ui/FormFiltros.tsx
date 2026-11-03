"use client";

/**
 * Filtros que se aplican solos, mientras se escribe o se elige. Los valores viven en
 * la URL, así que recargar o compartir el enlace conserva lo que se está viendo.
 *
 * Sigue siendo un formulario GET: Enter aplica de inmediato. El campo no pierde el
 * foco porque cambiar los parámetros no vuelve a montar la pantalla.
 */

import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Lo que se espera a que termine de escribir antes de consultar. */
const ESPERA_ESCRITURA_MS = 300;

export default function FormFiltros({
  campos,
  etiqueta,
  className,
  children,
}: {
  /** Los `name` de los filtros: son los que borra «Quitar filtros». */
  campos: readonly string[];
  etiqueta?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const ruta = usePathname();
  const parametros = useSearchParams();
  const [aplicando, transicion] = useTransition();
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelarEspera = () => {
    if (temporizador.current) clearTimeout(temporizador.current);
  };
  useEffect(() => cancelarEspera, []);

  function navegar(q: URLSearchParams) {
    // Una búsqueda nueva empieza en la primera página. El orden elegido se conserva.
    q.delete("page");
    const texto = q.toString();
    transicion(() => router.replace(texto ? `${ruta}?${texto}` : ruta, { scroll: false }));
  }

  function aplicar(form: HTMLFormElement) {
    const q = new URLSearchParams(parametros.toString());
    const datos = new FormData(form);
    for (const campo of campos) {
      const valor = String(datos.get(campo) ?? "").trim();
      if (valor) q.set(campo, valor);
      else q.delete(campo);
    }
    navegar(q);
  }

  function quitar(form: HTMLFormElement) {
    cancelarEspera();
    // Un campo ya editado no vuelve a su valor inicial por sí solo.
    for (const campo of campos) {
      const control = form.elements.namedItem(campo);
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) control.value = "";
    }
    const q = new URLSearchParams(parametros.toString());
    for (const campo of campos) q.delete(campo);
    navegar(q);
  }

  const hayFiltro = campos.some((c) => parametros.get(c));

  return (
    <form
      role="search"
      aria-label={etiqueta}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        cancelarEspera();
        aplicar(e.currentTarget);
      }}
      onChange={(e) => {
        const form = e.currentTarget;
        cancelarEspera();
        const escribe = (e.target as HTMLElement).tagName === "INPUT";
        temporizador.current = setTimeout(() => aplicar(form), escribe ? ESPERA_ESCRITURA_MS : 0);
      }}
    >
      {children}
      {hayFiltro && (
        <button type="button" className="btn btn-ghost" onClick={(e) => quitar(e.currentTarget.form as HTMLFormElement)}>
          Quitar filtros
        </button>
      )}
      <span aria-live="polite" className="self-center text-sm text-gray-500">
        {aplicando ? "Buscando…" : ""}
      </span>
    </form>
  );
}
