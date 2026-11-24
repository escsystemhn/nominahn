import { NextRequest, NextResponse } from "next/server";
import { alcanzaDispositivo } from "@/lib/biometrico/alcance";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody, zId } from "@/lib/http/validar";
import { cifrar, cifradoDisponible } from "@/lib/seguridad/cifrado";

const schema = z.object({
  nombre: z.string().trim().min(1).max(120).optional(),
  marca: z.enum(["ZKTECO", "HIKVISION"]).optional(),
  modelo: z.string().trim().max(120).nullable().optional(),
  serie: z.string().trim().max(120).nullable().optional(),
  ip: z.string().trim().min(1).max(100).optional(),
  puerto: z.coerce.number().int().min(1).max(65535).optional(),
  usuario: z.string().trim().max(120).nullable().optional(),
  /** Vacía significa «no la cambies», no «bórrala». */
  password: z.string().max(200).optional(),
  offsetMinutos: z.coerce.number().int().min(-840).max(840).optional(),
  /** «» (Todos los grupos) = sin grupo; sin mandarlo, no se toca. */
  sucursalId: z.union([z.literal(""), zId]).nullable().optional(),
  activo: z.boolean().optional(),
});

/** La fila incluye `passwordCifrado`; nunca sale al navegador. Ver la ruta hermana. */
const CAMPOS_PUBLICOS = {
  id: true, nombre: true, marca: true, modelo: true, serie: true, ip: true, puerto: true,
  usuario: true, offsetMinutos: true, sucursalId: true, activo: true, ultimaSync: true,
  ultimoEventoEn: true, createdAt: true, updatedAt: true,
} as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requerirPermiso("asistencia.biometrico");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { nombre, marca, modelo, serie, ip, puerto, usuario, password, offsetMinutos,
    sucursalId, activo } = parsed.data;

  // Fuera de su alcance responde igual que si no existiera.
  const actual = await prisma.dispositivoBiometrico.findUnique({ where: { id }, select: { sucursalId: true } });
  if (!actual || !alcanzaDispositivo(g.usuario, actual)) {
    return NextResponse.json({ error: "Dispositivo no encontrado" }, { status: 404 });
  }
  // Ni llevárselo a una sucursal que no alcanza, ni dejarlo sin sucursal.
  if (sucursalId !== undefined && !alcanzaDispositivo(g.usuario, { sucursalId: sucursalId || null })) {
    return NextResponse.json({ error: "Esa sucursal está fuera del alcance de su cuenta." }, { status: 403 });
  }

  if (password && !cifradoDisponible()) {
    return NextResponse.json(
      {
        error:
          "Falta CIFRADO_KEY en el entorno. Sin ella no se guardan credenciales de " +
          "dispositivo, porque no se almacenan en claro.",
      },
      { status: 503 }
    );
  }

  const dispositivo = await prisma.dispositivoBiometrico.update({
    where: { id },
    data: {
      ...(nombre !== undefined && { nombre }),
      ...(marca !== undefined && { marca }),
      ...(modelo !== undefined && { modelo: modelo || null }),
      ...(serie !== undefined && { serie: serie || null }),
      ...(ip !== undefined && { ip }),
      ...(puerto !== undefined && { puerto }),
      ...(usuario !== undefined && { usuario: usuario || null }),
      // Sólo se toca si mandaron una contraseña nueva: en el formulario el campo
      // llega vacío porque nunca se devuelve, y vaciarlo aquí borraría la buena.
      ...(password ? { passwordCifrado: cifrar(password) } : {}),
      ...(offsetMinutos !== undefined && { offsetMinutos }),
      ...(sucursalId !== undefined && { sucursalId: sucursalId || null }),
      ...(activo !== undefined && { activo }),
    },
    select: CAMPOS_PUBLICOS,
  });

  return NextResponse.json(dispositivo);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requerirPermiso("asistencia.biometrico");
  if (!g.ok) return g.response;

  const { id } = await params;

  // Borrar un reloj se lleva en cascada sus PIN y sus marcas.
  const actual = await prisma.dispositivoBiometrico.findUnique({ where: { id }, select: { sucursalId: true } });
  if (!actual || !alcanzaDispositivo(g.usuario, actual)) {
    return NextResponse.json({ error: "Dispositivo no encontrado" }, { status: 404 });
  }

  await prisma.dispositivoBiometrico.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
