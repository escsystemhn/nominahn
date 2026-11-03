/**
 * Validación y aplicación de una importación de horas extra.
 *
 * Una fila dice cuántas horas extra hizo una persona UN DÍA, y REEMPLAZA las que ese
 * día tuviera: subir dos veces el archivo no las duplica, y una columna en blanco
 * vale cero. Se guardan en el mismo `Marcaje` del que la planilla lee las horas, con
 * fuente PLANTILLA para que la siguiente sincronización del reloj no las pise.
 *
 * Sólo sirven si la planilla todavía puede pagarlas. Por eso se rechazan los días de
 * una planilla ya aprobada o pagada, y se avisa de los de una sin aprobar: leyó las
 * horas al calcularse, así que hay que recalcularla.
 */

import type { EstadoPlanilla, Prisma, PrismaClient } from "@prisma/client";
import { ESTADOS_OCUPAN_PERIODO } from "@/lib/payroll/estado-planilla";
import { MAX_ORDINARIA_MAS_EXTRA_H } from "@/lib/horarios/ley";
import { CERO, money, sumar, type Money } from "@/lib/payroll/money";
import { formatDate, hoyHN } from "@/lib/utils";
import { COLUMNAS_HORAS_EXTRA, clavesEsperadas } from "./columnas";
import { mapearColumnas, parsearCsv } from "./csv";
import * as v from "./valores";
import type { AccionFila, FilaPrevisualizada, Incidencia, ModoImportacion } from "./tipos";

/** Máximo de extras con la jornada ordinaria de 8 horas sin pasar del tope diario. */
const EXTRAS_CON_JORNADA_ORDINARIA = MAX_ORDINARIA_MAS_EXTRA_H - 8;

const COLUMNAS_HORAS = [
  { clave: "diurnas", etiqueta: "Extra 25%" },
  { clave: "mixtas", etiqueta: "Extra 50%" },
  { clave: "nocturnas", etiqueta: "Extra 75%" },
  { clave: "feriado", etiqueta: "Extra 100%" },
] as const;

type ClaveHoras = (typeof COLUMNAS_HORAS)[number]["clave"];

export interface FilaHorasExtra {
  linea: number;
  accion: Exclude<AccionFila, "OMITIR">;
  empleadoId: string;
  /** ISO, medianoche UTC. */
  fecha: string;
  diurnas: string;
  mixtas: string;
  nocturnas: string;
  feriado: string;
  /** `null` = conserva la que hubiera. */
  observacion: string | null;
  cambios: string[];
  referencia: string;
}

export interface ResultadoValidacion {
  filas: FilaHorasExtra[];
  incidencias: Incidencia[];
  previsualizacion: FilaPrevisualizada[];
  columnasDesconocidas: string[];
  totalOmitir: number;
}

export interface EmpleadoRef {
  id: string;
  codigo: string;
  nombre: string;
  sucursalId: string;
  departamentoId: string;
  estado: string;
  /** AAAA-MM-DD */
  fechaIngreso: string;
  /** AAAA-MM-DD */
  fechaSalida: string | null;
}

export interface MarcajeRef {
  diurnas: string;
  mixtas: string;
  nocturnas: string;
  feriado: string;
  esAusencia: boolean;
  fuente: string;
  observacion: string | null;
}

export interface PlanillaRef {
  /** AAAA-MM-DD */
  inicio: string;
  /** AAAA-MM-DD */
  fin: string;
  estado: string;
  /** Sólo cuenta si la persona está en ella: otra sucursal puede tener su propia planilla. */
  empleados: Set<string>;
}

export interface CatalogosHorasExtra {
  /** código de empleado normalizado → empleado */
  empleados: Map<string, EmpleadoRef>;
  /** `${empleadoId}|AAAA-MM-DD` → marcaje de ese día */
  marcajes: Map<string, MarcajeRef>;
  planillas: PlanillaRef[];
  /** AAAA-MM-DD, en Honduras */
  hoy: string;
}

