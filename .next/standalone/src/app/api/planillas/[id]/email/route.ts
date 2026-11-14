import { NextRequest, NextResponse } from "next/server";
import { filtroPorEmpleado } from "@/lib/auth/alcance";
import { accesoAPlanilla } from "@/lib/payroll/alcance-planilla";
import { textoEstadoPlanilla } from "@/lib/payroll/estado-planilla";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { configSmtpVigente, sendEmail } from "@/lib/email/send";
import { correoDeComprobantes } from "@/lib/email/destinatario";
import { audit, getClientInfo } from "@/lib/audit";
import { construirBoleta, EMPLEADO_BOLETA, EMPRESA_BOLETA, sucursalDeBoleta, UBICACION_BOLETA } from "@/lib/payroll/boleta";
import { adjuntoDelLogo, CID_LOGO, comprobanteHtml } from "@/lib/payroll/comprobante-html";
import { logosDeSucursales } from "@/lib/organizacion/logo-bd";
import { jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";

/** Sin cuerpo: se envía a toda la planilla. Con `empleadoIds`: sólo a esos. */
const schema = z.object({
  empleadoIds: z.array(z.string().trim().min(1)).max(1000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("planillas.boletas");
  if (!g.ok) return g.response;

  const { id } = await params;
  if ((await accesoAPlanilla(prisma, g.usuario, id)) === "ninguno") {
    return NextResponse.json({ error: "Planilla no encontrada" }, { status: 404 });
  }

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
      empresa: EMPRESA_BOLETA,
      detalles: {
        // Sólo a las personas de su alcance, aunque pida otras.
        where: { AND: [filtro ? { empleadoId: { in: filtro } } : {}, filtroPorEmpleado(g.usuario)] },
        include: {
          ...UBICACION_BOLETA,
          empleado: {
            select: {
              ...EMPLEADO_BOLETA,
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
      { error: `La planilla está ${textoEstadoPlanilla(planilla.estado)}: apruébela antes de enviar los comprobantes` },
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

  // De una vez: una planilla con cientos de personas tiene pocas sucursales.
  const ubicacionDe = (d: (typeof planilla.detalles)[number]) => ({ sucursal: d.sucursal, division: d.division, departamento: d.departamento, puesto: d.puesto });
  const jerarquia = await jerarquiaNominaHabilitada(prisma);
  const logos = await logosDeSucursales(prisma, planilla.detalles.flatMap((d) => sucursalDeBoleta(ubicacionDe(d), d.empleado)?.id ?? []));

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
      const ubicacion = ubicacionDe(detalle);
      const datos = construirBoleta(detalle, { empresa: planilla.empresa, empleado: detalle.empleado, planilla, ubicacion, jerarquia });
      const sucursalId = sucursalDeBoleta(ubicacion, detalle.empleado)?.id;
      const logo = sucursalId ? logos.get(sucursalId) : undefined;

      await sendEmail({
        to: email,
        // Sin montos: el asunto se lee en la pantalla bloqueada del teléfono.
        subject: `Comprobante de pago del ${datos.periodo}`,
        html: comprobanteHtml(datos, {
          modo: "correo",
          logo: logo ? { src: `cid:${CID_LOGO}`, ancho: logo.ancho, alto: logo.alto, alt: `Logo de ${datos.sucursal ?? datos.empresa}` } : null,
        }),
        attachments: logo ? [adjuntoDelLogo(logo.png)] : [],
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
