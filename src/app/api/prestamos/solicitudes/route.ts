/** Solicitudes de préstamo y anticipo, para quien asigna deducciones. */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("deducciones.asignar");
  if (!g.ok) return g.response;
  const estado = new URL(req.url).searchParams.get("estado");
  const solicitudes = await prisma.solicitudPrestamo.findMany({
    where: estado === "todas" ? {} : { estado: "PENDIENTE" },
    orderBy: { createdAt: estado === "todas" ? "desc" : "asc" },
    take: 200,
    include: {
      empleado: {
        select: {
          id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
          salarioBase: true, tipoPlanilla: true, sucursal: { select: { nombre: true } },
        },
      },
      deduccion: { select: { id: true, saldo: true, activo: true } },
    },
  });
  return NextResponse.json(solicitudes);
}