export type ComprobadorAlcance = (e: { id: string; sucursalId: string; departamentoId: string }) => boolean;

const norm = (s: string) => s.trim().toLowerCase();
const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Las fechas válidas del archivo: sólo se consultan esos días. */
function fechasDelArchivo(texto: string): Date[] {
  const csv = parsearCsv(texto);
  const { indices } = mapearColumnas(csv.cabeceras, clavesEsperadas(COLUMNAS_HORAS_EXTRA));
  if (indices.fecha === undefined) return [];
  const unicas = new Map<string, Date>();
  for (const { celdas } of csv.filas) {
    const r = v.fecha(celdas[indices.fecha]);
    if (r.ok) unicas.set(dia(r.valor), r.valor);
  }
  return [...unicas.values()];
}

export async function cargarCatalogos(db: PrismaClient, texto: string): Promise<CatalogosHorasExtra> {
  const fechas = fechasDelArchivo(texto);
  const tiempos = fechas.map((f) => f.getTime());

  const [empleados, marcajes, planillas] = await Promise.all([
    db.empleado.findMany({
      select: {
        id: true, codigo: true, primerNombre: true, primerApellido: true, sucursalId: true, departamentoId: true,
        estado: true, fechaIngreso: true, fechaSalida: true,
      },
    }),
    fechas.length === 0
      ? Promise.resolve([])
      : db.marcaje.findMany({
          where: { fecha: { in: fechas } },
          select: {
            empleadoId: true, fecha: true, horasExtraDiurna: true, horasExtraMixta: true, horasExtraNocturna: true,
            horasFeriado: true, esAusencia: true, fuente: true, observacion: true,
          },
        }),
    fechas.length === 0
      ? Promise.resolve([])
      : db.planilla.findMany({
          where: {
            estado: { in: [...ESTADOS_OCUPAN_PERIODO] as EstadoPlanilla[] },
            fechaInicio: { lte: new Date(Math.max(...tiempos)) },
            fechaFin: { gte: new Date(Math.min(...tiempos)) },
          },
          select: { estado: true, fechaInicio: true, fechaFin: true, detalles: { select: { empleadoId: true } } },
        }),
  ]);

  return {
    empleados: new Map(
      empleados.map((e) => [
        norm(e.codigo),
        {
          id: e.id, codigo: e.codigo, nombre: `${e.primerNombre} ${e.primerApellido}`,
          sucursalId: e.sucursalId, departamentoId: e.departamentoId, estado: e.estado,
          fechaIngreso: dia(e.fechaIngreso), fechaSalida: e.fechaSalida ? dia(e.fechaSalida) : null,
        },
      ])
    ),
    marcajes: new Map(
      marcajes.map((m) => [
        `${m.empleadoId}|${dia(m.fecha)}`,
        {
          diurnas: m.horasExtraDiurna.toString(), mixtas: m.horasExtraMixta.toString(),
          nocturnas: m.horasExtraNocturna.toString(), feriado: m.horasFeriado.toString(),
          esAusencia: m.esAusencia, fuente: m.fuente, observacion: m.observacion,
        },
      ])
    ),
    planillas: planillas.map((p) => ({
      inicio: dia(p.fechaInicio), fin: dia(p.fechaFin), estado: p.estado,
      empleados: new Set(p.detalles.map((d) => d.empleadoId)),
    })),
    hoy: dia(hoyHN()),
  };
}

