import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirSesion, puede } from "@/lib/auth/guard";
import { templateBoletaPago } from "@/lib/email/send";
import { construirBoleta } from "@/lib/payroll/boleta";

// GET: descarga la boleta (comprobante de pago) de un detalle de planilla.
// El empleado sólo puede descargar la suya; RRHH/admin/contador cualquier boleta.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { id } = await params;

  const detalle = await prisma.planillaDetalle.findUnique({
    where: { id },
    include: {
      empleado: {
        select: {
          id: true, codigo: true, identidad: true,
          primerNombre: true, segundoNombre: true,
          primerApellido: true, segundoApellido: true,
        },
      },
      planilla: {
        select: {
          tipo: true, fechaInicio: true, fechaFin: true, estado: true,
          empresa: { select: { nombre: true, rtn: true } },
        },
      },
    },
  });

  if (!detalle) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const esPropia = !!g.usuario.empleadoId && detalle.empleadoId === g.usuario.empleadoId;
  const esAdmin = puede(g.usuario, "planillas.ver");
  if (!esPropia && !esAdmin) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // Un borrador no es un comprobante: no se entrega como tal al trabajador.
  if (esPropia && !esAdmin && !["APROBADA", "PAGADA"].includes(detalle.planilla.estado)) {
    return NextResponse.json(
      { error: "La planilla de este período aún no está aprobada" },
      { status: 409 }
    );
  }

  // Desglose completo: cada deducción con su nombre e importe. La versión
  // anterior sólo mostraba bruto, total de deducciones y neto.
  const html = templateBoletaPago(
    construirBoleta(detalle, {
      empresa: detalle.planilla.empresa,
      empleado: detalle.empleado,
      planilla: detalle.planilla,
    })
  );

  // `?modo=ver` la muestra en el navegador en vez de descargarla: es lo que usa
  // el botón «Ver» de la planilla y del expediente del empleado.
  const ver = new URL(req.url).searchParams.get("modo") === "ver";

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": ver
        ? `inline; filename="boleta-${id}.html"`
        : `attachment; filename="boleta-${id}.html"`,
      // Documento con datos salariales: nunca en caché compartida.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Mostrada en línea, la boleta se ejecuta en el dominio de la aplicación y
      // con la sesión de quien la abre. La plantilla ya escapa lo que escriben
      // los usuarios; esta política impide además cualquier script, conexión o
      // recurso externo, por si algún día una línea se cuela sin escapar.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}
