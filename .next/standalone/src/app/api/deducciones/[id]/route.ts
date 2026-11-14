/**
 * Editar un tipo de deducción: nombre, categoría, monto habitual, descripción y si
 * está activo. El código no cambia: es la clave con que viaja en los archivos.
 *
 * Desactivar un tipo no deja de cobrar lo ya asignado (eso se quita por empleado): lo
 * saca de las listas para asignar y del archivo por empleado. Por eso la respuesta
 * dice a cuántos empleados les sigue corriendo.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { hoyHN } from "@/lib/utils";
import {
  MOTIVO_SISTEMA, conflictosDeTipos, esTipoDelSistema, leerDescripcion, leerMontoHabitual, leerNombre, leerTipo,
} from "@/lib/deducciones/tipos-bd";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("deducciones.configurar");
  if (!g.ok) return g.response;
  const { id } = await params;

  const actual = await prisma.tipoDeduccionConfig.findUnique({ where: { id } });
  if (!actual) return NextResponse.json({ error: "El tipo de deducción no existe." }, { status: 404 });
  if (esTipoDelSistema(actual)) return NextResponse.json({ error: `«${actual.nombre}» ${MOTIVO_SISTEMA}` }, { status: 400 });

  const d = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return NextResponse.json({ error: "Cuerpo JSON inválido" }, { status: 400 });

  const nombre = leerNombre(d.nombre);
  const tipo = leerTipo(d.tipo);
  const monto = leerMontoHabitual(d.montoFijo);
  const descripcion = leerDescripcion(d.descripcion);
  for (const r of [nombre, tipo, monto, descripcion]) if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  if (typeof d.activo !== "boolean") return NextResponse.json({ error: "Falta indicar si está activo." }, { status: 400 });
  if (!nombre.ok || !tipo.ok || !monto.ok || !descripcion.ok) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const conflicto = await conflictosDeTipos(prisma, [{ codigo: `__${actual.codigo}`, nombre: nombre.valor }], id);
  if (conflicto) return NextResponse.json({ error: conflicto }, { status: 409 });

  const nuevo = { nombre: nombre.valor, tipo: tipo.valor, montoFijo: monto.valor, descripcion: descripcion.valor, activo: d.activo };
  const guardado = await prisma.tipoDeduccionConfig.update({ where: { id }, data: nuevo });
  const asignadas = await prisma.deduccionEmpleado.count({
    where: { tipoDeduccionId: id, activo: true, OR: [{ fechaFin: null }, { fechaFin: { gte: hoyHN() } }] },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "TipoDeduccionConfig",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { nombre: actual.nombre, tipo: actual.tipo, montoFijo: actual.montoFijo?.toFixed(2) ?? null, descripcion: actual.descripcion, activo: actual.activo },
    valorNuevo: nuevo,
    ip,
    userAgent,
  });

  return NextResponse.json({ id: guardado.id, asignadas, cambioCategoria: actual.tipo !== tipo.valor });
}