export function validar(
  texto: string,
  catalogos: CatalogosHorasExtra,
  modo: ModoImportacion,
  alcanza: ComprobadorAlcance
): ResultadoValidacion {
  const csv = parsearCsv(texto);
  const incidencias: Incidencia[] = [];
  const filas: FilaHorasExtra[] = [];
  const previsualizacion: FilaPrevisualizada[] = [];
  let totalOmitir = 0;

  if (csv.cabeceras.length === 0) {
    incidencias.push({ linea: 1, severidad: "ERROR", mensaje: "El archivo está vacío." });
    return { filas, incidencias, previsualizacion, columnasDesconocidas: [], totalOmitir };
  }

  const { indices, desconocidas } = mapearColumnas(csv.cabeceras, clavesEsperadas(COLUMNAS_HORAS_EXTRA));
  for (const desconocida of desconocidas) {
    incidencias.push({ linea: 1, columna: desconocida, severidad: "AVISO", mensaje: "Columna no reconocida; se ignorará." });
  }

  const tiene = (clave: string) => indices[clave] !== undefined;
  const celda = (fila: string[], clave: string) => (tiene(clave) ? fila[indices[clave]] : undefined);

  for (const clave of ["empleado_codigo", "fecha"]) {
    if (!tiene(clave)) {
      incidencias.push({ linea: 1, severidad: "ERROR", mensaje: `Falta la columna obligatoria "${clave}". Descargue la plantilla para ver el formato.` });
    }
  }
  if (!COLUMNAS_HORAS.some((c) => tiene(c.clave))) {
    incidencias.push({ linea: 1, severidad: "ERROR", mensaje: "El archivo no trae ninguna columna de horas. Descargue la plantilla para ver el formato." });
  }
  if (incidencias.some((i) => i.severidad === "ERROR")) {
    return { filas, incidencias, previsualizacion, columnasDesconocidas: desconocidas, totalOmitir };
  }

  /** Empleado y día ya vistos en ESTE archivo: dos filas para el mismo día se pisarían. */
  const vistas = new Map<string, number>();

  for (const { linea, celdas } of csv.filas) {
    const errores: Incidencia[] = [];
    const avisos: Incidencia[] = [];
    const anota = (columna: string | undefined, mensaje: string, sev: "ERROR" | "AVISO" = "ERROR") =>
      (sev === "ERROR" ? errores : avisos).push({ linea, columna, severidad: sev, mensaje });

    // ─── Empleado ───────────────────────────────────────────────────────────
    const codigo = (celda(celdas, "empleado_codigo") ?? "").trim();
    let empleado = codigo ? catalogos.empleados.get(norm(codigo)) : undefined;
    if (!codigo) {
      anota("Codigo Empleado", "Es obligatorio.");
    } else if (!empleado) {
      anota("Codigo Empleado", `No existe un empleado con código "${codigo}".`);
    } else if (!alcanza(empleado)) {
      anota("Codigo Empleado", "Este empleado está fuera de su alcance de datos.");
      empleado = undefined;
    }

    // ─── Fecha ──────────────────────────────────────────────────────────────
    const rFecha = v.fecha(celda(celdas, "fecha"));
    if (!rFecha.ok) anota("Fecha", rFecha.error);

    // ─── Horas ──────────────────────────────────────────────────────────────
    const horas: Record<ClaveHoras, Money> = { diurnas: CERO, mixtas: CERO, nocturnas: CERO, feriado: CERO };
    let conValor = 0;
    let horasValidas = true;
    for (const { clave, etiqueta } of COLUMNAS_HORAS) {
      const bruto = celda(celdas, clave);
      if (v.vacia(bruto)) continue;
      conValor++;
      const r = v.decimal(bruto, { min: 0, max: 24 });
      if (r.ok) horas[clave] = r.valor;
      else {
        anota(etiqueta, r.error);
        horasValidas = false;
      }
    }
    if (conValor === 0) {
      anota(undefined, "No indica horas. Ponga las de ese día, o 0 para borrar las que tenga.");
      horasValidas = false;
    }

    let observacion: string | null = null;
    if (tiene("observacion") && !v.vacia(celda(celdas, "observacion"))) {
      const r = v.texto(celda(celdas, "observacion"), 500);
      if (!r.ok) anota("Observacion", r.error);
      else observacion = r.valor || null;
    }

    if (!empleado || !rFecha.ok || !horasValidas) {
      incidencias.push(...errores, ...avisos);
      continue;
    }

    const fecha = dia(rFecha.valor);
    const clave = `${empleado.id}|${fecha}`;
    const referencia = `${empleado.codigo} · ${empleado.nombre} · ${formatDate(rFecha.valor)}`;

    const repetida = vistas.get(clave);
    if (repetida !== undefined) anota(undefined, `Ya hay una fila para este empleado y día en la línea ${repetida}.`);
    else vistas.set(clave, linea);

    // ─── ¿Se pueden pagar? ──────────────────────────────────────────────────
    if (fecha > catalogos.hoy) anota("Fecha", "Es una fecha futura: registre las horas cuando ya se hayan trabajado.");
    if (fecha < empleado.fechaIngreso) anota("Fecha", `Es anterior a su ingreso (${formatDate(empleado.fechaIngreso)}).`);
    if (empleado.fechaSalida && fecha > empleado.fechaSalida) anota("Fecha", `Es posterior a su salida (${formatDate(empleado.fechaSalida)}).`);

    if (empleado.estado === "SUSPENDIDO" || (empleado.estado === "INACTIVO" && !empleado.fechaSalida)) {
      anota("Codigo Empleado", `Está ${empleado.estado === "SUSPENDIDO" ? "suspendido" : "inactivo"}: no entra en planilla y estas horas no se pagarían.`);
    } else if (empleado.estado === "VACACIONES" || empleado.estado === "PERMISO") {
      anota("Codigo Empleado", `Hoy figura ${empleado.estado === "VACACIONES" ? "de vacaciones" : "con permiso"}: revise que estas horas sean de días trabajados.`, "AVISO");
    }

    const empleadoId = empleado.id;
    const planillas = catalogos.planillas.filter((p) => p.inicio <= fecha && fecha <= p.fin && p.empleados.has(empleadoId));
    const cerrada = planillas.find((p) => p.estado === "APROBADA" || p.estado === "PAGADA");
    if (cerrada) {
      anota("Fecha", `Este día ya está en una planilla ${cerrada.estado.toLowerCase()} (${formatDate(cerrada.inicio)} a ${formatDate(cerrada.fin)}): estas horas no se pagarían.`);
    } else if (planillas.length > 0) {
      anota(
        "Fecha",
        planillas.every((p) => p.estado === "BORRADOR")
          ? "Este día ya está en un borrador de planilla: pulse Recalcular en ese borrador para que se paguen."
          : "Este día ya está en una planilla calculada: vuélvala a borrador y pulse Recalcular para que se paguen.",
        "AVISO"
      );
    }

    // ─── Tope diario ────────────────────────────────────────────────────────
    const totalExtra = sumar(horas.diurnas, horas.mixtas, horas.nocturnas);
    if (totalExtra.greaterThan(MAX_ORDINARIA_MAS_EXTRA_H)) {
      anota(undefined, `Suman ${totalExtra.toFixed(2)} horas extra en un día. La ley pone el máximo en ${MAX_ORDINARIA_MAS_EXTRA_H} horas contando la jornada (Art. 332).`);
    } else if (totalExtra.greaterThan(EXTRAS_CON_JORNADA_ORDINARIA)) {
      anota(undefined, `Con una jornada de 8 horas, ${totalExtra.toFixed(2)} horas extra pasan del máximo de ${MAX_ORDINARIA_MAS_EXTRA_H} horas diarias (Art. 332).`, "AVISO");
    }

    // ─── Qué se hará ────────────────────────────────────────────────────────
    const existente = catalogos.marcajes.get(clave);
    const cambios: string[] = [];
    let accion: Exclude<AccionFila, "OMITIR">;

    if (existente) {
      if (modo === "CREAR") {
        totalOmitir++;
        incidencias.push(...avisos);
        previsualizacion.push({ linea, accion: "OMITIR", referencia, cambios: ["Ese día ya tiene marcaje y el modo es sólo alta."] });
        continue;
      }
      accion = "ACTUALIZAR";

      if (existente.esAusencia) anota("Fecha", "Ese día tiene una ausencia registrada. Corríjala en Asistencia antes de cargarle horas.");

      for (const { clave: c, etiqueta } of COLUMNAS_HORAS) {
        const antes = money(existente[c]);
        if (!antes.equals(horas[c])) cambios.push(`${etiqueta} ${antes.toFixed(2)} → ${horas[c].toFixed(2)}`);
      }
      if (observacion !== null && observacion !== existente.observacion) cambios.push("Observación");

      const teniaExtras = !sumar(existente.diurnas, existente.mixtas, existente.nocturnas, existente.feriado).isZero();
      if (cambios.length > 0 && teniaExtras && existente.fuente !== "PLANTILLA") {
        anota(undefined, `Reemplaza las horas que ya tenía ese día, registradas ${existente.fuente === "MANUAL" ? "a mano" : "por el reloj"}.`, "AVISO");
      }
    } else {
      if (modo === "ACTUALIZAR") {
        totalOmitir++;
        incidencias.push(...avisos);
        previsualizacion.push({ linea, accion: "OMITIR", referencia, cambios: ["Ese día no tiene marcaje y el modo es sólo actualización."] });
        continue;
      }
      if (COLUMNAS_HORAS.every((c) => horas[c.clave].isZero())) {
        totalOmitir++;
        incidencias.push(...errores, ...avisos);
        if (errores.length === 0) previsualizacion.push({ linea, accion: "OMITIR", referencia, cambios: ["Sin horas que registrar."] });
        continue;
      }
      accion = "CREAR";
    }

    incidencias.push(...errores, ...avisos);
    if (errores.length > 0) continue;

    if (accion === "ACTUALIZAR" && cambios.length === 0) {
      totalOmitir++;
      previsualizacion.push({ linea, accion: "OMITIR", referencia, cambios: ["Sin cambios respecto a lo registrado."] });
      continue;
    }

    filas.push({
      linea,
      accion,
      empleadoId,
      fecha: rFecha.valor.toISOString(),
      diurnas: horas.diurnas.toFixed(2),
      mixtas: horas.mixtas.toFixed(2),
      nocturnas: horas.nocturnas.toFixed(2),
      feriado: horas.feriado.toFixed(2),
      observacion,
      cambios,
      referencia,
    });
    previsualizacion.push({ linea, accion, referencia, cambios });
  }

  return { filas, incidencias, previsualizacion, columnasDesconocidas: desconocidas, totalOmitir };
}

