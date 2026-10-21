/**
 * Acumulados del ISR de meses pagados FUERA de NominaHN, para el cálculo
 * personalizado: se importan de la hoja «Retención en la fuente».
 *
 *   POST   (multipart, `archivo` .xlsx, `hastaMes` opcional) → vista previa, no escribe
 *   PUT    { anio, filas: [{ empleadoId, meses: [...] }] }    → guarda (reemplaza esos meses)
 *   DELETE ?anio=2026                                         → borra los de ese año
 *
 * La vista previa empareja cada fila con un empleado por RTN, por identidad (el
 * RTN de persona natural es la identidad más un dígito) o por nombre completo.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { leerArchivo } from "@/lib/importacion/lote";
import { leerHojaRetencion, normalizarTexto } from "@/lib/importacion/acumulados-isr";
import { redondear } from "@/lib/payroll/money";
import { nombreCompleto } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "La petición no trae un archivo válido." }, { status: 400 });
  }
  const archivo = await leerArchivo(form, "archivo", { patron: /\.xlsx$/i, descripcion: "libros de Excel (.xlsx)" });
  if (!archivo.ok) return NextResponse.json({ error: archivo.error }, { status: 400 });

  const lectura = await leerHojaRetencion(archivo.bytes);
  if (!lectura.hoja) return NextResponse.json({ error: lectura.errores.join(" ") }, { status: 400 });

  // Por omisión, los meses ANTERIORES al del archivo: los de su mes en curso y
  // siguientes son proyección de la hoja, no lo pagado ni lo retenido.
  const pedido = Number(form.get("hastaMes"));
  const hastaMes = Number.isInteger(pedido) && pedido >= 1 && pedido <= 12
    ? pedido
    : Math.max(1, (lectura.mesArchivo ?? 13) - 1);

  const empleados = await prisma.empleado.findMany({
    select: { id: true, codigo: true, rtn: true, identidad: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true },
  });
  const digitos = (s: string | null) => (s ?? "").replace(/\D/g, "");
  const porRtn = new Map(empleados.filter((e) => digitos(e.rtn)).map((e) => [digitos(e.rtn), e]));
  const porIdentidad = new Map(empleados.filter((e) => digitos(e.identidad)).map((e) => [digitos(e.identidad), e]));
  const porNombre = new Map(empleados.map((e) => [normalizarTexto(nombreCompleto(e)), e]));

  const filas = lectura.filas.map((f) => {
    const [empleado, coincidencia] =
      f.rtn && porRtn.has(f.rtn) ? [porRtn.get(f.rtn)!, "RTN"]
        : f.rtn.length >= 13 && porIdentidad.has(f.rtn.slice(0, 13)) ? [porIdentidad.get(f.rtn.slice(0, 13))!, "IDENTIDAD"]
          : porNombre.has(normalizarTexto(f.nombre)) ? [porNombre.get(normalizarTexto(f.nombre))!, "NOMBRE"]
            : [null, null];
    const meses = f.meses
      .filter((m) => m.mes <= hastaMes)
      .map((m) => ({ ...m, sueldo: Number(redondear(m.sueldo)), variables: Number(redondear(m.variables)), isrRetenido: Number(redondear(m.isrRetenido)) }));
    return {
      fila: f.fila, nombre: f.nombre, rtn: f.rtn, coincidencia, meses,
      empleado: empleado ? { id: empleado.id, codigo: empleado.codigo, nombre: nombreCompleto(empleado) } : null,
      totalRetenido: Number(redondear(meses.reduce((s, m) => s + m.isrRetenido, 0))),
    };
  });

  return NextResponse.json({
    hoja: lectura.hoja, anio: lectura.anio, mesArchivo: lectura.mesArchivo, hastaMes,
    filas, avisos: lectura.errores,
    sinEmpleado: filas.filter((f) => !f.empleado).length,
  });
}

const zMonto = z.number().min(-10_000_000).max(10_000_000);
const schemaGuardar = z.object({
  anio: z.number().int().min(2000).max(2100),
  filas: z.array(z.object({
    empleadoId: zId,
    meses: z.array(z.object({
      mes: z.number().int().min(1).max(12),
      sueldo: zMonto,
      variables: zMonto,
      isrRetenido: zMonto,
    })).max(12),
  })).min(1).max(5000),
});

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schemaGuardar);
  if (!parsed.ok) return parsed.response;
  const { anio, filas } = parsed.data;

  const ids = [...new Set(filas.map((f) => f.empleadoId))];
  const existen = await prisma.empleado.count({ where: { id: { in: ids } } });
  if (existen !== ids.length) return NextResponse.json({ error: "Alguno de los empleados no existe." }, { status: 400 });

  const registros = filas.flatMap((f) => f.meses.map((m) => ({ empleadoId: f.empleadoId, anio, ...m })));
  await prisma.$transaction(
    registros.map((r) => prisma.acumuladoIsr.upsert({
      where: { empleadoId_anio_mes: { empleadoId: r.empleadoId, anio: r.anio, mes: r.mes } },
      update: { sueldo: redondear(r.sueldo), variables: redondear(r.variables), isrRetenido: redondear(r.isrRetenido), origen: "IMPORTACION" },
      create: { ...r, sueldo: redondear(r.sueldo), variables: redondear(r.variables), isrRetenido: redondear(r.isrRetenido), origen: "IMPORTACION" },
    }))
  );

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE", tabla: "AcumuladoIsr", registroId: String(anio),
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { anio, empleados: ids.length, meses: registros.length }, ip, userAgent,
  });
  return NextResponse.json({ anio, empleados: ids.length, meses: registros.length });
}

export async function DELETE(req: NextRequest) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;

  const anio = Number(req.nextUrl.searchParams.get("anio"));
  if (!Number.isInteger(anio)) return NextResponse.json({ error: "Indique el año." }, { status: 400 });
  const { count } = await prisma.acumuladoIsr.deleteMany({ where: { anio } });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE", tabla: "AcumuladoIsr", registroId: String(anio),
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { anio, meses: count }, ip, userAgent,
  });
  return NextResponse.json({ anio, borrados: count });
}
