/**
 * Plantilla de importación de horarios rotativos y exportación de un plan en el mismo
 * formato (una fila por empleado y día): se puede bajar, corregir en Excel y volver a subir.
 *
 *   ?plantilla=1[&planId=…][&formato=xlsx]  → la plantilla; con plan, ya trae su gente y sus días
 *   ?planId=…[&formato=xlsx]                → los días del plan
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puede, requerirPermiso } from "@/lib/auth/guard";
import { filtroPorEmpleado } from "@/lib/auth/alcance";
import { vistaDePlan } from "@/lib/horarios/alcance";
import { turnosCatalogo, ymd } from "@/lib/horarios/bd";
import { generarCsv, cabecerasDescarga, delimitadorPedido } from "@/lib/importacion/csv";
import { columnasVisibles, etiquetas } from "@/lib/importacion/columnas";
import { COLUMNAS_HORARIOS } from "@/lib/importacion/horarios";
import { cabecerasXlsx, plantillaXlsx } from "@/lib/importacion/xlsx";
import { formatDate, nombreCompleto } from "@/lib/utils";

const hhmm = (min: number | null) => (min === null ? "" : `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);

export async function GET(req: NextRequest) {
  const g = await requerirPermiso(["asistencia.turnos", "asistencia.ver"]);
  if (!g.ok) return g.response;
  const sp = new URL(req.url).searchParams;
  const xlsx = sp.get("formato") === "xlsx";
  const planId = sp.get("planId");
  const columnas = columnasVisibles(COLUMNAS_HORARIOS, puede(g.usuario, "empleados.pii"));
  const paraLlenar = columnas.filter((c) => !c.soloLectura);

  const turnos = await turnosCatalogo(prisma);
  const notas = [
    "Una fila por empleado y día. No cambie los nombres de las columnas.",
    "Turno: el código del turno, D = descanso, A = ausencia (ponga el motivo en Observacion). En blanco, use Entrada y Salida (HH:MM).",
    "Sucursal en blanco: la del empleado. Otra sucursal del plan para alguien de otra sucursal crea su traslado temporal ese día.",
    `Turnos: ${turnos.map((t) => `${t.codigo} (${hhmm(t.entrada)}–${hhmm(t.salida)})`).join(", ") || "todavía no hay turnos activos"}.`,
  ];

  let filas: string[][] = [];
  let nombre = "plantilla_horarios";
  if (planId) {
    const vista = await vistaDePlan(prisma, g.usuario, planId);
    const plan = vista.acceso === "ninguno" ? null : await prisma.planHorario.findUnique({ where: { id: planId }, select: { nombre: true, desde: true } });
    if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
    const dias = await prisma.horarioDia.findMany({
      where: { AND: [{ planId }, filtroPorEmpleado(g.usuario)] },
      select: {
        fecha: true, estado: true, entrada: true, salida: true, motivo: true, turnoId: true,
        turno: { select: { codigo: true } },
        empleado: { select: { codigo: true, identidad: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, sucursalId: true } },
        sucursalId: true,
      },
      orderBy: [{ empleado: { primerApellido: "asc" } }, { fecha: "asc" }],
    });
    const sucursales = new Map((await prisma.sucursal.findMany({ select: { id: true, nombre: true } })).map((s) => [s.id, s.nombre]));
    const valor: Record<string, (d: (typeof dias)[number]) => string> = {
      empleado_codigo: (d) => d.empleado.codigo,
      identidad: (d) => d.empleado.identidad ?? "",
      empleado_nombre: (d) => nombreCompleto(d.empleado),
      fecha: (d) => formatDate(d.fecha),
      sucursal: (d) => (d.estado === "TURNO" && d.sucursalId && d.sucursalId !== d.empleado.sucursalId ? sucursales.get(d.sucursalId) ?? "" : ""),
      turno: (d) => (d.estado === "DESCANSO" ? "D" : d.estado === "AUSENCIA" ? "A" : d.turno?.codigo ?? ""),
      // Con turno del catálogo basta el código; sin él, las horas.
      entrada: (d) => (d.estado === "TURNO" && !d.turnoId ? hhmm(d.entrada) : ""),
      salida: (d) => (d.estado === "TURNO" && !d.turnoId ? hhmm(d.salida) : ""),
      observacion: (d) => (d.estado === "AUSENCIA" ? d.motivo ?? "" : ""),
    };
    filas = dias.map((d) => columnas.map((c) => valor[c.clave]?.(d) ?? ""));
    nombre = `horarios_${plan.nombre.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}_${ymd(plan.desde)}`;
  }

  if (xlsx) {
    // Con filas, la plantilla lleva también la columna informativa del nombre.
    const cols = filas.length ? columnas : paraLlenar;
    return new NextResponse(new Uint8Array(await plantillaXlsx(cols, filas, { notas, fijarColumnas: 2 })), { headers: cabecerasXlsx(`${nombre}.xlsx`) });
  }
  const cols = filas.length ? columnas : paraLlenar;
  return new NextResponse(generarCsv(etiquetas(cols), filas, delimitadorPedido(sp.get("delimitador"))), { headers: cabecerasDescarga(`${nombre}.csv`) });
}
