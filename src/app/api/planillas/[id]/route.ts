import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import {
  validarTransicion,
  esEstadoCerrado,
  puedeEditarCampo,
  calcularHashPlanilla,
  verificarIntegridad,
  claveTransicion,
  type EstadoPlanilla,
} from "@/lib/payroll/estado-planilla";
import { z } from "zod";
import { parsearBody } from "@/lib/http/validar";
import { EstadoPlanilla as EstadoPlanillaEnum } from "@prisma/client";
import { encolarPorTransicion, procesarEnSegundoPlano } from "@/lib/sap/envio";
import {
  aplicarCobros,
  calcularLineas,
  devolverCobros,
  escribirLineas,
  type CalculoPlanilla,
} from "@/lib/payroll/calculo-planilla-bd";

const schemaPatch = z
  .object({
    estado: z.enum(EstadoPlanillaEnum).optional(),
    observaciones: z.string().trim().max(2000).optional(),
    motivo: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.estado !== undefined || d.observaciones !== undefined, {
    error: "Nada que actualizar",
  });

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // El detalle expone el salario, las deducciones y el neto de CADA empleado de
  // la empresa. Antes bastaba con tener sesión, de cualquier rol.
  const g = await requerirPermiso("planillas.ver");
  if (!g.ok) return g.response;

  const { id } = await params;
  const planilla = await prisma.planilla.findUnique({
    where: { id },
    include: {
      empresa: true,
      detalles: {
        include: {
          empleado: {
            include: {
              sucursal: { select: { nombre: true } },
              departamento: { select: { nombre: true } },
              puesto: { select: { nombre: true } },
            },
          },
        },
        orderBy: { empleado: { primerApellido: "asc" } },
      },
    },
  });

  if (!planilla) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // En planillas cerradas se contrasta el contenido actual contra el hash sellado
  // al cierre, de modo que una alteración hecha por fuera de la aplicación sea
  // visible para quien consulta el documento.
  const integridad = esEstadoCerrado(planilla.estado as EstadoPlanilla)
    ? verificarIntegridad(planilla.hashCalculo, planilla.detalles)
    : null;

  return NextResponse.json({ ...planilla, integridad });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // La transición concreta la valida `validarTransicion` con su propia matriz de
  // permisos; esta guardia sólo descarta a quien no opera nómina en absoluto.
  const g = await requerirPermiso([
    "planillas.calcular",
    "planillas.aprobar",
    "planillas.pagar",
    "planillas.anular",
    "planillas.reabrir",
    "planillas.anular_pagada",
  ]);
  if (!g.ok) return g.response;
  const { id: usuarioId, email: usuarioEmail } = g.usuario;

  const { id } = await params;
  const parsed = await parsearBody(req, schemaPatch);
  if (!parsed.ok) return parsed.response;
  const { estado, observaciones, motivo } = parsed.data;

  const planilla = await prisma.planilla.findUnique({
    where: { id },
    include: { detalles: { select: { empleadoId: true, totalBruto: true, totalDeducciones: true, salarioNeto: true } } },
  });
  if (!planilla) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const estadoActual = planilla.estado as EstadoPlanilla;

  // ─── Edición de campos sin cambio de estado ─────────────────────────────────
  if (observaciones !== undefined && !puedeEditarCampo(estadoActual, "observaciones")) {
    return NextResponse.json(
      { error: `No se puede editar una planilla en estado ${estadoActual}` },
      { status: 409 }
    );
  }

  const data: Record<string, unknown> = {};
  if (observaciones !== undefined) data.observaciones = observaciones;

  // ─── Cambio de estado ───────────────────────────────────────────────────────
  if (estado && estado !== estadoActual) {
    const validacion = validarTransicion(estadoActual, estado, g.usuario.permisos, { motivo });
    if (!validacion.ok) {
      return NextResponse.json({ error: validacion.error }, { status: validacion.status });
    }

    data.estado = estado;

    if (estado === "APROBADA") {
      data.aprobadoPor = usuarioId;
      data.cerradaAt = new Date();
      // Se sella la huella del cálculo en el momento de la aprobación.
      data.hashCalculo = calcularHashPlanilla(planilla.detalles);
    }

    if (estado === "PAGADA") {
      data.fechaPago = new Date();
      data.pagadoPor = usuarioId;
      // La aprobación ya selló el hash; si faltara (planilla heredada) se sella aquí.
      if (!planilla.hashCalculo) data.hashCalculo = calcularHashPlanilla(planilla.detalles);
      if (!planilla.cerradaAt) data.cerradaAt = new Date();
    }

    // Reapertura: la planilla vuelve a ser editable, por lo que el sello deja de
    // tener validez y se retira explícitamente.
    if (estado === "CALCULADA" || estado === "BORRADOR") {
      data.cerradaAt = null;
      data.hashCalculo = null;
      data.aprobadoPor = null;
    }

    if (estado === "ANULADA") {
      data.anuladaPor = usuarioId;
      data.motivoAnulacion = motivo ?? null;
      data.cerradaAt = planilla.cerradaAt ?? new Date();
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  const vuelveABorrador = estado === "BORRADOR" && estadoActual !== "BORRADOR";

  // Volver a borrador cambiaría importes que SAP ya tiene: ese camino es anular,
  // que genera el reverso.
  if (vuelveABorrador) {
    const enSap = await prisma.sapEnvioAsiento.count({ where: { planillaId: id, estado: { in: ["PENDIENTE", "ENVIANDO", "ENVIADO"] } } });
    if (enSap > 0) {
      return NextResponse.json({ error: "Esta planilla ya tiene un asiento en SAP: anúlela para generar el reverso." }, { status: 409 });
    }
  }

  // ─── Confirmar un borrador ──────────────────────────────────────────────────
  // Se recalcula por última vez, porque cobra con los datos de ahora. Si el
  // resultado ya no es el que se revisó, no se confirma a ciegas: se actualiza el
  // borrador y se pide revisarlo otra vez.
  let calculo: CalculoPlanilla | null = null;
  if (estado === "CALCULADA" && estadoActual === "BORRADOR") {
    const r = await calcularLineas(planilla);
    if (!r.ok) return NextResponse.json(r.cuerpo, { status: r.status });

    if (calcularHashPlanilla(r.detalles) !== calcularHashPlanilla(planilla.detalles)) {
      await prisma.$transaction((tx) => escribirLineas(tx, id, r), { timeout: 30000 });
      const { ip, userAgent } = getClientInfo(req);
      await audit({
        accion: "UPDATE",
        tabla: "Planilla",
        registroId: id,
        usuarioId,
        usuarioEmail: usuarioEmail ?? undefined,
        valorAnterior: { totalNeto: planilla.totalNeto },
        valorNuevo: { totalNeto: r.totales.totalNeto, recalculada: true, motivo: "Los datos cambiaron antes de confirmar" },
        ip,
        userAgent,
      });
      return NextResponse.json(
        {
          error: "Los datos cambiaron desde que se calculó este borrador, así que se actualizó y no se confirmó. Revíselo y confirme de nuevo.",
          recalculada: true,
        },
        { status: 409 }
      );
    }
    calculo = r;
  }

  // ─── Devolver lo cobrado ────────────────────────────────────────────────────
  // Al anular o volver a borrador hay que deshacer lo que esta planilla cobró de
  // préstamos y adelantos, y liberar sus bonos. Sin esto, corregirla y confirmarla
  // de nuevo volvía a consumir las cuotas y el préstamo se amortizaba de más.
  //
  // Va en la MISMA transacción que el cambio de estado, igual que el cobro: una
  // planilla no puede cambiar de estado con sus cobros a medias. Un borrador no
  // cobró nada, así que no hay qué devolver.
  const devuelve = vuelveABorrador || (estado === "ANULADA" && estadoActual !== "BORRADOR");
  let deduccionesRevertidas = 0;
  let envioSapId: string | null = null;
  let motivoSap: string | null = null;

  const actualizada = await prisma.$transaction(async (tx) => {
    if (calculo) {
      await escribirLineas(tx, id, calculo);
      await aplicarCobros(tx, id, calculo);
    }
    if (devuelve) {
      deduccionesRevertidas = await devolverCobros(tx, id, { conservarRegistro: estado === "ANULADA" });
    }

    const actualizadaTx = await tx.planilla.update({ where: { id }, data });

    // ─── SAP Business One ───────────────────────────────────────────────────
    // Con la integración activa, el asiento (o el reverso, al anular) queda
    // ENCOLADO en esta misma transacción: una planilla aprobada no puede quedar
    // sin su fila de envío. La llamada a SAP ocurre DESPUÉS del commit, nunca
    // aquí dentro. Y un fallo al construir el asiento no impide aprobar ni
    // pagar: se anota y el contador lo envía a mano desde la planilla.
    if (estado && estado !== estadoActual) {
      try {
        const r = await encolarPorTransicion(tx, { id, hashCalculo: actualizadaTx.hashCalculo }, estado, usuarioId ?? null);
        envioSapId = r.envioId;
        motivoSap = r.motivo;
      } catch (e) {
        motivoSap = e instanceof Error ? e.message : "Fallo al encolar el asiento";
        console.error("[sap] no se pudo encolar el asiento de la planilla", id, motivoSap);
      }
    }

    return actualizadaTx;
  }, { timeout: 30000 });

  if (envioSapId) procesarEnSegundoPlano(envioSapId);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: estado === "APROBADA" ? "APPROVE" : "UPDATE",
    tabla: "Planilla",
    registroId: id,
    usuarioId,
    usuarioEmail: usuarioEmail ?? undefined,
    valorAnterior: {
      estado: estadoActual,
      observaciones: planilla.observaciones,
      hashCalculo: planilla.hashCalculo,
      totalNeto: planilla.totalNeto,
    },
    valorNuevo: {
      ...data,
      transicion: estado ? claveTransicion(estadoActual, estado) : undefined,
      motivo: motivo ?? undefined,
      // Queda constancia de cuántas deducciones se devolvieron: es dinero del
      // trabajador y debe poder conciliarse contra el rastro.
      deduccionesRevertidas: deduccionesRevertidas || undefined,
      cuotasCobradas: calculo ? calculo.amortizaciones.length : undefined,
      bonosAplicados: calculo ? calculo.bonos.length : undefined,
      sap: envioSapId ? { envioId: envioSapId, motivo: motivoSap } : motivoSap ? { motivo: motivoSap } : undefined,
    },
    ip,
    userAgent,
  });

  return NextResponse.json({ ...actualizada, deduccionesRevertidas, sapEnvioId: envioSapId });
}

