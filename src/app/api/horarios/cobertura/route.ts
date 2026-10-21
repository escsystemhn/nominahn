/**
 * Cobertura mínima y horario de atención de una sucursal.
 *   GET ?sucursalId → { franjas, horario (7 días), puestos }
 *   PUT { sucursalId, franjas: [...], horario: [...] } → reemplaza las de esa sucursal
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";

const hora = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora con formato HH:MM");

const schema = z.object({
  sucursalId: zId,
  franjas: z.array(z.object({
    puestoId: zId,
    dias: z.array(z.number().int().min(1).max(7)).min(1, "Marque al menos un día"),
    desde: hora,
    hasta: hora,
    minimo: z.coerce.number().int().min(1, "El mínimo es al menos 1 persona").max(50),
    etiqueta: z.string().trim().max(60).optional().nullable(),
  }).refine((f) => f.desde !== f.hasta, { error: "La franja debe durar algo" })).max(300),
  horario: z.array(z.object({
    dia: z.number().int().min(1).max(7),
    apertura: hora.optional().nullable(),
    cierre: hora.optional().nullable(),
    cerrado: z.boolean(),
  })).max(7),
});

export async function GET(req: NextRequest) {
  const g = await requerirPermiso(["asistencia.turnos", "asistencia.ver"]);
  if (!g.ok) return g.response;
  const sucursalId = new URL(req.url).searchParams.get("sucursalId") ?? "";
  if (!sucursalId) return NextResponse.json({ error: "Indique la sucursal" }, { status: 400 });

  const [franjas, horario, puestos] = await Promise.all([
    prisma.coberturaSucursal.findMany({ where: { sucursalId, activo: true }, orderBy: [{ puestoId: "asc" }, { desde: "asc" }] }),
    prisma.horarioAtencion.findMany({ where: { sucursalId }, orderBy: { dia: "asc" } }),
    prisma.puesto.findMany({ where: { activo: true }, select: { id: true, nombre: true, departamento: { select: { nombre: true } } }, orderBy: { nombre: "asc" } }),
  ]);
  return NextResponse.json({
    franjas: franjas.map((f) => ({ ...f, dias: f.dias.split(",").map(Number).filter(Boolean) })),
    horario,
    puestos: puestos.map((p) => ({ id: p.id, nombre: p.nombre, departamento: p.departamento.nombre })),
  });
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;
  const sucursal = await prisma.sucursal.findUnique({ where: { id: d.sucursalId }, select: { id: true } });
  if (!sucursal) return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.coberturaSucursal.deleteMany({ where: { sucursalId: d.sucursalId } });
    if (d.franjas.length) {
      await tx.coberturaSucursal.createMany({
        data: d.franjas.map((f) => ({
          sucursalId: d.sucursalId, puestoId: f.puestoId, dias: [...new Set(f.dias)].sort().join(","),
          desde: f.desde, hasta: f.hasta, minimo: f.minimo, etiqueta: f.etiqueta || null,
        })),
      });
    }
    for (const h of d.horario) {
      const datos = { apertura: h.cerrado ? null : h.apertura || null, cierre: h.cerrado ? null : h.cierre || null, cerrado: h.cerrado };
      await tx.horarioAtencion.upsert({
        where: { sucursalId_dia: { sucursalId: d.sucursalId, dia: h.dia } },
        update: datos,
        create: { sucursalId: d.sucursalId, dia: h.dia, ...datos },
      });
    }
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "CoberturaSucursal", registroId: d.sucursalId, usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined, valorNuevo: { franjas: d.franjas.length, horario: d.horario }, ip, userAgent,
  });
  return NextResponse.json({ ok: true });
}
