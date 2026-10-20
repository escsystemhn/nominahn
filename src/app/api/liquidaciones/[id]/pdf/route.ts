/**
 * El finiquito en PDF, armado con el desglose CONGELADO al guardar la
 * liquidación: se reproduce igual aunque después cambien tablas o salarios.
 * Un borrador o una anulada sale con marca de agua.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { formatCurrency, formatDate, formatDateLong, nombreCompleto } from "@/lib/utils";
import { pdfFiniquito, type ConceptoFiniquito } from "@/lib/documentos/pdf";
import { leerFirmante } from "@/lib/documentos/firmante";
import { montoALetras } from "@/lib/documentos/numero-letras";
import { etiquetaCausa, textoTiempoServicio, folioLiquidacion } from "@/lib/payroll/etiquetas-prestaciones";
import { etiquetaParentesco } from "@/lib/empleados/familia";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("prestaciones.ver");
  if (!g.ok) return g.response;
  const { id } = await params;

  const liq = await prisma.liquidacionFinal.findUnique({
    where: { id },
    include: {
      empleado: {
        select: {
          codigo: true, identidad: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
          sucursal: { select: { empresa: { select: { nombre: true, rtn: true, direccion: true, telefono: true, email: true } } } },
          puesto: { select: { nombre: true } },
          departamento: { select: { nombre: true } },
          beneficiarios: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!liq) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const firmante = await leerFirmante(prisma);
  const conceptos = (Array.isArray(liq.conceptos) ? liq.conceptos : []) as unknown as ConceptoFiniquito[];
  const folio = folioLiquidacion(liq.id, liq.fechaSalida);
  const empresa = liq.empleado.sucursal.empresa;

  const buf = await pdfFiniquito({
    empresa,
    folio,
    estado: liq.estado,
    trabajador: {
      nombre: nombreCompleto(liq.empleado),
      identidad: liq.empleado.identidad,
      codigo: liq.empleado.codigo,
      puesto: liq.empleado.puesto?.nombre,
      departamento: liq.empleado.departamento?.nombre,
    },
    causa: etiquetaCausa(liq.causa),
    fechaIngreso: formatDate(liq.fechaIngreso),
    fechaSalida: formatDate(liq.fechaSalida),
    tiempoServicio: textoTiempoServicio(liq),
    salarioPromedio: Number(liq.salarioPromedio),
    salarioDiario: Number(liq.salarioDiario),
    conceptos: conceptos.map((c) => ({ ...c, monto: Number(c.monto) })),
    totalPrestaciones: Number(liq.totalPrestaciones),
    deducciones: Number(liq.deducciones),
    totalAPagar: Number(liq.totalAPagar),
    totalEnLetras: montoALetras(Number(liq.totalAPagar)),
    observaciones: (liq.observaciones ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    beneficiarios:
      liq.causa === "MUERTE"
        ? liq.empleado.beneficiarios.map((b) => ({ nombre: b.nombre, parentesco: etiquetaParentesco(b.parentesco), porcentaje: Number(b.porcentaje) }))
        : undefined,
    lugarFecha: `${firmante.ciudad ? `${firmante.ciudad}, ` : ""}${formatDateLong(new Date())}`,
    firmante: { nombre: firmante.nombre, cargo: firmante.cargo },
    moneda: (n) => formatCurrency(n),
  });

  const ver = new URL(req.url).searchParams.get("modo") === "ver";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${ver ? "inline" : "attachment"}; filename="${folio}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
