/**
 * Copia un departamento con sus puestos activos a otra sucursal de la empresa.
 *
 * Cada departamento pertenece a una sola sucursal: sin esto, una empresa con
 * varias sucursales tendría que escribir la misma estructura una por una. Si en
 * el destino ya hay un departamento con ese nombre, sólo se le agregan los puestos
 * que le falten, así que repetir la copia no duplica nada. No se copian empleados,
 * cobertura de horarios ni centro de costo: son decisiones de cada sucursal.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId, zIdOpcional } from "@/lib/http/validar";
import { divisionesHabilitadas, validarDivisionDeDepartamento } from "@/lib/organizacion/estructura-bd";
import { claveNombre, puestosPorCopiar } from "@/lib/organizacion/puestos";

const schema = z.object({ sucursalId: zId, divisionId: zIdOpcional });

const cuenta = (n: number) => `${n} ${n === 1 ? "puesto" : "puestos"}`;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { sucursalId, divisionId } = parsed.data;

  const origen = await prisma.departamento.findUnique({
    where: { id },
    select: {
      nombre: true, codigo: true, descripcion: true, sucursalId: true,
      sucursal: { select: { empresaId: true } },
      puestos: { where: { activo: true }, select: { nombre: true, descripcion: true, salarioMinimo: true, salarioMaximo: true } },
    },
  });
  if (!origen) return NextResponse.json({ error: "El departamento no existe." }, { status: 404 });
  if (sucursalId === origen.sucursalId) return NextResponse.json({ error: "Elija una sucursal distinta de la del departamento." }, { status: 400 });

  const destino = await prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { nombre: true, empresaId: true, activa: true } });
  if (!destino || destino.empresaId !== origen.sucursal.empresaId) return NextResponse.json({ error: "La sucursal de destino no es de esta empresa." }, { status: 400 });
  if (!destino.activa) return NextResponse.json({ error: `La sucursal ${destino.nombre} está inactiva.` }, { status: 400 });

  const conDivisiones = await divisionesHabilitadas(prisma);
  const errorDivision = await validarDivisionDeDepartamento(prisma, { sucursalId, divisionId }, conDivisiones);
  if (errorDivision) return NextResponse.json({ error: errorDivision }, { status: 400 });

  // Con divisiones, dos departamentos pueden llamarse igual en divisiones distintas.
  const candidatos = await prisma.departamento.findMany({
    where: { sucursalId, ...(conDivisiones ? { divisionId } : {}) },
    select: { id: true, nombre: true, activo: true, puestos: { select: { nombre: true } } },
  });
  const existente = candidatos.find((d) => claveNombre(d.nombre) === claveNombre(origen.nombre));
  if (existente && !existente.activo) {
    return NextResponse.json({ error: `${destino.nombre} ya tiene un departamento «${existente.nombre}», pero está inactivo. Actívelo antes de copiar.` }, { status: 409 });
  }

  const nuevos = puestosPorCopiar(origen.puestos, existente?.puestos ?? []);
  const departamentoId = await prisma.$transaction(async (tx) => {
    const idDestino = existente?.id ?? (await tx.departamento.create({
      data: { nombre: origen.nombre, codigo: origen.codigo, descripcion: origen.descripcion, sucursalId, divisionId },
      select: { id: true },
    })).id;
    if (nuevos.length) await tx.puesto.createMany({ data: nuevos.map((p) => ({ ...p, departamentoId: idDestino })) });
    return idDestino;
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: existente ? "UPDATE" : "CREATE", tabla: "Departamento", registroId: departamentoId, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      accion: "COPIAR_DEPARTAMENTO", origen: id, nombre: origen.nombre, sucursalId, divisionId,
      departamentoNuevo: !existente, puestosCreados: nuevos.map((p) => p.nombre),
    },
    ip, userAgent,
  });

  const omitidos = origen.puestos.length - nuevos.length;
  const mensaje = existente
    ? `${destino.nombre} ya tenía ${origen.nombre}: se agregaron ${cuenta(nuevos.length)}${omitidos ? ` y ya tenía ${cuenta(omitidos)}` : ""}.`
    : `Se creó ${origen.nombre} en ${destino.nombre} con ${cuenta(nuevos.length)}.`;
  return NextResponse.json({ departamentoId, departamentoNuevo: !existente, puestosCreados: nuevos.length, puestosOmitidos: omitidos, mensaje }, { status: 201 });
}
