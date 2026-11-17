/**
 * Motor de deducciones por asistencia. PURO: no lee la base ni el reloj. Recibe el perfil
 * de la persona, la política (ver `politica.ts`, con su base legal), el período y sus
 * incidencias, y devuelve qué descontar —en tiempo y en Lempiras—, la bitácora de cada
 * regla aplicada y las alertas legales.
 *
 * Orden de cada llegada tarde: compensación → umbral de ausencia → tolerancia → redondeo →
 * protección (nunca más que el tiempo no trabajado, salvo que la política lo permita
 * dejando una alerta). Las salidas anticipadas siguen el mismo camino sin compensación ni
 * umbral. Las ausencias se descuentan por día y, si son injustificadas, pueden costar el
 * séptimo: uno por semana (lunes a domingo) como máximo.
 *
 * Todo lo que se descuenta aquí es salario NO devengado (`reduceSalarioDevengado`). No
 * es una «deducción» en el sentido de los Arts. 371-372 (embargo y deudas): no compite
 * con los préstamos por la cuarta parte. OJO: la marca es informativa; la planilla
 * (`calculos-hn.ts`) sigue calculando IHSS, RAP e ISR sobre el salario mensual completo,
 * como antes de este motor. Bajar esas bases es una decisión aparte.
 *
 * `minutosRepuestos`: en esta aplicación las horas de una marca se reparten por TOTAL
 * trabajado (`repartirJornada`): quien llega tarde y se queda después completa su jornada
 * y ese tiempo no se le paga como extra. Descontarle la tardanza sería cobrarle tiempo
 * trabajado; por eso lo repuesto se resta siempre, antes que cualquier regla.
 */

import { money, redondear, sumar, type Money, type MoneyInput } from "@/lib/payroll/money";
import { HORAS_JORNADA_LEGAL, type FrecuenciaPago, type PoliticaAsistencia, type ReglaTiempo } from "./politica";

// ─── Entrada ─────────────────────────────────────────────────────────────────────

export type Jornada = { tipo: "DIURNA" | "NOCTURNA" | "MIXTA" } | { tipo: "PERSONALIZADA"; horasDiarias: number };

export interface PerfilEmpleado {
  salarioMensual: MoneyInput;
  frecuencia: FrecuenciaPago;
  /** Define el valor hora: salario diario ÷ horas de la jornada. */
  jornada: Jornada;
  /** Horas programadas por día ISO (1 = lunes … 7 = domingo). Un día ausente o en 0 es de descanso. */
  horario: Partial<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, number>>;
}

export type ClasificacionAusencia = "INJUSTIFICADA" | "CON_GOCE" | "SIN_GOCE" | "INCAPACIDAD";

export type Incidencia =
  | {
      tipo: "TARDANZA";
      fecha: string; // AAAA-MM-DD
      minutos: number;
      /** Tiempo trabajado después de la hora de salida ese día (para la compensación 1:1). */
      minutosDespuesDeSalida?: number;
      /** Tiempo que la propia marca ya repuso fuera de horario (siempre se resta). */
      minutosRepuestos?: number;
      /** false = no se le permitió entrar: el día entero queda sin trabajar. Por omisión, true. */
      trabajoElResto?: boolean;
    }
  | { tipo: "SALIDA_ANTICIPADA"; fecha: string; minutos: number; minutosRepuestos?: number }
  | { tipo: "AUSENCIA"; fecha: string; clasificacion: ClasificacionAusencia; /** 1 o 0.5 (media jornada). */ fraccion?: number };

export interface EntradaDeducciones {
  perfil: PerfilEmpleado;
  politica: PoliticaAsistencia;
  periodo: { desde: string; hasta: string };
  incidencias: Incidencia[];
  /** Feriados oficiales del período y sus alrededores (AAAA-MM-DD). */
  feriados?: string[];
  /** Lunes (AAAA-MM-DD) de semanas cuyo séptimo ya se descontó en el período anterior. */
  septimosYaDescontados?: string[];
  /** Si viene, lo descontado no pasa del salario del período. */
  salarioDelPeriodo?: MoneyInput;
}

// ─── Salida ──────────────────────────────────────────────────────────────────────

export type Concepto = "TARDANZA" | "SALIDA_ANTICIPADA" | "AUSENCIA" | "SEPTIMO_DIA" | "FERIADO";

