import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import PlanHorarioClient from "@/components/horarios/PlanHorarioClient";

export const metadata = { title: "Plan de horarios" };

export default async function PlanHorarioPage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await requerirPermisoPagina(["asistencia.turnos", "asistencia.ver"]);
  const { id } = await params;
  const niveles = etiquetasNiveles(await jerarquiaNominaHabilitada(prisma));
  return <PlanHorarioClient id={id} puedeEditar={puede(usuario, "asistencia.turnos")} niveles={niveles} />;
}
