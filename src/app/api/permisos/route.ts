import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirSesion } from "@/lib/auth/guard";
import { tienePermiso } from "@/lib/auth/permisos";
import { alcanceEsTotal } from "@/lib/auth/alcance";
import { z } from "zod";
import { parsearBody, zFecha } from "@/lib/http/validar";
import { TipoPermiso } from "@prisma/client";

const schemaSolicitud = z
  .object({
    tipo: z.enum(TipoPermiso),
    fechaInicio: zFecha,
    fechaFin: zFecha,
    motivo: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.fechaFin >= d.fechaInicio, {
    error: "La fecha fin no puede ser anterior a la de inicio",
    path: ["fechaFin"],
  });

function diasEntre(inicio: Date, fin: Date): number {
  const ms = fin.getTime() - inicio.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1; // inclusivo
}

// GET: ?scope=aprobaciones → solicitudes pendientes que el usuario puede aprobar.
// Sin scope → las solicitudes propias del empleado autenticado.
export async function GET(req: NextRequest) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const usuario = g.usuario;
  const role = usuario.role as string;
  const empleadoId = usuario.empleadoId ?? null;
  const scope = new URL(req.url).searchParams.get("scope");

  if (scope === "aprobaciones") {
    if (!tienePermiso(usuario.permisos, "asistencia.aprobar_permisos")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    /**
     * Quién ve QUÉ solicitudes: con alcance total, todas las pendientes; con
     * cualquier alcance más estrecho, sólo las de su equipo directo.
     *
     * Se conserva además el criterio por rol para las cuentas SIN perfil: un
     * gerente heredado tiene alcance TODO por omisión, y sin esta segunda
     * condición pasaría de ver su equipo a ver toda la empresa — una ampliación
     * de acceso que esta migración no debe introducir.
     */
    const soloEquipo =
      !alcanceEsTotal(usuario) || role === "GERENTE" || role === "SUPERVISOR";
    const permisos = await prisma.permiso.findMany({
      where: {
        estado: "PENDIENTE",
        ...(soloEquipo && empleadoId ? { empleado: { supervisorId: empleadoId } } : {}),
      },
      include: {
        empleado: { select: { primerNombre: true, primerApellido: true, codigo: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(permisos);
  }

  if (!empleadoId) return NextResponse.json([]);
  const permisos = await prisma.permiso.findMany({
    where: { empleadoId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(permisos);
}

// POST: el empleado autenticado crea una solicitud de permiso/vacaciones.
export async function POST(req: NextRequest) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const empleadoId = g.usuario.empleadoId ?? null;
  if (!empleadoId) {
    return NextResponse.json({ error: "Su usuario no está vinculado a un empleado." }, { status: 400 });
  }

  const parsed = await parsearBody(req, schemaSolicitud);
  if (!parsed.ok) return parsed.response;
  const { tipo, fechaInicio: inicio, fechaFin: fin, motivo } = parsed.data;

  const permiso = await prisma.permiso.create({
    data: {
      empleadoId,
      tipo,
      fechaInicio: inicio,
      fechaFin: fin,
      diasSolicitados: diasEntre(inicio, fin),
      motivo: motivo || null,
      estado: "PENDIENTE",
    },
  });

  return NextResponse.json(permiso, { status: 201 });
}
