/**
 * Estado y envío del asiento de UNA planilla en SAP Business One.
 *
 * GET  — estado de la cola para esta planilla, bitácora de intentos y vista
 *        previa del asiento tal como se enviaría hoy (con el mapeo actual).
 *        Lo ve quien ya puede ver la partida contable (`planillas.contabilidad`).
 * POST — { accion: "enviar" | "reintentar" | "reverso" }. Encola y procesa al
 *        momento, para que quien aprieta el botón vea la respuesta de SAP.
 *        Exige `planillas.sap_enviar`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { cargarConfigSap, ConfigSapIncompleta } from "@/lib/sap/config";
import { construirPayloadPlanilla, encolar, procesarEnvio } from "@/lib/sap/envio";

const schemaPost = z.object({
  accion: z.enum(["enviar", "reintentar", "reverso"]),
});

const seleccionEnvio = {
  id: true,
  tipo: true,
  estado: true,
  intentos: true,
  sapTransId: true,
  sapNumero: true,
  errorCodigo: true,
  errorTraducido: true,
  errorMensaje: true,
  esTransitorio: true,
  proximoIntentoAt: true,
  enviadoAt: true,
  creadoPor: true,
  createdAt: true,
  updatedAt: true,
  payload: true,
  bitacora: {
    orderBy: { createdAt: "desc" as const },
    take: 20,
    select: { intento: true, httpStatus: true, duracionMs: true, resultado: true, errorCodigo: true, mensaje: true, createdAt: true },
  },
};

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("planillas.contabilidad");
  if (!g.ok) return g.response;

  const { id } = await params;
  const planilla = await prisma.planilla.findUnique({ where: { id }, select: { id: true, estado: true, hashCalculo: true } });
  if (!planilla) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  let cfg = null;
  let errorConfig: string | null = null;
  try {
    cfg = await cargarConfigSap(prisma);
  } catch (e) {
    errorConfig = e instanceof ConfigSapIncompleta ? e.message : "Configuración de SAP ilegible.";
  }

  const envios = await prisma.sapEnvioAsiento.findMany({ where: { planillaId: id }, select: seleccionEnvio });
  const asiento = envios.find((e) => e.tipo === "ASIENTO") ?? null;
  const reverso = envios.find((e) => e.tipo === "REVERSO") ?? null;

  if (!cfg) {
    return NextResponse.json({ configurado: false, activo: false, errorConfig, asiento, reverso, vistaPrevia: null });
  }

  // Vista previa con el mapeo de HOY. Si la planilla está anulada, lo útil es
  // ver el reverso.
  let vistaPrevia = null;
  try {
    const tipo = planilla.estado === "ANULADA" && asiento?.estado === "ENVIADO" ? "REVERSO" : "ASIENTO";
    const r = await construirPayloadPlanilla(prisma, id, cfg, tipo);
    vistaPrevia = { tipo, payload: r.payload, errores: r.errores, avisos: r.avisos, totalDebe: r.totalDebe, totalHaber: r.totalHaber };
  } catch (e) {
    vistaPrevia = { tipo: "ASIENTO", payload: null, errores: [e instanceof Error ? e.message : "No se pudo construir el asiento"], avisos: [], totalDebe: 0, totalHaber: 0 };
  }

  return NextResponse.json({
    configurado: true,
    activo: cfg.activo,
    modoEnvio: cfg.modoEnvio,
    fechaContable: cfg.fechaContable,
    porCentroCosto: cfg.porCentroCosto,
    errorConfig,
    asiento,
    reverso,
    vistaPrevia,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("planillas.sap_enviar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schemaPost);
  if (!parsed.ok) return parsed.response;
  const { accion } = parsed.data;

  const planilla = await prisma.planilla.findUnique({ where: { id }, select: { id: true, estado: true, hashCalculo: true } });
  if (!planilla) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  let cfg;
  try {
    cfg = await cargarConfigSap(prisma);
  } catch (e) {
    return NextResponse.json({ error: e instanceof ConfigSapIncompleta ? e.message : "Configuración de SAP ilegible." }, { status: 409 });
  }
  if (!cfg) return NextResponse.json({ error: "La integración con SAP no está configurada." }, { status: 409 });
  if (!cfg.activo) return NextResponse.json({ error: "La integración con SAP está desactivada. Actívela en Configuración, SAP - Conexión." }, { status: 409 });

  const asientoPrevio = await prisma.sapEnvioAsiento.findUnique({ where: { planillaId_tipo: { planillaId: id, tipo: "ASIENTO" } } });

  let tipo: "ASIENTO" | "REVERSO";
  let reversoDeId: string | null = null;
  if (accion === "reverso") {
    if (planilla.estado !== "ANULADA") return NextResponse.json({ error: "El reverso sólo aplica a una planilla anulada." }, { status: 409 });
    if (!asientoPrevio || asientoPrevio.estado !== "ENVIADO") return NextResponse.json({ error: "Esta planilla no tiene un asiento enviado a SAP: no hay nada que revertir." }, { status: 409 });
    tipo = "REVERSO";
    reversoDeId = asientoPrevio.id;
  } else {
    if (!["APROBADA", "PAGADA"].includes(planilla.estado)) {
      return NextResponse.json({ error: `Sólo se envía una planilla aprobada o pagada (esta está ${planilla.estado}).` }, { status: 409 });
    }
    if (!planilla.hashCalculo) return NextResponse.json({ error: "La planilla no tiene huella de cierre." }, { status: 409 });
    if (asientoPrevio?.estado === "ENVIADO") {
      return NextResponse.json({ error: `Esta planilla ya está en SAP (asiento ${asientoPrevio.sapNumero ?? asientoPrevio.sapTransId}).` }, { status: 409 });
    }
    if (asientoPrevio?.estado === "ENVIANDO") {
      return NextResponse.json({ error: "El asiento se está enviando en este momento. Espere un minuto y vuelva a consultar." }, { status: 409 });
    }
    tipo = "ASIENTO";
  }

  const construido = await construirPayloadPlanilla(prisma, id, cfg, tipo);
  const hash = planilla.hashCalculo ?? asientoPrevio?.hashCalculo ?? "";
  const { envio } = await encolar(prisma, { planillaId: id, tipo, construido, hashCalculo: hash, creadoPor: g.usuario.id ?? null, reversoDeId });

  // Se procesa aquí mismo: quien pulsa el botón espera la respuesta de SAP.
  const resultado = envio.estado === "PENDIENTE" ? await procesarEnvio(envio.id) : envio;

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "SapEnvioAsiento",
    registroId: resultado.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      planillaId: id,
      accion,
      tipo,
      estado: resultado.estado,
      sapNumero: resultado.sapNumero,
      sapTransId: resultado.sapTransId,
      errorCodigo: resultado.errorCodigo,
      intentos: resultado.intentos,
    },
    ip,
    userAgent,
  });

  const completo = await prisma.sapEnvioAsiento.findUnique({ where: { id: resultado.id }, select: seleccionEnvio });
  return NextResponse.json({
    ok: resultado.estado === "ENVIADO",
    envio: completo,
    errores: construido.errores,
    avisos: construido.avisos,
  });
}
