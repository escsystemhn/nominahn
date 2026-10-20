import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { nombreCompleto } from "@/lib/utils";
import DocumentosClient from "@/components/employees/DocumentosClient";

export const metadata = { title: "Documentos" };

export default async function DocumentosPage({ searchParams }: { searchParams: Promise<{ empleadoId?: string; tab?: string }> }) {
  const usuario = await requerirPermisoPagina(["documentos.emitir", "documentos.plantillas"]);
  const sp = await searchParams;
  const empleados = await prisma.empleado.findMany({
    select: { id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, estado: true },
    orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
  });

  return (
    <DocumentosClient
      empleados={empleados.map((e) => ({ id: e.id, codigo: e.codigo, nombre: nombreCompleto(e), activo: e.estado !== "INACTIVO" }))}
      puedeEmitir={puede(usuario, "documentos.emitir")}
      puedePlantillas={puede(usuario, "documentos.plantillas")}
      empleadoInicial={sp.empleadoId ?? ""}
      tabInicial={sp.tab === "plantillas" ? "plantillas" : sp.tab === "historial" ? "historial" : undefined}
    />
  );
}
