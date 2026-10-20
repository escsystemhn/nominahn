/**
 * Guarda un concepto de ley (IHSS, IVM, RAP o INFOP): porcentajes, topes y, si
 * se elige «monto fijo», los montos mensuales de empleado y patrono.
 *
 * Las planillas ya cerradas guardan sus importes y no cambian; lo que cambia es
 * el próximo cálculo. Cada cambio queda en la bitácora con el valor anterior.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { parsearBody, zPorcentaje, zMontoAnulable, zMontoPositivo } from "@/lib/http/validar";
import { audit, getClientInfo } from "@/lib/audit";
import { CONCEPTOS_LEY, esCodigoConceptoLey, porcentajeAFraccion } from "@/lib/payroll/conceptos-ley";

/** La base guarda la tasa con 4 decimales de fracción: 2 del porcentaje. */
const zTasa = zPorcentaje.refine(
  (p) => Math.abs(p * 100 - Math.round(p * 100)) < 1e-6,
  "máximo 2 decimales"
);

const schema = z.object({
  modo: z.enum(["PORCENTAJE", "MONTO_FIJO"]),
  porcentajeEmpleado: zTasa.nullable().optional(),
  porcentajeEmpleador: zTasa,
  topeMaximo: zMontoPositivo.nullable().optional(),
  topeMinimo: zMontoAnulable,
  montoFijoEmpleado: zMontoAnulable,
  montoFijoEmpleador: zMontoAnulable,
});

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;

  const { codigo } = await params;
  if (!esCodigoConceptoLey(codigo)) {
    return NextResponse.json({ error: "Concepto no editable aquí" }, { status: 404 });
  }
  const meta = CONCEPTOS_LEY[codigo];

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  // Reglas por concepto. Los porcentajes y topes se exigen también en modo
  // monto fijo: se conservan para poder volver al porcentaje sin reescribirlos.
  const detalles: Record<string, string[]> = {};
  const falta = (campo: string, msg = "requerido") => (detalles[campo] = [msg]);
  if (meta.tieneEmpleado && (d.porcentajeEmpleado === null || d.porcentajeEmpleado === undefined)) {
    falta("porcentajeEmpleado");
  }
  if (meta.tieneTope && !d.topeMaximo) falta("topeMaximo");
  if (meta.tienePiso) {
    if (d.topeMinimo === null || d.topeMinimo === undefined) falta("topeMinimo");
    else if (d.topeMaximo && d.topeMaximo <= d.topeMinimo) falta("topeMaximo", "el techo debe ser mayor que el piso");
  }
  if (d.modo === "MONTO_FIJO") {
    if (meta.tieneEmpleado && (d.montoFijoEmpleado === null || d.montoFijoEmpleado === undefined)) {
      falta("montoFijoEmpleado");
    }
    if (d.montoFijoEmpleador === null || d.montoFijoEmpleador === undefined) falta("montoFijoEmpleador");
  }
  if (Object.keys(detalles).length > 0) {
    return NextResponse.json({ error: "Datos inválidos", detalles }, { status: 400 });
  }

  const datos = {
    modo: d.modo,
    ...(meta.tieneEmpleado ? { porcentaje: porcentajeAFraccion(d.porcentajeEmpleado!) } : {}),
    porcentajeEmpleador: porcentajeAFraccion(d.porcentajeEmpleador),
    topeMaximo: meta.tieneTope ? d.topeMaximo! : null,
    topeMinimo: meta.tienePiso ? d.topeMinimo! : null,
    montoFijo: meta.tieneEmpleado ? (d.montoFijoEmpleado ?? null) : null,
    montoFijoEmpleador: d.montoFijoEmpleador ?? null,
    // Guardar aquí es decidir que estos valores rigen: un concepto inactivo
    // dejaría al motor en sus valores por defecto sin que nadie lo note.
    activo: true,
  };

  const anterior = await prisma.tipoDeduccionConfig.findUnique({ where: { codigo } });
  const guardado = await prisma.tipoDeduccionConfig.upsert({
    where: { codigo },
    create: {
      codigo,
      nombre: meta.nombre,
      tipo: "LEGAL",
      esLegal: true,
      aplicaEmpleado: meta.tieneEmpleado,
      aplicaEmpleador: true,
      descripcion: meta.descripcion,
      ...datos,
    },
    update: datos,
  });

  const foto = (c: typeof guardado | null) =>
    c && {
      modo: c.modo,
      porcentaje: num(c.porcentaje),
      porcentajeEmpleador: num(c.porcentajeEmpleador),
      topeMaximo: num(c.topeMaximo),
      topeMinimo: num(c.topeMinimo),
      montoFijo: num(c.montoFijo),
      montoFijoEmpleador: num(c.montoFijoEmpleador),
      activo: c.activo,
    };

  await audit({
    accion: anterior ? "UPDATE" : "CREATE",
    tabla: "TipoDeduccionConfig",
    registroId: guardado.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: foto(anterior),
    valorNuevo: foto(guardado),
    ...getClientInfo(req),
  });

  return NextResponse.json({ ok: true });
}