/**
 * Descartar un borrador. Se borra de verdad porque todavía no es un documento: no
 * cobró nada ni salió del sistema. Una planilla confirmada se anula, no se borra, y
 * los triggers lo impiden además a partir de que se aprueba.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("planillas.calcular");
  if (!g.ok) return g.response;

  const { id } = await params;
  const planilla = await prisma.planilla.findUnique({
    where: { id },
    select: { estado: true, tipo: true, fechaInicio: true, fechaFin: true, totalNeto: true, _count: { select: { enviosSap: true } } },
  });
  if (!planilla) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (planilla.estado !== "BORRADOR") {
    return NextResponse.json({ error: "Sólo se descarta un borrador. Una planilla confirmada se anula." }, { status: 409 });
  }
  if (planilla._count.enviosSap > 0) {
    return NextResponse.json({ error: "Este borrador tiene envíos a SAP en su historial: anúlelo en vez de descartarlo." }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.planillaDetalle.deleteMany({ where: { planillaId: id } });
    await tx.planilla.delete({ where: { id } });
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE",
    tabla: "Planilla",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { estado: planilla.estado, tipo: planilla.tipo, fechaInicio: planilla.fechaInicio, fechaFin: planilla.fechaFin, totalNeto: planilla.totalNeto },
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true });
}
