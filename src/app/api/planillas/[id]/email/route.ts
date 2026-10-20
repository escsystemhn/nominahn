import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { configSmtpVigente, sendEmail, templateBoletaPago } from "@/lib/email/send";
import { correoDeComprobantes } from "@/lib/email/destinatario";
import { audit, getClientInfo } from "@/lib/audit";
import { construirBoleta } from "@/lib/payroll/boleta";
import { formatDate } from "@/lib/utils";

/** Sin cuerpo: se envía a toda la planilla. Con `empleadoIds`: sólo a esos. */
const schema = z.object({
  empleadoIds: z.array(z.string().trim().min(1)).max(1000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("planillas.boletas");
  if (!g.ok) return g.response;

  const { id } = await params;

  // El cuerpo es opcional: el botón «enviar a todos» no manda nada.
  let filtro: string[] | undefined;
  const texto = await req.text();
  if (texto.trim()) {
    let json: unknown;
    try {
      json = JSON.parse(texto);
    } catch {
      return NextResponse.json({ error: "Cuerpo JSON inválido" }, { status: 400 });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    filtro = parsed.data.empleadoIds;
  }

  const planilla = await prisma.planilla.findUnique({
    where: { id },
    include: {
      empresa: { select: { nombre: true, rtn: true } },
      detalles: {
        where: filtro ? { empleadoId: { in: filtro } } : undefined,
        include: {
          empleado: {
            select: {
              id: true, codigo: true, identidad: true,
              primerNombre: true, segundoNombre: true,
              primerApellido: true, segundoApellido: true,
              emailPersonal: true, emailCorporativo: true,
              user: { select: { email: true } },
            },
          },
        },
      },
    },
  });

  if (!planilla) return NextResponse.json({ error: "Planilla no encontrada" }, { status: 404 });

  // No se envían comprobantes de una planilla que aún puede cambiar: el
  // trabajador recibiría un documento que luego deja de corresponder.
  if (!["APROBADA", "PAGADA"].includes(planilla.estado)) {
    return NextResponse.json(
      { error: `La planilla está ${planilla.estado}: apruébela antes de enviar los comprobantes` },
      { status: 409 }
    );
  }

  // Sin servidor, cada envío fallaría igual y la respuesta diría «14 errores»
  // sin explicar nada. Se detecta antes y se dice qué hacer.
  if (!(await configSmtpVigente().catch(() => null))) {
    return NextResponse.json(
      {
        error:
          "No hay servidor de correo saliente configurado. Un administrador debe " +
          "configurarlo en Configuración → Correo saliente.",
      },
      { status: 503 }
    );
  }

  let enviados = 0;
  let errores = 0;
  let primerError: string | null = null;
  const sinCorreo: string[] = [];

  for (const detalle of planilla.detalles) {
    const email = correoDeComprobantes(detalle.empleado);
    if (!email) {
      sinCorreo.push(detalle.empleado.codigo);
      continue;
    }

    try {
      await sendEmail({
        to: email,
        subject: `Comprobante de pago — ${planilla.tipo} — ${formatDate(planilla.fechaFin)}`,
        html: templateBoletaPago(
          construirBoleta(detalle, {
            empresa: planilla.empresa,
            empleado: detalle.empleado,
            planilla,
          })
        ),
      });

      await prisma.planillaDetalle.update({
        where: { id: detalle.id },
        data: { emailEnviado: true, emailEnviadoAt: new Date() },
      });

      enviados++;
    } catch (e) {
      errores++;
      // El primero basta para diagnosticar: si falla la autenticación, fallan
      // todos por lo mismo.
      primerError ??= e instanceof Error ? e.message : "Error desconocido";
    }
  }

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "Planilla",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      accion: "ENVIO_BOLETAS", enviados, errores, sinCorreo: sinCorreo.length,
      ...(filtro ? { empleados: filtro.length } : {}),
    },
    ip,
    userAgent,
  });

  // Quien no tiene correo se reporta: antes se saltaba en silencio y el total
  // no cuadraba sin que nadie supiera por qué.
  return NextResponse.json({
    enviados,
    errores,
    sinCorreo,
    primerError,
    total: planilla.detalles.length,
  });
}
