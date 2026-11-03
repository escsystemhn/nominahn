import Link from "next/link";

export const metadata = { title: "Página no encontrada" };

/** Una dirección que no existe en el sistema, con o sin sesión iniciada. */
export default function PaginaNoEncontrada() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="panel w-full max-w-md p-6">
        <h1 className="text-xl font-semibold text-gray-900">No encontramos esa página</h1>
        <p className="mt-1 text-sm text-gray-500">Revise la dirección o vuelva al inicio.</p>
        <Link href="/dashboard" className="btn btn-primary mt-5">
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
