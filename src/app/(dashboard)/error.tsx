"use client";

import { startTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { SOPORTE } from "@/lib/inicio-sesion";

/** Una pantalla que falla no se lleva por delante el menú: desde aquí se puede seguir trabajando. */
export default function ErrorDePantalla({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
  }, [error]);

  // `reset` sólo vuelve a dibujar: si lo que falló fue el servidor, hay que pedirle los datos otra vez.
  const reintentar = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="No se pudo cargar esta pantalla"
        description="Sus datos no se perdieron. Puede intentarlo de nuevo o volver al inicio."
        actions={
          <>
            <Link href="/dashboard" className="btn btn-secondary">
              Ir al inicio
            </Link>
            <button type="button" className="btn btn-primary" onClick={reintentar}>
              Intentar de nuevo
            </button>
          </>
        }
      />
      <p className="max-w-xl text-sm text-gray-600">
        Si vuelve a pasar, escriba a soporte a{" "}
        <a href={`mailto:${SOPORTE.correo}`} className="text-blue-600 hover:underline">
          {SOPORTE.correo}
        </a>
        {error.digest && (
          <>
            {" "}
            e indique este código: <span className="font-mono text-gray-900">{error.digest}</span>
          </>
        )}
        .
      </p>
    </div>
  );
}
