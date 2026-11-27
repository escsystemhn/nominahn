/**
 * Formato de captura POR GRUPO (2026-11-27, pedido de Edbin): un solo Excel con las horas
 * extra y deducciones de todo un grupo, una hoja por tipo de planilla (Quincenal y
 * Mensual), con sus sucursales una debajo de otra. Ver `construirFormatoGrupo` en
 * `lib/importacion/formato-captura.ts`. Es una opción más: el formato por sucursal sigue
 * igual.
 *
 *   GET                                → los grupos del alcance, con cuántos empleados
 *                                        cobran en quincenal y en mensual, y las columnas
 *   POST { grupoId, mes, quincena, frecuencias, columnas, conMontos, horasExtra, recordar }
 *                                      → el .xlsx. La hoja quincenal es de esa quincena y la
 *                                        mensual, del mes completo.
 *
 * Con la estructura de grupos, el grupo es la `Sucursal` y cada sucursal de la hoja, una
 * `Division`. Sin divisiones, el grupo es la `Empresa` y cada sección, una `Sucursal`.
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
  MAX_EMPLEADOS_FORMATO,
  SIN_PII_FORMATO,
  columnasDelFormato,
  construirFormatoGrupo,
  guardarFormato,
  leerFormatoGuardado,
  nombreArchivoGrupo,
  periodoDeHojaGrupo,
  porCodigoYNombre,
  type HojaGrupo,
  type SeccionFormato,
} from "@/lib/importacion/formato-captura";
import { divisionesHabilitadas, jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import { horasEnCelda } from "@/lib/payroll/horas-extra-periodo";
import { cargarHorasDelPeriodo } from "@/lib/payroll/horas-extra-periodo-bd";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { ESTADOS_QUE_COBRAN } from "@/lib/payroll/elegibles";
import { nombreCompleto } from "@/lib/utils";

/** Las hojas del libro, en este orden. */
const FRECUENCIAS = ["QUINCENAL", "MENSUAL"] as const;
type Frecuencia = (typeof FRECUENCIAS)[number];

const schema = z.object({
  grupoId: zId,
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Elija el mes."),
  quincena: z.union([z.literal(1), z.literal(2)]),
  frecuencias: z.array(z.enum(FRECUENCIAS)).min(1, "Marque al menos una planilla: quincenal o mensual.").max(2),
  columnas: z.array(z.string().trim().min(1).max(30)).max(100),
  conMontos: z.boolean().default(true),
  horasExtra: z.boolean().default(false),
  recordar: z.boolean().default(false),
});

interface SucursalConDeptos {
  id: string;
  nombre: string;
  divisiones: Array<{ id: string; nombre: string }>;
  departamentos: Array<{ id: string; nombre: string; codigo: string | null; divisionId: string | null }>;
}

/** Las secciones de la hoja en orden: cada sucursal (o división) con sus departamentos por código. */
function unidadesDe(sucursales: readonly SucursalConDeptos[], conDivisiones: boolean, sinDivision: string) {
  const unidades: Array<{ nombre: string; departamentos: SucursalConDeptos["departamentos"] }> = [];
  for (const s of sucursales) {
    const deptos = [...s.departamentos].sort(porCodigoYNombre);
    if (!conDivisiones) {
      unidades.push({ nombre: s.nombre, departamentos: deptos });
      continue;
    }
    for (const v of [...s.divisiones].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))) {
      unidades.push({ nombre: v.nombre, departamentos: deptos.filter((d) => d.divisionId === v.id) });
    }
    const sueltos = deptos.filter((d) => !d.divisionId);
    if (sueltos.length) unidades.push({ nombre: `${s.nombre}, ${sinDivision.toLowerCase()}`, departamentos: sueltos });
  }
  return unidades;
}

