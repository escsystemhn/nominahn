/**
 * Organigrama para consumo externo (cliente, integraciones).
 *
 * Envoltura fina sobre `construirOrganigrama`. La lógica vive en
 * `lib/organizacion/organigrama.ts` porque la página del panel también la
 * necesita, y llamarse a sí misma por HTTP para obtenerla —que es lo que hacía
 * antes— pagaba un viaje de red, dependía de que la cabecera `host` resolviera
 * internamente y convertía cualquier error en un «no se pudo cargar» sin causa.
 *
 * QUÉ ÁRBOL SE DEVUELVE: la LÍNEA DE REPORTE (`supervisorId`), no la estructura
 * (Empresa → Sucursal → Departamento → Puesto). No es una elección estética:
 * `supervisorId` ya gobierna quién aprueba los permisos de quién y a quién se
 * añade como `JEFE_DIRECTO` en una evaluación 360°. El departamento y la
 * sucursal viajan en cada nodo para filtrar y colorear, no para armar el árbol.
 */

import { NextRequest, NextResponse } from "next/server";
import { requerirPermiso } from "@/lib/auth/guard";
import { construirOrganigrama } from "@/lib/organizacion/organigrama";

export type { NodoOrganigrama, Organigrama } from "@/lib/organizacion/organigrama";

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("organizacion.ver");
  if (!g.ok) return g.response;

  const { searchParams } = new URL(req.url);
  const organigrama = await construirOrganigrama(g.usuario, {
    sucursalId: searchParams.get("sucursalId") || undefined,
    incluirInactivos: searchParams.get("inactivos") === "1",
  });

  return NextResponse.json(organigrama);
}
