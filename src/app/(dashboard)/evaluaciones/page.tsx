import { prisma } from "@/lib/prisma";
import { puede, requerirPermisoPagina } from "@/lib/auth/guard";
import { filtroPorEmpleado } from "@/lib/auth/alcance";
import EvaluacionesClient from "@/components/evaluations/EvaluacionesClient";

export default async function EvaluacionesPage() {
  // Sin esto, cualquier cuenta que escribiera la dirección veía las evaluaciones de todos:
  // una cuenta sin perfil tiene alcance total y el menú sólo ocultaba el enlace.
  const usuario = await requerirPermisoPagina(["talento.evaluaciones_ver", "talento.evaluaciones_gestionar"]);

  // El empleado de una evaluación nueva se busca en el servidor al escribir
  // (`/api/empleados/buscar?para=evaluaciones`): ya no se cargan todos aquí.
  const evaluaciones = await prisma.evaluacion.findMany({
    where: filtroPorEmpleado(usuario),
    include: {
      empleado: {
        select: {
          id: true,
          codigo: true,
          primerNombre: true,
          primerApellido: true,
          sucursal: { select: { nombre: true } },
          departamento: { select: { nombre: true } },
          puesto: { select: { nombre: true } },
        },
      },
      // Los consolidados: lo calificado en una directa, o el promedio de los evaluadores.
      criterios: {
        where: { participanteId: null },
        select: { competenciaId: true, criterio: true, calificacion: true, peso: true },
      },
      _count: { select: { participantes: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const evaluacionesSerial = evaluaciones.map(({ criterios, _count, ...ev }) => ({
    ...ev,
    calificacion: Number(ev.calificacion),
    desempeno: ev.desempeno === null ? null : Number(ev.desempeno),
    potencial: ev.potencial === null ? null : Number(ev.potencial),
    bonoPorcentaje: ev.bonoPorcentaje === null ? null : Number(ev.bonoPorcentaje),
    bonoMonto: ev.bonoMonto === null ? null : Number(ev.bonoMonto),
    criterios: criterios.map((c) => ({ ...c, calificacion: Number(c.calificacion), peso: Number(c.peso) })),
    evaluadores: _count.participantes,
  }));

  return (
    <EvaluacionesClient
      evaluaciones={evaluacionesSerial}
      permisos={{
        gestionar: puede(usuario, "talento.evaluaciones_gestionar"),
        cerrar: puede(usuario, "talento.evaluaciones_cerrar"),
        competencias: puede(usuario, "talento.competencias"),
      }}
    />
  );
}
