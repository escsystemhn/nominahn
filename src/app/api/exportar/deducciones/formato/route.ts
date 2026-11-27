/**
 * Formato de captura de deducciones por sucursal (ver `lib/importacion/formato-captura.ts`).
 *
 *   GET  ?tipoPlanilla=QUINCENAL  → sucursales del alcance con sus departamentos (y cuántos
 *                                   empleados cobran en ese tipo de planilla), y las columnas
 *                                   del formato con su orden
 *   POST { tipoPlanilla, desde, hasta, sucursalId, divisionId, departamentoIds, columnas,
 *          conMontos, horasExtra, recordar }  → el .xlsx (con `horasExtra`, las horas extra
 *          del período al 25, 50, 75 y 100 % antes de las deducciones)
 *
 * Con la estructura de grupos, la «sucursal» que se elige es la `Division` y el grupo es la
 * `Sucursal` (`etiquetasNiveles`). Sin divisiones, es la `Sucursal`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso, puede } from "@/lib/auth/guard";
import { conAlcance, filtroSucursales } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { cabecerasXlsx } from "@/lib/importacion/xlsx";
import { cargarDeduccionesDelPeriodo, cargarTiposMatriz, estadosDelPeriodo, etiquetaTipo, totalDeCelda } from "@/lib/importacion/montos-periodo";
import {
  MAX_EMPLEADOS_FORMATO as MAX_EMPLEADOS,
  SIN_PII_FORMATO as SIN_PII,
  columnasDelFormato,
  construirFormato,
  guardarFormato,
  leerFormatoGuardado,
  nombreArchivoFormato,
  porCodigoYNombre,
  type DepartamentoFormato,
} from "@/lib/importacion/formato-captura";
import { divisionesHabilitadas, jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import { horasEnCelda } from "@/lib/payroll/horas-extra-periodo";
import { cargarHorasDelPeriodo } from "@/lib/payroll/horas-extra-periodo-bd";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { ESTADOS_QUE_COBRAN } from "@/lib/payroll/elegibles";
import { TIPOS_PLANILLA, errorDePeriodo, type TipoPlanillaPeriodo } from "@/lib/payroll/periodos-planilla";
import { nombreCompleto } from "@/lib/utils";

const zTipo = z.enum(TIPOS_PLANILLA as [TipoPlanillaPeriodo, ...TipoPlanillaPeriodo[]]);

const schema = z.object({
  tipoPlanilla: zTipo,
  desde: z.string(),
  hasta: z.string(),
  sucursalId: zId,
  divisionId: z.string().trim().min(1).nullable().default(null),
  departamentoIds: z.array(zId).min(1, "Marque al menos un departamento.").max(500),
  columnas: z.array(z.string().trim().min(1).max(30)).max(100),
  conMontos: z.boolean().default(true),
  horasExtra: z.boolean().default(false),
  recordar: z.boolean().default(false),
});

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("deducciones.exportar");
  if (!g.ok) return g.response;
  if (!puede(g.usuario, "empleados.pii")) return NextResponse.json({ error: SIN_PII }, { status: 403 });
  const tipo = zTipo.safeParse(new URL(req.url).searchParams.get("tipoPlanilla"));
  if (!tipo.success) return NextResponse.json({ error: "Elija el tipo de planilla." }, { status: 400 });

  const [conDivisiones, jerarquia, sucursales, conteo, tipos, guardado] = await Promise.all([
    divisionesHabilitadas(prisma),
    jerarquiaNominaHabilitada(prisma),
    prisma.sucursal.findMany({
      where: { ...filtroSucursales(g.usuario), activa: true },
      select: {
        id: true, nombre: true, empresa: { select: { nombre: true } },
        divisiones: { where: { activa: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } },
        departamentos: { where: { activo: true }, select: { id: true, nombre: true, codigo: true, divisionId: true } },
      },
      orderBy: { nombre: "asc" },
    }),
    prisma.empleado.groupBy({
      by: ["departamentoId"],
      where: conAlcance({ estado: { in: [...ESTADOS_QUE_COBRAN] }, tipoPlanilla: tipo.data }, g.usuario),
      _count: { _all: true },
    }),
    cargarTiposMatriz(prisma),
    leerFormatoGuardado(prisma),
  ]);
  const empleadosDe = new Map(conteo.map((c) => [c.departamentoId, c._count._all]));
  const et = etiquetasNiveles(jerarquia);

  const unidades: Array<{ sucursalId: string; divisionId: string | null; grupo: string; nombre: string; departamentos: Array<{ id: string; nombre: string; empleados: number }> }> = [];
  for (const s of sucursales) {
    const deptos = (filtro: (d: (typeof s.departamentos)[number]) => boolean) =>
      s.departamentos.filter(filtro).sort(porCodigoYNombre).map((d) => ({ id: d.id, nombre: d.nombre, empleados: empleadosDe.get(d.id) ?? 0 }))
        .filter((d) => d.empleados > 0);
    if (conDivisiones) {
      for (const v of s.divisiones) {
        const ds = deptos((d) => d.divisionId === v.id);
        if (ds.length) unidades.push({ sucursalId: s.id, divisionId: v.id, grupo: s.nombre, nombre: v.nombre, departamentos: ds });
      }
      const sueltos = deptos((d) => !d.divisionId);
      if (sueltos.length) unidades.push({ sucursalId: s.id, divisionId: null, grupo: s.nombre, nombre: `${s.nombre}, ${et.sinDivision.toLowerCase()}`, departamentos: sueltos });
    } else {
      const ds = deptos(() => true);
      if (ds.length) unidades.push({ sucursalId: s.id, divisionId: null, grupo: s.empresa.nombre, nombre: s.nombre, departamentos: ds });
    }
  }

  return NextResponse.json({
    etiquetas: { grupo: conDivisiones ? et.sucursal : et.empresaLegal, sucursal: conDivisiones ? et.division : et.sucursal },
    unidades,
    columnas: columnasDelFormato(tipos, guardado).map(({ tipo: t, incluida }) => ({ codigo: t.codigo, etiqueta: etiquetaTipo(t), incluida })),
    horasExtra: guardado?.horasExtra ?? false,
    puedeRecordar: puede(g.usuario, "deducciones.configurar"),
  });
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("deducciones.exportar");
  if (!g.ok) return g.response;
  if (!puede(g.usuario, "empleados.pii")) return NextResponse.json({ error: SIN_PII }, { status: 403 });

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;
  const errorPeriodo = errorDePeriodo({ desde: b.desde, hasta: b.hasta });
  if (errorPeriodo) return NextResponse.json({ error: errorPeriodo }, { status: 400 });
  const periodo = { tipo: b.tipoPlanilla, desde: b.desde, hasta: b.hasta };
  if (b.columnas.length === 0 && !b.horasExtra) return NextResponse.json({ error: "Elija al menos una columna de deducción, o las horas extra." }, { status: 400 });

  // La sucursal tiene que estar en el alcance; la división, ser suya; los departamentos, de ahí.
  const [conDivisiones, jerarquia, sucursal] = await Promise.all([
    divisionesHabilitadas(prisma),
    jerarquiaNominaHabilitada(prisma),
    prisma.sucursal.findFirst({
      where: { ...filtroSucursales(g.usuario), id: b.sucursalId },
      select: { id: true, nombre: true, empresa: { select: { nombre: true } }, divisiones: { select: { id: true, nombre: true } } },
    }),
  ]);
  if (!sucursal) return NextResponse.json({ error: "La sucursal no existe o está fuera de su alcance." }, { status: 404 });
  const division = b.divisionId ? sucursal.divisiones.find((v) => v.id === b.divisionId) : null;
  if (b.divisionId && !division) return NextResponse.json({ error: "La sucursal elegida no es de ese grupo." }, { status: 400 });

  const departamentos = await prisma.departamento.findMany({
    where: {
      id: { in: b.departamentoIds }, sucursalId: sucursal.id,
      ...(conDivisiones ? { divisionId: b.divisionId } : {}),
    },
    select: { id: true, nombre: true, codigo: true },
  });
  if (departamentos.length !== new Set(b.departamentoIds).size) {
    return NextResponse.json({ error: "Algún departamento no es de la sucursal elegida." }, { status: 400 });
  }

  const tipos = await cargarTiposMatriz(prisma);
  const porCodigo = new Map(tipos.map((t) => [t.codigo, t]));
  const desconocida = b.columnas.find((c) => !porCodigo.has(c));
  if (desconocida) return NextResponse.json({ error: `«${desconocida}» no es un tipo de deducción que se pueda importar.` }, { status: 400 });
  const columnas = [...new Set(b.columnas)].map((c) => porCodigo.get(c)!);

  const empleados = await prisma.empleado.findMany({
    where: conAlcance({ estado: { in: [...ESTADOS_QUE_COBRAN] }, tipoPlanilla: periodo.tipo, departamentoId: { in: departamentos.map((d) => d.id) } }, g.usuario),
    select: { id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, departamentoId: true },
    orderBy: { codigo: "asc" },
    take: MAX_EMPLEADOS + 1,
  });
  if (empleados.length > MAX_EMPLEADOS) return NextResponse.json({ error: `Son más de ${MAX_EMPLEADOS} empleados: elija menos departamentos.` }, { status: 413 });
  if (!empleados.length) return NextResponse.json({ error: "Ningún empleado de esos departamentos cobra en este tipo de planilla." }, { status: 400 });

  const estados = b.conMontos
    ? estadosDelPeriodo(await cargarDeduccionesDelPeriodo(prisma, empleados.map((e) => e.id), columnas.map((t) => t.id), periodo), periodo)
    : new Map();
  // Las horas de hoy: lo fijado para el período o, si no hay, lo que suman los marcajes.
  const horasHoy = b.horasExtra && b.conMontos ? await cargarHorasDelPeriodo(prisma, empleados.map((e) => e.id), periodo) : null;
  const grupos: DepartamentoFormato[] = departamentos.sort(porCodigoYNombre).map((d) => ({
    nombre: d.nombre,
    empleados: empleados.filter((e) => e.departamentoId === d.id).map((e) => ({ id: e.id, codigo: e.codigo, nombre: nombreCompleto(e) })),
  }));

  const et = etiquetasNiveles(jerarquia);
  const nombreSucursal = division?.nombre ?? sucursal.nombre;
  const archivo = await construirFormato({
    grupo: conDivisiones ? sucursal.nombre : sucursal.empresa.nombre,
    sucursal: nombreSucursal,
    etiquetaSucursal: conDivisiones ? et.division : et.sucursal,
    periodo,
    departamentos: grupos,
    columnas,
    monto: (empleadoId, tipoId) => {
      const e = estados.get(`${empleadoId}|${tipoId}`);
      return e ? totalDeCelda(e) : null;
    },
    horas: b.horasExtra
      ? (empleadoId, recargo) => (horasHoy ? horasEnCelda(horasHoy.fijadas.get(empleadoId), horasHoy.marcajes.get(empleadoId), recargo) || null : null)
      : null,
  });

  // Las columnas elegidas quedan como el formato de la empresa, si quien descarga puede configurarlo.
  if (b.recordar && puede(g.usuario, "deducciones.configurar")) {
    const elegidas = new Set(columnas.map((t) => t.codigo));
    await guardarFormato(prisma, { columnas: columnas.map((t) => t.codigo), ocultas: tipos.map((t) => t.codigo).filter((c) => !elegidas.has(c)), horasExtra: b.horasExtra });
  }

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "EXPORT", tabla: "DeduccionEmpleado", registroId: `formato:${empleados.length}`,
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      formato: "captura por sucursal", sucursal: nombreSucursal, departamentos: departamentos.length, filas: empleados.length,
      periodo, conMontos: b.conMontos, horasExtra: b.horasExtra, columnas: columnas.map((t) => t.codigo), incluyePII: true, alcance: g.usuario.alcance ?? "TODO",
    },
    ip, userAgent,
  });

  return new NextResponse(new Uint8Array(archivo), { headers: cabecerasXlsx(nombreArchivoFormato(periodo, nombreSucursal)) });
}
