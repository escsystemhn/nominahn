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

  // ─── Anulación: devolver lo amortizado ──────────────────────────────────────
  // Al anular hay que deshacer lo que esta planilla cobró de préstamos y
  // adelantos. Sin esto, el flujo de corrección del sistema —anular y
  // reemitir— volvía a consumir las cuotas y el préstamo se amortizaba de más.
  //
  // La reversión va en la MISMA transacción que el cambio de estado: una
  // planilla no puede quedar anulada con sus amortizaciones sin devolver.
  let deduccionesRevertidas = 0;
  let envioSapId: string | null = null;
  let motivoSap: string | null = null;

  const actualizada = await prisma.$transaction(async (tx) => {
    if (estado === "ANULADA") {
      const pendientes = await tx.amortizacionPlanilla.findMany({
        where: { planillaId: id, revertidaAt: null },
        select: { id: true, deduccionId: true, montoAplicado: true, llevaSaldo: true, desactivo: true },
      });

      if (pendientes.length > 0) {
        // Inverso exacto de lo que aplicó el cálculo. Se devuelve el DELTA, no
        // se restaura un estado previo: así la reversión es correcta aunque
        // otra planilla posterior haya cobrado cuotas del mismo préstamo.
        // Espeja `revertirAmortizacion()` de lib/payroll/deducciones.ts, donde
        // esta aritmética está probada.
        await tx.$executeRaw`
          UPDATE "DeduccionEmpleado" d
             SET "cuotasPagadas" = GREATEST(0, d."cuotasPagadas" - 1),
                 "saldo"         = CASE WHEN v.lleva_saldo
                                        THEN COALESCE(d."saldo", 0) + v.monto
                                        ELSE d."saldo" END,
                 "activo"        = CASE WHEN v.desactivo THEN true ELSE d."activo" END,
                 "updatedAt"     = NOW()
            FROM (SELECT * FROM UNNEST(
                    ${pendientes.map((p) => p.deduccionId)}::text[],
                    ${pendientes.map((p) => p.montoAplicado.toFixed(2))}::numeric[],
                    ${pendientes.map((p) => p.llevaSaldo)}::boolean[],
                    ${pendientes.map((p) => p.desactivo)}::boolean[]
                  ) AS t(id, monto, lleva_saldo, desactivo)) v
           WHERE d."id" = v.id`;

        // Sellar impide devolver dos veces el mismo importe.
        await tx.amortizacionPlanilla.updateMany({
          where: { id: { in: pendientes.map((p) => p.id) } },
          data: { revertidaAt: new Date() },
        });

        deduccionesRevertidas = pendientes.length;
      }
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
      sap: envioSapId ? { envioId: envioSapId, motivo: motivoSap } : motivoSap ? { motivo: motivoSap } : undefined,
    },
    ip,
    userAgent,
  });

  return NextResponse.json({ ...actualizada, deduccionesRevertidas, sapEnvioId: envioSapId });
}
