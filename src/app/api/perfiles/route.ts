/**
 * Perfiles de acceso: listar y crear.
 *
 * Un perfil es un conjunto de permisos con nombre más un alcance de datos. Es lo
 * que sustituye a inventar un rol nuevo cada vez que hace falta un matiz
 * ("este contador aprueba pero no paga").
 *
 * La regla que sostiene el módulo: NADIE CREA UN PERFIL CON PERMISOS QUE NO
 * TIENE. Sin ella, quien administra perfiles se fabrica uno con acceso total y
 * se lo asigna, y el reparto de permisos deja de significar nada.
 */

import { NextRequest, NextResponse } from "next/server";
import { AlcanceDatos } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { z } from "zod";
import { esPermisoValido, CATALOGO, TODOS_LOS_PERMISOS } from "@/lib/auth/permisos";
import { puedeOtorgar } from "@/lib/auth/politica-usuarios";

const schema = z.object({
  nombre: z.string().trim().min(1, "requerido").max(80),
  codigo: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "sólo letras, números, guión y guión bajo"),
  descripcion: z.string().trim().max(300).optional(),
  alcance: z.enum(AlcanceDatos).default("TODO"),
  permisos: z.array(z.string()).max(200),
});

export async function GET() {
  const g = await requerirPermiso(["seguridad.perfiles", "seguridad.usuarios_ver", "seguridad.usuarios_gestionar"]);
  if (!g.ok) return g.response;

  const perfiles = await prisma.perfilAcceso.findMany({
    orderBy: [{ esSistema: "desc" }, { nombre: "asc" }],
    include: { _count: { select: { usuarios: true } } },
  });

  // El catálogo viaja con la respuesta para que la pantalla de perfiles no tenga
  // que duplicar la lista de permisos ni quedarse desfasada respecto al servidor.
  return NextResponse.json({ perfiles, catalogo: CATALOGO });
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("seguridad.perfiles");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { nombre, codigo, descripcion, alcance, permisos } = parsed.data;

  // Un código que ya no existe en el catálogo se descarta en vez de guardarse:
  // guardarlo dejaría en la base permisos fantasma que nadie comprueba nunca.
  const invalidos = permisos.filter((p) => !esPermisoValido(p));
  if (invalidos.length > 0) {
    return NextResponse.json(
      { error: `Permisos desconocidos: ${invalidos.join(", ")}` },
      { status: 400 }
    );
  }

  const otorga = puedeOtorgar(g.usuario, permisos);
  if (!otorga.ok) return NextResponse.json({ error: otorga.motivo }, { status: 403 });

  const codigoNormalizado = codigo.toUpperCase();
  const yaExiste = await prisma.perfilAcceso.findUnique({
    where: { codigo: codigoNormalizado },
    select: { id: true },
  });
  if (yaExiste) {
    return NextResponse.json({ error: "Ya existe un perfil con ese código." }, { status: 409 });
  }

  const perfil = await prisma.perfilAcceso.create({
    data: {
      nombre,
      codigo: codigoNormalizado,
      descripcion,
      alcance,
      permisos: [...new Set(permisos)],
      // Se sella el catálogo que existía al crearlo: es lo que permitirá saber
      // más adelante si un permiso ausente se rechazó o simplemente no existía.
      permisosConocidos: [...TODOS_LOS_PERMISOS],
      esSistema: false,
      activo: true,
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "PerfilAcceso",
    registroId: perfil.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { nombre, codigo: codigoNormalizado, alcance, permisos: perfil.permisos },
    ip,
    userAgent,
  });

  return NextResponse.json({ perfil }, { status: 201 });
}
