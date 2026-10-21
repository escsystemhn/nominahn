/**
 * Exportación de un plan de horarios: Excel (una hoja por sucursal, resumen,
 * alertas y cobertura), PDF (por sucursal y semana) y JSON (matriz, resumen y
 * alertas, para integrar con otros sistemas).
 */

import ExcelJS from "exceljs";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { pdfmakeListo } from "@/lib/reportes/salida";
import { horaDeMinutos, horas, ETIQUETA_EXTRA, type ClaseExtra } from "./ley";
import { fechaCorta, lunesDe, periodoTexto, rango } from "./fechas";
import type { DiaCalculado, EmpleadoPlan, ResultadoValidacion } from "./tipos";

export interface DatosExportacion {
  plan: { nombre: string; desde: string; hasta: string; estado: string };
  empleados: (EmpleadoPlan & { puestoNombre: string })[];
  sucursales: { id: string; nombre: string }[];
  turnos: { id: string; codigo: string; nombre: string }[];
  validacion: ResultadoValidacion;
  generado: Date;
}

const LETRA = { DIURNA: "D", MIXTA: "M", NOCTURNA: "N" } as const;
const COLOR: Record<string, string> = {
  APERTURA: "E0F2FE", INTERMEDIO: "DCFCE7", CIERRE: "E0E7FF", MEDIA: "FEF3C7", DESCANSO: "F1F5F9", AUSENCIA: "FCE7F3",
};
const TINTA = "0D2B38";

function preparar(d: DatosExportacion) {
  const nombreSuc = new Map(d.sucursales.map((s) => [s.id, s.nombre]));
  const porEmpleado = new Map<string, Map<string, DiaCalculado>>();
  for (const x of d.validacion.dias) {
    const m = porEmpleado.get(x.empleadoId) ?? new Map<string, DiaCalculado>();
    m.set(x.fecha, x);
    porEmpleado.set(x.empleadoId, m);
  }
  const resumen = new Map(d.validacion.resumen.map((r) => [r.empleadoId, r]));
  const fechas = rango(d.plan.desde, d.plan.hasta);
  const grupos = d.sucursales.map((s) => ({
    sucursal: s,
    empleados: d.empleados.filter((e) => e.sucursalId === s.id).sort((a, b) => a.puestoNombre.localeCompare(b.puestoNombre) || a.nombre.localeCompare(b.nombre)),
  }));
  const texto = (x: DiaCalculado | undefined, base: string): string => {
    if (!x) return "";
    if (x.estado === "AUSENCIA") return x.motivo ?? "Ausencia";
    if (x.estado === "DESCANSO") return x.motivo ? (x.motivo.startsWith("Descanso adicional") ? "Descanso adicional" : x.motivo) : "Descanso";
    let t = `${horaDeMinutos(x.entrada!)}–${horaDeMinutos(x.salida!)} ${x.tipo ? LETRA[x.tipo] : ""}`;
    if (x.pausa) t += `, ${x.pausa}′`;
    if (x.esTraslado && x.sucursalId && x.sucursalId !== base) t += ` → ${nombreSuc.get(x.sucursalId) ?? ""}`;
    if (x.extraTotalMin > 0) t += `, +${horas(x.extraTotalMin)} h extra`;
    return t;
  };
  const clase = (x: DiaCalculado | undefined) => (!x ? "" : x.estado === "TURNO" ? x.categoria ?? "" : x.estado);
  return { nombreSuc, porEmpleado, resumen, fechas, grupos, texto, clase };
}

// ─── JSON ─────────────────────────────────────────────────────────────────────

