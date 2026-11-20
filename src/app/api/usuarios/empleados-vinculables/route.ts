/**
 * Empleados que se pueden vincular a una cuenta de acceso, buscados por lo que la persona
 * escribe (nombre en cualquier orden y sin tildes, o código). Reemplaza la lista que la
 * pantalla de Usuarios cargaba entera en un <select>: se cortaba en 500 y, con muchos
 * empleados, encontrar a uno era desplazarse sin fin (pedido de Edbin, 2026-11-18).
 *
 * Sólo quien gestiona usuarios. Sin cuenta todavía (la relación es uno a uno) y sin los
 * dados de baja. La identidad sólo cuenta para buscar con `empleados.pii`.
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso, puede } from "@/lib/auth/guard";
import { filtroBusquedaEmpleados } from "@/lib/empleados/busqueda";
import { nombreCompleto } from "@/lib/utils";

/** Lo que cabe de un vistazo; si hay más, la pantalla pide afinar la búsqueda. */
const MAXIMO = 20;

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("seguridad.usuarios_gestionar");
  if (!g.ok) return g.response;

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  // La foto la sirve una ruta que pide permiso sobre empleados: sin él, la imagen saldría rota.
  const veFotos = puede(g.usuario, "empleados.ver");
  const where: Prisma.EmpleadoWhereInput = {
    AND: [
      { userId: null, estado: { not: "INACTIVO" } },
      await filtroBusquedaEmpleados(prisma, q, { conIdentidad: puede(g.usuario, "empleados.pii") }),
    ],
  };

  const [total, filas] = await Promise.all([
    prisma.empleado.count({ where }),
    prisma.empleado.findMany({
      where,
      select: {
        id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
        emailCorporativo: true,
        puesto: { select: { nombre: true } },
        departamento: { select: { nombre: true, division: { select: { nombre: true } } } },
        sucursal: { select: { nombre: true } },
        foto: { select: { updatedAt: true } },
      },
      orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }, { id: "asc" }],
      take: MAXIMO,
    }),
  ]);

  return NextResponse.json({
    total,
    empleados: filas.map((e) => ({
      id: e.id,
      codigo: e.codigo,
      nombre: nombreCompleto(e),
      puesto: e.puesto?.nombre ?? null,
      departamento: e.departamento.nombre,
      // Con la jerarquía, la «sucursal» es la división del departamento; si no hay, la sucursal.
      lugar: e.departamento.division?.nombre ?? e.sucursal.nombre,
      correo: e.emailCorporativo,
      foto: veFotos ? (e.foto?.updatedAt.getTime() ?? null) : null,
    })),
  });
}
