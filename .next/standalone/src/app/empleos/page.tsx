import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDateLong } from "@/lib/utils";
import { FILTRO_VACANTE_PUBLICA, SELECT_VACANTE_PUBLICA, TIPO_CONTRATO_PUBLICO, textoSalario } from "@/lib/talento/empleos";
import { ORDEN_EMPRESA_PRINCIPAL } from "@/lib/empresa";

export async function generateMetadata(): Promise<Metadata> {
  const empresa = await prisma.empresa.findFirst({ where: { activa: true }, select: { nombre: true }, orderBy: ORDEN_EMPRESA_PRINCIPAL });
  return {
    title: { absolute: empresa ? `Empleos en ${empresa.nombre}` : "Empleos" },
    description: empresa ? `Vacantes abiertas en ${empresa.nombre}.` : "Vacantes abiertas.",
  };
}

export default async function EmpleosPage() {
  await connection();
  const vacantes = await prisma.vacante.findMany({
    where: FILTRO_VACANTE_PUBLICA,
    select: SELECT_VACANTE_PUBLICA,
    orderBy: { fechaApertura: "desc" },
  });

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight text-blue-900">Vacantes abiertas</h1>
      <p className="mt-2 max-w-2xl text-gray-600">
        Elija un puesto, lea lo que pide y envíe su currículo en PDF. No necesita crear una cuenta.
      </p>

      {vacantes.length === 0 ? (
        <p className="mt-10 border-t border-gray-200 pt-6 text-gray-600">
          No hay vacantes abiertas en este momento. Vuelva a consultar más adelante.
        </p>
      ) : (
        <ul className="mt-10 divide-y divide-gray-200 border-y border-gray-200">
          {vacantes.map((v) => {
            const salario = textoSalario(
              v.salarioMin ? Number(v.salarioMin) : null,
              v.salarioMax ? Number(v.salarioMax) : null,
              formatCurrency
            );
            return (
              <li key={v.id}>
                <Link
                  href={`/empleos/${v.id}`}
                  className="group grid gap-1 py-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 sm:grid-cols-[1fr_auto] sm:items-baseline sm:gap-6"
                >
                  <div>
                    <h2 className="text-lg font-medium text-gray-900 group-hover:text-blue-700">{v.titulo}</h2>
                    <p className="mt-1 text-sm text-gray-600">
                      {[v.departamento?.nombre, TIPO_CONTRATO_PUBLICO[v.tipoContrato], v.plazas > 1 ? `${v.plazas} plazas` : null]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                  <div className="text-sm text-gray-600 sm:text-right">
                    {salario && <p className="tnum font-medium text-gray-900">{salario}</p>}
                    <p>Publicada el {formatDateLong(v.fechaApertura)}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
