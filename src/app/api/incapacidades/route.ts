/**
 * Incapacidades del IHSS.
 *   GET  → lista (?empleadoId=&desde=&hasta=) con el reparto de días y el subsidio estimado
 *   POST → registrar un certificado; las reglas vigentes quedan congeladas en él
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zFecha, zId } from "@/lib/http/validar";
import { cargarParametrosLegales } from "@/lib/payroll/parametros-bd";
import { diasEntre, diasPatronoParaNueva, diasEnPeriodo, subsidioEstimado, DIAS_MATERNIDAD } from "@/lib/asistencia/incapacidades";
import { leerReglas, diasPatronoConsumidos } from "@/lib/asistencia/incapacidades-bd";

const schema = z
  .object({
    empleadoId: zId,
    tipo: z.enum(["ENFERMEDAD_COMUN", "ACCIDENTE_COMUN", "RIESGO_PROFESIONAL", "MATERNIDAD"]),
    emisor: z.enum(["IHSS", "MEDICO_PRIVADO", "SISTEMA_MEDICO_EMPRESA"]),
    fechaInicio: zFecha,
    fechaFin: zFecha,
    numeroCertificado: z.string().trim().max(60).optional().nullable(),
    prorrogaDeId: zId.optional().nullable(),
    archivoUrl: z.string().trim().max(300).regex(/^\/api\/uploads\/[A-Za-z0-9-]+\.[a-z]+$/).optional().nullable(),
    observacion: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((d) => d.fechaFin >= d.fechaInicio, { error: "La fecha final no puede ser anterior a la inicial", path: ["fechaFin"] });

const MAX_DIAS = 365;

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("asistencia.incapacidades");
  if (!g.ok) return g.response;
  const sp = new URL(req.url).searchParams;
  const empleadoId = sp.get("empleadoId") || undefined;
  const desde = sp.get("desde");
  const hasta = sp.get("hasta");

  const [lista, parametros] = await Promise.all([
    prisma.incapacidad.findMany({
      where: {
        ...(empleadoId ? { empleadoId } : {}),
        ...(desde && hasta ? { fechaInicio: { lte: new Date(`${hasta}T00:00:00Z`) }, fechaFin: { gte: new Date(`${desde}T00:00:00Z`) } } : {}),
      },
      orderBy: { fechaInicio: "desc" },
      take: 300,
      include: {
        empleado: { select: { id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, salarioBase: true } },
      },
    }),
    cargarParametrosLegales(),
  ]);

  return NextResponse.json(
    lista.map((i) => {
      const reparto = diasEnPeriodo({ ...i, porcentajeComplemento: Number(i.porcentajeComplemento) }, i.fechaInicio, i.fechaFin);
      const salario = Number(i.empleado.salarioBase);
      return {
        ...i,
        porcentajeSubsidio: Number(i.porcentajeSubsidio),
        porcentajeComplemento: Number(i.porcentajeComplemento),
        empleado: { ...i.empleado, salarioBase: undefined },
        reparto,
        subsidioEstimado: subsidioEstimado(salario, reparto.ihss, Number(i.porcentajeSubsidio), parametros.ihssTope),
      };
    })
  );
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("asistencia.incapacidades");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const dias = diasEntre(d.fechaInicio, d.fechaFin);
  if (dias > MAX_DIAS) return NextResponse.json({ error: `Una incapacidad no puede pasar de ${MAX_DIAS} días (Art. 71 del Reglamento del IHSS).` }, { status: 422 });

  const empleado = await prisma.empleado.findUnique({ where: { id: d.empleadoId }, select: { id: true, salarioBase: true } });
  if (!empleado) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  // Dos certificados no pueden cubrir el mismo día: el descuento se duplicaría.
  const solapada = await prisma.incapacidad.findFirst({
    where: { empleadoId: d.empleadoId, anulada: false, fechaInicio: { lte: d.fechaFin }, fechaFin: { gte: d.fechaInicio } },
    select: { id: true, fechaInicio: true, fechaFin: true },
  });
  if (solapada) {
    return NextResponse.json({ error: "Ya hay una incapacidad registrada que cubre parte de esas fechas. Si es una continuación, regístrela como prórroga a partir del día siguiente." }, { status: 409 });
  }

  const avisos: string[] = [];
  if (d.prorrogaDeId) {
    const previa = await prisma.incapacidad.findUnique({ where: { id: d.prorrogaDeId }, select: { empleadoId: true, tipo: true, fechaFin: true, anulada: true } });
    if (!previa || previa.empleadoId !== d.empleadoId || previa.anulada) {
      return NextResponse.json({ error: "La incapacidad de la que sería prórroga no existe, está anulada o es de otro empleado." }, { status: 422 });
    }
    if (previa.tipo !== d.tipo) return NextResponse.json({ error: "Una prórroga debe ser del mismo tipo que la incapacidad original." }, { status: 422 });
    const contigua = d.fechaInicio.getTime() - previa.fechaFin.getTime() === 86_400_000;
    if (!contigua) avisos.push("La prórroga no empieza el día siguiente al final de la incapacidad anterior.");
  }
  if (d.tipo === "MATERNIDAD" && dias > DIAS_MATERNIDAD) {
    avisos.push(`El reposo por maternidad es de ${DIAS_MATERNIDAD} días (Art. 34 del Reglamento del IHSS); se registran ${dias}.`);
  }

  const reglas = await leerReglas(prisma);
  const regla = reglas[d.tipo];
  const consumidos = await diasPatronoConsumidos(prisma, d.prorrogaDeId);
  const diasPatrono = Math.min(dias, diasPatronoParaNueva(regla, consumidos));

  // Si el período ya está en una planilla cerrada, el ajuste no se aplica solo.
  const cerrada = await prisma.planillaDetalle.findFirst({
    where: { empleadoId: d.empleadoId, planilla: { estado: { in: ["APROBADA", "PAGADA"] }, fechaInicio: { lte: d.fechaFin }, fechaFin: { gte: d.fechaInicio } } },
    select: { planilla: { select: { fechaInicio: true, fechaFin: true } } },
  });
  if (cerrada) avisos.push("Parte de estas fechas ya está en una planilla aprobada o pagada: esa planilla no cambia; el ajuste tendrá que hacerse a mano.");

  const inc = await prisma.incapacidad.create({
    data: {
      empleadoId: d.empleadoId,
      tipo: d.tipo,
      emisor: d.emisor,
      fechaInicio: d.fechaInicio,
      fechaFin: d.fechaFin,
      dias,
      numeroCertificado: d.numeroCertificado || null,
      prorrogaDeId: d.prorrogaDeId || null,
      diasPatrono,
      porcentajeSubsidio: regla.porcentajeSubsidio,
      porcentajeComplemento: regla.porcentajeComplemento,
      archivoUrl: d.archivoUrl || null,
      observacion: d.observacion || null,
      registradoPor: g.usuario.email ?? g.usuario.id ?? null,
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "Incapacidad",
    registroId: inc.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { empleadoId: d.empleadoId, tipo: d.tipo, fechaInicio: d.fechaInicio, fechaFin: d.fechaFin, dias, diasPatrono, prorrogaDeId: d.prorrogaDeId ?? undefined },
    ip,
    userAgent,
  });
  return NextResponse.json({ ...inc, avisos }, { status: 201 });
}
