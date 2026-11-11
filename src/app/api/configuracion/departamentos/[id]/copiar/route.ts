/**
 * Copia un departamento con sus puestos activos a otras sucursales de la empresa
 * o a otras divisiones de su propia sucursal.
 *
 * Cada departamento pertenece a una sola sucursal y división: sin esto, una empresa
 * tendría que escribir la misma estructura una por una. Si en el destino ya hay un
 * departamento con ese nombre, sólo se le agregan los puestos que le falten, así
 * que repetir la copia no duplica nada. No se copian empleados, cobertura de
 * horarios ni centro de costo: son decisiones de cada destino.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId, zIdOpcional } from "@/lib/http/validar";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { divisionesHabilitadas, jerarquiaNominaHabilitada, validarDivisionDeDepartamento } from "@/lib/organizacion/estructura-bd";
import { claveNombre, mensajeCopia, puestosPorCopiar } from "@/lib/organizacion/puestos";

const schema = z.object({
  sucursalId: zId,
  divisionId: zIdOpcional,
  /** Varias divisiones de la sucursal de destino a la vez: todas o ninguna. */
  divisionIds: z.array(zId).min(1).max(100).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { sucursalId, divisionId, divisionIds } = parsed.data;
  const destinos: (string | null)[] = divisionIds ? [...new Set(divisionIds)] : [divisionId];

  const origen = await prisma.departamento.findUnique({
    where: { id },
    select: {
      nombre: true, codigo: true, descripcion: true, sucursalId: true, divisionId: true,
      sucursal: { select: { empresaId: true } },
      puestos: { where: { activo: true }, select: { nombre: true, descripcion: true, salarioMinimo: true, salarioMaximo: true } },
    },
  });
  if (!origen) return NextResponse.json({ error: "El departamento no existe." }, { status: 404 });
  // Dentro de la misma sucursal sólo tiene sentido hacia otra división.
  if (sucursalId === origen.sucursalId && destinos.some((d) => d === null || d === origen.divisionId)) {
    return NextResponse.json({ error: "Elija un destino distinto del propio departamento." }, { status: 400 });
  }

  const destino = await prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { nombre: true, empresaId: true, activa: true } });
  if (!destino || destino.empresaId !== origen.sucursal.empresaId) return NextResponse.json({ error: "La sucursal de destino no es de esta empresa." }, { status: 400 });
  if (!destino.activa) return NextResponse.json({ error: `La sucursal ${destino.nombre} está inactiva.` }, { status: 400 });

  const conDivisiones = await divisionesHabilitadas(prisma);
  for (const d of destinos) {
    const errorDivision = await validarDivisionDeDepartamento(prisma, { sucursalId, divisionId: d }, conDivisiones);
    if (errorDivision) return NextResponse.json({ error: errorDivision }, { status: 400 });
  }

  const [candidatos, divisiones, conJerarquia] = await Promise.all([
    prisma.departamento.findMany({ where: { sucursalId }, select: { id: true, nombre: true, activo: true, divisionId: true, puestos: { select: { nombre: true } } } }),
    prisma.division.findMany({ where: { sucursalId }, select: { id: true, nombre: true } }),
    jerarquiaNominaHabilitada(prisma),
  ]);
  const nombreDivision = new Map(divisiones.map((v) => [v.id, v.nombre]));
  const nombreDestino = (d: string | null) => (d ? nombreDivision.get(d) ?? destino.nombre : destino.nombre);

  // Con divisiones, dos departamentos pueden llamarse igual en divisiones distintas.
  const plan = destinos.map((d) => {
    const existente = candidatos.find((c) => (!conDivisiones || c.divisionId === d) && claveNombre(c.nombre) === claveNombre(origen.nombre));
    return { divisionId: d, existente, nuevos: puestosPorCopiar(origen.puestos, existente?.puestos ?? []) };
  });
  const conInactivo = plan.find((p) => p.existente && !p.existente.activo);
  if (conInactivo) {
    return NextResponse.json({ error: `${nombreDestino(conInactivo.divisionId)} ya tiene un departamento «${conInactivo.existente!.nombre}», pero está inactivo. Actívelo antes de copiar.` }, { status: 409 });
  }

  const ids = await prisma.$transaction(async (tx) => {
    const salida: string[] = [];
    for (const p of plan) {
      const idDestino = p.existente?.id ?? (await tx.departamento.create({
        data: { nombre: origen.nombre, codigo: origen.codigo, descripcion: origen.descripcion, sucursalId, divisionId: p.divisionId },
        select: { id: true },
      })).id;
      if (p.nuevos.length) await tx.puesto.createMany({ data: p.nuevos.map((n) => ({ ...n, departamentoId: idDestino })) });
      salida.push(idDestino);
    }
    return salida;
    // Varias empresas son varias escrituras: con la base lejos, los 5 s por omisión no alcanzan.
  }, { timeout: 30_000 });

  const { ip, userAgent } = getClientInfo(req);
  for (const [i, p] of plan.entries()) {
    await audit({
      accion: p.existente ? "UPDATE" : "CREATE", tabla: "Departamento", registroId: ids[i], usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
      valorNuevo: {
        accion: "COPIAR_DEPARTAMENTO", origen: id, nombre: origen.nombre, sucursalId, divisionId: p.divisionId,
        departamentoNuevo: !p.existente, puestosCreados: p.nuevos.map((n) => n.nombre),
      },
      ip, userAgent,
    });
  }

  const resultados = plan.map((p) => ({
    destino: nombreDestino(p.divisionId),
    departamentoNuevo: !p.existente,
    puestosCreados: p.nuevos.length,
    puestosOmitidos: origen.puestos.length - p.nuevos.length,
  }));
  return NextResponse.json({
    departamentoId: ids[0],
    departamentoNuevo: resultados.some((r) => r.departamentoNuevo),
    puestosCreados: resultados.reduce((suma, r) => suma + r.puestosCreados, 0),
    puestosOmitidos: resultados.reduce((suma, r) => suma + r.puestosOmitidos, 0),
    mensaje: mensajeCopia(origen.nombre, etiquetasNiveles(conJerarquia).divisiones.toLowerCase(), resultados),
  }, { status: 201 });
}
