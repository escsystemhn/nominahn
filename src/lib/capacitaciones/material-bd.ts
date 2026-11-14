/**
 * Quién ve el material de una capacitación: quien administra capacitaciones (dentro de
 * su alcance) y quien está inscrito en ella, mientras no esté cancelada. Lo demás
 * responde como si el material no existiera.
 */
import { prisma } from "@/lib/prisma";
import { puede, type Usuario } from "@/lib/auth/guard";
import { filtroCapacitaciones } from "./alcance";

export interface AccesoMaterial {
  material: { id: string; capacitacionId: string; titulo: string; tipo: string; archivo: string; mime: string; tamano: number };
  /** Lo abre como participante (cuenta para su avance). */
  comoParticipante: boolean;
}

export async function accesoAMaterial(usuario: Usuario, materialId: string): Promise<AccesoMaterial | null> {
  const material = await prisma.materialCapacitacion.findUnique({
    where: { id: materialId },
    select: { id: true, capacitacionId: true, titulo: true, tipo: true, archivo: true, mime: true, tamano: true, capacitacion: { select: { estado: true } } },
  });
  if (!material) return null;
  const { capacitacion, ...m } = material;

  if (usuario.empleadoId && capacitacion.estado !== "CANCELADA") {
    const inscrito = await prisma.participanteCapacitacion.count({ where: { capacitacionId: m.capacitacionId, empleadoId: usuario.empleadoId } });
    if (inscrito > 0) return { material: m, comoParticipante: true };
  }
  if (puede(usuario, "talento.capacitaciones")) {
    const alcanza = await prisma.capacitacion.count({ where: { AND: [{ id: m.capacitacionId }, filtroCapacitaciones(usuario)] } });
    if (alcanza > 0) return { material: m, comoParticipante: false };
  }
  return null;
}