export interface LineaDeduccion {
  fecha: string;
  concepto: Concepto;
  /** Tiempo descontado: minutos para tardanzas y salidas, días para el resto. */
  minutos: number;
  dias: number;
  monto: Money;
  /** Salario no devengado: baja la base de IHSS, RAP e ISR del período. */
  reduceSalarioDevengado: boolean;
  detalle: string;
}

export type NivelAlerta = "INFO" | "REVISAR" | "RIESGO_LEGAL";

export interface Alerta {
  nivel: NivelAlerta;
  fecha?: string;
  mensaje: string;
  fundamento?: string;
}

export interface ResultadoDeducciones {
  valores: { horasJornada: number; salarioDiario: Money; valorHora: Money; valorMinuto: Money };
  lineas: LineaDeduccion[];
  totales: { minutosTardanza: number; minutosSalida: number; diasAusencia: number; diasSeptimo: number; diasFeriado: number; monto: Money };
  /** Minutos de tiempo extra que se usaron para compensar tardanzas: NO se pagan como horas extra. */
  minutosExtraConsumidos: number;
  /** Lunes de las semanas cuyo séptimo se descontó (para no repetirlo en el período siguiente). */
  semanasConSeptimo: string[];
  bitacora: string[];
  alertas: Alerta[];
}

// ─── Fechas (UTC, sin zona: las incidencias son días de calendario) ──────────────

const MS_DIA = 86_400_000;
const aFecha = (f: string) => {
  const [a, m, d] = f.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
};
const aTexto = (d: Date) => d.toISOString().slice(0, 10);
/** 1 = lunes … 7 = domingo. */
export const diaIso = (f: string) => ((aFecha(f).getUTCDay() + 6) % 7) + 1;
export const lunesDe = (f: string) => aTexto(new Date(aFecha(f).getTime() - (diaIso(f) - 1) * MS_DIA));
const sumarDias = (f: string, n: number) => aTexto(new Date(aFecha(f).getTime() + n * MS_DIA));
const diasDelMes = (f: string) => {
  const d = aFecha(f);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};

const FUNDAMENTO_MULTA = "Código del Trabajo, Art. 92 num. 9 (se prohíbe descontar del salario en concepto de multa) y Art. 96 num. 5";

// ─── Motor ───────────────────────────────────────────────────────────────────────

