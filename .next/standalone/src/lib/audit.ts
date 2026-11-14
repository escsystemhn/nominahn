import { prisma } from "@/lib/prisma";
import { AccionAudit } from "@prisma/client";

interface AuditParams {
  accion: AccionAudit;
  tabla: string;
  registroId: string;
  usuarioId?: string;
  usuarioEmail?: string;
  valorAnterior?: unknown;
  valorNuevo?: unknown;
  ip?: string;
  userAgent?: string;
}

export async function audit(params: AuditParams) {
  try {
    await prisma.auditLog.create({
      data: {
        accion: params.accion,
        tabla: params.tabla,
        registroId: params.registroId,
        usuarioId: params.usuarioId,
        usuarioEmail: params.usuarioEmail,
        valorAnterior: params.valorAnterior ? JSON.parse(JSON.stringify(params.valorAnterior)) : undefined,
        valorNuevo: params.valorNuevo ? JSON.parse(JSON.stringify(params.valorNuevo)) : undefined,
        ip: params.ip,
        userAgent: params.userAgent,
      },
    });
  } catch (e) {
    // Un fallo de auditoría NO debe bloquear la operación de negocio: perder el
    // rastro es malo, pero dejar una planilla a medias es peor.
    //
    // Sí debe DEJAR SEÑAL. Antes el `catch {}` vacío hacía que un fallo
    // persistente de escritura —tabla llena, permisos, columna nueva— pasara
    // completamente desapercibido: se creía tener rastro y no había ninguno.
    console.error(
      `[audit] no se pudo registrar ${params.accion} sobre ${params.tabla}#${params.registroId}`,
      e
    );
  }
}

export function getClientInfo(request: Request) {
  return {
    ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  };
}
