"use client";

import { useEffect } from "react";
import { PRODUCTO } from "@/lib/marca";

/**
 * El último recurso: falló el armazón mismo, así que no hay fuentes ni estilos
 * propios en los que apoyarse y todo va escrito aquí.
 */
export default function ErrorGeneral({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", color: "#0d2b38", background: "#f4f7f8", margin: 0 }}>
        <main style={{ maxWidth: 440, margin: "20vh auto 0", padding: "0 16px" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{PRODUCTO} no pudo abrirse</h1>
          <p style={{ fontSize: 14, color: "#4d5f6a", marginTop: 8 }}>
            Sus datos no se perdieron. Intente de nuevo; si sigue igual, avise a soporte.
            {error.digest && <> Código: {error.digest}.</>}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 16, height: 36, padding: "0 14px", border: 0, borderRadius: 8, background: "#0a6a82", color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" }}
          >
            Intentar de nuevo
          </button>
        </main>
      </body>
    </html>
  );
}
