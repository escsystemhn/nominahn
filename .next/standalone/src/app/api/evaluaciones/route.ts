import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso, requerirSesion, puede } from "@/lib/auth/guard";
import { alcanceEsTotal, alcanzaEmpleado, conAlcance, filtroEmpleados, filtroPorEmpleado } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { z } from "zod";
import { randomBytes } from "crypto";
import { zPorcentaje } from "@/lib/http/validar";
import { estadoDirecta, guardarCriteriosConsolidados, zCriterioDirecto } from "@/lib/evaluaciones/consolidado";

const crearSchema = z.object({
  empleadoId: z.string(),
  tipo: z.enum(["DESEMPENO_MENSUAL", "COMPETENCIA_TRIMESTRAL"]),
  periodo: z.string().min(1),
  campanaId: z.string().optional(),
  incluirAuto: z.boolean().default(true),
  incluirJefe: z.boolean().default(true),
  incluirPares: z.boolean().default(false),
  incluirSubord: z.boolean().default(false),
  paresIds: z.array(z.string()).default([]),
  subordinadosIds: z.array(z.string()).default([]),
  /**
   * DIRECTA: quien la registra califica ahora cada aspecto (la pantalla «Nueva
   * evaluación»); no se crean evaluadores ni enlaces. 360: la califican los evaluadores
   * por su enlace (campañas). Por omisión 360, que es lo que hacía la ruta antes.
   */
  modo: z.enum(["DIRECTA", "360"]).default("360"),
  criterios: z.array(zCriterioDirecto).max(60).default([]),
  comentarios: z.string().trim().max(5000).optional(),
  fortalezas: z.string().trim().max(5000).optional(),
  mejoras: z.string().trim().max(5000).optional(),
  objetivos: z.string().trim().max(5000).optional(),
  potencial: zPorcentaje.optional(),
});

