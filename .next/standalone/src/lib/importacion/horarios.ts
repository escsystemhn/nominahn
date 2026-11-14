/**
 * Importar un plan de horarios rotativos desde Excel: una fila por empleado y día.
 *
 *   Codigo Empleado | DNI | Fecha | Sucursal | Turno | Entrada | Salida | Observacion
 *
 * «Turno» es el código de un turno del catálogo, «D» (descanso) o «A» (ausencia); en
 * blanco, la jornada sale de Entrada y Salida. «Sucursal» en blanco es la del empleado (o
 * la de su traslado de ese día); OTRA sucursal del plan para alguien de fuera del plan es
 * un traslado temporal, que se crea al aplicar (decisión de Edbin, 2026-11-14).
 *
 * Se valida todo antes de tocar nada: que el empleado y la sucursal existan y estén a su
 * alcance, que la fecha esté en el plan, que no haya dos filas para el mismo día, y que
 * no tenga ya turno ese día en otro plan publicado (cruce de turnos). Las reglas legales
 * (descanso entre jornadas, horas extra, víspera) las revisa el plan al aplicar, como
 * con cualquier cambio.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { jornadaDeHoras } from "@/lib/horarios/ley";
import { turnosCatalogo, trasladosDelPeriodo, aFecha, ymd, type TrasladoConNombres } from "@/lib/horarios/bd";
import { destinoEn, tramosSeguidos } from "@/lib/horarios/traslados";
import { formatDate } from "@/lib/utils";
import type { ColumnaCsv } from "./tipos";
import { clavesEsperadas } from "./columnas";
import { mapearColumnas, parsearCsv } from "./csv";
import * as v from "./valores";
import type { AccionFila, FilaPrevisualizada, Incidencia, ModoImportacion } from "./tipos";

export const COLUMNAS_HORARIOS: readonly ColumnaCsv[] = [
  { clave: "empleado_codigo", etiqueta: "Codigo Empleado", descripcion: "Código del empleado. Ponga el código o el DNI: con uno basta.", ejemplo: "SPS-018" },
  { clave: "identidad", etiqueta: "DNI", descripcion: "Número de identidad, 13 dígitos, con o sin guiones. Sirve en lugar del código.", sensible: true, ejemplo: "0501-1998-01234" },
  { clave: "empleado_nombre", etiqueta: "Empleado", descripcion: "Sólo informativo. Al importar se ignora.", soloLectura: true },
  { clave: "fecha", etiqueta: "Fecha", descripcion: "DD/MM/AAAA, dentro de las fechas del plan.", requerido: true, ejemplo: "02/11/2026" },
  { clave: "sucursal", etiqueta: "Sucursal", descripcion: "Nombre o código de la sucursal donde trabaja ese día. En blanco: la suya. Otra sucursal del plan = traslado temporal ese día.", ejemplo: "Sucursal Choloma" },
  { clave: "turno", etiqueta: "Turno", descripcion: "Código del turno (ver la hoja Instrucciones), D = descanso, A = ausencia. En blanco: use Entrada y Salida.", ejemplo: "TDA-M" },
  { clave: "entrada", etiqueta: "Entrada", descripcion: "HH:MM. Sólo si no usa un turno o para cambiar su hora.", ejemplo: "08:00" },
  { clave: "salida", etiqueta: "Salida", descripcion: "HH:MM. Si es menor que la entrada, termina al día siguiente.", ejemplo: "17:00" },
  { clave: "observacion", etiqueta: "Observacion", descripcion: "Motivo de una ausencia, o del traslado que crea la fila. Opcional.", ejemplo: "Apoyo por inventario" },
] as const;

type Estado = "TURNO" | "DESCANSO" | "AUSENCIA";

export interface DatosDia {
  estado: Estado;
  manual: true;
  turnoId: string | null;
  entrada: number | null;
  salida: number | null;
  pausa: number;
  sucursalId: string | null;
  esTraslado: boolean;
  motivo: string | null;
}

export interface FilaHorario {
  linea: number;
  accion: Exclude<AccionFila, "OMITIR">;
  planId: string;
  empleadoId: string;
  /** AAAA-MM-DD */
  fecha: string;
  datos: DatosDia;
  /** Sucursal del traslado temporal que hay que crear para este día, si no lo hay. */
  crearTrasladoA: string | null;
  /** La observación de la fila: el motivo del traslado que crea, si lo crea. */
  observacion?: string | null;
  referencia: string;
  cambios: string[];
}

