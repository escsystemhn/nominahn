/**
 * Estructura organizacional contra la base de datos: si las divisiones están
 * habilitadas y si una cadena sucursal → división → departamento es coherente.
 *
 * Las divisiones son una OPCIÓN que el administrador enciende en
 * Configuración → Estructura organizacional (clave `ORGANIZACION_DIVISIONES` de
 * `ConfiguracionSistema`). Apagada, la aplicación se comporta como antes de
 * existir el nivel: nadie elige división, la API no la acepta y los reportes
 * agrupan Sucursal → Departamento. Apagarla no borra nada; sólo lo oculta.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import type { AlcanceOrg } from "./estructura";

type Db = PrismaClient | Prisma.TransactionClient;

export const CLAVE_DIVISIONES = "ORGANIZACION_DIVISIONES";
const DESCRIPCION_DIVISIONES = "Usa el nivel División entre la sucursal y el departamento (Sucursal → División → Departamento)";

export async function divisionesHabilitadas(db: Db): Promise<boolean> {
  const fila = await db.configuracionSistema.findUnique({ where: { clave: CLAVE_DIVISIONES }, select: { valor: true } });
  return fila?.valor.trim().toLowerCase() === "true";
}

export async function guardarDivisionesHabilitadas(db: Db, habilitar: boolean): Promise<void> {
  const valor = habilitar ? "true" : "false";
  await db.configuracionSistema.upsert({
    where: { clave: CLAVE_DIVISIONES },
    update: { valor },
    create: { clave: CLAVE_DIVISIONES, valor, descripcion: DESCRIPCION_DIVISIONES },
  });
}

/**
 * Opciones de los selectores Sucursal → División → Departamento. Sin el nivel
 * División habilitado no se cargan divisiones y los departamentos no la llevan.
 */
export async function cargarOpcionesEstructura(db: Db, filtroSucursales: Prisma.SucursalWhereInput = {}) {
  const conDivisiones = await divisionesHabilitadas(db);
  const [sucursales, divisiones, departamentos] = await Promise.all([
    db.sucursal.findMany({ where: filtroSucursales, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    conDivisiones
      ? db.division.findMany({ where: { sucursal: filtroSucursales }, select: { id: true, nombre: true, sucursalId: true }, orderBy: { nombre: "asc" } })
      : Promise.resolve([]),
    db.departamento.findMany({ where: { sucursal: filtroSucursales }, select: { id: true, nombre: true, sucursalId: true, divisionId: true }, orderBy: { nombre: "asc" } }),
  ]);
  return {
    conDivisiones,
    sucursales,
    divisiones,
    departamentos: departamentos.map((d) => ({ ...d, divisionId: conDivisiones ? d.divisionId : null })),
  };
}

export type ResultadoAlcance = { ok: true; alcance: AlcanceOrg } | { ok: false; error: string };

/**
 * Comprueba que la cadena empresa → sucursal → división → departamento sea
 * coherente y la COMPLETA hacia arriba: un departamento implica su sucursal y
 * su división. Guardar la cadena entera es lo que permite que el índice de
 * período único compare planillas de distinto nivel con la misma clave.
 */
export async function validarAlcanceOrg(
  db: Db,
  a: AlcanceOrg,
  opciones: { empresaId?: string; divisiones: boolean }
): Promise<ResultadoAlcance> {
  if (a.divisionId && !opciones.divisiones) {
    return { ok: false, error: "Las divisiones no están habilitadas. Actívelas en Configuración → Estructura organizacional." };
  }
  let { sucursalId, divisionId } = a;
  const { departamentoId } = a;

  if (departamentoId) {
    const d = await db.departamento.findUnique({ where: { id: departamentoId }, select: { sucursalId: true, divisionId: true } });
    if (!d) return { ok: false, error: "El departamento no existe." };
    if (sucursalId && sucursalId !== d.sucursalId) return { ok: false, error: "El departamento no pertenece a la sucursal elegida." };
    if (divisionId && divisionId !== d.divisionId) return { ok: false, error: "El departamento no pertenece a la división elegida." };
    sucursalId = d.sucursalId;
    divisionId = opciones.divisiones ? d.divisionId : null;
  } else if (divisionId) {
    const v = await db.division.findUnique({ where: { id: divisionId }, select: { sucursalId: true } });
    if (!v) return { ok: false, error: "La división no existe." };
    if (sucursalId && sucursalId !== v.sucursalId) return { ok: false, error: "La división no pertenece a la sucursal elegida." };
    sucursalId = v.sucursalId;
  }

  if (sucursalId) {
    const s = await db.sucursal.findUnique({ where: { id: sucursalId }, select: { empresaId: true } });
    if (!s) return { ok: false, error: "La sucursal no existe." };
    if (opciones.empresaId && s.empresaId !== opciones.empresaId) return { ok: false, error: "La sucursal no pertenece a la empresa elegida." };
  }
  return { ok: true, alcance: { sucursalId, divisionId, departamentoId } };
}

/**
 * Ubicación de un empleado: el departamento debe ser de su sucursal y el
 * puesto, de su departamento. Antes la API no lo comprobaba, y con divisiones
 * un departamento ajeno pondría a la persona bajo otra sucursal o división en
 * la planilla y en los reportes.
 */
export async function validarUbicacionEmpleado(
  db: Db,
  u: { sucursalId: string; departamentoId: string; puestoId: string | null }
): Promise<string | null> {
  const d = await db.departamento.findUnique({ where: { id: u.departamentoId }, select: { sucursalId: true } });
  if (!d) return "El departamento no existe.";
  if (d.sucursalId !== u.sucursalId) return "El departamento elegido pertenece a otra sucursal.";
  if (u.puestoId) {
    const p = await db.puesto.findUnique({ where: { id: u.puestoId }, select: { departamentoId: true } });
    if (!p) return "El puesto no existe.";
    if (p.departamentoId !== u.departamentoId) return "El puesto elegido pertenece a otro departamento.";
  }
  return null;
}

/**
 * La división de un departamento nuevo o editado. Con las divisiones apagadas
 * no se acepta ninguna. Encendidas, debe ser de la misma sucursal y estar
 * activa; y si la sucursal ya tiene divisiones activas, es obligatoria, para
 * que ningún departamento nuevo quede fuera de la jerarquía.
 */
export async function validarDivisionDeDepartamento(
  db: Db,
  d: { sucursalId: string; divisionId: string | null },
  divisiones: boolean
): Promise<string | null> {
  if (!divisiones) {
    return d.divisionId ? "Las divisiones no están habilitadas. Actívelas en Configuración → Estructura organizacional." : null;
  }
  if (d.divisionId) {
    const v = await db.division.findUnique({ where: { id: d.divisionId }, select: { sucursalId: true, activa: true } });
    if (!v) return "La división no existe.";
    if (v.sucursalId !== d.sucursalId) return "La división elegida es de otra sucursal.";
    if (!v.activa) return "La división elegida está inactiva.";
    return null;
  }
  const activas = await db.division.count({ where: { sucursalId: d.sucursalId, activa: true } });
  return activas > 0 ? "Esta sucursal está organizada por divisiones: elija la división del departamento." : null;
}
