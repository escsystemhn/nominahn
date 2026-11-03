import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { conAlcance, filtroPorEmpleado } from "@/lib/auth/alcance";
import EvaluacionesClient from "@/components/evaluations/EvaluacionesClient";

export default async function EvaluacionesPage() {
  // Sin esto, cualquier cuenta que escribiera la dirección veía las evaluaciones de todos:
  // una cuenta sin perfil tiene alcance total y el menú sólo ocultaba el enlace.
  const usuario = await requerirPermisoPagina(["talento.evaluaciones_ver", "talento.evaluaciones_gestionar"]);

  const [evaluaciones, empleados] = await Promise.all([
    prisma.evaluacion.findMany({
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
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.empleado.findMany({
      where: conAlcance({ estado: "ACTIVO" }, usuario),
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