interface EmpleadoRef {
  id: string;
  codigo: string;
  nombre: string;
  sucursalId: string;
  departamentoId: string;
  estado: string;
  conPuesto: boolean;
  fechaIngreso: string;
  fechaSalida: string | null;
}

interface TurnoRef {
  id: string;
  codigo: string;
  entrada: number;
  salida: number;
  pausa: number;
  almuerzoMinutos: number;
  almuerzoDesdeMin: number;
}

export interface CatalogosHorarios {
  plan: { id: string; nombre: string; estado: string; desde: string; hasta: string; sucursalesIds: string[] };
  empleados: Map<string, EmpleadoRef>;
  porIdentidad: Map<string, EmpleadoRef>;
  /** nombre o código de sucursal en minúsculas → { id, nombre } */
  sucursales: Map<string, { id: string; nombre: string }>;
  turnos: Map<string, TurnoRef>;
  /** `${empleadoId}|AAAA-MM-DD` → lo que tiene hoy en este plan */
  existentes: Map<string, { estado: string; turnoCodigo: string | null; sucursalId: string | null }>;
  /** `${empleadoId}|AAAA-MM-DD` → nombre del OTRO plan publicado donde ya tiene turno */
  enOtrosPlanes: Map<string, string>;
  traslados: TrasladoConNombres[];
}

export type ComprobadorAlcance = (e: { id: string; sucursalId: string; departamentoId: string }) => boolean;

const norm = (s: string) => s.trim().toLowerCase();
const soloDigitos = (s: string) => s.replace(/\D/g, "");
const hhmm = (min: number) => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const HORA = /^([01]?\d|2[0-3]):[0-5]\d$/;

export async function cargarCatalogos(db: PrismaClient, planId: string): Promise<CatalogosHorarios | null> {
  const plan = await db.planHorario.findUnique({ where: { id: planId }, select: { id: true, nombre: true, estado: true, desde: true, hasta: true, sucursalesIds: true } });
  if (!plan) return null;
  const [empleados, sucursales, turnosRaw, catalogo, existentes, otros, traslados] = await Promise.all([
    db.empleado.findMany({
      select: { id: true, codigo: true, identidad: true, primerNombre: true, primerApellido: true, sucursalId: true, departamentoId: true, estado: true, puestoId: true, fechaIngreso: true, fechaSalida: true },
    }),
    db.sucursal.findMany({ where: { activa: true }, select: { id: true, nombre: true, codigo: true } }),
    db.turno.findMany({ where: { activo: true }, select: { id: true, codigo: true, almuerzoMinutos: true, almuerzoDesdeHoras: true } }),
    turnosCatalogo(db),
    db.horarioDia.findMany({ where: { planId }, select: { empleadoId: true, fecha: true, estado: true, sucursalId: true, turno: { select: { codigo: true } } } }),
    db.horarioDia.findMany({
      where: { planId: { not: planId }, estado: "TURNO", fecha: { gte: plan.desde, lte: plan.hasta }, plan: { estado: "PUBLICADO" } },
      select: { empleadoId: true, fecha: true, plan: { select: { nombre: true } } },
    }),
    trasladosDelPeriodo(db, { desde: ymd(plan.desde), hasta: ymd(plan.hasta) }),
  ]);
  const catPorId = new Map(catalogo.map((t) => [t.id, t]));
  const refs = empleados.map((e) => ({
    identidad: e.identidad,
    ref: {
      id: e.id, codigo: e.codigo, nombre: `${e.primerNombre} ${e.primerApellido}`, sucursalId: e.sucursalId, departamentoId: e.departamentoId,
      estado: e.estado, conPuesto: e.puestoId !== null, fechaIngreso: ymd(e.fechaIngreso), fechaSalida: e.fechaSalida ? ymd(e.fechaSalida) : null,
    },
  }));
  const mapaSuc = new Map<string, { id: string; nombre: string }>();
  for (const s of sucursales) {
    mapaSuc.set(norm(s.nombre), { id: s.id, nombre: s.nombre });
    if (s.codigo) mapaSuc.set(norm(s.codigo), { id: s.id, nombre: s.nombre });
  }
  const turnos = new Map<string, TurnoRef>();
  for (const t of turnosRaw) {
    const c = catPorId.get(t.id);
    if (!c) continue;
    turnos.set(norm(t.codigo), {
      id: t.id, codigo: t.codigo, entrada: c.entrada, salida: c.salida, pausa: c.pausa,
      almuerzoMinutos: t.almuerzoMinutos, almuerzoDesdeMin: Number(t.almuerzoDesdeHoras) * 60,
    });
  }
  return {
    plan: { id: plan.id, nombre: plan.nombre, estado: plan.estado, desde: ymd(plan.desde), hasta: ymd(plan.hasta), sucursalesIds: plan.sucursalesIds },
    empleados: new Map(refs.map(({ ref }) => [norm(ref.codigo), ref])),
    porIdentidad: new Map(refs.filter((r) => r.identidad).map((r) => [soloDigitos(r.identidad!), r.ref])),
    sucursales: mapaSuc,
    turnos,
    existentes: new Map(existentes.map((d) => [`${d.empleadoId}|${ymd(d.fecha)}`, { estado: d.estado, turnoCodigo: d.turno?.codigo ?? null, sucursalId: d.sucursalId }])),
    enOtrosPlanes: new Map(otros.map((d) => [`${d.empleadoId}|${ymd(d.fecha)}`, d.plan.nombre])),
    traslados,
  };
}

