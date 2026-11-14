import { requerirPermisoPagina } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { etiquetaPuesto } from "@/lib/organizacion/estructura";
import CompetenciasClient from "./CompetenciasClient";

const CONTEXTO_PUESTO = { nombre: true, departamento: { select: { nombre: true, sucursal: { select: { nombre: true } } } } } as const;

export const metadata = { title: "Aspectos a evaluar" };

export default async function CompetenciasPage() {
  await requerirPermisoPagina("talento.competencias");

  const [competencias, puestos] = await Promise.all([
    prisma.competenciaDefinicion.findMany({
      // Las desactivadas también: se pueden volver a activar.
      include: {
        puestosCompetencia: {
          include: { puesto: { select: { id: true, ...CONTEXTO_PUESTO } } },
          where: { activa: true },
        },
      },
      orderBy: [{ activa: "desc" }, { nombre: "asc" }],
    }),
    prisma.puesto.findMany({
      where: { activo: true },
      select: { id: true, ...CONTEXTO_PUESTO },
      orderBy: { nombre: "asc" },
    }),
  ]);

  // Serializar Decimal → number para el cliente
  const competenciasSerializadas = competencias.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    descripcion: c.descripcion,
    categoria: c.categoria,
    activa: c.activa,
    general: c.general,
    tipoEvaluacion: c.tipoEvaluacion,
    peso: Number(c.peso),
    puestosCompetencia: c.puestosCompetencia.map((pc) => ({
      puestoId: pc.puestoId,
      nivelRequerido: pc.nivelRequerido,
      peso: Number(pc.peso),
      puesto: { id: pc.puesto.id, nombre: etiquetaPuesto(pc.puesto) },
    })),
  }));

  return <CompetenciasClient competencias={competenciasSerializadas} puestos={puestos.map((p) => ({ id: p.id, nombre: etiquetaPuesto(p), nombreCorto: p.nombre }))} />;
}
