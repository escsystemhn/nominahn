import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDateLong } from "@/lib/utils";
import { maxBytes } from "@/lib/uploads";
import { FILTRO_VACANTE_PUBLICA, SELECT_VACANTE_PUBLICA, TIPO_CONTRATO_PUBLICO, textoSalario } from "@/lib/talento/empleos";
import FormularioPostulacion from "@/components/empleos/FormularioPostulacion";

type Params = { params: Promise<{ id: string }> };

async function vacantePublica(id: string) {
  return prisma.vacante.findFirst({ where: { id, ...FILTRO_VACANTE_PUBLICA }, select: SELECT_VACANTE_PUBLICA });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const [v, empresa] = await Promise.all([
    vacantePublica(id),
    prisma.empresa.findFirst({ where: { activa: true }, select: { nombre: true } }),
  ]);
  if (!v) return { title: { absolute: "Vacante no disponible" } };
  return { title: { absolute: empresa ? `${v.titulo} en ${empresa.nombre}` : v.titulo } };
}

export default async function VacantePublicaPage({ params }: Params) {
  await connection();
  const { id } = await params;
  const [v, empresa] = await Promise.all([
    vacantePublica(id),
    prisma.empresa.findFirst({ where: { activa: true }, select: { nombre: true } }),
  ]);
  if (!v) notFound();

  const salario = textoSalario(v.salarioMin ? Number(v.salarioMin) : null, v.salarioMax ? Number(v.salarioMax) : null, formatCurrency);
  const datos = [
    v.departamento ? { t: "Área", d: v.departamento.nombre } : null,
    { t: "Contrato", d: TIPO_CONTRATO_PUBLICO[v.tipoContrato] },
    salario ? { t: "Salario", d: salario } : null,
    v.plazas > 1 ? { t: "Plazas", d: String(v.plazas) } : null,
    { t: "Publicada", d: formatDateLong(v.fechaApertura) },
  ].filter((x): x is { t: string; d: string } => !!x);

  return (
    <>
      <Link href="/empleos" className="text-sm text-blue-700 hover:underline">Todas las vacantes</Link>
      <div className="mt-4 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <article>
          <h1 className="text-3xl font-semibold tracking-tight text-blue-900">{v.titulo}</h1>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-gray-200 py-4 text-sm sm:grid-cols-3">
            {datos.map((x) => (
              <div key={x.t}>
                <dt className="text-gray-500">{x.t}</dt>
                <dd className={`mt-0.5 font-medium text-gray-900 ${x.t === "Salario" ? "tnum" : ""}`}>{x.d}</dd>
              </div>
            ))}
          </dl>
          {v.descripcion && (
            <section className="mt-8">
              <h2 className="text-base font-semibold text-gray-900">El puesto</h2>
              <p className="mt-2 max-w-prose whitespace-pre-line leading-relaxed text-gray-700">{v.descripcion}</p>
            </section>
          )}
          {v.requisitos && (
            <section className="mt-8">
              <h2 className="text-base font-semibold text-gray-900">Lo que pedimos</h2>
              <p className="mt-2 max-w-prose whitespace-pre-line leading-relaxed text-gray-700">{v.requisitos}</p>
            </section>
          )}
        </article>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <FormularioPostulacion vacanteId={v.id} empresa={empresa?.nombre ?? "la empresa"} maxMb={Math.floor(maxBytes() / 1024 / 1024)} />
        </aside>
      </div>
    </>
  );
}
