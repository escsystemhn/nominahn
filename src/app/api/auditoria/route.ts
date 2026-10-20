import { NextRequest, NextResponse } from "next/server";
import { Prisma, AccionAudit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";

/**
 * Consulta del rastro de auditoría.
 *
 * El sistema escribía en `AuditLog` pero no había forma de LEERLO: no existía
 * ruta ni pantalla, de modo que el rol AUDITOR no podía ejercer su función
 * desde la aplicación. Los tres índices que esta consulta necesita
 * (tabla+registro, usuario, fecha) ya estaban declarados en el modelo.
 */

const LIMITE_MAX = 200;

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("seguridad.auditoria");
  if (!g.ok) return g.response;

  const { searchParams } = new URL(req.url);
  const tabla = searchParams.get("tabla") || undefined;
  const registroId = searchParams.get("registroId") || undefined;
  const usuarioId = searchParams.get("usuarioId") || undefined;
  const accion = searchParams.get("accion") as AccionAudit | null;
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");
  const limite = Math.min(LIMITE_MAX, Math.max(1, Number(searchParams.get("limite")) || 100));
  const pagina = Math.max(1, Number(searchParams.get("pagina")) || 1);

  const where: Prisma.AuditLogWhereInput = {};
  if (tabla) where.tabla = tabla;
  if (registroId) where.registroId = registroId;
  if (usuarioId) where.usuarioId = usuarioId;
  if (accion && Object.values(AccionAudit).includes(accion)) where.accion = accion;
  if (desde || hasta) {
    where.createdAt = {
      ...(desde ? { gte: new Date(desde) } : {}),
      ...(hasta ? { lte: new Date(hasta) } : {}),
    };
  }

  const [total, registros] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagina - 1) * limite,
      take: limite,
    }),
  ]);

  return NextResponse.json({ registros, total, pagina, limite });
}
