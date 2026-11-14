/**
 * La empresa de la instalación: la que se muestra en la barra superior, en
 * Configuración → Empresa y en el portal de empleo.
 *
 * Se leía con `findFirst()` SIN orden, y Postgres devuelve entonces las filas en
 * su orden físico, que cambia cuando una fila se actualiza: con dos empresas
 * registradas, editar los datos de una hacía que la aplicación pasara a mostrar
 * la otra. Este orden es estable: la activa, la que tiene más sucursales y, a
 * igualdad, la más antigua.
 */

import type { Prisma } from "@prisma/client";

export const ORDEN_EMPRESA_PRINCIPAL: Prisma.EmpresaOrderByWithRelationInput[] = [
  { activa: "desc" },
  { sucursales: { _count: "desc" } },
  { createdAt: "asc" },
];
