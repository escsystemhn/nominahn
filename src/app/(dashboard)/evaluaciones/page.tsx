import { prisma } from "@/lib/prisma";
import EvaluacionesClient from "@/components/evaluations/EvaluacionesClient";

export default async function EvaluacionesPage() {
  const [evaluaciones, empleados] = await Promise.all([
    prisma.evaluacion.findMany({
      include: {
        empleado: {
          select: {
            id: true,
            codigo: true,
            primerNombre: true,
            primerApellido: true,
            sucursal: { select: { nombre: true } },
            departamento: { select: { nombre: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.empleado.findMany({
      where: { estado: "ACTIVO" },
      select: { id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true },
      orderBy: { primerApellido: "asc" },
    }),
  ]);

  const evaluacionesSerial = evaluaciones.map((ev) => ({
    ...ev,
    calificacion: Number(ev.calificacion),
  }));

  return <EvaluacionesClient evaluaciones={evaluacionesSerial} empleados={empleados} />;
}
