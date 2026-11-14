/**
 * Anticipos de prestaciones pagados aparte de la planilla: negociación de prestaciones y
 * adelantos del 13.º y 14.º (ver AnticipoPrestacion en el esquema).
 *
 *   GET  → lista, con filtros empleadoId, tipo, estado y anio
 *   POST → registrar un pago ya hecho (cheque o transferencia)
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { TipoAnticipoPrestacion, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado, filtroPorEmpleado } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zFecha, zId, zMontoPositivo } from "@/lib/http/validar";
import { aNumero } from "@/lib/payroll/money";
import { anioDecimoEnCurso, ETIQUETA_ANTICIPO } from "@/lib/prestaciones/anticipos";
import { hoyHN } from "@/lib/utils";

const DECIMO_DE = { ADELANTO_DECIMO_TERCERO: "DECIMO_TERCERO", ADELANTO_DECIMO_CUARTO: "DECIMO_CUARTO" } as const;

const schemaCrear = z
  .object({
    empleadoId: zId,
    tipo: z.enum(TipoAnticipoPrestacion),
    monto: zMontoPositivo,
    fechaPago: zFecha,
    /** Adelantos: año del PAGO del décimo. Si se omite, el del décimo en curso a la fecha del pago. */
    anioDecimo: z.coerce.number().int().min(2000).max(2100).optional(),
    periodoDesde: zFecha.optional(),
    periodoHasta: zFecha.optional(),
    referencia: z.string().trim().max(120).optional(),
    observacion: z.string().trim().max(1000).optional(),
  })
  .refine((d) => !(d.periodoDesde && d.periodoHasta) || d.periodoDesde <= d.periodoHasta, {
    error: "El período cubierto termina antes de empezar",
    path: ["periodoHasta"],
  });

const SELECT_LISTA = {
  id: true, tipo: true, monto: true, fechaPago: true, anioDecimo: true, periodoDesde: true, periodoHasta: true,
  referencia: true, observacion: true, estado: true, montoAplicado: true, motivoAnulacion: true, createdAt: true,
  empleado: { select: { id: true, codigo: true, identidad: true, primerNombre: true, primerApellido: true, estado: true, sucursal: { select: { nombre: true } } } },
  liquidacionFinal: { select: { id: true, estado: true, fechaSalida: true } },
  liquidacionDecimo: { select: { id: true, tipo: true, anio: true, estado: true } },
} as const;

type Fila = Prisma.AnticipoPrestacionGetPayload<{ select: typeof SELECT_LISTA }>;
const serializar = (a: Fila) => ({
  ...a,
  etiqueta: ETIQUETA_ANTICIPO[a.tipo],
  monto: aNumero(a.monto),
  montoAplicado: a.montoAplicado === null ? null : aNumero(a.montoAplicado),
});

export async function GET(req: NextRequest) {
  const g = await requerirPermiso(["prestaciones.ver", "deducciones.ver"]);
  if (!g.ok) return g.response;

  const sp = new URL(req.url).searchParams;
  const tipo = sp.get("tipo");
  const estado = sp.get("estado");
  const anio = Number(sp.get("anio"));
  const filas = await prisma.anticipoPrestacion.findMany({
    where: {
      ...(sp.get("empleadoId") ? { empleadoId: sp.get("empleadoId")! } : {}),
      ...(tipo && tipo in ETIQUETA_ANTICIPO ? { tipo: tipo as TipoAnticipoPrestacion } : {}),
      ...(estado === "VIGENTE" || estado === "APLICADO" || estado === "ANULADO" ? { estado } : {}),
      ...(Number.isInteger(anio) && anio > 2000 ? { OR: [{ anioDecimo: anio }, { anioDecimo: null, fechaPago: { gte: new Date(Date.UTC(anio, 0, 1)), lt: new Date(Date.UTC(anio + 1, 0, 1)) } }] } : {}),
      AND: [filtroPorEmpleado(g.usuario)],
    },
    select: SELECT_LISTA,
    orderBy: [{ fechaPago: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  return NextResponse.json(filas.map(serializar));
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("prestaciones.generar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schemaCrear);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const empleado = await prisma.empleado.findUnique({
    where: { id: d.empleadoId },
    select: { id: true, sucursalId: true, departamentoId: true, fechaIngreso: true },
  });
  if (!empleado || !alcanzaEmpleado(g.usuario, empleado)) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  if (d.fechaPago > hoyHN()) return NextResponse.json({ error: "Registre el pago cuando ya se hizo: la fecha es futura." }, { status: 400 });
  if (d.fechaPago < empleado.fechaIngreso) return NextResponse.json({ error: "La fecha del pago es anterior al ingreso del empleado." }, { status: 400 });

  const finiquito = await prisma.liquidacionFinal.findFirst({
    where: { empleadoId: d.empleadoId, estado: { in: ["APROBADA", "PAGADA"] } },
    select: { estado: true },
  });
  if (finiquito) {
    return NextResponse.json({ error: `El empleado ya tiene su liquidación final ${finiquito.estado === "PAGADA" ? "pagada" : "aprobada"}: un anticipo ya no se rebajaría de nada.` }, { status: 409 });
  }

  let anioDecimo: number | null = null;
  let aviso: string | null = null;
  if (d.tipo !== "NEGOCIACION_PRESTACIONES") {
    const decimo = DECIMO_DE[d.tipo];
    anioDecimo = d.anioDecimo ?? anioDecimoEnCurso(decimo, d.fechaPago);
    const liquidado = await prisma.liquidacionDecimo.findUnique({
      where: { empleadoId_tipo_anio: { empleadoId: d.empleadoId, tipo: decimo, anio: anioDecimo } },
      select: { estado: true },
    });
    if (liquidado?.estado === "PAGADA") {
      return NextResponse.json({ error: `El ${decimo === "DECIMO_TERCERO" ? "décimo tercer" : "décimo cuarto"} mes de ${anioDecimo} ya se pagó: un adelanto ya no se le puede restar.` }, { status: 409 });
    }
    if (liquidado?.estado === "CALCULADA") {
      aviso = `El ${decimo === "DECIMO_TERCERO" ? "décimo tercer" : "décimo cuarto"} mes de ${anioDecimo} ya está calculado: vuelva a calcularlo en Prestaciones para restar este adelanto.`;
    }
  }

  const creado = await prisma.anticipoPrestacion.create({
    data: {
      empleadoId: d.empleadoId,
      tipo: d.tipo,
      monto: d.monto,
      fechaPago: d.fechaPago,
      anioDecimo,
      periodoDesde: d.tipo === "NEGOCIACION_PRESTACIONES" ? d.periodoDesde ?? null : null,
      periodoHasta: d.tipo === "NEGOCIACION_PRESTACIONES" ? d.periodoHasta ?? null : null,
      referencia: d.referencia || null,
      observacion: d.observacion || null,
      registradoPor: g.usuario.id ?? null,
    },
    select: SELECT_LISTA,
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "AnticipoPrestacion",
    registroId: creado.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { empleadoId: d.empleadoId, tipo: d.tipo, monto: d.monto, fechaPago: d.fechaPago, anioDecimo },
    ip,
    userAgent,
  });

  return NextResponse.json({ ...serializar(creado), aviso }, { status: 201 });
}
