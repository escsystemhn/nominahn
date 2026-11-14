/**
 * Reglas al cambiar el estado de un empleado o su fecha de salida.
 *
 * Inactivar sin fecha de salida dejaba a la persona fuera de la planilla y sin
 * pago por los días que sí trabajó en el último período, porque lo proporcional
 * sale de esa fecha. Y al reincorporarla, una fecha vieja le recortaba el período.
 */

export interface CambioEstado {
  estadoActual: string;
  /** Ausente = no se toca. */
  estadoNuevo?: string;
  salidaActual: Date | null;
  /** Ausente = no se toca; `null` = se borra. */
  salidaNueva?: Date | null;
  ingreso: Date;
}

export interface RevisionEstado {
  error?: string;
  /** Se reincorpora sin indicar otra fecha: la de salida anterior ya no vale. */
  limpiarSalida: boolean;
  /** Pasa a Inactivo ahora: hay que cerrar su contrato vigente. */
  seDaDeBaja: boolean;
  /** Fecha de salida que queda. */
  salida: Date | null;
}

export function revisarCambioEstado(c: CambioEstado): RevisionEstado {
  const estado = c.estadoNuevo ?? c.estadoActual;
  const salida = c.salidaNueva !== undefined ? c.salidaNueva : c.salidaActual;
  const seDaDeBaja = estado === "INACTIVO" && c.estadoActual !== "INACTIVO";
  const reincorpora = c.estadoActual === "INACTIVO" && estado !== "INACTIVO";

  // Sólo se revisa lo que cambia: un registro antiguo sin fecha no debe impedir
  // corregirle, por ejemplo, el teléfono.
  const tocaSalida = c.salidaNueva !== undefined;
  const base = { limpiarSalida: false, seDaDeBaja, salida };

  if (reincorpora && !tocaSalida) return { ...base, limpiarSalida: true, salida: null };
  if (!seDaDeBaja && !tocaSalida) return base;

  if (estado === "INACTIVO" && !salida) {
    return { ...base, error: "Indique la fecha de salida: sin ella no se le pagarían los días trabajados del último período." };
  }
  if (salida && salida < c.ingreso) {
    return { ...base, error: "La fecha de salida no puede ser anterior a la de ingreso." };
  }
  return base;
}