export interface ResultadoAplicacion {
  creados: number;
  actualizados: number;
  ids: string[];
}

export async function aplicar(tx: Prisma.TransactionClient, filas: FilaHorasExtra[]): Promise<ResultadoAplicacion> {
  let creados = 0;
  let actualizados = 0;
  const ids: string[] = [];

  for (const fila of filas) {
    const horas = {
      // `horasExtra` debe ser la suma del desglose (ver el modelo Marcaje).
      horasExtra: sumar(fila.diurnas, fila.mixtas, fila.nocturnas),
      horasExtraDiurna: fila.diurnas,
      horasExtraMixta: fila.mixtas,
      horasExtraNocturna: fila.nocturnas,
      horasFeriado: fila.feriado,
      fuente: "PLANTILLA",
    };
    const fecha = new Date(fila.fecha);
    const marcaje = await tx.marcaje.upsert({
      where: { empleadoId_fecha: { empleadoId: fila.empleadoId, fecha } },
      create: { ...horas, empleadoId: fila.empleadoId, fecha, observacion: fila.observacion },
      update: { ...horas, ...(fila.observacion !== null ? { observacion: fila.observacion } : {}) },
      select: { id: true },
    });
    if (fila.accion === "CREAR") creados++;
    else actualizados++;
    ids.push(marcaje.id);
  }

  return { creados, actualizados, ids };
}
