import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import DocumentosClient from "@/components/employees/DocumentosClient";

export const metadata = { title: "Documentos" };

export default async function DocumentosPage({ searchParams }: { searchParams: Promise<{ empleadoId?: string; tab?: string }> }) {
  const usuario = await requerirPermisoPagina(["documentos.emitir", "documentos.plantillas"]);
  const sp = await searchParams;

  // Los empleados ya no se cargan aquí (2026-11-27): «Empleado» y «Probar con» los buscan en el
  // servidor (`/api/empleados/buscar?para=documentos…`), con el mismo alcance.
  return (
    <DocumentosClient
      puedeEmitir={puede(usuario, "documentos.emitir")}
      puedePlantillas={puede(usuario, "documentos.plantillas")}
      empleadoInicial={sp.empleadoId ?? ""}
      tabInicial={sp.tab === "plantillas" ? "plantillas" : sp.tab === "historial" ? "historial" : undefined}
    />
  );
}
