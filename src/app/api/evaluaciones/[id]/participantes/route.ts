import { NextRequest, NextResponse } from "next/server";
import { requerirSesion, puede } from "@/lib/auth/guard";
import { alcanzaEmpleado, filtroEmpleados, alcanceEsTotal } from "@/lib/auth/alcance";
import { empleadoAlAlcance } from "@/lib/auth/alcance-bd";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { ESTADOS_CALIFICABLES, registrarRespuesta, SinCalificacion, zRespuestaParticipante } from "@/lib/evaluaciones/respuesta";

type Params = { params: Promise<{ id: string }> };

const submitSchema = zRespuestaParticipante.extend({ participanteId: z.string() });

/** GET /api/evaluaciones/[id]/participantes — lista los participantes */
export async function GET(_req: NextRequest, { params }: Params) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { id } = await params;

  /**
   * Una evaluación que no existe da una lista vacía, y eso mismo da una fuera de su
   * alcance. Quien evalúa sigue viendo su propia fila, con la que envía el formulario;
   * en la propia evaluación se ve a todos, y en una ajena, a los evaluadores de su alcance.
   */
  const yo = g.usuario.empleadoId;
  const evaluacion = await prisma.evaluacion.findUnique({ where: { id }, select: { empleadoId: true } });
  const esPropia = !!yo && evaluacion?.empleadoId === yo;
  // Sin permiso de consultar evaluaciones sólo queda la propia: una cuenta sin perfil tiene alcance total.
  const alcanzada = !!evaluacion && puede(g.usuario, "talento.evaluaciones_ver") && (await empleadoAlAlcance(g.usuario, evaluacion.empleadoId));
  const miFila = yo ? [{ evaluadorId: yo }] : [];
  // Con alcance total no se acota: un filtro vacío dentro de un OR no significa «todos».
  const visibles = esPropia || (alcanzada && alcanceEsTotal(g.usuario))
    ? {}
    : { OR: alcanzada ? [{ evaluador: filtroEmpleados(g.usuario) }, ...miFila] : miFila };

  const participantes = await prisma.evaluacionParticipante.findMany({
    where: { evaluacionId: id, ...visibles },
    // El token es el enlace para calificar: quien lo tiene, califica en nombre de ese evaluador.
    omit: { tokenAcceso: true },
    include: {
      evaluador: { select: { id: true, primerNombre: true, primerApellido: true, fotoPerfil: true } },
      criteriosParticipante: { include: { competencia: { select: { id: true, nombre: true } } } },
    },
    orderBy: { rol: "asc" },
  });

  return NextResponse.json(participantes);
}

/** POST /api/evaluaciones/[id]/participantes — enviar formulario de un participante */
export async function POST(req: NextRequest, { params }: Params) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { id } = await params;
  const body = await req.json();
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { participanteId, calificacion, comentarios, criterios } = parsed.data;

  const participante = await prisma.evaluacionParticipante.findFirst({
    where: { id: participanteId, evaluacionId: id },
    include: {
      evaluador: { select: { id: true, sucursalId: true, departamentoId: true } },
      evaluacion: { select: { estado: true, empleado: { select: { id: true, sucursalId: true, departamentoId: true } } } },
    },
  });
  if (!participante) return NextResponse.json({ error: "Participante no encontrado" }, { status: 404 });

  // Su propio formulario lo envía siempre. En nombre de otro, sólo si alcanza al evaluado
  // y a ese evaluador: lo demás responde igual que si el participante no existiera.
  const esSuFormulario = !!g.usuario.empleadoId && participante.evaluadorId === g.usuario.empleadoId;
  if (!esSuFormulario && !(alcanzaEmpleado(g.usuario, participante.evaluacion.empleado) && alcanzaEmpleado(g.usuario, participante.evaluador))) {
    return NextResponse.json({ error: "Participante no encontrado" }, { status: 404 });
  }

  if (participante.estado === "COMPLETADO") {
    return NextResponse.json({ error: "Ya fue completada por este evaluador" }, { status: 409 });
  }
  // Una evaluación pendiente de firma, finalizada o cancelada ya no recibe calificaciones
  // (el enlace sin sesión ya lo exigía; esta ruta no).
  if (!(ESTADOS_CALIFICABLES as readonly string[]).includes(participante.evaluacion.estado)) {
    return NextResponse.json({ error: "La evaluación ya no recibe calificaciones" }, { status: 422 });
  }

  /**
   * Quien envía la evaluación tiene que ser el evaluador asignado. Quien
   * administra el proceso puede hacerlo en su lugar —para desatascar una
   * campaña—, y eso queda en la auditoría.
   */
  if (
    !puede(g.usuario, "talento.evaluaciones_cerrar") &&
    participante.evaluadorId !== g.usuario.empleadoId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const nota = await prisma.$transaction((tx) => registrarRespuesta(tx, id, participanteId, { calificacion, comentarios, criterios }));
    return NextResponse.json({ ok: true, calificacion: nota });
  } catch (e) {
    if (e instanceof SinCalificacion) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
