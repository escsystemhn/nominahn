/**
 * Datos de la empresa: nombre, RTN, dirección, teléfono y correo.
 *
 * Sólo quien tiene `configuracion.empresa` (por omisión, únicamente el super
 * administrador): el nombre y el RTN se imprimen en boletas, constancias,
 * contratos y el archivo del banco, así que un error aquí se repite en todo.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zCorreoOpcional, zId } from "@/lib/http/validar";

/** Texto opcional y borrable: vacío → null. */
const opcional = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.union([z.null(), z.string().trim().max(max)])).optional();

const digitos = (s: string) => s.replace(/\D/g, "");

const schema = z.object({
  id: zId,
  nombre: z.string().trim().min(1, "requerido").max(200),
  // El RTN de una persona jurídica en Honduras tiene 14 dígitos; se aceptan
  // guiones y espacios como separadores y se guarda tal como se escribió.
  rtn: z
    .string()
    .trim()
    .regex(/^[\d\s-]+$/, "sólo dígitos, guiones o espacios")
    .refine((v) => digitos(v).length === 14, { error: "debe tener 14 dígitos" }),
  direccion: opcional(300),
  telefono: opcional(50),
  email: zCorreoOpcional,
});

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.empresa");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { id, ...datos } = parsed.data;

  const antes = await prisma.empresa.findUnique({
    where: { id },
    select: { nombre: true, rtn: true, direccion: true, telefono: true, email: true },
  });
  if (!antes) return NextResponse.json({ error: "La empresa no existe." }, { status: 404 });

  // El índice único compara el texto: «0801-1990-000001» y «08011990000001» son
  // el mismo RTN escrito distinto, y eso también es un duplicado.
  const otras = await prisma.empresa.findMany({ where: { id: { not: id } }, select: { nombre: true, rtn: true } });
  const repetida = otras.find((e) => digitos(e.rtn) === digitos(datos.rtn));
  if (repetida) {
    return NextResponse.json({ error: `El RTN ya pertenece a otra empresa registrada: ${repetida.nombre}.` }, { status: 409 });
  }

  try {
    const empresa = await prisma.empresa.update({
      where: { id },
      data: {
        nombre: datos.nombre,
        rtn: datos.rtn,
        ...(datos.direccion !== undefined ? { direccion: datos.direccion } : {}),
        ...(datos.telefono !== undefined ? { telefono: datos.telefono } : {}),
        ...(datos.email !== undefined ? { email: datos.email } : {}),
      },
      select: { id: true, nombre: true, rtn: true, direccion: true, telefono: true, email: true },
    });

    const { ip, userAgent } = getClientInfo(req);
    await audit({
      accion: "UPDATE", tabla: "Empresa", registroId: id,
      usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
      valorAnterior: antes, valorNuevo: { nombre: empresa.nombre, rtn: empresa.rtn, direccion: empresa.direccion, telefono: empresa.telefono, email: empresa.email },
      ip, userAgent,
    });
    return NextResponse.json(empresa);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "El RTN ya pertenece a otra empresa registrada." }, { status: 409 });
    }
    throw e;
  }
}
