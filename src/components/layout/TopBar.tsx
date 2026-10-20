"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import type { Session } from "next-auth";
import { iniciales } from "@/lib/utils";

/**
 * Barra superior: a la izquierda, de quién son los libros que se están viendo
 * (la empresa cliente); a la derecha, quién ha iniciado sesión.
 *
 * Antes decía «Sistema Integral de Recursos Humanos», una línea que no
 * respondía a ninguna pregunta de la persona que trabaja la planilla.
 */
export default function TopBar({
  user,
  empresa,
}: {
  user: Session["user"];
  /** Nombre de la empresa configurada; sin ella se muestra el producto. */
  empresa?: string | null;
}) {
  const nombre = user?.name ?? user?.email ?? "Usuario";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div className="min-w-0 text-sm">
        <span className="font-medium text-gray-900">{empresa ?? "NominaHN"}</span>
      </div>

      <div className="flex items-center gap-1">
        {/* Único punto de entrada a la propia cuenta: la contraseña se cambia
            desde ahí, y las cuentas sin empleado vinculado no tienen Mi espacio. */}
        <Link
          href="/mi-cuenta"
          className="group flex items-center gap-3 rounded-md py-1 pl-2 pr-1 transition-colors hover:bg-gray-50"
          title="Mi cuenta"
        >
          <div className="text-right leading-tight">
            <p className="text-sm font-medium text-gray-900">{nombre}</p>
            <p className="text-xs text-gray-500">{user?.email}</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-900 text-xs font-semibold text-white">
            {iniciales(nombre)}
          </div>
        </Link>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="btn btn-ghost h-8 px-2.5 text-xs"
          title="Cerrar sesión"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Salir
        </button>
      </div>
    </header>
  );
}
