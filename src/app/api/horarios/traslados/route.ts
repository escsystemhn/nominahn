/**
 * Traslados temporales entre sucursales para los horarios rotativos.
 *
 *   GET  ?planId=…  → los traslados que tocan ese plan y a quién se puede traer de otra sucursal
 *   POST            → registrar un traslado { empleadoId, sucursalDestinoId, desde, hasta, motivo? }
 *
 * Un traslado no cambia la sucursal del empleado ni su planilla: sólo dónde trabaja esos
 * días (ver TrasladoTemporal en el esquema).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado, conAlcance, filtroSucursales } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { aFecha, trasladosDelPeriodo, ymd } from "@/lib/horarios/bd";
import { vistaDePlan } from "@/lib/horarios/alcance";
import { erroresDeTraslado } from "@/lib/horarios/traslados";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const schema = z.object({
  empleadoId: zId,
  sucursalDestinoId: zId,
  desde: fecha,
  hasta: fecha,
  motivo: z.string().trim().max(200).optional(),
});

export async function GET(req: NextRequest) {
  const g = await requerirPermiso(["asistencia.turnos", "asistencia.ver"]);
  if (!g.ok) return g.response;

  const planId = new URL(req.url).searchParams.get("planId");
  if (!planId) return NextResponse.json({ error: "Indique el plan" }, { status: 400 });
  const plan = await prisma.planHorario.findUnique({ where: { id: planId }, select: { desde: true, hasta: true, sucursalesIds: true } });
  const vista = await vistaDePlan(prisma, g.usuario, planId);
  if (!plan || vista.acceso === "ninguno") return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  const [traslados, candidatos] = await Promise.all([
    trasladosDelPeriodo(prisma, { desde: ymd(plan.desde), hasta: ymd(plan.hasta), sucursalesIds: plan.sucursalesIds }),
    // A quién se puede traer: personal activo con puesto, de su alcance, de OTRAS sucursales.
    prisma.empleado.findMany({
      where: conAlcance(
        { estado: { notIn: ["INACTIVO", "SUSPENDIDO"] }, puestoId: { not: null }, sucursalId: { notIn: plan.sucursalesIds }, fechaIngreso: { lte: plan.hasta } },
        g.usuario
      ),
      select: { id: true, codigo: true, primerNombre: true, primerApellido: true, sucursal: { select: { nombre: true } }, puesto: { select: { nombre: true } } },
      orderBy: [{ sucursal: { nombre: "asc" } }, { primerApellido: "asc" }],
      take: 1000,
    }),
  ]);
  return NextResponse.json({
    traslados,
    candidatos: candidatos.map((e) => ({
      id: e.id, codigo: e.codigo, nombre: `${e.primerNombre} ${e.primerApellido}`, sucursal: e.sucursal.nombre, puesto: e.puesto?.nombre ?? "",
    })),
  });
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const empleado = await prisma.empleado.findUnique({
    where: { id: d.empleadoId },
    select: { id: true, sucursalId: true, departamentoId: true, estado: true, primerNombre: true, primerApellido: true },
  });
  // Fuera de su alcance responde igual que si no existiera.
  if (!empleado || !alcanzaEmpleado(g.usuario, empleado)) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  if (empleado.estado === "INACTIVO" || empleado.estado === "SUSPENDIDO") {
    return NextResponse.json({ error: "El empleado no está activo." }, { status: 409 });
  }
  const destino = await prisma.sucursal.findFirst({ where: { AND: [{ id: d.sucursalDestinoId, activa: true }, filtroSucursales(g.usuario)] }, select: { id: true, nombre: true } });
  if (!destino) return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 });

  const existentes = await trasladosDelPeriodo(prisma, { desde: d.desde, hasta: d.hasta, empleadoIds: [empleado.id] });
  const errores = erroresDeTraslado(d, empleado.sucursalId, existentes);
  if (errores.length) return NextResponse.json({ error: errores.join(" ") }, { status: 409 });

  // Turnos publicados en su propia sucursal esos días: el traslado no los borra; se avisa
  // para que se quiten (lo planificado en dos sitios a la vez no puede cumplirse).
  const enOtroPlan = await prisma.horarioDia.findMany({
    where: { empleadoId: empleado.id, estado: "TURNO", fecha: { gte: aFecha(d.desde), lte: aFecha(d.hasta) }, sucursalId: { not: destino.id }, plan: { estado: "PUBLICADO" } },
    select: { fecha: true, plan: { select: { nombre: true } } },
    orderBy: { fecha: "asc" },
  });

  const creado = await prisma.trasladoTemporal.create({
    data: {
      empleadoId: empleado.id,
      sucursalOrigenId: empleado.sucursalId,
      sucursalDestinoId: destino.id,
      desde: aFecha(d.desde),
      hasta: aFecha(d.hasta),
      motivo: d.motivo || null,
      creadoPor: g.usuario.id ?? null,
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "TrasladoTemporal",
    registroId: creado.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { empleadoId: empleado.id, de: empleado.sucursalId, a: destino.id, desde: d.desde, hasta: d.hasta, motivo: d.motivo },
    ip,
    userAgent,
  });

  return NextResponse.json(
    {
      id: creado.id,
      aviso: enOtroPlan.length
        ? `${empleado.primerNombre} ${empleado.primerApellido} tiene ${enOtroPlan.length} turno(s) publicado(s) en «${enOtroPlan[0].plan.nombre}» esos días: vuelva ese plan a borrador y quíteselos.`
        : null,
    },
    { status: 201 }
  );
}
