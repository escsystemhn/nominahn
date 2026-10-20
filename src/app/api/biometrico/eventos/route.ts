/**
 * Marcaciones crudas tal como las reportó el reloj.
 *
 * Es la vista de auditoría para la que existe `MarcajeEvento`. Cuando alguien
 * reclama sus horas, `Marcaje` sólo dice «8.5 horas»; aquí se ve de dónde salió
 * ese número: las cuatro marcas del día, a qué hora, en qué equipo y con qué
 * PIN. Sin esto, la única respuesta posible a un reclamo es «lo dice el sistema».
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import type { Prisma } from "@prisma/client";

const LIMITE_POR_DEFECTO = 100;
const LIMITE_MAXIMO = 500;

const ESTADOS = ["PENDIENTE", "PROCESADO", "CUARENTENA", "DESCARTADO"] as const;
type Estado = (typeof ESTADOS)[number];

function fechaValida(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  // Es dato de asistencia: lo puede consultar quien consulta asistencia, no
  // sólo quien administra los aparatos.
  const g = await requerirPermiso(["asistencia.ver", "asistencia.biometrico"]);
  if (!g.ok) return g.response;

  const q = new URL(req.url).searchParams;

  const desde = fechaValida(q.get("desde"));
  const hasta = fechaValida(q.get("hasta"));
  const estado = q.get("estado");
  const dispositivoId = q.get("dispositivoId");
  const empleadoId = q.get("empleadoId");
  const pin = q.get("pin")?.trim();

  const where: Prisma.MarcajeEventoWhereInput = {
    ...(dispositivoId ? { dispositivoId } : {}),
    ...(empleadoId ? { empleadoId } : {}),
    ...(pin ? { pin } : {}),
    ...(estado && (ESTADOS as readonly string[]).includes(estado)
      ? { estado: estado as Estado }
      : {}),
    // `fechaLocal` es de CALENDARIO (medianoche UTC): el filtro por día del
    // usuario tiene que ir contra ella y no contra `ocurridoEn`, que es el
    // instante y caería en el día siguiente para una marca nocturna.
    ...(desde || hasta
      ? { fechaLocal: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } }
      : {}),
  };

  const limite = Math.min(Number(q.get("limite")) || LIMITE_POR_DEFECTO, LIMITE_MAXIMO);
  const salto = Math.max(Number(q.get("salto")) || 0, 0);

  const [total, eventos] = await Promise.all([
    prisma.marcajeEvento.count({ where }),
    prisma.marcajeEvento.findMany({
      where,
      select: {
        id: true,
        pin: true,
        ocurridoEn: true,
        fechaLocal: true,
        tipo: true,
        estado: true,
        verificacion: true,
        motivo: true,
        dispositivo: { select: { id: true, nombre: true, marca: true } },
        empleado: { select: { id: true, codigo: true, primerNombre: true, primerApellido: true } },
      },
      orderBy: { ocurridoEn: "desc" },
      take: limite,
      skip: salto,
    }),
  ]);

  return NextResponse.json({
    total,
    limite,
    salto,
    eventos: eventos.map((e) => ({
      id: e.id,
      pin: e.pin,
      ocurridoEn: e.ocurridoEn.toISOString(),
      fechaLocal: e.fechaLocal.toISOString(),
      tipo: e.tipo,
      estado: e.estado,
      verificacion: e.verificacion,
      motivo: e.motivo,
      dispositivo: e.dispositivo.nombre,
      marca: e.dispositivo.marca,
      empleado: e.empleado
        ? `${e.empleado.codigo} — ${e.empleado.primerNombre} ${e.empleado.primerApellido}`
        : null,
    })),
  });
}
