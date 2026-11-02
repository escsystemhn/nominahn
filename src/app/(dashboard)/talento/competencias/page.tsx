import { requerirPermisoPagina } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { etiquetaPuesto } from "@/lib/organizacion/estructura";
import CompetenciasClient from "./CompetenciasClient";

const CONTEXTO_PUESTO = { nombre: true, departamento: { select: { nombre: true, sucursal: { select: { nombre: true } } } } } as const;

export const metadata = { title: "Competencias | NominaHN" };

export default async function CompetenciasPage() {
  await requerirPermisoPagina("talento.competencias");

  const [competencias, puestos] = await Promise.all([
    prisma.competenciaDefinicion.findMany({
      where: { activa: true },
      include: {
        puestosCompetencia: {
          include: { puesto: { select: { id: true, ...CONTEXTO_PUESTO } } },
          where: { activa: true },
        },
      },
      orderBy: { nombre: "asc" },
    }),
    prisma.puesto.findMany({
      where: { activo: true },
      select: { id: true, ...CONTEXTO_PUESTO },
      orderBy: { nombre: "asc" },
    }),
  ]);

  // Serializar Decimal → number para el cliente
  const competenciasSerializadas = competencias.map((c) => ({
    ...c,
    puestosCompetencia: c.puestosCompetencia.map((pc) => ({
      ...pc,
      peso: Number(pc.peso),
      puesto: { id: pc.puesto.id, nombre: etiquetaPuesto(pc.puesto) },
    })),
  }));

  return <CompetenciasClient competencias={competenciasSerializadas} puestos={puestos.map((p) => ({ id: p.id, nombre: etiquetaPuesto(p) }))} />;
}