export function aJson(d: DatosExportacion) {
  const { porEmpleado, resumen, fechas, grupos, nombreSuc } = preparar(d);
  return {
    plan: d.plan,
    generado: d.generado.toISOString(),
    sucursales: grupos.map((g) => ({
      sucursal: g.sucursal.nombre,
      empleados: g.empleados.map((e) => ({
        codigo: e.codigo,
        nombre: e.nombre,
        rol: e.puestoNombre,
        dias: fechas.map((f) => {
          const x = porEmpleado.get(e.id)?.get(f);
          return {
            fecha: f,
            estado: x?.estado === "TURNO" ? "Turno asignado" : x?.estado === "DESCANSO" ? "Día de descanso" : x?.estado === "AUSENCIA" ? "Ausencia" : null,
            entrada: x?.entrada != null ? horaDeMinutos(x.entrada) : null,
            salida: x?.salida != null ? horaDeMinutos(x.salida) : null,
            terminaDiaSiguiente: (x?.salida ?? 0) > 1440,
            almuerzoMinutos: x?.estado === "TURNO" ? x.pausa : null,
            tipoJornada: x?.tipo ? x.tipo.charAt(0) + x.tipo.slice(1).toLowerCase() : null,
            horasOrdinarias: x?.estado === "TURNO" ? horas(x.ordinariosMin) : 0,
            horasExtra: x?.estado === "TURNO" ? horas(x.extraTotalMin) : 0,
            sucursal: x?.sucursalId ? nombreSuc.get(x.sucursalId) ?? null : null,
            traslado: x?.esTraslado ?? false,
            motivo: x?.motivo ?? null,
          };
        }),
      })),
    })),
    resumen: d.empleados.map((e) => {
      const r = resumen.get(e.id);
      return {
        codigo: e.codigo, nombre: e.nombre, rol: e.puestoNombre,
        horasOrdinarias: r?.ordinariasH ?? 0, horasExtra: r?.extraH ?? 0,
        horasExtraPorRecargo: r ? (Object.keys(r.extraPorClaseH) as ClaseExtra[]).map((k) => ({ clase: ETIQUETA_EXTRA[k], horas: r.extraPorClaseH[k] })) : [],
        maxDiasConsecutivos: r?.maxConsecutivos ?? 0, descansos: r?.descansos ?? 0, descansosFinDeSemana: r?.descansosFinDeSemana ?? 0,
        aperturas: r?.aperturas ?? 0, cierres: r?.cierres ?? 0, traslados: r?.traslados ?? 0,
        semanas: r?.semanas ?? [],
      };
    }),
    alertas: d.validacion.alertas,
    faltantes: d.validacion.faltantes.map((f) => ({
      sucursal: nombreSuc.get(f.sucursalId) ?? f.sucursalId, puestoId: f.puestoId, fecha: f.fecha,
      desde: horaDeMinutos(f.desde), hasta: horaDeMinutos(f.hasta), requeridos: f.requeridos, programados: f.programados,
    })),
  };
}

// ─── Excel ────────────────────────────────────────────────────────────────────

