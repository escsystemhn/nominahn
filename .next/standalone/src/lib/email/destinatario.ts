/**
 * A qué correo va el comprobante de pago de un empleado.
 *
 * Antes iba SÓLO al correo de su cuenta de usuario del sistema. Un operario sin
 * cuenta —la mayoría— nunca recibía su comprobante, aunque en su ficha tuviera
 * un correo. El orden:
 *
 *   1. Personal: el que la persona dio para asuntos privados; el salario lo es.
 *   2. Corporativo: si no dio uno personal.
 *   3. El de su cuenta de usuario, como último recurso.
 */

export interface CorreosEmpleado {
  emailPersonal?: string | null;
  emailCorporativo?: string | null;
  user?: { email: string | null } | null;
}

export function correoDeComprobantes(e: CorreosEmpleado): string | null {
  const limpio = (v?: string | null) => (v && v.trim() ? v.trim() : null);
  return limpio(e.emailPersonal) ?? limpio(e.emailCorporativo) ?? limpio(e.user?.email) ?? null;
}
