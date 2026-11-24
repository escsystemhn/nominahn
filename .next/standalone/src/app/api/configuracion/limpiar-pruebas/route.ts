/**
 * Limpiar pruebas (ver `lib/payroll/limpiar-pruebas.ts`).
 *   GET  ?desde=ISO  → lo que se creó desde esa fecha: planillas (con por qué no se puede
 *                      quitar alguna) y montos del período importados
 *   POST { desde, planillaIds, montos, respaldo } → lo quita; con `respaldo`, primero un
 *                      respaldo manual y, si falla, no se toca nada
 *
 * Sólo quien hace respaldos y calcula planillas, con alcance a toda la empresa: borra
 * trabajo de cualquiera.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso, puede, type Usuario } from "@/lib/auth/guard";
import { alcanceEsTotal } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { crearRespaldo, ErrorRespaldo } from "@/lib/respaldos/respaldos-bd";
import { buscarDatosDePrueba, limpiarDatosDePrueba } from "@/lib/payroll/limpiar-pruebas";
import { errorDeDesde } from "@/lib/payroll/limpiar-pruebas-reglas";

const schema = z.object({
  desde: z.string().min(1),
  planillaIds: z.array(zId).max(1000).default([]),
  montos: z.boolean().default(false),
  respaldo: z.boolean().default(true),
});

async function guardia() {
  const g = await requerirPermiso("configuracion.respaldos");
  if (!g.ok) return g;
  if (!puede(g.usuario, "planillas.calcular") || !alcanceEsTotal(g.usuario)) {
    return { ok: false as const, response: NextResponse.json({ error: "Limpiar pruebas requiere calcular planillas con alcance a toda la empresa." }, { status: 403 }) };
  }
  return g;
}

export async function GET(req: NextRequest) {
  const g = await guardia();
  if (!g.ok) return g.response;
  const desde = new Date(new URL(req.url).searchParams.get("desde") ?? "");
  const error = errorDeDesde(desde);
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json(await buscarDatosDePrueba(prisma, desde));
}

export async function POST(req: NextRequest) {
  const g = await guardia();
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { planillaIds, montos, respaldo } = parsed.data;
  const desde = new Date(parsed.data.desde);
  const error = errorDeDesde(desde);
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (planillaIds.length === 0 && !montos) return NextResponse.json({ error: "No hay nada marcado para limpiar." }, { status: 400 });

  const usuario: Usuario = g.usuario;
  let archivoRespaldo: string | null = null;
  if (respaldo) {
    try {
      const r = await crearRespaldo("MANUAL", { id: usuario.id, email: usuario.email ?? undefined });
      // Sin un respaldo en al menos un destino no se borra nada.
      if (r.estado === "ERROR" || !r.archivo) throw new ErrorRespaldo(r.error ?? "El respaldo no llegó a ningún destino.");
      archivoRespaldo = r.archivo;
    } catch (e) {
      const motivo = e instanceof ErrorRespaldo ? e.message : "No se pudo hacer el respaldo.";
      return NextResponse.json({ error: `No se limpió nada: ${motivo} Revise Configuración → Respaldos, o desmarque el respaldo previo.` }, { status: 409 });
    }
  }

  const r = await prisma.$transaction((tx) => limpiarDatosDePrueba(tx, { desde, planillaIds, montos }), { timeout: 120_000 });

  const { ip, userAgent } = getClientInfo(req);
  for (const p of r.planillas) {
    await audit({
      accion: "DELETE", tabla: "Planilla", registroId: p.id, usuarioId: usuario.id, usuarioEmail: usuario.email ?? undefined,
      valorAnterior: { ...p, motivo: "Limpieza de pruebas", desde: desde.toISOString() }, ip, userAgent,
    });
  }
  if (r.montos || r.basesRap || r.horasExtra) {
    await audit({
      accion: "DELETE", tabla: "DeduccionEmpleado", registroId: `limpieza:${r.montos}`, usuarioId: usuario.id, usuarioEmail: usuario.email ?? undefined,
      valorAnterior: { motivo: "Limpieza de pruebas", desde: desde.toISOString(), montosDelPeriodo: r.montos, basesRap: r.basesRap, horasExtra: r.horasExtra, enUso: r.montosEnUso }, ip, userAgent,
    });
  }
  return NextResponse.json({ ...r, respaldo: archivoRespaldo });
}
