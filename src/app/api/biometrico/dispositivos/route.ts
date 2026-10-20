import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { parsearBody, zId } from "@/lib/http/validar";
import { cifrar, cifradoDisponible } from "@/lib/seguridad/cifrado";

const zPuerto = z.coerce.number().int().min(1).max(65535);
const schema = z.object({
  nombre: z.string().trim().min(1).max(120),
  /// Decide el driver: los protocolos de ZKTeco y Hikvision no tienen nada en común.
  marca: z.enum(["ZKTECO", "HIKVISION"]).optional(),
  modelo: z.string().trim().max(120).optional().nullable(),
  serie: z.string().trim().max(120).optional().nullable(),
  ip: z.string().trim().min(1).max(100),
  puerto: zPuerto.optional(),
  /// Hikvision los exige en cada petición ISAPI; ZKTeco no los usa.
  usuario: z.string().trim().max(120).optional().nullable(),
  password: z.string().max(200).optional().nullable(),
  /// Minutos respecto a UTC. Honduras es −360 y no cambia con la estación.
  offsetMinutos: z.coerce.number().int().min(-840).max(840).optional(),
  sucursalId: zId.optional().nullable(),
});

/**
 * Campos que se devuelven al cliente.
 *
 * Explícito y no `findMany()` a secas: la fila incluye `passwordCifrado`, y una
 * credencial de un terminal de control de acceso no tiene por qué viajar al
 * navegador ni siquiera cifrada.
 */
const CAMPOS_PUBLICOS = {
  id: true,
  nombre: true,
  marca: true,
  modelo: true,
  serie: true,
  ip: true,
  puerto: true,
  usuario: true,
  offsetMinutos: true,
  sucursalId: true,
  activo: true,
  ultimaSync: true,
  ultimoEventoEn: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const dispositivos = await prisma.dispositivoBiometrico.findMany({
    select: CAMPOS_PUBLICOS,
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(dispositivos);
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("asistencia.biometrico");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { nombre, marca, modelo, serie, ip, puerto, usuario, password, offsetMinutos, sucursalId } =
    parsed.data;

  // Antes que guardar la contraseña en claro «por ahora», se rechaza el alta:
  // en un terminal de control de acceso esa credencial abre puertas.
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

  const marcaElegida = marca ?? "ZKTECO";

  const dispositivo = await prisma.dispositivoBiometrico.create({
    data: {
      nombre,
      marca: marcaElegida,
      modelo: modelo || null,
      serie: serie || null,
      ip,
      // 4370 es el puerto de ZKTeco; Hikvision habla ISAPI sobre HTTP.
      puerto: puerto ?? (marcaElegida === "HIKVISION" ? 80 : 4370),
      usuario: usuario || null,
      passwordCifrado: password ? cifrar(password) : null,
      offsetMinutos: offsetMinutos ?? -360,
      sucursalId: sucursalId || null,
      activo: true,
    },
    select: CAMPOS_PUBLICOS,
  });

  return NextResponse.json(dispositivo, { status: 201 });
}