export async function aXlsxPlan(d: DatosExportacion): Promise<Buffer> {
  const { porEmpleado, resumen, fechas, grupos, texto, clase, nombreSuc } = preparar(d);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Gestión360 Nómina";
  wb.created = d.generado;
  const relleno = (c: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: `FF${c}` } });
  const titulo = (ws: ExcelJS.Worksheet, t: string, ncol: number) => {
    ws.mergeCells(1, 1, 1, ncol);
    ws.getCell(1, 1).value = t;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: `FF${TINTA}` } };
    ws.mergeCells(2, 1, 2, ncol);
    ws.getCell(2, 1).value = `${d.plan.nombre}. Del ${periodoTexto(d.plan.desde, d.plan.hasta)}, ${d.plan.estado.toLowerCase()}. D diurna, M mixta, N nocturna.`;
    ws.getCell(2, 1).font = { size: 9, color: { argb: "FF637580" } };
  };
  const cabecera = (fila: ExcelJS.Row) => {
    fila.font = { bold: true, color: { argb: "FFFFFFFF" } };
    fila.eachCell((c) => { c.fill = relleno(TINTA); c.alignment = { vertical: "middle", wrapText: true }; });
  };

  for (const g of grupos) {
    const ws = wb.addWorksheet(g.sucursal.nombre.slice(0, 31).replace(/[\\/*?:[\]]/g, " "), { views: [{ state: "frozen", xSplit: 3, ySplit: 4 }] });
    const cab = ["Código", "Nombre", "Puesto", ...fechas.map(fechaCorta), "Horas ord.", "Extra", "Descansos"];
    titulo(ws, `Horario de ${g.sucursal.nombre}`, cab.length);
    const fila = ws.getRow(4);
    fila.values = cab;
    cabecera(fila);
    for (const e of g.empleados) {
      const dias = fechas.map((f) => porEmpleado.get(e.id)?.get(f));
      const r = resumen.get(e.id);
      const row = ws.addRow([e.codigo, e.nombre, e.puestoNombre, ...dias.map((x) => texto(x, e.sucursalId)), r?.ordinariasH ?? 0, r?.extraH ?? 0, r?.descansos ?? 0]);
      dias.forEach((x, i) => {
        const c = COLOR[clase(x)];
        if (c) row.getCell(4 + i).fill = relleno(c);
        row.getCell(4 + i).alignment = { wrapText: true, vertical: "top" };
        row.getCell(4 + i).font = { size: 9, bold: (x?.extraTotalMin ?? 0) > 0 };
      });
    }
    ws.getColumn(1).width = 10;
    ws.getColumn(2).width = 26;
    ws.getColumn(3).width = 16;
    for (let i = 0; i < fechas.length; i++) ws.getColumn(4 + i).width = 15;
  }

  const wr = wb.addWorksheet("Resumen");
  const cabR = ["Código", "Nombre", "Puesto", "Sucursal", "Días trabajados", "Horas ordinarias", "Horas extra", "Extra +25 %", "Extra +50 %", "Extra +75 %", "Máx. días seguidos", "Descansos", "Fines de semana libres", "Aperturas", "Cierres", "Traslados"];
  titulo(wr, "Resumen por persona", cabR.length);
  wr.getRow(4).values = cabR;
  cabecera(wr.getRow(4));
  for (const e of d.empleados) {
    const r = resumen.get(e.id);
    if (!r) continue;
    const row = wr.addRow([e.codigo, e.nombre, e.puestoNombre, nombreSuc.get(e.sucursalId) ?? "", r.diasTrabajados, r.ordinariasH, r.extraH,
      r.extraPorClaseH.DIURNA_25, r.extraPorClaseH.NOCTURNA_50, r.extraPorClaseH.PROLONGACION_NOCTURNA_75, r.maxConsecutivos, r.descansos,
      r.descansosFinDeSemana, r.aperturas, r.cierres, r.traslados]);
    if (r.extraH > 0) row.getCell(7).font = { bold: true, color: { argb: "FFB45309" } };
    if (r.maxConsecutivos > 6) row.getCell(11).font = { bold: true, color: { argb: "FFB91C1C" } };
  }
  wr.columns.forEach((c, i) => { c.width = i === 1 ? 26 : i < 4 ? 14 : 12; });

  const wa = wb.addWorksheet("Alertas");
  titulo(wa, "Alertas de cumplimiento legal y operativo", 5);
  wa.getRow(4).values = ["Nivel", "Tipo", "Artículo", "Fecha", "Detalle"];
  cabecera(wa.getRow(4));
  for (const a of d.validacion.alertas) {
    const row = wa.addRow([a.nivel, a.tipo === "LEGAL" ? "Legal" : "Operativa", a.articulo ?? "", a.fecha ?? "", a.mensaje]);
    row.getCell(1).font = { bold: true, color: { argb: a.nivel === "ERROR" ? "FFB91C1C" : a.nivel === "AVISO" ? "FFB45309" : "FF475569" } };
  }
  wa.getColumn(5).width = 110;
  wa.getColumn(3).width = 16;
  wa.getColumn(4).width = 12;

  const wf = wb.addWorksheet("Cobertura");
  titulo(wf, "Franjas por debajo del mínimo", 7);
  wf.getRow(4).values = ["Sucursal", "Puesto", "Fecha", "Desde", "Hasta", "Requeridos", "Programados"];
  cabecera(wf.getRow(4));
  for (const f of d.validacion.faltantes) {
    const puesto = d.empleados.find((e) => e.puestoId === f.puestoId)?.puestoNombre ?? f.puestoId;
    wf.addRow([nombreSuc.get(f.sucursalId) ?? "", puesto, f.fecha, horaDeMinutos(f.desde), horaDeMinutos(f.hasta), f.requeridos, f.programados]);
  }
  wf.columns.forEach((c) => { c.width = 16; });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export async function aPdfPlan(d: DatosExportacion): Promise<Buffer> {
  const pdf = pdfmakeListo();
  const { porEmpleado, fechas, grupos, texto, clase } = preparar(d);
  const semanas = [...new Set(fechas.map(lunesDe))];
  const contenido: Content[] = [];
  const meta = `Del ${periodoTexto(d.plan.desde, d.plan.hasta)}, ${d.plan.estado.toLowerCase()}. D diurna, M mixta, N nocturna. Generado el ${d.generado.toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })}`;

  grupos.forEach((g, gi) => {
    semanas.forEach((lunes, si) => {
      const diasSemana = fechas.filter((f) => lunesDe(f) === lunes);
      const encabezado: TableCell[] = ["Persona", ...diasSemana.map(fechaCorta), "Horas"].map((t) => ({
        text: t, bold: true, color: "#FFFFFF", fillColor: `#${TINTA}`, fontSize: 7.5, margin: [3, 3, 3, 3],
      }));
      const cuerpo: TableCell[][] = g.empleados.map((e) => {
        const dias = diasSemana.map((f) => porEmpleado.get(e.id)?.get(f));
        const ord = dias.reduce((s, x) => s + (x?.estado === "TURNO" ? x.ordinariosMin : 0), 0);
        const extra = dias.reduce((s, x) => s + (x?.estado === "TURNO" ? x.extraTotalMin : 0), 0);
        return [
          { text: [{ text: `${e.nombre}\n`, bold: true }, { text: e.puestoNombre, color: "#637580" }], fontSize: 7, margin: [3, 2, 3, 2] },
          ...dias.map((x) => ({ text: texto(x, e.sucursalId), fontSize: 6.5, fillColor: COLOR[clase(x)] ? `#${COLOR[clase(x)]}` : undefined, bold: (x?.extraTotalMin ?? 0) > 0, margin: [2, 2, 2, 2] as [number, number, number, number] })),
          { text: `${horas(ord)}${extra ? `\n+${horas(extra)} extra` : ""}`, fontSize: 7, alignment: "right" as const, margin: [2, 2, 3, 2] },
        ];
      });
      contenido.push({
        stack: [
          { text: `${g.sucursal.nombre}, semana del ${fechaCorta(lunes)}`, fontSize: 12, bold: true, color: `#${TINTA}` },
          { text: meta, fontSize: 7, color: "#637580", margin: [0, 1, 0, 6] },
          g.empleados.length
            ? { table: { headerRows: 1, widths: [90, ...diasSemana.map(() => "*"), 38], body: [encabezado, ...cuerpo] }, layout: { hLineWidth: () => 0.4, vLineWidth: () => 0.4, hLineColor: () => "#DCE3E7", vLineColor: () => "#DCE3E7" } }
            : { text: "Sin personal programado.", fontSize: 8, italics: true },
        ],
        pageBreak: gi === 0 && si === 0 ? undefined : "before",
      });
    });
  });

  const alertas = d.validacion.alertas.filter((a) => a.nivel !== "INFO");
  contenido.push({
    stack: [
      { text: "Alertas de cumplimiento", fontSize: 12, bold: true, color: `#${TINTA}`, margin: [0, 0, 0, 6] },
      alertas.length
        ? { ul: alertas.slice(0, 400).map((a) => ({ text: `${a.nivel === "ERROR" ? "ERROR" : "Aviso"}${a.articulo ? ` (${a.articulo})` : ""}: ${a.mensaje}`, fontSize: 7.5, color: a.nivel === "ERROR" ? "#B91C1C" : "#142129" })) }
        : { text: "Sin incumplimientos ni faltantes.", fontSize: 9 },
    ],
    pageBreak: "before",
  });

  const definicion: TDocumentDefinitions = {
    pageSize: "LETTER",
    pageOrientation: "landscape",
    pageMargins: [28, 28, 28, 34],
    defaultStyle: { font: "Helvetica", fontSize: 8, color: "#142129" },
    info: { title: d.plan.nombre, author: "Gestión360 Nómina", creator: "Gestión360 Nómina" },
    content: contenido,
    footer: (pagina: number, total: number) => ({
      columns: [
        { text: d.plan.nombre, fontSize: 7, color: "#637580", margin: [28, 10, 0, 0] },
        { text: `Página ${pagina} de ${total}`, fontSize: 7, color: "#637580", alignment: "right", margin: [0, 10, 28, 0] },
      ],
    }),
  };
  return pdf.createPdf(definicion).getBuffer();
}