export interface ResultadoValidacionHorarios {
  filas: FilaHorario[];
  incidencias: Incidencia[];
  previsualizacion: FilaPrevisualizada[];
  columnasDesconocidas: string[];
  totalOmitir: number;
}

export function validar(
  texto: string,
  cat: CatalogosHorarios,
  modo: ModoImportacion,
  alcanza: ComprobadorAlcance,
  sucursalPermitida: (sucursalId: string) => boolean = () => true
): ResultadoValidacionHorarios {
  const csv = parsearCsv(texto);
  const incidencias: Incidencia[] = [];
  const filas: FilaHorario[] = [];
  const previsualizacion: FilaPrevisualizada[] = [];
  let totalOmitir = 0;
  const vacio = (columnasDesconocidas: string[] = []) => ({ filas, incidencias, previsualizacion, columnasDesconocidas, totalOmitir });

  if (cat.plan.estado !== "BORRADOR") {
    incidencias.push({ linea: 1, severidad: "ERROR", mensaje: "El plan no está en borrador: vuélvalo a borrador para importarle horarios." });
    return vacio();
  }
  if (csv.cabeceras.length === 0) {
    incidencias.push({ linea: 1, severidad: "ERROR", mensaje: "El archivo está vacío." });
    return vacio();
  }
  const { indices, desconocidas } = mapearColumnas(csv.cabeceras, clavesEsperadas(COLUMNAS_HORARIOS));
  for (const d of desconocidas) incidencias.push({ linea: 1, columna: d, severidad: "AVISO", mensaje: "Columna no reconocida; se ignorará." });
  const tiene = (c: string) => indices[c] !== undefined;
  const celda = (fila: string[], c: string) => (tiene(c) ? fila[indices[c]] : undefined);
  if (!tiene("fecha")) incidencias.push({ linea: 1, severidad: "ERROR", mensaje: "Falta la columna «Fecha». Descargue la plantilla para ver el formato." });
  if (!tiene("empleado_codigo") && !tiene("identidad")) incidencias.push({ linea: 1, severidad: "ERROR", mensaje: "Falta la columna del empleado: «Codigo Empleado» o «DNI»." });
  if (!tiene("turno") && !(tiene("entrada") && tiene("salida"))) incidencias.push({ linea: 1, severidad: "ERROR", mensaje: "Falta la columna «Turno» (o «Entrada» y «Salida»)." });
  if (incidencias.some((i) => i.severidad === "ERROR")) return vacio(desconocidas);

  const vistas = new Map<string, number>();
  const nombreSuc = (id: string | null) => [...cat.sucursales.values()].find((s) => s.id === id)?.nombre ?? "";

  for (const { linea, celdas } of csv.filas) {
    const errores: Incidencia[] = [];
    const avisos: Incidencia[] = [];
    const anota = (columna: string | undefined, mensaje: string, sev: "ERROR" | "AVISO" = "ERROR") =>
      (sev === "ERROR" ? errores : avisos).push({ linea, columna, severidad: sev, mensaje });

    // ─── Empleado ───────────────────────────────────────────────────────────
    const codigo = (celda(celdas, "empleado_codigo") ?? "").trim();
    const dniBruto = (celda(celdas, "identidad") ?? "").trim();
    let emp = codigo ? cat.empleados.get(norm(codigo)) : undefined;
    let porDni: EmpleadoRef | undefined;
    if (dniBruto) {
      const r = v.identidad(dniBruto);
      if (!r.ok) anota("DNI", r.error);
      else if (!(porDni = cat.porIdentidad.get(r.valor))) anota("DNI", `No hay un empleado con DNI ${dniBruto}.`);
    }
    if (!codigo && !dniBruto) anota("Codigo Empleado", "Ponga el código o el DNI del empleado.");
    else if (codigo && !emp) anota("Codigo Empleado", `No existe un empleado con código "${codigo}".`);
    else if (emp && porDni && emp.id !== porDni.id) {
      anota("DNI", `El DNI es de ${porDni.codigo}, ${porDni.nombre}, no de ${emp.codigo}.`);
      emp = undefined;
    }
    emp = emp ?? porDni;
    if (emp && !alcanza(emp)) {
      anota(codigo ? "Codigo Empleado" : "DNI", "Este empleado está fuera de su alcance de datos.");
      emp = undefined;
    }

    // ─── Fecha ──────────────────────────────────────────────────────────────
    const rFecha = v.fecha(celda(celdas, "fecha"));
    if (!rFecha.ok) anota("Fecha", rFecha.error);
    const fecha = rFecha.ok ? ymd(rFecha.valor) : "";
    if (fecha && (fecha < cat.plan.desde || fecha > cat.plan.hasta)) {
      anota("Fecha", `Está fuera del plan (${formatDate(cat.plan.desde)} a ${formatDate(cat.plan.hasta)}).`);
    }

    // ─── Turno ──────────────────────────────────────────────────────────────
    const turnoBruto = (celda(celdas, "turno") ?? "").trim();
    const entradaBruta = (celda(celdas, "entrada") ?? "").trim();
    const salidaBruta = (celda(celdas, "salida") ?? "").trim();
    let estado: Estado = "TURNO";
    let turno: TurnoRef | undefined;
    if (/^(d|descanso)$/i.test(turnoBruto)) estado = "DESCANSO";
    else if (/^(a|aus|ausencia)$/i.test(turnoBruto)) estado = "AUSENCIA";
    else if (turnoBruto) {
      turno = cat.turnos.get(norm(turnoBruto));
      if (!turno) anota("Turno", `No hay un turno activo con código "${turnoBruto}". Use un código del catálogo, D o A.`);
    } else if (!entradaBruta || !salidaBruta) {
      anota("Turno", "Ponga el turno, D (descanso), A (ausencia) o la entrada y la salida.");
    }
    for (const [col, val] of [["Entrada", entradaBruta], ["Salida", salidaBruta]] as const) {
      if (val && !HORA.test(val)) anota(col, `"${val}" no es una hora HH:MM.`);
    }
    if (estado !== "TURNO" && (entradaBruta || salidaBruta)) anota("Turno", "Un descanso o una ausencia no lleva entrada ni salida.");
    if ((entradaBruta && !salidaBruta) || (!entradaBruta && salidaBruta)) anota("Entrada", "Ponga la entrada y la salida, o ninguna.");

    // ─── Sucursal ───────────────────────────────────────────────────────────
    const sucBruta = (celda(celdas, "sucursal") ?? "").trim();
    let sucursal: { id: string; nombre: string } | undefined;
    if (sucBruta) {
      sucursal = cat.sucursales.get(norm(sucBruta));
      if (!sucursal) anota("Sucursal", `No hay una sucursal activa llamada "${sucBruta}".`);
      else if (!cat.plan.sucursalesIds.includes(sucursal.id)) anota("Sucursal", `${sucursal.nombre} no está en este plan.`);
      else if (!sucursalPermitida(sucursal.id)) anota("Sucursal", `${sucursal.nombre} está fuera del alcance de su cuenta.`);
    }

    const observacion = (celda(celdas, "observacion") ?? "").trim().slice(0, 200) || null;

    if (!emp || !rFecha.ok || errores.length > 0) {
      incidencias.push(...errores, ...avisos);
      continue;
    }

    // ─── La persona ese día ─────────────────────────────────────────────────
    const referencia = `${emp.codigo}, ${emp.nombre}, ${formatDate(rFecha.valor)}`;
    if (emp.estado === "INACTIVO" || emp.estado === "SUSPENDIDO") anota("Codigo Empleado", `Está ${emp.estado === "INACTIVO" ? "inactivo" : "suspendido"}.`);
    if (!emp.conPuesto) anota("Codigo Empleado", "No tiene puesto: asígneselo en su ficha (el plan reparte por puesto).");
    if (fecha < emp.fechaIngreso) anota("Fecha", `Es anterior a su ingreso (${formatDate(emp.fechaIngreso)}).`);
    if (emp.fechaSalida && fecha > emp.fechaSalida) anota("Fecha", `Es posterior a su salida (${formatDate(emp.fechaSalida)}).`);

    const clave = `${emp.id}|${fecha}`;
    const repetida = vistas.get(clave);
    if (repetida !== undefined) anota(undefined, `Ya hay una fila para este empleado y día en la línea ${repetida}.`);
    else vistas.set(clave, linea);

    const propia = cat.plan.sucursalesIds.includes(emp.sucursalId);
    const destinoHoy = destinoEn(cat.traslados, emp.id, fecha);
    const destinoEnPlan = destinoHoy && cat.plan.sucursalesIds.includes(destinoHoy) ? destinoHoy : null;
    // Dónde trabaja: la indicada; si no, la del traslado de ese día; si no, la suya.
    const sucursalId = sucursal?.id ?? destinoEnPlan ?? (propia ? emp.sucursalId : null);
    let crearTrasladoA: string | null = null;

    if (!sucursalId) {
      anota("Sucursal", `${emp.nombre} no es de las sucursales de este plan: indique a cuál se traslada ese día.`);
    } else if (propia && destinoHoy && !cat.plan.sucursalesIds.includes(destinoHoy)) {
      const t = cat.traslados.find((x) => x.empleadoId === emp.id && x.sucursalDestinoId === destinoHoy);
      anota("Fecha", `Ese día está trasladado a ${t?.destinoNombre ?? "otra sucursal"}: no trabaja en este plan.`);
    } else if (!propia && destinoHoy && destinoHoy !== sucursalId) {
      const t = cat.traslados.find((x) => x.empleadoId === emp.id && x.sucursalDestinoId === destinoHoy);
      anota("Sucursal", `Ese día ya está trasladado a ${t?.destinoNombre ?? "otra sucursal"}.`);
    } else if (!propia && !destinoHoy) {
      // De fuera del plan y sin traslado ese día: el traslado se crea al aplicar.
      crearTrasladoA = sucursalId;
    }

    if (estado === "TURNO" && cat.enOtrosPlanes.has(clave)) {
      anota("Fecha", `Ya tiene turno ese día en el plan «${cat.enOtrosPlanes.get(clave)}», publicado: no puede estar en dos lugares a la vez.`);
    }

    // ─── La jornada ─────────────────────────────────────────────────────────
    let datos: DatosDia = { estado, manual: true, turnoId: null, entrada: null, salida: null, pausa: 0, sucursalId: null, esTraslado: false, motivo: estado === "TURNO" ? null : observacion };
    if (estado === "TURNO" && errores.length === 0 && sucursalId) {
      const e = entradaBruta || (turno ? hhmm(turno.entrada) : "");
      const s = salidaBruta || (turno ? hhmm(turno.salida) : "");
      const lapso = turno && !entradaBruta && !salidaBruta ? turno.salida - turno.entrada : null;
      const pausa = turno ? (lapso !== null ? turno.pausa : 0) : 0;
      const j = jornadaDeHoras(e, s, pausa);
      if (!j) anota("Entrada", "Horas inválidas.");
      else {
        // Con horas propias, el almuerzo es el del turno si el lapso lo alcanza.
        const pausaFinal = turno && (entradaBruta || salidaBruta) ? (j.salida - j.entrada >= turno.almuerzoDesdeMin ? turno.almuerzoMinutos : 0) : j.pausa;
        datos = { ...datos, turnoId: turno?.id ?? null, entrada: j.entrada, salida: j.salida, pausa: pausaFinal, sucursalId, esTraslado: sucursalId !== emp.sucursalId, motivo: null };
      }
    } else if (sucursalId) {
      datos = { ...datos, sucursalId: null };
    }

    // ─── Qué se hará ────────────────────────────────────────────────────────
    const antes = cat.existentes.get(clave);
    if (antes && modo === "CREAR") {
      totalOmitir++;
      incidencias.push(...avisos);
      previsualizacion.push({ linea, accion: "OMITIR", referencia, cambios: ["Ese día ya está en el plan y el modo es sólo altas."] });
      continue;
    }
    if (!antes && modo === "ACTUALIZAR") {
      totalOmitir++;
      incidencias.push(...avisos);
      previsualizacion.push({ linea, accion: "OMITIR", referencia, cambios: ["Ese día no está en el plan y el modo es sólo actualización."] });
      continue;
    }
    incidencias.push(...errores, ...avisos);
    if (errores.length > 0) continue;

    const que =
      estado === "DESCANSO" ? "Descanso" : estado === "AUSENCIA" ? `Ausencia${observacion ? ` (${observacion})` : ""}` : `${turno ? `Turno ${turno.codigo} ` : ""}${hhmm(datos.entrada!)}–${hhmm(datos.salida!)}${datos.sucursalId ? ` en ${nombreSuc(datos.sucursalId)}` : ""}`;
    const cambios = [que];
    if (crearTrasladoA) cambios.push(`Crea el traslado temporal desde ${nombreSuc(emp.sucursalId) || "su sucursal"}`);
    else if (!propia) cambios.push(`Trasladado desde ${nombreSuc(emp.sucursalId) || "otra sucursal"}`);
    else if (datos.esTraslado) cambios.push("Trabaja en otra sucursal del plan");
    if (antes) cambios.unshift(`Antes: ${antes.estado === "TURNO" ? `turno${antes.turnoCodigo ? ` ${antes.turnoCodigo}` : ""}` : antes.estado.toLowerCase()}`);

    const accion = antes ? "ACTUALIZAR" : "CREAR";
    filas.push({ linea, accion, planId: cat.plan.id, empleadoId: emp.id, fecha, datos, crearTrasladoA, observacion, referencia, cambios });
    previsualizacion.push({ linea, accion, referencia, cambios });
  }

  return { filas, incidencias, previsualizacion, columnasDesconocidas: desconocidas, totalOmitir };
}

