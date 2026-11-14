/**
 * Alcance sobre capacitaciones. Un programa no tiene sucursal propia y reúne a gente de
 * cualquiera, así que lo que lo ata a una cuenta es quien lo creó o quien participa.
 *
 * Quien alcanza sólo a parte de sus participantes consulta y gestiona a esos; cambiar el
 * estado o el costo del programa afecta a todos, y sólo lo hace quien los alcanza a todos
 * o quien lo creó. Es el mismo reparto de las planillas (lib/payroll/alcance-planilla.ts).
 */

import type { Prisma } from "@prisma/client";
import { alcanceEsTotal, filtroPorEmpleado, type UsuarioConAlcance } from "@/lib/auth/alcance";

type Cuenta = UsuarioConAlcance & { id?: string };

const creadaPor = (usuario: Cuenta): Prisma.CapacitacionWhereInput[] => (usuario.id ? [{ creadoPor: usuario.id }] : []);

/**
 * Las que puede ver: las que creó y aquellas con alguien de su alcance. Un programa sin
 * participantes que creó otra cuenta no se ve: no hay nada que lo ate a su sucursal.
 */
export function filtroCapacitaciones(usuario: Cuenta): Prisma.CapacitacionWhereInput {
  if (alcanceEsTotal(usuario)) return {};
  return { OR: [{ participantes: { some: filtroPorEmpleado(usuario) } }, ...creadaPor(usuario)] };
}

/** Las que puede cambiar como programa: las que creó y aquellas con todos en su alcance. */
export function filtroCapacitacionesCompletas(usuario: Cuenta): Prisma.CapacitacionWhereInput {
  if (alcanceEsTotal(usuario)) return {};
  const filtro = filtroPorEmpleado(usuario);
  return { OR: [{ AND: [{ participantes: { some: filtro } }, { participantes: { none: { NOT: filtro } } }] }, ...creadaPor(usuario)] };
}
