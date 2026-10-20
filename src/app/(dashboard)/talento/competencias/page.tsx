import { requerirPermisoPagina } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import CompetenciasClient from "./CompetenciasClient";

export const metadata = { title: "Competencias | NominaHN" };

export default async function CompetenciasPage() {
  await requerirPermisoPagina("talento.competencias");

  const [competencias, puestos] = await Promise.all([
    prisma.competenciaDefinicion.findMany({
      where: { activa: true },
      include: {
        puestosCompetencia: {
          include: { puesto: { select: { id: true, nombre: true } } },
          where: { activa: true },
        },
      },
      orderBy: { nombre: "asc" },
    }),
    prisma.puesto.findMany({
      where: { activo: true },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    }),
  ]);

  // Serializar Decimal → number para el cliente
  const competenciasSerializadas = competencias.map((c) => ({
    ...c,
    puestosCompetencia: c.puestosCompetencia.map((pc) => ({
      ...pc,
      peso: Number(pc.peso),
    })),
  }));

  return <CompetenciasClient competencias={competenciasSerializadas} puestos={puestos} />;
}