export async function GET() {
  const g = await requerirPermiso("deducciones.exportar");
  if (!g.ok) return g.response;
  if (!puede(g.usuario, "empleados.pii")) return NextResponse.json({ error: SIN_PII_FORMATO }, { status: 403 });

  const [conDivisiones, jerarquia, sucursales, conteo, tipos, guardado] = await Promise.all([
    divisionesHabilitadas(prisma),
    jerarquiaNominaHabilitada(prisma),
    prisma.sucursal.findMany({
      where: { ...filtroSucursales(g.usuario), activa: true },
      select: {
        id: true, nombre: true, empresaId: true, empresa: { select: { nombre: true } },
        divisiones: { select: { id: true, nombre: true } },
        departamentos: { where: { activo: true }, select: { id: true, nombre: true, codigo: true, divisionId: true } },
      },
      orderBy: { nombre: "asc" },
    }),
    prisma.empleado.groupBy({
      by: ["departamentoId", "tipoPlanilla"],
      where: conAlcance({ estado: { in: [...ESTADOS_QUE_COBRAN] }, tipoPlanilla: { in: [...FRECUENCIAS] } }, g.usuario),
      _count: { _all: true },
    }),
    cargarTiposMatriz(prisma),
    leerFormatoGuardado(prisma),
  ]);
  const et = etiquetasNiveles(jerarquia);
  const cuantos = new Map(conteo.map((c) => [`${c.departamentoId}|${c.tipoPlanilla}`, c._count._all]));

  const porGrupo = new Map<string, { id: string; nombre: string; sucursales: SucursalConDeptos[] }>();
  for (const s of sucursales) {
    const id = conDivisiones ? s.id : s.empresaId;
    const nombre = conDivisiones ? s.nombre : s.empresa.nombre;
    const grupo = porGrupo.get(id) ?? { id, nombre, sucursales: [] };
    grupo.sucursales.push(s);
    porGrupo.set(id, grupo);
  }
  const grupos = [...porGrupo.values()].map((gr) => {
    const unidades = unidadesDe(gr.sucursales, conDivisiones, et.sinDivision);
    const de = (tipo: Frecuencia, deptos: SucursalConDeptos["departamentos"]) => deptos.reduce((n, d) => n + (cuantos.get(`${d.id}|${tipo}`) ?? 0), 0);
    return {
      id: gr.id,
      nombre: gr.nombre,
      quincenal: de("QUINCENAL", unidades.flatMap((u) => u.departamentos)),
      mensual: de("MENSUAL", unidades.flatMap((u) => u.departamentos)),
      // Cuántas sucursales tienen a alguien en alguna de las dos planillas.
      sucursales: unidades.filter((u) => de("QUINCENAL", u.departamentos) + de("MENSUAL", u.departamentos) > 0).length,
    };
  }).filter((gr) => gr.quincenal + gr.mensual > 0).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return NextResponse.json({
    etiquetas: { grupo: conDivisiones ? et.sucursal : et.empresaLegal, sucursal: conDivisiones ? et.division : et.sucursal, sucursales: conDivisiones ? et.divisiones : et.sucursales },
    grupos,
    columnas: columnasDelFormato(tipos, guardado).map(({ tipo: t, incluida }) => ({ codigo: t.codigo, etiqueta: etiquetaTipo(t), incluida })),
    horasExtra: guardado?.horasExtra ?? false,
    puedeRecordar: puede(g.usuario, "deducciones.configurar"),
  });
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("deducciones.exportar");
  if (!g.ok) return g.response;
  if (!puede(g.usuario, "empleados.pii")) return NextResponse.json({ error: SIN_PII_FORMATO }, { status: 403 });

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;
  if (b.columnas.length === 0 && !b.horasExtra) return NextResponse.json({ error: "Elija al menos una columna de deducción, o las horas extra." }, { status: 400 });

  const [conDivisiones, jerarquia, tipos] = await Promise.all([divisionesHabilitadas(prisma), jerarquiaNominaHabilitada(prisma), cargarTiposMatriz(prisma)]);
  const porCodigo = new Map(tipos.map((t) => [t.codigo, t]));
  const desconocida = b.columnas.find((c) => !porCodigo.has(c));
  if (desconocida) return NextResponse.json({ error: `«${desconocida}» no es un tipo de deducción que se pueda importar.` }, { status: 400 });
  const columnas = [...new Set(b.columnas)].map((c) => porCodigo.get(c)!);

  // Sólo las sucursales del grupo que están en el alcance de quien descarga.
  const sucursales = await prisma.sucursal.findMany({
    where: { ...filtroSucursales(g.usuario), activa: true, ...(conDivisiones ? { id: b.grupoId } : { empresaId: b.grupoId }) },
    select: {
      id: true, nombre: true, empresa: { select: { nombre: true } },
      divisiones: { select: { id: true, nombre: true } },
      departamentos: { where: { activo: true }, select: { id: true, nombre: true, codigo: true, divisionId: true } },
    },
    orderBy: { nombre: "asc" },
  });
  if (!sucursales.length) return NextResponse.json({ error: "El grupo no existe o está fuera de su alcance." }, { status: 404 });
  const et = etiquetasNiveles(jerarquia);
  const grupo = conDivisiones ? sucursales[0].nombre : sucursales[0].empresa.nombre;
  const unidades = unidadesDe(sucursales, conDivisiones, et.sinDivision);

  const empleados = await prisma.empleado.findMany({
    where: conAlcance({
      estado: { in: [...ESTADOS_QUE_COBRAN] },
      tipoPlanilla: { in: b.frecuencias },
      departamentoId: { in: unidades.flatMap((u) => u.departamentos.map((d) => d.id)) },
    }, g.usuario),
    select: { id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, departamentoId: true, tipoPlanilla: true },
    orderBy: { codigo: "asc" },
    take: MAX_EMPLEADOS_FORMATO + 1,
  });
  if (empleados.length > MAX_EMPLEADOS_FORMATO) {
    return NextResponse.json({ error: `El grupo tiene más de ${MAX_EMPLEADOS_FORMATO} empleados: use el formato por sucursal.` }, { status: 413 });
  }

  const hojas: Array<HojaGrupo & { filas: number }> = [];
  for (const tipo of FRECUENCIAS) {
    if (!b.frecuencias.includes(tipo)) continue;
    const deEsta = empleados.filter((e) => e.tipoPlanilla === tipo);
    if (!deEsta.length) continue;
    const periodo = periodoDeHojaGrupo(tipo, b.mes, b.quincena);
    const ids = deEsta.map((e) => e.id);
    const estados = b.conMontos
      ? estadosDelPeriodo(await cargarDeduccionesDelPeriodo(prisma, ids, columnas.map((t) => t.id), periodo), periodo)
      : new Map();
    // Las horas de hoy: lo fijado para el período o, si no hay, lo que suman los marcajes.
    const horasHoy = b.horasExtra && b.conMontos ? await cargarHorasDelPeriodo(prisma, ids, periodo) : null;
    const secciones: SeccionFormato[] = unidades
      .map((u) => ({
        nombre: u.nombre,
        departamentos: u.departamentos.map((d) => ({
          nombre: d.nombre,
          empleados: deEsta.filter((e) => e.departamentoId === d.id).map((e) => ({ id: e.id, codigo: e.codigo, nombre: nombreCompleto(e) })),
        })),
      }))
      .filter((s) => s.departamentos.some((d) => d.empleados.length));
    hojas.push({
      periodo,
      secciones,
      filas: deEsta.length,
      monto: (empleadoId, tipoId) => {
        const e = estados.get(`${empleadoId}|${tipoId}`);
        return e ? totalDeCelda(e) : null;
      },
      horas: (empleadoId, recargo) => (horasHoy ? horasEnCelda(horasHoy.fijadas.get(empleadoId), horasHoy.marcajes.get(empleadoId), recargo) || null : null),
    });
  }
  if (!hojas.length) {
    const cuales = b.frecuencias.length === 2 ? "quincenal ni en mensual" : b.frecuencias[0] === "QUINCENAL" ? "quincenal" : "mensual";
    return NextResponse.json({ error: `Nadie de ${grupo} cobra en planilla ${cuales}.` }, { status: 400 });
  }

  const archivo = await construirFormatoGrupo({
    grupo,
    etiquetaSucursal: conDivisiones ? et.division : et.sucursal,
    columnas,
    conHoras: b.horasExtra,
    hojas,
  });

  // Las columnas elegidas quedan como el formato de la empresa (el mismo que el de por sucursal).
  if (b.recordar && puede(g.usuario, "deducciones.configurar")) {
    const elegidas = new Set(columnas.map((t) => t.codigo));
    await guardarFormato(prisma, { columnas: columnas.map((t) => t.codigo), ocultas: tipos.map((t) => t.codigo).filter((c) => !elegidas.has(c)), horasExtra: b.horasExtra });
  }

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "EXPORT", tabla: "DeduccionEmpleado", registroId: `formato-grupo:${empleados.length}`,
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      formato: "captura por grupo", grupo,
      hojas: hojas.map((h) => ({ periodo: h.periodo, sucursales: h.secciones.length, filas: h.filas })),
      conMontos: b.conMontos, horasExtra: b.horasExtra, columnas: columnas.map((t) => t.codigo), incluyePII: true, alcance: g.usuario.alcance ?? "TODO",
    },
    ip, userAgent,
  });

  return new NextResponse(new Uint8Array(archivo), { headers: cabecerasXlsx(nombreArchivoGrupo(grupo, b.mes, b.quincena)) });
}
