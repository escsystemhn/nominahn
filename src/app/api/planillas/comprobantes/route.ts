/**
 * Los comprobantes de varias planillas en un solo PDF, para imprimir un período de una
 * vez (pedido de Edbin, 2026-11-24): cada empleado en su hoja carta con las dos copias de
 * media carta, ordenados por sucursal, división y departamento y, dentro, en el orden que
 * la persona eligió para ver la planilla.
 *
 *   GET ?ids=a,b,c&contar=1            → { empleados, sinCorreo, sinAprobar, planillas, detalle }
 *     `detalle`: por planilla, su nombre, estado, cuántos empleados y cuántos con correo, para
 *     enviarlas por correo una tras otra (`/api/planillas/[id]/email`, 2026-11-24).
 *   GET ?ids=a,b,c[&solo=sin-correo][&modo=ver]  → el PDF
 *
 * Sólo las personas del alcance de quien lo pide; las planillas anuladas no cuentan.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { filtroPorEmpleado } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { construirBoleta, EMPLEADO_BOLETA, EMPRESA_BOLETA, sucursalDeBoleta, UBICACION_BOLETA } from "@/lib/payroll/boleta";
import { claveDeLinea, cobradasSinDetalle } from "@/lib/payroll/deducciones-de-linea-bd";
import { nombresEnOrden } from "@/lib/deducciones/orden-columnas";
import { pdfComprobantes } from "@/lib/payroll/comprobante-pdf";
import { logosDeSucursales } from "@/lib/organizacion/logo-bd";
import { jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import { correoDeComprobantes } from "@/lib/email/destinatario";
import { COOKIE_VISTA_PLANILLA, comparadorPlanilla, leerVista } from "@/lib/payroll/vista-planilla";
import { nombreCompleto } from "@/lib/utils";

/** Un lote de 1 500 comprobantes son 1 500 hojas: más que eso se pide por partes. */
const MAX_COMPROBANTES = 1500;
const MAX_PLANILLAS = 300;
const dia = (d: Date) => d.toISOString().slice(0, 10);
const corta = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("planillas.ver");
  if (!g.ok) return g.response;
  const sp = new URL(req.url).searchParams;
  const ids = [...new Set((sp.get("ids") ?? "").split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(x)))];
  if (!ids.length) return NextResponse.json({ error: "Elija al menos una planilla." }, { status: 400 });
  if (ids.length > MAX_PLANILLAS) return NextResponse.json({ error: `Son más de ${MAX_PLANILLAS} planillas: elija menos.` }, { status: 413 });

  const detalles = await prisma.planillaDetalle.findMany({
    where: { AND: [{ planillaId: { in: ids }, planilla: { estado: { not: "ANULADA" } } }, filtroPorEmpleado(g.usuario)] },
    include: {
      ...UBICACION_BOLETA,
      empleado: {
        select: {
          ...EMPLEADO_BOLETA, sucursalId: true, departamentoId: true, fechaIngreso: true,
          emailPersonal: true, emailCorporativo: true, user: { select: { email: true } },
        },
      },
      planilla: {
        select: {
          id: true, tipo: true, fechaInicio: true, fechaFin: true, fechaPago: true, estado: true, empresa: EMPRESA_BOLETA,
          sucursal: { select: { id: true, nombre: true } }, division: { select: { nombre: true } }, departamento: { select: { nombre: true } },
        },
      },
    },
    take: MAX_COMPROBANTES + 1,
  });
  if (detalles.length > MAX_COMPROBANTES) {
    return NextResponse.json({ error: `Son más de ${MAX_COMPROBANTES} comprobantes: imprima el período por partes.` }, { status: 413 });
  }

  const sinCorreo = detalles.filter((d) => !correoDeComprobantes(d.empleado));
  if (sp.get("contar") === "1") {
    // Por planilla, para enviarlas por correo una tras otra y decir cuántos van en cada una.
    const porPlanilla = new Map<string, (typeof detalles)[number][]>();
    for (const d of detalles) porPlanilla.set(d.planillaId, [...(porPlanilla.get(d.planillaId) ?? []), d]);
    const planillas = [...porPlanilla.values()].map((ds) => ds[0].planilla);
    const unGrupo = new Set(planillas.map((p) => p.sucursal?.id ?? "")).size <= 1;
    const unPeriodo = new Set(planillas.map((p) => `${p.tipo}|${dia(p.fechaInicio)}|${dia(p.fechaFin)}`)).size <= 1;
    const nombreDe = (p: (typeof planillas)[number]) => {
      const partes = p.sucursal ? [p.sucursal.nombre, p.division?.nombre, p.departamento?.nombre].filter(Boolean) as string[] : ["Toda la empresa"];
      const unidad = unGrupo && partes.length > 1 ? partes.slice(1).join(" / ") : partes.join(" / ");
      return unPeriodo ? unidad : `${unidad} (${corta(dia(p.fechaInicio))} al ${corta(dia(p.fechaFin))})`;
    };
    return NextResponse.json({
      empleados: detalles.length,
      sinCorreo: sinCorreo.length,
      sinAprobar: detalles.filter((d) => !["APROBADA", "PAGADA"].includes(d.planilla.estado)).length,
      planillas: porPlanilla.size,
      detalle: [...porPlanilla.entries()]
        .map(([id, ds]) => ({
          id, nombre: nombreDe(ds[0].planilla), estado: ds[0].planilla.estado,
          empleados: ds.length, conCorreo: ds.filter((d) => !!correoDeComprobantes(d.empleado)).length,
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true })),
    });
  }

  const soloSinCorreo = sp.get("solo") === "sin-correo";
  const elegidos = soloSinCorreo ? sinCorreo : detalles;
  if (!elegidos.length) {
    return NextResponse.json({ error: soloSinCorreo ? "Todos tienen correo: no hay comprobantes que imprimir." : "Esas planillas no tienen empleados de su alcance." }, { status: 404 });
  }

  // Por sucursal, división y departamento; dentro, en el orden elegido para ver la planilla.
  const vista = leerVista(req.cookies.get(COOKIE_VISTA_PLANILLA)?.value);
  const comparar = comparadorPlanilla(vista.orden, vista.dir);
  const lugar = (d: (typeof elegidos)[number]) => [d.sucursal?.nombre ?? "", d.division?.nombre ?? "", d.departamento?.nombre ?? ""];
  const fila = (d: (typeof elegidos)[number]) => ({
    nombre: nombreCompleto(d.empleado), fechaIngreso: d.empleado.fechaIngreso, codigo: d.empleado.codigo,
    apellido: [d.empleado.primerApellido, d.empleado.segundoApellido, d.empleado.primerNombre, d.empleado.segundoNombre].filter(Boolean).join(" "),
    salario: Number(d.salarioBase), bruto: Number(d.totalBruto), deducciones: Number(d.totalDeducciones), neto: Number(d.salarioNeto),
  });
  const ordenados = [...elegidos].sort((a, b) => {
    const la = lugar(a), lb = lugar(b);
    for (let i = 0; i < 3; i++) {
      const c = la[i].localeCompare(lb[i], "es", { sensitivity: "base", numeric: true });
      if (c) return c;
    }
    return a.planilla.fechaInicio.getTime() - b.planilla.fechaInicio.getTime() || comparar(fila(a), fila(b));
  });

  const jerarquia = await jerarquiaNominaHabilitada(prisma);
  // Cada deducción con su nombre, en el orden de las columnas de la planilla.
  const [ordenDeducciones, cobradas] = await Promise.all([nombresEnOrden(prisma), cobradasSinDetalle(prisma, ordenados)]);
  const lista = ordenados.map((d) => {
    const ubicacion = { sucursal: d.sucursal, division: d.division, departamento: d.departamento, puesto: d.puesto };
    return { d, ubicacion, datos: construirBoleta(d, { empresa: d.planilla.empresa, empleado: d.empleado, planilla: d.planilla, ubicacion, jerarquia, ordenDeducciones, cobradas: cobradas.get(claveDeLinea(d)) }) };
  });
  const sucursales = [...new Set(lista.map((x) => sucursalDeBoleta(x.ubicacion, x.d.empleado)?.id).filter((x): x is string => !!x))];
  const logos = await logosDeSucursales(prisma, sucursales);

  const desde = dia(new Date(Math.min(...ordenados.map((d) => d.planilla.fechaInicio.getTime()))));
  const hasta = dia(new Date(Math.max(...ordenados.map((d) => d.planilla.fechaFin.getTime()))));
  const pdf = await pdfComprobantes(
    lista.map((x) => {
      const id = sucursalDeBoleta(x.ubicacion, x.d.empleado)?.id;
      return { datos: x.datos, logo: id ? logos.get(id) ?? null : null };
    }),
    `Comprobantes de pago del ${corta(desde)} al ${corta(hasta)}`,
  );

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "EXPORT", tabla: "PlanillaDetalle", registroId: `comprobantes:${ordenados.length}`,
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { formato: "comprobantes en lote", planillas: [...new Set(ordenados.map((d) => d.planillaId))], comprobantes: ordenados.length, soloSinCorreo, alcance: g.usuario.alcance ?? "TODO" },
    ip, userAgent,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${sp.get("modo") === "ver" ? "inline" : "attachment"}; filename="comprobantes_${desde}_al_${hasta}.pdf"`,
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
