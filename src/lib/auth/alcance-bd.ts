import { prisma } from "@/lib/prisma";
import { alcanzaEmpleado, type UsuarioConAlcance } from "./alcance";

/**
 * ¿Este usuario alcanza al empleado de este id? Un id que no existe responde lo mismo
 * que uno fuera de su alcance: quien pregunta no debe poder distinguirlos.
 */
export async function empleadoAlAlcance(usuario: UsuarioConAlcance, id: string): Promise<boolean> {
  const empleado = await prisma.empleado.findUnique({ where: { id }, select: { id: true, sucursalId: true, departamentoId: true } });
  return !!empleado && alcanzaEmpleado(usuario, empleado);
}
