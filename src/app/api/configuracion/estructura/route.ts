/**
 * Opciones de estructura organizacional: el nivel División
 * (Sucursal → División → Departamento) y la jerarquía de nómina
 * (Frecuencia → Grupo → Sucursal → Departamento → Empleados). Las enciende o apaga
 * el administrador. Apagarlas no borra divisiones ni asignaciones: sólo deja de
 * mostrarlas (ver `src/lib/organizacion/estructura-bd.ts`).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { aplicarCambioOpciones } from "@/lib/organizacion/estructura";
import {
  CLAVE_DIVISIONES,
  CLAVE_JERARQUIA_NOMINA,
  divisionesHabilitadas,
  guardarDivisionesHabilitadas,
  guardarJerarquiaNominaHabilitada,
  jerarquiaNominaHabilitada,
} from "@/lib/organizacion/estructura-bd";

const schema = z
  .object({ divisiones: z.boolean().optional(), jerarquia: z.boolean().optional() })
  .refine((c) => c.divisiones !== undefined || c.jerarquia !== undefined, "Indique qué opción cambia");

const leerOpciones = async () => {
  const [divisiones, jerarquia] = await Promise.all([divisionesHabilitadas(prisma), jerarquiaNominaHabilitada(prisma)]);
  return { divisiones, jerarquia };
};

export async function GET() {
  const g = await requerirPermiso(["configuracion.ver", "configuracion.editar"]);
  if (!g.ok) return g.response;
  return NextResponse.json(await leerOpciones());
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const antes = await leerOpciones();
  const nuevas = aplicarCambioOpciones(antes, parsed.data);
  await prisma.$transaction(async (tx) => {
    await guardarDivisionesHabilitadas(tx, nuevas.divisiones);
    await guardarJerarquiaNominaHabilitada(tx, nuevas.jerarquia);
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "ConfiguracionSistema",
    registroId: parsed.data.jerarquia !== undefined ? CLAVE_JERARQUIA_NOMINA : CLAVE_DIVISIONES,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: antes,
    valorNuevo: nuevas,
    ip,
    userAgent,
  });

  return NextResponse.json(nuevas);
}
