/**
 * Emisión de documentos desde plantilla (lado de la base).
 *
 * El texto se resuelve y se GUARDA ya resuelto en `DocumentoEmitido`: si mañana
 * cambia el salario o la plantilla, la constancia emitida hoy se vuelve a
 * descargar idéntica, con su mismo folio.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as prismaGlobal } from "@/lib/prisma";
import { formatCurrency, hoyHN, formatDateLong, nombreCompleto } from "@/lib/utils";
import { turnoDe, textoTurno } from "@/lib/asistencia/turnos";
import { construirContexto, resolverPlantilla, PLANTILLAS_POR_OMISION, type Resolucion } from "./plantillas";
import { leerFirmante } from "./firmante";
import { pdfCarta, type FirmaDoc } from "./pdf";

type Db = PrismaClient;

/** Siembra las plantillas del sistema que falten (por código). Idempotente. */
export async function asegurarPlantillas(db: Db = prismaGlobal): Promise<number> {
  const existentes = new Set((await db.plantillaDocumento.findMany({ select: { codigo: true } })).map((p) => p.codigo));
  const faltan = PLANTILLAS_POR_OMISION.filter((p) => !existentes.has(p.codigo));
  if (faltan.length === 0) return 0;
  await db.plantillaDocumento.createMany({
    data: faltan.map((p) => ({ ...p, esSistema: true })),
    skipDuplicates: true,
  });
  return faltan.length;
}

export class ErrorDocumento extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje);
  }
}

/** Datos del empleado, su contrato y su turno, ya convertidos en variables. */
export async function contextoDe(db: Db, empleadoId: string, destinatario?: string | null): Promise<Record<string, string>> {
  const emp = await db.empleado.findUnique({
    where: { id: empleadoId },
    select: {
      primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
      identidad: true, rtn: true, codigo: true, genero: true, estadoCivil: true, nacionalidad: true,
      direccion: true, fechaNacimiento: true, fechaIngreso: true, tipoContrato: true, tipoPlanilla: true,
      salarioBase: true, cuentaBancaria: true,
      puesto: { select: { nombre: true } },
      departamento: { select: { nombre: true } },
      sucursal: { select: { nombre: true, direccion: true, empresa: { select: { nombre: true, rtn: true, direccion: true, telefono: true } } } },
      contratos: { where: { activo: true }, orderBy: { fechaInicio: "desc" }, take: 1, select: { fechaInicio: true, jornada: true, horario: true } },
    },
  });
  if (!emp) throw new ErrorDocumento(404, "Empleado no encontrado");

  const hoy = hoyHN();
  const [firmante, turno] = await Promise.all([leerFirmante(db), turnoDe(empleadoId, hoy, db)]);

  return construirContexto({
    empleado: {
      ...emp,
      salarioBase: Number(emp.salarioBase),
      puesto: emp.puesto?.nombre,
      departamento: emp.departamento?.nombre,
      sucursal: emp.sucursal?.nombre,
      sucursalDireccion: emp.sucursal?.direccion,
    },
    contrato: emp.contratos[0] ?? null,
    turno: textoTurno(turno),
    empresa: emp.sucursal.empresa,
    firmante,
    destinatario,
    hoy,
    moneda: (n) => formatCurrency(n),
  });
}

export interface Previsualizacion extends Resolucion {
  titulo: string;
}

export async function previsualizar(
  db: Db,
  o: { plantillaId?: string; contenido?: string; titulo?: string; empleadoId: string; destinatario?: string | null }
): Promise<Previsualizacion> {
  let contenido = o.contenido;
  let titulo = o.titulo ?? "";
  if (o.plantillaId) {
    const p = await db.plantillaDocumento.findUnique({ where: { id: o.plantillaId } });
    if (!p) throw new ErrorDocumento(404, "Plantilla no encontrada");
    contenido = contenido ?? p.contenido;
    titulo = o.titulo ?? p.titulo;
  }
  if (!contenido) throw new ErrorDocumento(400, "No hay texto que resolver");
  const contexto = await contextoDe(db, o.empleadoId, o.destinatario);
  return { titulo, ...resolverPlantilla(contenido, contexto) };
}