export function calcularDeduccionesAsistencia(e: EntradaDeducciones): ResultadoDeducciones {
  const { perfil, politica: p } = e;
  const bitacora: string[] = [];
  const alertas: Alerta[] = [];
  const lineas: LineaDeduccion[] = [];
  const log = (s: string) => bitacora.push(s);

  // ── A. Valor día, hora y minuto ──
  const horasJornada = perfil.jornada.tipo === "PERSONALIZADA" ? perfil.jornada.horasDiarias : HORAS_JORNADA_LEGAL[perfil.jornada.tipo];
  if (!(horasJornada > 0)) throw new Error("La jornada debe tener horas diarias mayores que cero.");
  const mensual = money(perfil.salarioMensual);
  const divisorDe = (fecha: string) =>
    p.divisor.tipo === "TREINTA" ? 30 : p.divisor.tipo === "DIAS_REALES" ? diasDelMes(fecha) : p.divisor.dias;
  const diario = (fecha: string) => mensual.div(divisorDe(fecha));
  const porMinuto = (fecha: string) => diario(fecha).div(horasJornada).div(60);
  const ref = e.periodo.desde;
  log(
    `Valor día = ${mensual.toFixed(2)} ÷ ${divisorDe(ref)} (${p.divisor.tipo}) = ${redondear(diario(ref)).toFixed(2)}; ` +
      `valor hora = día ÷ ${horasJornada} h (${perfil.jornada.tipo}) = ${redondear(diario(ref).div(horasJornada), 4).toFixed(4)}.`
  );

  const enPeriodo = (f: string) => f >= e.periodo.desde && f <= e.periodo.hasta;
  const horario: Partial<Record<number, number>> = perfil.horario;
  const horasDelDia = (f: string) => horario[diaIso(f)] ?? 0;

  const agregar = (l: Omit<LineaDeduccion, "monto" | "reduceSalarioDevengado"> & { monto: Money }) =>
    lineas.push({ ...l, monto: redondear(l.monto), reduceSalarioDevengado: l.monto.gt(0) });

  /** La protección contra multas: lo que pasa del tiempo real se topa o se alerta. */
  const proteger = (fecha: string, pedido: number, real: number, unidad: string, motivo: string): number => {
    if (pedido <= real + 1e-9) return pedido;
    if (p.proteccion.excesoSobreTiempoReal === "TOPAR") {
      log(`${fecha}: ${motivo} pediría ${pedido} ${unidad}, más que lo no trabajado (${real}); se topa en ${real}.`);
      alertas.push({ nivel: "INFO", fecha, mensaje: `${motivo}: se descontó sólo el tiempo no trabajado (${real} ${unidad} en vez de ${pedido}).`, fundamento: FUNDAMENTO_MULTA });
      return real;
    }
    alertas.push({
      nivel: "RIESGO_LEGAL", fecha,
      mensaje: `${motivo}: se descuentan ${pedido} ${unidad} por ${real} no trabajados. La diferencia equivale a una multa.`,
      fundamento: FUNDAMENTO_MULTA,
    });
    log(`${fecha}: ${motivo}: ${pedido} ${unidad} (PERMITIR_CON_ALERTA; el tiempo real es ${real}).`);
    return pedido;
  };

  const fuera = e.incidencias.filter((i) => !enPeriodo(i.fecha));
  for (const i of fuera) alertas.push({ nivel: "REVISAR", fecha: i.fecha, mensaje: "Incidencia fuera del período: no se tomó en cuenta." });
  const dentro = e.incidencias.filter((i) => enPeriodo(i.fecha)).sort((a, b) => a.fecha.localeCompare(b.fecha));

  let minutosExtraConsumidos = 0;
  const ausencias: { fecha: string; clasificacion: ClasificacionAusencia; fraccion: number; origen: string }[] = [];

  // ── B. Tardanzas y salidas anticipadas ──
  const procesarTiempo = (tipo: "TARDANZA" | "SALIDA_ANTICIPADA", regla: ReglaTiempo) => {
    const nombre = tipo === "TARDANZA" ? "Llegada tarde" : "Salida anticipada";
    const tol = regla.tolerancia;
    let bolsaUsada = 0;
    let bolsaAgotada = false;
    for (const i of dentro) {
      if (i.tipo !== tipo) continue;
      let real = Math.max(0, Math.round(i.minutos));
      if (real === 0) continue;

      // 0. Lo que la marca ya repuso fuera de horario no es tiempo sin trabajar.
      const repuestos = Math.min(real, Math.max(0, Math.round(i.minutosRepuestos ?? 0)));
      if (repuestos > 0) {
        real -= repuestos;
        log(`${i.fecha}: ${nombre} de ${i.minutos} min; ${repuestos} se repusieron fuera de horario y completaron la jornada: quedan ${real}.`);
        if (real === 0) continue;
      }

      // 1. Compensación 1:1 con tiempo después de la salida (sólo llegadas tarde).
      if (i.tipo === "TARDANZA" && p.compensacion.activa && (i.minutosDespuesDeSalida ?? 0) > 0) {
        const c = Math.min(real, Math.round(i.minutosDespuesDeSalida ?? 0));
        real -= c;
        minutosExtraConsumidos += c;
        log(`${i.fecha}: ${nombre} de ${i.minutos} min compensada con ${c} min después de la salida; quedan ${real}. Esos ${c} min no se pagan como extra.`);
        if (real === 0) continue;
      }

      // 2. Umbral: una llegada muy tarde pasa a ausencia.
      if (i.tipo === "TARDANZA" && p.umbralAusencia.activo && i.minutos >= p.umbralAusencia.minutos) {
        if (i.trabajoElResto === false) {
          ausencias.push({ fecha: i.fecha, clasificacion: "INJUSTIFICADA", fraccion: 1, origen: `llegada tarde de ${i.minutos} min sin dejarle entrar` });
          alertas.push({
            nivel: "REVISAR", fecha: i.fecha,
            mensaje: "No se le permitió entrar: queda como ausencia injustificada del día. Confirme que el reglamento lo prevé; si la decisión fue del patrono, podría no ser «sin causa justificada».",
            fundamento: "Código del Trabajo, Art. 94 (sólo sanciones previstas en el reglamento o el contrato)",
          });
          log(`${i.fecha}: ${nombre} de ${i.minutos} min ≥ umbral de ${p.umbralAusencia.minutos}; no se le dejó entrar → ausencia del día.`);
          continue;
        }
        const pedido = Math.round((p.umbralAusencia.siTrabajo === "MEDIA_JORNADA" ? horasJornada / 2 : horasJornada) * 60);
        const minutos = proteger(i.fecha, pedido, real, "min", `${nombre} de ${i.minutos} min convertida en ${p.umbralAusencia.siTrabajo === "MEDIA_JORNADA" ? "media jornada" : "día completo"}`);
        agregar({ fecha: i.fecha, concepto: tipo, minutos, dias: minutos / 60 / horasJornada, monto: porMinuto(i.fecha).times(minutos), detalle: `umbral de ${p.umbralAusencia.minutos} min` });
        continue;
      }

      // 3. Tolerancia.
      let base = real;
      let topeReal = real;
      if (tol.modo === "POR_EVENTO") {
        if (real <= tol.minutos) {
          log(`${i.fecha}: ${nombre} de ${real} min dentro de la tolerancia de ${tol.minutos}: no se descuenta.`);
          continue;
        }
        base = tol.descontarCompletoSiExcede ? real : real - tol.minutos;
        log(`${i.fecha}: ${nombre} de ${real} min pasa la tolerancia de ${tol.minutos}: ${tol.descontarCompletoSiExcede ? "se descuentan completos" : `se descuenta el excedente (${base})`}.`);
      } else if (tol.modo === "BOLSA_PERIODO") {
        if (bolsaAgotada) {
          log(`${i.fecha}: ${nombre} de ${real} min con la bolsa de ${tol.minutos} ya agotada: se descuentan.`);
        } else if (bolsaUsada + real <= tol.minutos) {
          bolsaUsada += real;
          log(`${i.fecha}: ${nombre} de ${real} min cubierta por la bolsa (${bolsaUsada} de ${tol.minutos} usados).`);
          continue;
        } else {
          const excedente = bolsaUsada + real - tol.minutos;
          bolsaAgotada = true;
          if (tol.alAgotarse === "SOLO_EXCEDENTE") {
            base = excedente;
            log(`${i.fecha}: ${nombre} de ${real} min agota la bolsa de ${tol.minutos}: se descuenta el excedente (${excedente}).`);
          } else {
            // Lo acumulado también fue tiempo no trabajado: cobrarlo ahora no pasa del tiempo real.
            base = bolsaUsada + real;
            topeReal = bolsaUsada + real;
            log(`${i.fecha}: ${nombre} de ${real} min agota la bolsa de ${tol.minutos}: se descuenta todo lo acumulado (${base}).`);
          }
          bolsaUsada = tol.minutos;
        }
      }

      // 4. Redondeo y 5. protección.
      let minutos = base;
      if (regla.redondeo.modo === "BLOQUES") {
        const b = regla.redondeo.minutos;
        minutos = Math.ceil(base / b) * b;
        if (minutos !== base) log(`${i.fecha}: ${base} min redondeados a bloques de ${b} → ${minutos}.`);
        minutos = proteger(i.fecha, minutos, topeReal, "min", `Redondeo en bloques de ${b} min`);
      }
      agregar({ fecha: i.fecha, concepto: tipo, minutos, dias: minutos / 60 / horasJornada, monto: porMinuto(i.fecha).times(minutos), detalle: topeReal === real ? `${real} min reales` : `${topeReal} min reales acumulados en el período` });
    }
  };
  if (p.descontarTiempo) {
    procesarTiempo("TARDANZA", p.tardanzas);
    procesarTiempo("SALIDA_ANTICIPADA", p.salidasAnticipadas);
  } else if (dentro.some((i) => i.tipo !== "AUSENCIA")) {
    log("Llegadas tarde y salidas anticipadas: el descuento está apagado en la política; no se descuentan.");
  }

  // ── C. Ausencias ──
  for (const i of dentro) if (i.tipo === "AUSENCIA") ausencias.push({ fecha: i.fecha, clasificacion: i.clasificacion, fraccion: i.fraccion ?? 1, origen: "registrada" });
  ausencias.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const injustificadas: { fecha: string; fraccion: number }[] = [];
  const porSemana = new Map<string, { fecha: string; fraccion: number }[]>();
  for (const a of ausencias) {
    const horas = horasDelDia(a.fecha);
    if (horas <= 0) {
      alertas.push({ nivel: "REVISAR", fecha: a.fecha, mensaje: "Ausencia en un día de descanso según el horario: no se descuenta." });
      continue;
    }
    if (a.clasificacion === "CON_GOCE") {
      log(`${a.fecha}: ausencia justificada con goce de sueldo: no se descuenta.`);
      continue;
    }
    if (a.clasificacion === "INCAPACIDAD") {
      log(`${a.fecha}: incapacidad: no se descuenta aquí; la liquida Incapacidades (primeros 3 días el patrono, desde el 4.º el subsidio del IHSS y el patrono completa).`);
      continue;
    }
    const fraccion = Math.min(1, Math.max(0, a.fraccion));
    const proporcion = Math.min(1, horas / horasJornada); // el sábado de 4 h es medio día
    const corto = proporcion < 1;
    let dias = fraccion * proporcion;
    if (corto && p.ausencias.diaCorto.descuento === "DIA_COMPLETO") {
      dias = proteger(a.fecha, fraccion, dias, "días", `Falta en día de ${horas} h descontada como día completo`);
    }
    const tipoTexto = a.clasificacion === "INJUSTIFICADA" ? "injustificada" : "sin goce (con permiso)";
    agregar({
      fecha: a.fecha, concepto: "AUSENCIA", minutos: Math.round(dias * horasJornada * 60), dias,
      monto: diario(a.fecha).times(dias), detalle: `${tipoTexto}${a.origen !== "registrada" ? `, ${a.origen}` : ""}`,
    });
    log(`${a.fecha}: ausencia ${tipoTexto} de ${fraccion === 1 ? "un día" : `${fraccion} de día`}${corto ? ` en día de ${horas} h` : ""}: ${dias.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} día(s).`);
    if (a.clasificacion === "SIN_GOCE") {
      log(`${a.fecha}: con permiso no pierde el séptimo: la regla es para quien falta «sin causa justificada» (Decreto 112-82, Art. 7).`);
      continue;
    }
    injustificadas.push({ fecha: a.fecha, fraccion });
    const cuenta = fraccion >= p.ausencias.fraccionMinimaParaSeptimo && (!corto || p.ausencias.diaCorto.cuentaParaSeptimo);
    if (cuenta) porSemana.set(lunesDe(a.fecha), [...(porSemana.get(lunesDe(a.fecha)) ?? []), { fecha: a.fecha, fraccion }]);
    else log(`${a.fecha}: no cuenta para el séptimo (${corto ? "día corto que la política excluye" : `fracción ${fraccion} menor que ${p.ausencias.fraccionMinimaParaSeptimo}`}).`);
  }

  // Séptimo: uno por semana como máximo.
  const regla = p.ausencias.septimo[perfil.frecuencia];
  const semanasConSeptimo: string[] = [];
  for (const [lunes, faltas] of [...porSemana.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (e.septimosYaDescontados?.includes(lunes)) {
      log(`Semana del ${lunes}: su séptimo ya se descontó en el período anterior; no se repite.`);
      continue;
    }
    let dias = 0;
    if (regla.modo === "DIA_COMPLETO") dias = 1;
    else if (regla.modo === "PROPORCIONAL") dias = Math.min(1, faltas.reduce((n, f) => n + f.fraccion, 0) / regla.diasSemana);
    if (dias === 0) {
      log(`Semana del ${lunes}: ${faltas.length} falta(s) injustificada(s); la política ${perfil.frecuencia} no descuenta el séptimo.`);
      continue;
    }
    const fecha = faltas[0].fecha;
    semanasConSeptimo.push(lunes);
    agregar({ fecha, concepto: "SEPTIMO_DIA", minutos: Math.round(dias * horasJornada * 60), dias, monto: diario(fecha).times(dias), detalle: `semana del ${lunes}` });
    log(
      `Semana del ${lunes}: ${faltas.length} falta(s) injustificada(s) → ` +
        (regla.modo === "PROPORCIONAL"
          ? `séptimo proporcional ${faltas.length}/${regla.diasSemana} = ${dias.toFixed(4)} día, máximo 1.`
          : "pierde el séptimo completo (uno por semana aunque falte más de un día).")
    );
  }

  // Feriados: falta injustificada el día laboral anterior o posterior.
  if (p.ausencias.feriadoAdyacente !== "IGNORAR") {
    const feriados = new Set(e.feriados ?? []);
    const laboral = (f: string) => horasDelDia(f) > 0 && !feriados.has(f);
    const vecino = (f: string, paso: 1 | -1) => {
      let d = sumarDias(f, paso);
      for (let n = 0; n < 7 && !laboral(d); n++) d = sumarDias(d, paso);
      return d;
    };
    const faltaCompleta = new Set(injustificadas.filter((x) => x.fraccion >= 1).map((x) => x.fecha));
    for (const f of [...feriados].sort()) {
      const pegada = [vecino(f, -1), vecino(f, 1)].find((d) => faltaCompleta.has(d));
      if (!pegada) continue;
      if (p.ausencias.feriadoAdyacente === "ALERTAR" || !enPeriodo(f)) {
        alertas.push({ nivel: "REVISAR", fecha: pegada, mensaje: `Falta injustificada junto al feriado del ${f}.` });
        log(`${pegada}: falta injustificada junto al feriado del ${f}: sólo se avisa.`);
        continue;
      }
      agregar({ fecha: f, concepto: "FERIADO", minutos: horasJornada * 60, dias: 1, monto: diario(f), detalle: `falta el ${pegada}` });
      alertas.push({
        nivel: "RIESGO_LEGAL", fecha: f,
        mensaje: `Se descuenta el feriado del ${f} por la falta del ${pegada}. El Código no lo prevé y, con salario mensual o quincenal, el pago del feriado ya va incluido.`,
        fundamento: "Código del Trabajo, Art. 339",
      });
      log(`${f}: se descuenta el feriado por la falta del ${pegada} (regla del reglamento interno; riesgo legal).`);
    }
  }

  // Art. 112 h): sólo aviso.
  const completas = injustificadas.filter((x) => x.fraccion >= 1).map((x) => x.fecha);
  const siguienteLaboral = (f: string) => {
    let d = sumarDias(f, 1);
    for (let n = 0; n < 7 && horasDelDia(d) <= 0; n++) d = sumarDias(d, 1);
    return d;
  };
  const seguidas = completas.find((f) => completas.includes(siguienteLaboral(f)));
  const porMes = new Map<string, number>();
  for (const f of completas) porMes.set(f.slice(0, 7), (porMes.get(f.slice(0, 7)) ?? 0) + 1);
  const mesDeTres = [...porMes.entries()].find(([, n]) => n >= 3);
  if (seguidas || mesDeTres) {
    alertas.push({
      nivel: "INFO", fecha: seguidas ?? undefined,
      mensaje: seguidas ? "Dos días completos seguidos de falta injustificada." : `Tres o más días de falta injustificada en ${mesDeTres![0]}.`,
      fundamento: "Código del Trabajo, Art. 112 h): causa justa de despido. El motor sólo avisa.",
    });
  }

  // ── D. Tope del período ──
  let monto = sumar(...lineas.map((l) => l.monto));
  if (e.salarioDelPeriodo !== undefined && monto.gt(money(e.salarioDelPeriodo))) {
    const tope = redondear(e.salarioDelPeriodo);
    alertas.push({ nivel: "REVISAR", mensaje: `Lo descontado (${monto.toFixed(2)}) pasaba del salario del período; se deja en ${tope.toFixed(2)}.` });
    log(`Tope: lo descontado no pasa del salario del período (${tope.toFixed(2)}).`);
    monto = tope;
  }

  const suma = (c: Concepto, campo: "minutos" | "dias") => lineas.filter((l) => l.concepto === c).reduce((n, l) => n + l[campo], 0);
  return {
    valores: {
      horasJornada,
      salarioDiario: redondear(diario(ref)),
      valorHora: redondear(diario(ref).div(horasJornada), 4),
      valorMinuto: redondear(porMinuto(ref), 6),
    },
    lineas,
    totales: {
      minutosTardanza: suma("TARDANZA", "minutos"),
      minutosSalida: suma("SALIDA_ANTICIPADA", "minutos"),
      diasAusencia: suma("AUSENCIA", "dias"),
      diasSeptimo: suma("SEPTIMO_DIA", "dias"),
      diasFeriado: suma("FERIADO", "dias"),
      // Ya topado al salario del período, si se dio; las líneas conservan su importe.
      monto,
    },
    minutosExtraConsumidos,
    semanasConSeptimo,
    bitacora,
    alertas,
  };
}
