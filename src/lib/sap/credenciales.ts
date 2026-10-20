/**
 * Cuándo se puede reutilizar una contraseña guardada.
 *
 * Una contraseña guardada sólo vale contra el destino para el que se guardó.
 * Si alguien cambia el servidor (la URL del Service Layer, o el servidor,
 * puerto o instancia de SQL Server) y deja la contraseña vacía, la aplicación
 * NO la manda al destino nuevo: habría bastado apuntar a un servidor propio
 * para recibirla en claro. Hay que volver a escribirla. Mismo criterio que
 * SAP_EstCta (`exigirPasswordNueva`).
 *
 * Puro, para probarlo.
 */

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\/+$/, "");

export interface DestinoSl {
  urlBase: string;
}

export interface DestinoBd {
  servidor: string | null;
  puerto: number | null;
  instancia: string | null;
}

export function cambioDestinoSl(nuevo: DestinoSl, guardado: DestinoSl | null): boolean {
  if (!guardado) return false;
  return norm(nuevo.urlBase) !== norm(guardado.urlBase);
}

export function cambioDestinoBd(nuevo: DestinoBd, guardado: DestinoBd | null): boolean {
  if (!guardado || !guardado.servidor) return false;
  return (
    norm(nuevo.servidor) !== norm(guardado.servidor) ||
    Number(nuevo.puerto || 1433) !== Number(guardado.puerto || 1433) ||
    norm(nuevo.instancia) !== norm(guardado.instancia)
  );
}

export const MENSAJE_PASSWORD_SL =
  "Cambió la URL del Service Layer, así que hay que escribir de nuevo la contraseña de SAP. La guardada sólo se usa contra el servidor para el que se guardó.";

export const MENSAJE_PASSWORD_BD =
  "Cambió el servidor de la base de datos, así que hay que escribir de nuevo la contraseña de SQL Server. La guardada sólo se usa contra el servidor para el que se guardó.";
