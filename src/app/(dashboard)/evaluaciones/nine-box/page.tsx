import { requerirPermisoPagina } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import NineBoxClient from "./NineBoxClient";

export const metadata = { title: "Nine-Box Grid | NominaHN" };

export default async function NineBoxPage() {
  await requerirPermisoPagina("talento.evaluaciones_ver");

  // Obtener evaluaciones FINALIZADAS con desempeño y potencial
  const evaluaciones = await prisma.evaluacion.findMany({
    where: {
      estado: "FINALIZADA",
      desempeno: { not: null },
      potencial: { not: null },
    },
    select: {
      id: true,
      desempeno: true,
      potencial: true,
      calificacion: true,
      periodo: true,
      empleado: {
        select: {
          id: true,
          primerNombre: true,
          primerApellido: true,
          codigo: true,
          fotoPerfil: true,
          puesto: { select: { nombre: true } },
          departamento: { select: { nombre: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Agrupar por empleado — tomar la evaluación más reciente
  const byEmp = new Map<string, typeof evaluaciones[0]>();
  for (const ev of evaluaciones) {
    if (!byEmp.has(ev.empleado.id)) byEmp.set(ev.empleado.id, ev);
  }

  const datos = Array.from(byEmp.values()).map((ev) => ({
    id: ev.empleado.id,
    nombre: `${ev.empleado.primerNombre} ${ev.empleado.primerApellido}`,
    codigo: ev.empleado.codigo,
    puesto: ev.empleado.puesto?.nombre ?? "",
    departamento: ev.empleado.departamento?.nombre ?? "",
    desempeno: Number(ev.desempeno),
    potencial: Number(ev.potencial),
    calificacion: Number(ev.calificacion),
    periodo: ev.periodo,
  }));

  return <NineBoxClient datos={datos} />;
}
