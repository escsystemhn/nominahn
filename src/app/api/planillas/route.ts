import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { calcularLineas, escribirLineas } from "@/lib/payroll/calculo-planilla-bd";
import { ESTADOS_OCUPAN_PERIODO, type EstadoPlanilla } from "@/lib/payroll/estado-planilla";
import { Prisma, TipoPlanilla } from "@prisma/client";
import { z } from "zod";
import { parsearBody, zId, zIdOpcional, zFecha } from "@/lib/http/validar";
import { divisionesHabilitadas, validarAlcanceOrg } from "@/lib/organizacion/estructura-bd";

const schemaCrear = z
  .object({
    tipo: z.enum(TipoPlanilla),
    fechaInicio: zFecha,
    fechaFin: zFecha,
    empresaId: zId,
    // Alcance: vacío = todo el nivel de arriba. «» llega de los selects «Todas».
    sucursalId: zIdOpcional,
    divisionId: zIdOpcional,
    departamentoId: zIdOpcional,
  })
  .refine((d) => d.fechaFin > d.fechaInicio, {
    error: "La fecha fin debe ser posterior a la fecha inicio",
    path: ["fechaFin"],
  });

export async function GET() {
  // Una planilla lleva los totales de nómina de la empresa: no es información
  // que corresponda a cualquier usuario con sesión.
  const g = await requerirPermiso("planillas.ver");
  if (!g.ok) return g.response;

  const planillas = await prisma.planilla.findMany({
    include: { empresa: { select: { nombre: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(planillas);
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("planillas.calcular");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schemaCrear);
  if (!parsed.ok) return parsed.response;
  const { tipo, fechaInicio: desde, fechaFin: hasta, empresaId } = parsed.data;

  // Alcance organizacional: toda la empresa, una sucursal, una división o un
  // departamento. Se valida la cadena contra la empresa y se completa hacia
  // arriba (un departamento implica su división y su sucursal), para que el
  // índice de período único compare planillas del mismo nivel.
  const verificado = await validarAlcanceOrg(
    prisma,
    { sucursalId: parsed.data.sucursalId, divisionId: parsed.data.divisionId, departamentoId: parsed.data.departamentoId },
    { empresaId, divisiones: await divisionesHabilitadas(prisma) }
  );
  if (!verificado.ok) return NextResponse.json({ error: verificado.error }, { status: 400 });
  const alcance = verificado.alcance;
  const sucursal = alcance.sucursalId;

  // ─── Unicidad del período ───────────────────────────────────────────────────
  // Una planilla ANULADA no ocupa su período: el flujo de corrección es anular y
  // reemitir. El índice único parcial en BD replica esta misma condición y cubre
  // la carrera entre dos peticiones simultáneas.
  const yaExiste = await prisma.planilla.findFirst({
    where: {
      empresaId,
      sucursalId: sucursal,
      divisionId: alcance.divisionId,
      departamentoId: alcance.departamentoId,
      tipo,
      fechaInicio: desde,
      fechaFin: hasta,
      estado: { in: [...ESTADOS_OCUPAN_PERIODO] as EstadoPlanilla[] },
    },
    select: { id: true, estado: true },
  });
  if (yaExiste) {
    return NextResponse.json(
      {
        error: yaExiste.estado === "BORRADOR"
          ? "Ya hay un borrador para este período y alcance: ábralo para revisarlo, recalcularlo o descartarlo."
          : `Ya existe una planilla ${yaExiste.estado} para este período y alcance. Anúlala antes de volver a calcularla.`,
        planillaId: yaExiste.id,
      },
      { status: 409 }
    );
  }

  // Nace en BORRADOR, y ahí se queda: se revisa y se recalcula sin cobrar nada.
  // Confirmarla (PATCH a CALCULADA) es lo que cobra las cuotas y marca los bonos.
  const calculo = await calcularLineas({ tipo, empresaId, fechaInicio: desde, fechaFin: hasta, ...alcance });
  if (!calculo.ok) return NextResponse.json(calculo.cuerpo, { status: calculo.status });

  let planillaId: string;
  try {
    planillaId = await prisma.$transaction(async (tx) => {
      const planilla = await tx.planilla.create({
        data: { empresaId, sucursalId: sucursal, divisionId: alcance.divisionId, departamentoId: alcance.departamentoId,
          tipo, estado: "BORRADOR",
          fechaInicio: desde, fechaFin: hasta },
      });
      await escribirLineas(tx, planilla.id, calculo);
      return planilla.id;
    }, { timeout: 30000 });
  } catch (e) {
    // Carrera perdida contra otra petición simultánea: el índice único parcial
    // rechazó el duplicado que la verificación previa no llegó a ver.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Otra planilla para este período y alcance acaba de crearse. Recarga la lista." },
        { status: 409 }
      );
    }
    throw e;
  }

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "Planilla",
    registroId: planillaId,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      tipo, empresaId, sucursalId: sucursal, divisionId: alcance.divisionId, departamentoId: alcance.departamentoId,
      fechaInicio: desde, fechaFin: hasta, metodoIsr: calculo.metodoIsr,
      empleados: calculo.detalles.length,
      ...calculo.totales,
    },
    ip,
    userAgent,
  });

  const planillaFinal = await prisma.planilla.findUnique({
    where: { id: planillaId },
    include: { detalles: { include: { empleado: true } } },
  });

  return NextResponse.json(planillaFinal, { status: 201 });
}
