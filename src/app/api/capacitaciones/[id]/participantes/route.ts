import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { empleadoAlAlcance } from "@/lib/auth/alcance-bd";
import { filtroCapacitaciones } from "@/lib/capacitaciones/alcance";
import { z } from "zod";
import { parsearBody, zId } from "@/lib/http/validar";
import { formasIdentidad, normalizarIdentidad } from "@/lib/empleados/identidad";

// Por su id (la lista) o por su DNI, escrito con o sin guiones.
const schemaInscribir = z
  .object({ empleadoId: zId.optional(), identidad: z.string().trim().max(40).optional() })
  .refine((d) => d.empleadoId || d.identidad, { error: "Indique el empleado o su DNI" });

const schemaCalificar = z
  .object({
    participanteId: zId,
    asistio: z.boolean().optional(),
    aprobado: z.boolean().nullable().optional(),
    calificacion: z.preprocess(
      (v) => (v === "" || v == null ? null : v),
      z.coerce.number().min(0).max(100).nullable()
    ).optional(),
  })
  .refine((d) => d.asistio !== undefined || d.aprobado !== undefined || d.calificacion !== undefined, {
    error: "Sin cambios",
  });

// POST: inscribir un empleado en la capacitación.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("talento.capacitaciones_gestionar");
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schemaInscribir);
  if (!parsed.ok) return parsed.response;
  let empleadoId = parsed.data.empleadoId;
  if (!empleadoId) {
    const dni = normalizarIdentidad(parsed.data.identidad);
    if (!dni) return NextResponse.json({ error: "Indique el DNI" }, { status: 400 });
    if (!dni.ok) return NextResponse.json({ error: dni.error }, { status: 400 });
    const encontrado = await prisma.empleado.findFirst({ where: { identidad: { in: formasIdentidad(dni.valor) } }, select: { id: true, estado: true } });
    if (!encontrado) return NextResponse.json({ error: "No hay un empleado con ese DNI." }, { status: 404 });
    if (encontrado.estado === "INACTIVO") return NextResponse.json({ error: "Ese empleado está inactivo." }, { status: 409 });
    empleadoId = encontrado.id;
  }

  // Fuera de su alcance, el programa y el empleado responden igual que si no existieran.
  if (!(await prisma.capacitacion.count({ where: { AND: [{ id }, filtroCapacitaciones(g.usuario)] } }))) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  if (!(await empleadoAlAlcance(g.usuario, empleadoId))) {
    return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  }

  try {
    const p = await prisma.participanteCapacitacion.create({
      data: { capacitacionId: id, empleadoId },
    });
    return NextResponse.json(p, { status: 201 });
  } catch {
    return NextResponse.json({ error: "El empleado ya está inscrito" }, { status: 409 });
  }
}

// PATCH: actualizar asistencia/aprobación/calificación de un participante.
export async function PATCH(req: NextRequest) {
  const g = await requerirPermiso("talento.capacitaciones_gestionar");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schemaCalificar);
  if (!parsed.ok) return parsed.response;
  const { participanteId, asistio, aprobado, calificacion } = parsed.data;

  // Fuera de su alcance responde igual que si no existiera (ver alcanzaEmpleado).
  const actual = await prisma.participanteCapacitacion.findUnique({
    where: { id: participanteId },
    select: { empleado: { select: { id: true, sucursalId: true, departamentoId: true } } },
  });
  if (!actual || !alcanzaEmpleado(g.usuario, actual.empleado)) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const p = await prisma.participanteCapacitacion.update({
    where: { id: participanteId },
    data: {
      ...(asistio !== undefined && { asistio }),
      ...(aprobado !== undefined && { aprobado }),
      ...(calificacion !== undefined && { calificacion }),
    },
  });
  return NextResponse.json(p);
}
