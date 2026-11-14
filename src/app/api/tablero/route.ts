/**
 * GET /api/tablero — el tablero ejecutivo de Talento Humano.
 *
 *   ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&sucursalId=…&departamentoId=…
 *   &formato=xlsx|pdf  → el resumen para descargar (una hoja por tema)
 *
 * Por omisión, del primero del mes a hoy. Todo dentro del alcance de quien lo pide.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { filtroSucursales } from "@/lib/auth/alcance";
import { calcularTablero, type Tablero } from "@/lib/dashboard/indicadores-bd";
import { aPdf, aXlsx, type ReporteTabla } from "@/lib/reportes/salida";
import type { HojaReporte } from "@/lib/reportes/salida-celdas";
import { fechaCalendario, formatCurrency, formatDate, hoyHN } from "@/lib/utils";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DOS_ANIOS = 731 * 86_400_000;

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("reportes.ver");
  if (!g.ok) return g.response;
  const sp = new URL(req.url).searchParams;
  const hoy = hoyHN();
  const desde = FECHA.test(sp.get("desde") ?? "") ? fechaCalendario(sp.get("desde")!) : new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
  const hasta = FECHA.test(sp.get("hasta") ?? "") ? fechaCalendario(sp.get("hasta")!) : hoy;
  if (hasta < desde) return NextResponse.json({ error: "La fecha final es anterior a la inicial." }, { status: 400 });
  if (hasta.getTime() - desde.getTime() > DOS_ANIOS) return NextResponse.json({ error: "El rango puede ser de hasta dos años." }, { status: 400 });

  // Una sucursal fuera de su alcance responde como inexistente.
  const sucursalId = sp.get("sucursalId") || undefined;
  if (sucursalId && !(await prisma.sucursal.count({ where: { AND: [{ id: sucursalId }, filtroSucursales(g.usuario)] } }))) {
    return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 });
  }
  const t = await calcularTablero(g.usuario, { desde, hasta, sucursalId, departamentoId: sp.get("departamentoId") || undefined });

  const formato = sp.get("formato");
  if (formato !== "xlsx" && formato !== "pdf") return NextResponse.json(t, { headers: { "Cache-Control": "private, no-store" } });

  const reporte = aReporte(t, [
    `Del ${formatDate(desde)} al ${formatDate(hasta)}`,
    ...(sucursalId ? [`Sucursal: ${(await prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { nombre: true } }))?.nombre ?? ""}`] : []),
  ]);
  const nombre = `tablero_${t.filtro.desde}_${t.filtro.hasta}`;
  if (formato === "xlsx") {
    return new NextResponse(new Uint8Array(await aXlsx(reporte)), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${nombre}.xlsx"` },
    });
  }
  return new NextResponse(new Uint8Array(await aPdf(reporte)), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${nombre}.pdf"` },
  });
}

const L = (n: number) => formatCurrency(n);
const P = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("es-HN", { maximumFractionDigits: 1 })} %`);
const det = (n: number) => Array.from({ length: n }, () => ({ tipo: "detalle" as const, nivel: 0 }));
const hoja = (nombre: string, pestana: string, cabeceras: string[], datos: string[][]): HojaReporte => ({ nombre, pestana, cabeceras, datos, filas: det(datos.length), descripcion: " " });

function aReporte(t: Tablero, filtros: string[]): ReporteTabla {
  const resumen: string[][] = [
    ["Empleados activos", String(t.fuerza.activos)],
    ["Altas del período", String(t.fuerza.altas)],
    ["Bajas del período", String(t.fuerza.bajas)],
    ["Rotación", P(t.fuerza.rotacion)],
    ["Puntualidad", P(t.asistencia.puntualidad)],
    ["Ausentismo", P(t.asistencia.ausentismo)],
    ["Horas extra por cada 100 ordinarias", P(t.asistencia.extraSobreOrdinarias)],
    ["Promedio de evaluaciones", t.desempeno.promedio === null ? "—" : String(t.desempeno.promedio)],
    ["Asistencia a capacitaciones", P(t.capacitacion.asistencia)],
    ["Aprobación de capacitaciones", P(t.capacitacion.aprobados)],
    ["Costo de nómina del período", L(t.masa.actual.costo)],
    ["Costo del período anterior", L(t.masa.anterior.costo)],
    ["Variación", P(t.masa.variacionCosto)],
    ["Pasivo laboral: cesantía", L(t.pasivo.cesantia)],
    ["Pasivo laboral: décimos devengados", L(t.pasivo.decimosAcumulados)],
  ];
  const decimos = t.decimos.flatMap((d) =>
    d.porSucursal.map((s) => [d.tipo === "DECIMO_TERCERO" ? `13.º ${d.anio}` : `14.º ${d.anio}`, s.nombre, String(s.empleados), L(s.proyectado), L(s.adelantos), L(s.neto)])
  );
  const totDecimos = t.decimos.map((d) => [`TOTAL ${d.tipo === "DECIMO_TERCERO" ? "13.º" : "14.º"} ${d.anio}`, "", "", L(d.proyectado), L(d.adelantos), L(d.neto)]);
  const hojas = [
    hoja("Resumen", "Resumen", ["Indicador", "Valor"], resumen),
    hoja("Fuerza laboral por sucursal", "Sucursales", ["Sucursal", "Activos"], t.fuerza.porSucursal.map((s) => [s.nombre, String(s.activos)])),
    hoja("Altas y bajas por mes", "Altas y bajas", ["Mes", "Altas", "Bajas"], t.fuerza.porMes.map((m) => [m.mes, String(m.altas), String(m.bajas)])),
    hoja("Deducciones del período", "Deducciones", ["Concepto", "Monto"], t.masa.actual.deducciones.map((d) => [d.concepto, L(d.monto)])),
    hoja("Décimos: proyección y adelantos", "Décimos", ["Décimo", "Sucursal", "Empleados", "Proyectado", "Adelantos", "Neto a desembolsar"], [...decimos, ...totDecimos]),
  ];
  return {
    titulo: "Tablero ejecutivo de Talento Humano",
    cabeceras: hojas[0].cabeceras,
    datos: hojas[0].datos,
    generado: new Date(),
    filtros,
    hojas,
  };
}
