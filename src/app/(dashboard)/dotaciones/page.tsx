import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { nombreCompleto } from "@/lib/utils";
import DotacionesClient from "@/components/employees/DotacionesClient";

export default async function DotacionesPage() {
  const usuario = await requerirPermisoPagina("talento.dotaciones");

  const [empleados, articulos] = await Promise.all([
    prisma.empleado.findMany({
      where: { estado: "ACTIVO" },
      select: { id: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, codigo: true },
      orderBy: { primerApellido: "asc" },
    }),
    prisma.articuloDotacion.findMany({ orderBy: [{ activo: "desc" }, { nombre: "asc" }] }),
  ]);

  const empleadosOpts = empleados.map((e) => ({ id: e.id, nombre: `${e.codigo} · ${nombreCompleto(e)}` }));

  return (
    <DotacionesClient
      empleados={empleadosOpts}
      articulos={articulos}
      puedeGestionar={puede(usuario, "talento.dotaciones_gestionar")}
    />
  );
}
