/**
 * Configuración → Respaldos: destinos, horario y cifrado, y el historial.
 * Sólo `configuracion.respaldos`: un respaldo es la base entera.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { cifradoDisponible } from "@/lib/seguridad/cifrado";
import { configPublica, erroresDeConfig, esquemaConfig, leerPrueba, proximoProgramado, CLAVE_PRUEBA_RESTAURACION, CLAVE_RESPALDOS } from "@/lib/respaldos/config";
import { guardarConfigRespaldos, leerConfigRespaldos, limpiarHuerfanos, ubicarPostgres } from "@/lib/respaldos/respaldos-bd";
import { descargables } from "@/lib/respaldos/destinos";

export async function GET() {
  const g = await requerirPermiso("configuracion.respaldos");
  if (!g.ok) return g.response;
  await limpiarHuerfanos();
  const [config, historial, prueba] = await Promise.all([
    leerConfigRespaldos(),
    prisma.respaldo.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.configuracionSistema.findUnique({ where: { clave: CLAVE_PRUEBA_RESTAURACION } }),
  ]);
  const pg = ubicarPostgres();
  // Los mismos destinos que mira la descarga (también los pausados: sus archivos siguen ahí).
  const enDisco = await descargables(config.destinos, historial, config.retencion);
  return NextResponse.json({
    config: configPublica(config),
    estado: {
      pgDump: "error" in pg ? { ok: false, mensaje: pg.error } : { ok: true, mensaje: pg.version },
      cifradoDisponible: cifradoDisponible(),
      windows: process.platform === "win32",
      // La instalación de Windows prepara una carpeta en la que el servicio puede escribir.
      carpetaSugerida: process.env.RESPALDOS_DIR ?? null,
      proximo: config.automatico.activo ? proximoProgramado(config.automatico, new Date()).toISOString() : null,
      // La deja la tarea semanal de la instalación (`g360 probar-restauracion`).
      pruebaRestauracion: leerPrueba(prueba?.valor),
    },
    historial: historial.map((r) => ({
      ...r,
      tamano: r.tamano === null ? null : Number(r.tamano),
      // Los podados (se conservan los N más recientes) ya no se ofrecen para descargar.
      descargable: !!r.archivo && enDisco.has(r.archivo),
    })),
  });
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.respaldos");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, esquemaConfig);
  if (!parsed.ok) return parsed.response;

  const anterior = await leerConfigRespaldos();
  const errores = erroresDeConfig(parsed.data, anterior);
  if (errores.length) return NextResponse.json({ error: errores.join(" ") }, { status: 400 });
  const traeClaves = !!parsed.data.claveCifrado || parsed.data.destinos.some((d) => (d.tipo === "RED" && d.clave) || (d.tipo === "NUBE" && d.secretAccessKey));
  if (traeClaves && !cifradoDisponible()) {
    return NextResponse.json({ error: "Falta CIFRADO_KEY en el servidor: sin ella las contraseñas no se pueden guardar (y no se guardan en claro)." }, { status: 409 });
  }

  const config = await guardarConfigRespaldos(parsed.data, anterior);
  const { ip, userAgent } = getClientInfo(req);
  // La auditoría lleva la forma pública: ninguna clave, ni cifrada.
  await audit({
    accion: "UPDATE", tabla: "ConfiguracionSistema", registroId: CLAVE_RESPALDOS, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: configPublica(anterior), valorNuevo: configPublica(config), ip, userAgent,
  });
  return NextResponse.json({ config: configPublica(config) });
}