export async function GET(req: NextRequest) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { searchParams } = new URL(req.url);
  const empleadoId = searchParams.get("empleadoId");
  const periodo = searchParams.get("periodo");
  const tipo = searchParams.get("tipo");
  const estado = searchParams.get("estado");

  /**
   * Qué evaluaciones ve cada quien.
   *
   * `talento.evaluaciones_ver` da acceso al conjunto; sin él, se cae al ámbito
   * propio: los subordinados directos si la persona tiene equipo, y sus propias
   * evaluaciones si no. Es el mismo reparto que hacían los roles EMPLEADO,
   * SUPERVISOR y GERENTE, expresado ahora sobre el permiso.
   */
  const role = g.usuario.role as string;
  const veTodas = puede(g.usuario, "talento.evaluaciones_ver") && alcanceEsTotal(g.usuario);
  let whereEmpleado: Record<string, string> | undefined = undefined;

  if (!veTodas || role === "EMPLEADO" || role === "SUPERVISOR" || role === "GERENTE") {
    if (!g.usuario.empleadoId) return NextResponse.json([]);
    whereEmpleado =
      role === "EMPLEADO" || !puede(g.usuario, "talento.evaluaciones_ver")
        ? { id: g.usuario.empleadoId }
        : { supervisorId: g.usuario.empleadoId };
  }

  // Las propias son lo propio: el alcance acota lo ajeno, no su propio expediente.
  // De las ajenas se ve sólo a los evaluadores de su alcance, y sólo lo que calificaron.
  const soloPropias = !!whereEmpleado?.id;
  const evaluador = soloPropias ? {} : filtroEmpleados(g.usuario);

  const evaluaciones = await prisma.evaluacion.findMany({
    where: {
      AND: [
        {
          ...(empleadoId ? { empleadoId } : {}),
          ...(periodo ? { periodo } : {}),
          ...(tipo ? { tipo: tipo as "DESEMPENO_MENSUAL" | "COMPETENCIA_TRIMESTRAL" } : {}),
          ...(estado ? { estado: estado as "BORRADOR" | "EN_PROGRESO" | "PENDIENTE_FIRMA" | "FINALIZADA" | "CANCELADA" } : {}),
          ...(whereEmpleado ? { empleado: whereEmpleado } : {}),
        },
        soloPropias ? {} : filtroPorEmpleado(g.usuario),
      ],
    },
    include: {
      empleado: { select: { id: true, primerNombre: true, primerApellido: true, codigo: true } },
      participantes: {
        // El token es el enlace para calificar: quien lo tiene, califica en nombre de ese evaluador.
        omit: { tokenAcceso: true },
        where: { evaluador },
        include: { evaluador: { select: { id: true, primerNombre: true, primerApellido: true } } },
      },
      campana: { select: { id: true, nombre: true } },
      criterios: { where: { OR: [{ participanteId: null }, { participante: { evaluador } }] } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(evaluaciones);
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("talento.evaluaciones_gestionar");
  if (!g.ok) return g.response;

  const body = await req.json().catch(() => null);
  const parsed = crearSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const d = parsed.data;
  const directa = d.modo === "DIRECTA";
  if (directa && d.criterios.length === 0) {
    return NextResponse.json({ error: "Califique al menos un aspecto." }, { status: 400 });
  }

  const empleado = await prisma.empleado.findUnique({
    where: { id: d.empleadoId },
    select: { id: true, sucursalId: true, departamentoId: true, supervisorId: true },
  });
  // Fuera de su alcance responde igual que si no existiera (ver alcanzaEmpleado).
  if (!empleado || !alcanzaEmpleado(g.usuario, empleado)) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  // Pares y subordinados son un lote: con uno solo fuera de su alcance no se crea nada.
  const evaluadoresIds = [...new Set([...d.paresIds, ...d.subordinadosIds])];
  if (evaluadoresIds.length > 0) {
    const alcanzados = await prisma.empleado.count({ where: conAlcance({ id: { in: evaluadoresIds } }, g.usuario) });
    if (alcanzados !== evaluadoresIds.length) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  }

  const evaluacion = await prisma.$transaction(async (tx) => {
    const ev = await tx.evaluacion.create({
      data: {
        empleadoId: d.empleadoId,
        tipo: d.tipo,
        periodo: d.periodo,
        campanaId: d.campanaId,
        estado: directa ? estadoDirecta(d.criterios) : "BORRADOR",
        comentarios: d.comentarios || null,
        fortalezas: d.fortalezas || null,
        mejoras: d.mejoras || null,
        objetivos: d.objetivos || null,
        potencial: d.potencial,
      },
    });

    // La calificación la calcula el servidor con los pesos de cada aspecto. Antes la
    // pantalla mandaba su promedio, el esquema lo descartaba y quedaba el 0 por omisión.
    if (directa) {
      const nota = await guardarCriteriosConsolidados(tx, ev.id, d.criterios);
      if (nota === null) return ev;
      return tx.evaluacion.update({ where: { id: ev.id }, data: { calificacion: nota, desempeno: nota } });
    }

    type ParticipanteInput = {
      evaluacionId: string;
      evaluadorId: string;
      rol: "AUTOEVALUACION" | "JEFE_DIRECTO" | "PAR" | "SUBORDINADO" | "RRHH";
      tokenAcceso: string;
    };

    const participantes: ParticipanteInput[] = [];

    if (d.incluirAuto) {
      participantes.push({ evaluacionId: ev.id, evaluadorId: d.empleadoId, rol: "AUTOEVALUACION", tokenAcceso: randomBytes(20).toString("hex") });
    }
    if (d.incluirJefe && empleado.supervisorId) {
      participantes.push({ evaluacionId: ev.id, evaluadorId: empleado.supervisorId, rol: "JEFE_DIRECTO", tokenAcceso: randomBytes(20).toString("hex") });
    }
    for (const parId of d.paresIds) {
      participantes.push({ evaluacionId: ev.id, evaluadorId: parId, rol: "PAR", tokenAcceso: randomBytes(20).toString("hex") });
    }
    for (const subId of d.subordinadosIds) {
      participantes.push({ evaluacionId: ev.id, evaluadorId: subId, rol: "SUBORDINADO", tokenAcceso: randomBytes(20).toString("hex") });
    }

    if (participantes.length > 0) {
      await tx.evaluacionParticipante.createMany({ data: participantes });
    }

    return ev;
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "Evaluacion",
    registroId: evaluacion.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { empleadoId: d.empleadoId, tipo: d.tipo, periodo: d.periodo, modo: d.modo, calificacion: Number(evaluacion.calificacion), estado: evaluacion.estado },
    ip,
    userAgent,
  });

  return NextResponse.json(evaluacion, { status: 201 });
}
