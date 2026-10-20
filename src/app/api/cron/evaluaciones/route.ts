import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";

// Protegido por secret header — llamar desde cron externo o Vercel Cron
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const hoy = new Date();

  // Buscar campañas PROGRAMADAS cuya fechaInicio ya pasó
  const campanas = await prisma.evaluacionCampana.findMany({
    where: {
      estado: "PROGRAMADA",
      fechaInicio: { lte: hoy },
    },
  });

  const resultados = [];

  for (const campana of campanas) {
    // Determinar empleados en scope
    const empleados = await prisma.empleado.findMany({
      where: {
        estado: "ACTIVO",
        ...(campana.sucursalId ? { sucursalId: campana.sucursalId } : {}),
        ...(campana.departamentoId ? { departamentoId: campana.departamentoId } : {}),
      },
      select: { id: true, supervisorId: true },
    });

    let creadas = 0;
    for (const emp of empleados) {
      // Evitar duplicados por período
      const existe = await prisma.evaluacion.findFirst({
        where: { empleadoId: emp.id, tipo: campana.tipo, periodo: campana.periodo },
      });
      if (existe) continue;

      await prisma.$transaction(async (tx) => {
        const ev = await tx.evaluacion.create({
          data: {
            empleadoId: emp.id,
            tipo: campana.tipo,
            periodo: campana.periodo,
            campanaId: campana.id,
            estado: "EN_PROGRESO",
          },
        });

        type ParticipanteInput = {
          evaluacionId: string;
          evaluadorId: string;
          rol: "AUTOEVALUACION" | "JEFE_DIRECTO" | "PAR" | "SUBORDINADO" | "RRHH";
          tokenAcceso: string;
        };

        const participantes: ParticipanteInput[] = [];

        if (campana.incluirAuto) {
          participantes.push({ evaluacionId: ev.id, evaluadorId: emp.id, rol: "AUTOEVALUACION", tokenAcceso: randomBytes(20).toString("hex") });
        }
        if (campana.incluirJefe && emp.supervisorId) {
          participantes.push({ evaluacionId: ev.id, evaluadorId: emp.supervisorId, rol: "JEFE_DIRECTO", tokenAcceso: randomBytes(20).toString("hex") });
        }

        if (participantes.length > 0) {
          await tx.evaluacionParticipante.createMany({ data: participantes });
        }
      });

      creadas++;
    }

    // Marcar campaña como EN_PROGRESO
    await prisma.evaluacionCampana.update({
      where: { id: campana.id },
      data: { estado: "EN_PROGRESO" },
    });

    resultados.push({ campanaId: campana.id, nombre: campana.nombre, evaluacionesCreadas: creadas });
  }

  // Cerrar campañas cuya fechaFin ya pasó
  await prisma.evaluacionCampana.updateMany({
    where: { estado: "EN_PROGRESO", fechaFin: { lt: hoy } },
    data: { estado: "FINALIZADA" },
  });

  return NextResponse.json({ ok: true, campanasProcesadas: resultados.length, detalle: resultados });
}

// GET: permite invocación desde Vercel Cron (que usa GET con Authorization header)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return POST(req);
}
