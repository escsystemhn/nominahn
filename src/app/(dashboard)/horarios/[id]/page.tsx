import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import PlanHorarioClient from "@/components/horarios/PlanHorarioClient";

export const metadata = { title: "Plan de horarios" };

export default async function PlanHorarioPage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await requerirPermisoPagina(["asistencia.turnos", "asistencia.ver"]);
  const { id } = await params;
  return <PlanHorarioClient id={id} puedeEditar={puede(usuario, "asistencia.turnos")} />;
}