export interface ResultadoAplicacionHorarios {
  creados: number;
  actualizados: number;
  traslados: number;
}

/** Escribe los días y crea los traslados que hagan falta, en una transacción. */
export async function aplicar(tx: Prisma.TransactionClient, filas: readonly FilaHorario[], creadoPor: string | null): Promise<ResultadoAplicacionHorarios> {
  let creados = 0;
  let actualizados = 0;
  for (const f of filas) {
    await tx.horarioDia.upsert({
      where: { planId_empleadoId_fecha: { planId: f.planId, empleadoId: f.empleadoId, fecha: aFecha(f.fecha) } },
      update: f.datos,
      create: { planId: f.planId, empleadoId: f.empleadoId, fecha: aFecha(f.fecha), ...f.datos },
    });
    if (f.accion === "CREAR") creados++;
    else actualizados++;
  }

  // Un traslado por tramo de días seguidos hacia la misma sucursal.
  const porDestino = new Map<string, { fecha: string; observacion: string | null }[]>();
  for (const f of filas) {
    if (!f.crearTrasladoA) continue;
    const k = `${f.empleadoId}|${f.crearTrasladoA}`;
    porDestino.set(k, [...(porDestino.get(k) ?? []), { fecha: f.fecha, observacion: f.observacion ?? null }]);
  }
  let traslados = 0;
  for (const [k, dias] of porDestino) {
    const [empleadoId, destino] = k.split("|");
    const emp = await tx.empleado.findUnique({ where: { id: empleadoId }, select: { sucursalId: true } });
    for (const tramo of tramosSeguidos(dias.map((d) => d.fecha))) {
      // El motivo: la primera observación de los días del tramo, o uno genérico.
      const motivo =
        dias
          .filter((d) => d.observacion && d.fecha >= tramo.desde && d.fecha <= tramo.hasta)
          .sort((x, y) => x.fecha.localeCompare(y.fecha))[0]?.observacion ?? "Importado con el plan de horarios";
      await tx.trasladoTemporal.create({
        data: {
          empleadoId, sucursalOrigenId: emp!.sucursalId, sucursalDestinoId: destino,
          desde: aFecha(tramo.desde), hasta: aFecha(tramo.hasta), motivo, creadoPor,
        },
      });
      traslados++;
    }
  }
  return { creados, actualizados, traslados };
}
