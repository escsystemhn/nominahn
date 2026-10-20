import { requerirPermisoPagina } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import SkillGapClient from "./SkillGapClient";

export const metadata = { title: "Análisis de Brechas | NominaHN" };

export default async function SkillGapPage({
  searchParams,
}: {
  searchParams: Promise<{ puestoId?: string; empleadoId?: string }>;
}) {
  await requerirPermisoPagina("talento.evaluaciones_ver");

  const sp = await searchParams;

  const puestos = await prisma.puesto.findMany({
    where: { activo: true },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });

  const empleadosBrechas: {
    empleado: { id: string; nombre: string; codigo: string };
    competencias: {
      competenciaId: string;
      nombre: string;
      nivelRequerido: number;
      nivelActual: number;
      brecha: number;
    }[];
  }[] = [];

  if (sp.puestoId) {
    // Competencias requeridas para el puesto
    const requeridas = await prisma.puestoCompetencia.findMany({
      where: { puestoId: sp.puestoId, activa: true },
      include: { competencia: true },
    });

    if (requeridas.length > 0) {
      const NIVEL_NUM: Record<string, number> = {
        INICIAL: 1, BASICO: 2, INTERMEDIO: 3, AVANZADO: 4, EXPERTO: 5,
      };

      const empleados = await prisma.empleado.findMany({
        where: {
          puestoId: sp.puestoId,
          estado: "ACTIVO",
          ...(sp.empleadoId ? { id: sp.empleadoId } : {}),
        },
        select: { id: true, primerNombre: true, primerApellido: true, codigo: true },
      });

      for (const emp of empleados) {
        // Última evaluación finalizada por competencia
        const criterios = await prisma.criterioEvaluacion.findMany({
          where: {
            evaluacion: { empleadoId: emp.id, estado: "FINALIZADA" },
            competenciaId: { not: null },
          },
          orderBy: { evaluacion: { createdAt: "desc" } },
          distinct: ["competenciaId"],
          select: { competenciaId: true, calificacion: true },
        });

        const actualPorComp = new Map(criterios.map((c) => [c.competenciaId, Number(c.calificacion)]));

        const brechas = requeridas.map((r) => {
          const nivelRequeridoNum = NIVEL_NUM[r.nivelRequerido] ?? 3;
          const calActual = actualPorComp.get(r.competenciaId) ?? 0;
          // Convertir calificación 0-100 a escala 1-5
          const nivelActual = calActual === 0 ? 0 : Math.max(1, Math.min(5, Math.round((calActual / 100) * 5)));
          return {
            competenciaId: r.competenciaId,
            nombre: r.competencia.nombre,
            nivelRequerido: nivelRequeridoNum,
            nivelActual,
            brecha: nivelRequeridoNum - nivelActual,
          };
        });

        empleadosBrechas.push({
          empleado: { id: emp.id, nombre: `${emp.primerNombre} ${emp.primerApellido}`, codigo: emp.codigo },
          competencias: brechas,
        });
      }
    }
  }

  return (
    <SkillGapClient
      puestos={puestos}
      puestoIdActual={sp.puestoId ?? ""}
      datos={empleadosBrechas}
    />
  );
}
