import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirSesion } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody } from "@/lib/http/validar";

// Campos personales que el empleado puede editar por sí mismo.
// NO incluye salario, contrato, identidad, puesto ni datos organizacionales:
// el allowlist es la única barrera contra que se auto-suba el sueldo.
const campo = z.string().trim().max(500).nullish().transform((v) => (v ? v : null));
const schema = z.object({
  telefonoPersonal: campo,
  telefonoEmergencia: campo,
  contactoEmergencia: campo,
  direccion: campo,
  estadoCivil: campo,
}).partial();

export async function GET() {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const empleadoId = g.usuario.empleadoId ?? null;
  if (!empleadoId) return NextResponse.json({ error: "Sin expediente" }, { status: 400 });

  const empleado = await prisma.empleado.findUnique({
    where: { id: empleadoId },
    select: {
      telefonoPersonal: true,
      telefonoEmergencia: true,
      contactoEmergencia: true,
      direccion: true,
      estadoCivil: true,
    },
  });

  return NextResponse.json(empleado ?? {});
}

export async function PATCH(req: NextRequest) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const empleadoId = g.usuario.empleadoId ?? null;
  if (!empleadoId) return NextResponse.json({ error: "Sin expediente" }, { status: 400 });

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  // Sólo los campos efectivamente enviados (el schema descartó lo desconocido).
  const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
  }

  const actualizado = await prisma.empleado.update({
    where: { id: empleadoId },
    data,
    select: {
      telefonoPersonal: true,
      telefonoEmergencia: true,
      contactoEmergencia: true,
      direccion: true,
      estadoCivil: true,
    },
  });

  return NextResponse.json(actualizado);
}
