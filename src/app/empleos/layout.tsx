/**
 * Armazón del portal público de empleo. Lleva el nombre del empleador, no el de
 * la aplicación: quien busca trabajo busca a la empresa.
 */

import Link from "next/link";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";

export default async function EmpleosLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const empresa = await prisma.empresa.findFirst({ where: { activa: true }, select: { nombre: true } });
  const nombre = empresa?.nombre ?? "Empleos";

  return (
    <div className="min-h-screen border-t-4 border-[#20B1D2] bg-white text-gray-900">
      <header className="border-b border-gray-200">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-4 py-5 sm:px-6">
          <Link href="/empleos" className="text-lg font-semibold tracking-tight text-blue-900 hover:text-blue-700">
            {nombre}
          </Link>
          <span className="hidden text-sm text-gray-500 sm:inline">Trabaje con nosotros</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
      <footer className="border-t border-gray-200">
        <p className="mx-auto max-w-5xl px-4 py-6 text-xs text-gray-500 sm:px-6">
          {nombre.endsWith(".") ? nombre : `${nombre}.`} Los datos que envíe se usan sólo para procesos de selección de personal.
        </p>
      </footer>
    </div>
  );
}
