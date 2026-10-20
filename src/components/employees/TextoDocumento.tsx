/**
 * Vista en pantalla del texto de un documento: párrafos y `**negrita**`, igual
 * que el PDF. Las líneas para llenar a mano se resaltan para que se vean.
 */

import { Fragment } from "react";
import { LINEA_VACIA } from "@/lib/documentos/plantillas";

function linea(texto: string, k: string) {
  const partes = texto.split(/(\*\*[^*]+\*\*|_{10})/g).filter((p) => p !== "");
  return partes.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={`${k}-${i}`}>{p.slice(2, -2)}</strong>;
    if (p === LINEA_VACIA) return <mark key={`${k}-${i}`} className="rounded bg-amber-100 px-1 text-amber-900">{p}</mark>;
    return <Fragment key={`${k}-${i}`}>{p}</Fragment>;
  });
}

export default function TextoDocumento({ titulo, texto }: { titulo?: string; texto: string }) {
  const parrafos = texto.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <article className="rounded-md border border-gray-200 bg-white px-6 py-5 text-[13px] leading-relaxed text-gray-800">
      {titulo && <h3 className="mb-4 text-center text-sm font-semibold uppercase tracking-wide text-gray-900">{titulo}</h3>}
      {parrafos.map((p, i) => (
        <p key={i} className="mb-3 text-justify">
          {p.split("\n").map((l, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {linea(l, `${i}-${j}`)}
            </Fragment>
          ))}
        </p>
      ))}
    </article>
  );
}