/** Folio correlativo por año: 2026-000001. */
async function siguienteFolio(tx: Prisma.TransactionClient, anio: number): Promise<string> {
  const ultimo = await tx.documentoEmitido.findFirst({
    where: { folio: { startsWith: `${anio}-` } },
    orderBy: { folio: "desc" },
    select: { folio: true },
  });
  const n = ultimo ? Number(ultimo.folio.split("-")[1]) + 1 : 1;
  return `${anio}-${String(n).padStart(6, "0")}`;
}

export async function emitir(
  db: Db,
  o: { plantillaId: string; empleadoId: string; destinatario?: string | null; emitidoPor: string | null; porAutoservicio: boolean }
) {
  const plantilla = await db.plantillaDocumento.findUnique({ where: { id: o.plantillaId } });
  if (!plantilla || !plantilla.activo) throw new ErrorDocumento(404, "La plantilla no existe o está desactivada");
  if (o.porAutoservicio && !plantilla.autoservicio) throw new ErrorDocumento(403, "Esta plantilla no está disponible en autoservicio");

  const r = await previsualizar(db, { plantillaId: plantilla.id, empleadoId: o.empleadoId, destinatario: o.destinatario });
  if (r.desconocidas.length) {
    throw new ErrorDocumento(422, `La plantilla usa variables que no existen: ${r.desconocidas.join(", ")}. Corríjala antes de emitir.`);
  }
  const firmante = await leerFirmante(db);
  const anio = hoyHN().getUTCFullYear();

  // Dos emisiones simultáneas pueden calcular el mismo folio: el índice único
  // lo impide y se reintenta con el siguiente.
  for (let intento = 0; intento < 5; intento++) {
    try {
      return await db.$transaction(async (tx) => {
        const folio = await siguienteFolio(tx, anio);
        return tx.documentoEmitido.create({
          data: {
            folio,
            plantillaId: plantilla.id,
            empleadoId: o.empleadoId,
            destinatario: o.destinatario?.trim() || null,
            titulo: r.titulo,
            contenido: r.texto,
            firmanteNombre: firmante.nombre || null,
            firmanteCargo: firmante.cargo || null,
            emitidoPor: o.emitidoPor,
            porAutoservicio: o.porAutoservicio,
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new ErrorDocumento(409, "No se pudo asignar un folio; intente de nuevo");
}

/** PDF de un documento emitido, con su texto congelado. */
export async function pdfDeEmitido(db: Db, id: string): Promise<{ buffer: Buffer; folio: string; empleadoId: string }> {
  const doc = await db.documentoEmitido.findUnique({
    where: { id },
    include: {
      plantilla: { select: { tipo: true } },
      empleado: {
        select: {
          primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, identidad: true,
          sucursal: { select: { empresa: { select: { nombre: true, rtn: true, direccion: true, telefono: true, email: true } } } },
        },
      },
    },
  });
  if (!doc) throw new ErrorDocumento(404, "Documento no encontrado");
  const firmante = await leerFirmante(db);

  const patrono: FirmaDoc = { nombre: doc.firmanteNombre || "Por el patrono", cargo: doc.firmanteCargo || null };
  const firmas: FirmaDoc[] =
    doc.plantilla.tipo === "CONTRATO"
      ? [{ ...patrono, cargo: `${patrono.cargo ?? ""}${patrono.cargo ? ", " : ""}por EL PATRONO` }, { nombre: nombreCompleto(doc.empleado), cargo: "EL TRABAJADOR", identidad: doc.empleado.identidad }]
      : [patrono];

  // Las constancias llevan la fecha en el cuerpo; el contrato también. La línea
  // de lugar y fecha arriba sólo se pone en cartas y otros.
  const conLugarFecha = doc.plantilla.tipo === "CARTA" || doc.plantilla.tipo === "OTRO";
  const buffer = await pdfCarta({
    empresa: doc.empleado.sucursal.empresa,
    titulo: doc.titulo,
    contenido: doc.contenido,
    lugarFecha: conLugarFecha ? `${firmante.ciudad ? `${firmante.ciudad}, ` : ""}${formatDateLong(doc.createdAt)}` : null,
    folio: doc.folio,
    firmas,
    marcaAgua: doc.anulado ? "ANULADO" : null,
  });
  return { buffer, folio: doc.folio, empleadoId: doc.empleadoId };
}
