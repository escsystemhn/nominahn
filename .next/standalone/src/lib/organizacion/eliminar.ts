/**
 * Cuándo se puede eliminar o mover una pieza de la estructura (pedido de Edbin, 2026-11-16):
 * grupos (sucursales), empresas (divisiones), departamentos y puestos se eliminan siempre que
 * no estén amarrados a un empleado ni entre sí; una empresa cambia de grupo mientras no tenga
 * movimientos (planillas). Lo que la pieza tiene de configuración propia —la cobertura y el
 * horario de atención de una sucursal, su logo— no la amarra: se va con ella.
 *
 * Funciones puras: las rutas cuentan y estas deciden el mensaje.
 */

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export interface UsoSucursal {
  empleados: number;
  divisiones: number;
  departamentos: number;
  planillas: number;
  lineasPlanilla: number;
  traslados: number;
}

export function motivoParaNoEliminarSucursal(u: UsoSucursal): string | null {
  if (u.empleados > 0) return `No se puede eliminar: tiene ${plural(u.empleados, "empleado", "empleados")}. Desactívela para retirarla de las listas.`;
  if (u.divisiones > 0) return `No se puede eliminar: tiene ${plural(u.divisiones, "empresa o división", "empresas o divisiones")}. Elimínelas o muévalas primero.`;
  if (u.departamentos > 0) return `No se puede eliminar: tiene ${plural(u.departamentos, "departamento", "departamentos")}. Elimínelos primero.`;
  if (u.planillas + u.lineasPlanilla > 0) return "No se puede eliminar: aparece en planillas emitidas. Desactívela para retirarla de las listas.";
  if (u.traslados > 0) return "No se puede eliminar: tiene traslados temporales registrados. Desactívela para retirarla de las listas.";
  return null;
}

export interface UsoDepartamento {
  empleados: number;
  puestos: number;
  vacantes: number;
  planillas: number;
  lineasPlanilla: number;
}

export function motivoParaNoEliminarDepartamento(u: UsoDepartamento): string | null {
  if (u.empleados > 0) return `No se puede eliminar: tiene ${plural(u.empleados, "empleado", "empleados")}. Desactívelo para retirarlo de las listas.`;
  if (u.puestos > 0) return `No se puede eliminar: tiene ${plural(u.puestos, "puesto", "puestos")}. Elimínelos primero.`;
  if (u.vacantes > 0) return `No se puede eliminar: tiene ${plural(u.vacantes, "vacante", "vacantes")} en Reclutamiento.`;
  if (u.planillas + u.lineasPlanilla > 0) return "No se puede eliminar: aparece en planillas emitidas. Desactívelo para retirarlo de las listas.";
  return null;
}

export interface UsoMovimientoDivision {
  planillas: number;
  lineasPlanilla: number;
  /** Cobertura de horarios del grupo actual para los puestos que se irían con la empresa. */
  coberturasPuestos: number;
}

/** Una empresa cambia de grupo sólo sin movimientos: ni planillas ni líneas de planilla. */
export function motivoParaNoMoverDivision(u: UsoMovimientoDivision): string | null {
  if (u.planillas + u.lineasPlanilla > 0) return "No se puede cambiar de grupo: ya tiene planillas. Las planillas emitidas cuelgan de su grupo actual.";
  if (u.coberturasPuestos > 0) {
    return "No se puede cambiar de grupo: sus puestos tienen cobertura de horarios en el grupo actual. Quítela en Horarios rotativos y vuelva a intentarlo.";
  }
  return null;
}
