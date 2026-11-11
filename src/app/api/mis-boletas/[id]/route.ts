import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { prisma } from "@/lib/prisma";
import { requerirSesion, puede } from "@/lib/auth/guard";
import { construirBoleta, EMPLEADO_BOLETA, EMPRESA_BOLETA, nombreArchivoComprobante, sucursalDeBoleta, UBICACION_BOLETA } from "@/lib/payroll/boleta";
import { comprobanteHtml } from "@/lib/payroll/comprobante-html";
import { pdfComprobante } from "@/lib/payroll/comprobante-pdf";
import { logosDeSucursales, pngComoDataUri } from "@/lib/organizacion/logo-bd";

// GET: el comprobante de pago de una línea de planilla, en PDF para descargarlo o,
// con `?modo=ver`, en pantalla. El empleado sólo puede abrir el suyo; RRHH, admin y
// contador, cualquiera de su alcance.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { id } = await params;

  const detalle = await prisma.planillaDetalle.findUnique({
    where: { id },
    include: {
      ...UBICACION_BOLETA,
      empleado: { select: { ...EMPLEADO_BOLETA, sucursalId: true, departamentoId: true } },
      planilla: {
        select: {
          tipo: true, fechaInicio: true, fechaFin: true, fechaPago: true, estado: true,
          empresa: EMPRESA_BOLETA,
        },
      },
    },
  });

  if (!detalle) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const esPropia = !!g.usuario.empleadoId && detalle.empleadoId === g.usuario.empleadoId;
  const vePlanillas = puede(g.usuario, "planillas.ver");
  const esAdmin = vePlanillas && alcanzaEmpleado(g.usuario, detalle.empleado);
  // Fuera de su alcance responde igual que si no existiera.
  if (!esPropia && vePlanillas && !esAdmin) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
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

  const ubicacion = { sucursal: detalle.sucursal, division: detalle.division, departamento: detalle.departamento };
  // Desglose completo: cada deducción con su nombre e importe.
  const datos = construirBoleta(detalle, {
    empresa: detalle.planilla.empresa,
    empleado: detalle.empleado,
    planilla: detalle.planilla,
    ubicacion,
  });
  const sucursalId = sucursalDeBoleta(ubicacion, detalle.empleado)?.id;
  const logo = sucursalId ? (await logosDeSucursales(prisma, [sucursalId])).get(sucursalId) : null;

  // Documento con datos salariales: nunca en caché compartida.
  const comunes = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

  if (new URL(req.url).searchParams.get("modo") !== "ver") {
    const pdf = await pdfComprobante(datos, logo);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        ...comunes,
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nombreArchivoComprobante(detalle.empleado.codigo, detalle.planilla.fechaFin)}"`,
      },
    });
  }

  const nonce = randomBytes(16).toString("base64");
  const html = comprobanteHtml(datos, {
    modo: "pantalla",
    logo: logo ? { src: pngComoDataUri(logo.png), ancho: logo.ancho, alto: logo.alto, alt: `Logo de ${datos.sucursal ?? datos.empresa}` } : null,
    nonce,
    urlPdf: `/api/mis-boletas/${id}`,
  });

  return new NextResponse(html, {
    headers: {
      ...comunes,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="comprobante-${id}.html"`,
      // La boleta se ejecuta en el dominio de la aplicación y con la sesión de quien
      // la abre. La plantilla ya escapa lo que escriben los usuarios; esta política
      // impide además cualquier conexión o recurso externo, y todo script salvo el
      // del botón de imprimir, por si algún día una línea se cuela sin escapar.
      "Content-Security-Policy":
        `default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}
