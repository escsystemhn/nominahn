import { describe, expect, it } from "vitest";
import { calcularDeduccionesAsistencia, diaIso, lunesDe, type EntradaDeducciones, type Incidencia, type PerfilEmpleado } from "./motor";
import { POLITICA_POR_OMISION, leerPolitica, type PoliticaAsistencia } from "./politica";

// Salario 30,000 ÷ 30 = 1,000 al día; 125 la hora diurna; 2.083333… el minuto.
const L_V: PerfilEmpleado["horario"] = { 1: 8, 2: 8, 3: 8, 4: 8, 5: 8 };
const perfilBase: PerfilEmpleado = { salarioMensual: 30000, frecuencia: "MENSUAL", jornada: { tipo: "DIURNA" }, horario: L_V };

/** Copia la política por omisión y le aplica cambios. */
const politica = (cambiar: (p: PoliticaAsistencia) => void = () => {}) => {
  const p = structuredClone(POLITICA_POR_OMISION);
  p.descontarTiempo = true; // las pruebas de tiempo lo necesitan; «apagado» tiene la suya
  cambiar(p);
  return p;
};
const sinTolerancia = (p: PoliticaAsistencia) => { p.tardanzas.tolerancia = { modo: "NINGUNA" }; };

const correr = (incidencias: Incidencia[], p: PoliticaAsistencia = politica(), extra: Partial<EntradaDeducciones> = {}) =>
  calcularDeduccionesAsistencia({ perfil: perfilBase, politica: p, periodo: { desde: "2026-11-01", hasta: "2026-11-30" }, incidencias, ...extra });

const total = (r: ReturnType<typeof correr>) => r.totales.monto.toFixed(2);
const niveles = (r: ReturnType<typeof correr>) => r.alertas.map((a) => a.nivel);

describe("fechas", () => {
  it("el 2 de noviembre de 2026 es lunes y su semana empieza ese día", () => {
    expect(diaIso("2026-11-02")).toBe(1);
    expect(diaIso("2026-11-08")).toBe(7);
    expect(lunesDe("2026-11-07")).toBe("2026-11-02");
    expect(diaIso("2026-10-21")).toBe(3);
  });
});

describe("A. valor día, hora y minuto", () => {
  it("divisor 30 y jornada diurna: día ÷ 8", () => {
    const r = correr([]);
    expect(r.valores.salarioDiario.toFixed(2)).toBe("1000.00");
    expect(r.valores.valorHora.toFixed(4)).toBe("125.0000");
    expect(r.valores.valorMinuto.toFixed(6)).toBe("2.083333");
  });

  it("días reales del mes (febrero, 28) y días laborables fijos (26)", () => {
    const feb = calcularDeduccionesAsistencia({ perfil: perfilBase, politica: politica((p) => { p.divisor = { tipo: "DIAS_REALES" }; }), periodo: { desde: "2026-02-01", hasta: "2026-02-28" }, incidencias: [] });
    expect(feb.valores.salarioDiario.toFixed(2)).toBe("1071.43");
    expect(correr([], politica((p) => { p.divisor = { tipo: "LABORABLES", dias: 26 }; })).valores.salarioDiario.toFixed(2)).toBe("1153.85");
  });

  it("nocturna ÷ 6, mixta ÷ 7 y personalizada (4 h)", () => {
    const r = (jornada: PerfilEmpleado["jornada"]) =>
      calcularDeduccionesAsistencia({ perfil: { ...perfilBase, jornada }, politica: politica(sinTolerancia), periodo: { desde: "2026-11-01", hasta: "2026-11-30" }, incidencias: [{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 30 }] });
    expect(r({ tipo: "NOCTURNA" }).valores.valorHora.toFixed(4)).toBe("166.6667");
    expect(total(r({ tipo: "NOCTURNA" }))).toBe("83.33");
    expect(r({ tipo: "MIXTA" }).valores.valorHora.toFixed(4)).toBe("142.8571");
    expect(r({ tipo: "PERSONALIZADA", horasDiarias: 4 }).valores.valorHora.toFixed(4)).toBe("250.0000");
  });
});

describe("B1. tolerancia", () => {
  const conTolerancia10 = (completo: boolean) => politica((p) => { p.tardanzas.tolerancia = { modo: "POR_EVENTO", minutos: 10, descontarCompletoSiExcede: completo }; });

  it("12 minutos con 10 de gracia: completos (12) o sólo el excedente (2); 8 minutos, nada", () => {
    expect(total(correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 12 }], conTolerancia10(true)))).toBe("25.00");
    expect(total(correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 12 }], conTolerancia10(false)))).toBe("4.17");
    expect(correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 8 }], conTolerancia10(true)).lineas).toHaveLength(0);
  });

  const tardes: Incidencia[] = [
    { tipo: "TARDANZA", fecha: "2026-11-02", minutos: 10 },
    { tipo: "TARDANZA", fecha: "2026-11-03", minutos: 15 },
    { tipo: "TARDANZA", fecha: "2026-11-04", minutos: 12 },
    { tipo: "TARDANZA", fecha: "2026-11-05", minutos: 5 },
  ];

  it("bolsa de 30 en el período, sólo el excedente: 10 + 15 caben, del 12 se cobran 7 y después todo", () => {
    const r = correr(tardes, politica((p) => { p.tardanzas.tolerancia = { modo: "BOLSA_PERIODO", minutos: 30, alAgotarse: "SOLO_EXCEDENTE" }; }));
    expect(r.lineas.map((l) => [l.fecha, l.minutos])).toEqual([["2026-11-04", 7], ["2026-11-05", 5]]);
    expect(total(r)).toBe("25.00"); // 14.58 + 10.42
  });

  it("bolsa de 30, total acumulado: al agotarse se cobran los 37 minutos, sin pasar del tiempo real", () => {
    const r = correr(tardes, politica((p) => { p.tardanzas.tolerancia = { modo: "BOLSA_PERIODO", minutos: 30, alAgotarse: "TOTAL_ACUMULADO" }; }));
    expect(r.lineas.map((l) => l.minutos)).toEqual([37, 5]);
    expect(r.totales.minutosTardanza).toBe(42); // igual a lo que llegó tarde: 10+15+12+5
    expect(niveles(r)).not.toContain("RIESGO_LEGAL");
  });
});

describe("B2. redondeo en bloques y la prohibición de multas", () => {
  const bloques = (b: number, proteccion: "TOPAR" | "PERMITIR_CON_ALERTA") =>
    politica((p) => { sinTolerancia(p); p.tardanzas.redondeo = { modo: "BLOQUES", minutos: b }; p.proteccion.excesoSobreTiempoReal = proteccion; });

  it("16 minutos en bloques de 30: se topa en 16 (por omisión)", () => {
    const r = correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 16 }], bloques(30, "TOPAR"));
    expect(r.lineas[0].minutos).toBe(16);
    expect(total(r)).toBe("33.33");
    expect(niveles(r)).toEqual(["INFO"]);
  });

  it("con PERMITIR_CON_ALERTA se descuentan 30 y queda el riesgo legal con su artículo", () => {
    const r = correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 16 }], bloques(30, "PERMITIR_CON_ALERTA"));
    expect(total(r)).toBe("62.50");
    expect(r.alertas[0]).toMatchObject({ nivel: "RIESGO_LEGAL" });
    expect(r.alertas[0].fundamento).toMatch(/Art\. 92 num\. 9/);
  });

  it("un redondeo exacto no alerta: 30 minutos en bloques de 15", () => {
    const r = correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 30 }], bloques(15, "PERMITIR_CON_ALERTA"));
    expect(r.lineas[0].minutos).toBe(30);
    expect(r.alertas).toHaveLength(0);
  });
});

describe("B3. umbral: de llegada tarde a ausencia", () => {
  const umbral = (proteccion: "TOPAR" | "PERMITIR_CON_ALERTA" = "TOPAR") =>
    politica((p) => { sinTolerancia(p); p.umbralAusencia = { activo: true, minutos: 120, siTrabajo: "MEDIA_JORNADA" }; p.proteccion.excesoSobreTiempoReal = proteccion; });

  it("150 minutos y trabajó el resto: la media jornada (240) se topa en lo no trabajado (150)", () => {
    const r = correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 150 }], umbral());
    expect(r.lineas[0]).toMatchObject({ concepto: "TARDANZA", minutos: 150 });
    expect(total(r)).toBe("312.50");
  });

  it("con PERMITIR_CON_ALERTA descuenta la media jornada y alerta", () => {
    const r = correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 150 }], umbral("PERMITIR_CON_ALERTA"));
    expect(total(r)).toBe("500.00");
    expect(niveles(r)).toContain("RIESGO_LEGAL");
  });

  it("no se le dejó entrar: ausencia injustificada del día, con su séptimo, y se pide revisar", () => {
    const r = correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 150, trabajoElResto: false }], umbral());
    expect(r.lineas.map((l) => l.concepto)).toEqual(["AUSENCIA", "SEPTIMO_DIA"]);
    expect(total(r)).toBe("2000.00");
    expect(niveles(r)).toContain("REVISAR");
  });
});

describe("B4. compensación 1:1", () => {
  const conCompensacion = politica((p) => { sinTolerancia(p); p.compensacion.activa = true; });

  it("20 tarde y 15 después de la salida: se descuentan 5 y esos 15 no se pagan como extra", () => {
    const r = correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 20, minutosDespuesDeSalida: 15 }], conCompensacion);
    expect(r.lineas[0].minutos).toBe(5);
    expect(total(r)).toBe("10.42");
    expect(r.minutosExtraConsumidos).toBe(15);
  });

  it("compensada del todo: no hay línea; sin la opción activa, no se compensa", () => {
    expect(correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 10, minutosDespuesDeSalida: 40 }], conCompensacion).lineas).toHaveLength(0);
    expect(correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 20, minutosDespuesDeSalida: 15 }], politica(sinTolerancia)).lineas[0].minutos).toBe(20);
  });
});

describe("B0. interruptor y tiempo repuesto", () => {
  it("con el descuento de tiempo apagado (por omisión) sólo cuentan las ausencias", () => {
    const r = correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 45 }, { tipo: "SALIDA_ANTICIPADA", fecha: "2026-11-03", minutos: 30 }, { tipo: "AUSENCIA", fecha: "2026-11-04", clasificacion: "INJUSTIFICADA" }], structuredClone(POLITICA_POR_OMISION));
    expect(r.lineas.map((l) => l.concepto)).toEqual(["AUSENCIA", "SEPTIMO_DIA"]);
    expect(r.bitacora.join(" ")).toMatch(/descuento está apagado/);
  });

  it("lo repuesto fuera de horario se resta siempre, aun sin la compensación activa", () => {
    const r = correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 20, minutosRepuestos: 15 }], politica(sinTolerancia));
    expect(r.lineas[0].minutos).toBe(5);
    expect(r.minutosExtraConsumidos).toBe(0);
    expect(correr([{ tipo: "SALIDA_ANTICIPADA", fecha: "2026-11-03", minutos: 30, minutosRepuestos: 30 }], politica()).lineas).toHaveLength(0);
  });
});

describe("C. ausencias y séptimo día", () => {
  const faltas = (...fechas: string[]): Incidencia[] => fechas.map((fecha) => ({ tipo: "AUSENCIA", fecha, clasificacion: "INJUSTIFICADA" }));

  it("política A: dos faltas en la misma semana cuestan dos días y UN séptimo", () => {
    const r = correr(faltas("2026-11-03", "2026-11-04"));
    expect(total(r)).toBe("3000.00");
    expect(r.semanasConSeptimo).toEqual(["2026-11-02"]);
  });

  it("política A: en semanas distintas, un séptimo por semana", () => {
    expect(total(correr(faltas("2026-11-03", "2026-11-10")))).toBe("4000.00");
  });

  it("política B: sólo los días", () => {
    expect(total(correr(faltas("2026-11-03", "2026-11-04"), politica((p) => { p.ausencias.septimo.MENSUAL = { modo: "NINGUNO" }; })))).toBe("2000.00");
  });

  it("política C: 1/6 por falta, nunca más de un séptimo por semana", () => {
    const c = politica((p) => { p.ausencias.septimo.MENSUAL = { modo: "PROPORCIONAL", diasSemana: 6 }; });
    expect(total(correr(faltas("2026-11-03", "2026-11-04"), c))).toBe("2333.33");
    const semanaEntera = correr(faltas("2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"), politica((p) => { p.ausencias.septimo.MENSUAL = { modo: "PROPORCIONAL", diasSemana: 5 }; }));
    expect(semanaEntera.totales.diasSeptimo).toBe(1);
  });

  it("el séptimo sigue la frecuencia de pago de la persona", () => {
    const p = politica((x) => { x.ausencias.septimo.SEMANAL = { modo: "DIA_COMPLETO" }; x.ausencias.septimo.MENSUAL = { modo: "NINGUNO" }; });
    const semanal = calcularDeduccionesAsistencia({ perfil: { ...perfilBase, frecuencia: "SEMANAL" }, politica: p, periodo: { desde: "2026-11-02", hasta: "2026-11-08" }, incidencias: faltas("2026-11-03") });
    expect(semanal.totales.diasSeptimo).toBe(1);
    expect(correr(faltas("2026-11-03"), p).totales.diasSeptimo).toBe(0);
  });

  it("sin goce: se descuenta el día pero NO el séptimo; con goce e incapacidad: nada", () => {
    const r = correr([
      { tipo: "AUSENCIA", fecha: "2026-11-03", clasificacion: "SIN_GOCE" },
      { tipo: "AUSENCIA", fecha: "2026-11-10", clasificacion: "CON_GOCE" },
      { tipo: "AUSENCIA", fecha: "2026-11-17", clasificacion: "INCAPACIDAD" },
    ]);
    expect(r.lineas.map((l) => l.concepto)).toEqual(["AUSENCIA"]);
    expect(total(r)).toBe("1000.00");
    expect(r.bitacora.join(" ")).toMatch(/la liquida Incapacidades/);
  });

  it("media jornada injustificada: medio día y, con fracción mínima 1, sin séptimo", () => {
    const r = correr([{ tipo: "AUSENCIA", fecha: "2026-11-03", clasificacion: "INJUSTIFICADA", fraccion: 0.5 }]);
    expect(total(r)).toBe("500.00");
    expect(r.totales.diasSeptimo).toBe(0);
  });

  it("el séptimo de una semana ya descontada en el período anterior no se repite", () => {
    const r = correr(faltas("2026-11-03"), politica(), { septimosYaDescontados: ["2026-11-02"] });
    expect(total(r)).toBe("1000.00");
  });

  it("una falta en día de descanso no se descuenta", () => {
    const r = correr(faltas("2026-11-08"));
    expect(r.lineas).toHaveLength(0);
    expect(niveles(r)).toEqual(["REVISAR"]);
  });
});

describe("C3. sábado de 4 horas (semana de 44)", () => {
  const sabado = (cambiar: (p: PoliticaAsistencia) => void) =>
    calcularDeduccionesAsistencia({
      perfil: { ...perfilBase, horario: { ...L_V, 6: 4 } }, politica: politica(cambiar),
      periodo: { desde: "2026-11-01", hasta: "2026-11-30" }, incidencias: [{ tipo: "AUSENCIA", fecha: "2026-11-07", clasificacion: "INJUSTIFICADA" }],
    });

  it("proporcional: medio día, y pierde el séptimo si la política lo cuenta", () => {
    expect(total(sabado(() => {}))).toBe("1500.00");
    expect(total(sabado((p) => { p.ausencias.diaCorto.cuentaParaSeptimo = false; }))).toBe("500.00");
  });

  it("como día completo: se topa en medio día, o se cobra completo con riesgo legal (Art. 322)", () => {
    const topado = sabado((p) => { p.ausencias.diaCorto = { descuento: "DIA_COMPLETO", cuentaParaSeptimo: false }; });
    expect(total(topado)).toBe("500.00");
    const permitido = sabado((p) => { p.ausencias.diaCorto = { descuento: "DIA_COMPLETO", cuentaParaSeptimo: false }; p.proteccion.excesoSobreTiempoReal = "PERMITIR_CON_ALERTA"; });
    expect(total(permitido)).toBe("1000.00");
    expect(niveles(permitido)).toContain("RIESGO_LEGAL");
  });
});

describe("C4. faltas junto a un feriado", () => {
  const conFeriado = (regla: PoliticaAsistencia["ausencias"]["feriadoAdyacente"]) =>
    calcularDeduccionesAsistencia({
      perfil: perfilBase, politica: politica((p) => { p.ausencias.feriadoAdyacente = regla; p.ausencias.septimo.MENSUAL = { modo: "NINGUNO" }; }),
      periodo: { desde: "2026-10-16", hasta: "2026-10-31" }, feriados: ["2026-10-21"],
      incidencias: [{ tipo: "AUSENCIA", fecha: "2026-10-20", clasificacion: "INJUSTIFICADA" }],
    });

  it("IGNORAR no hace nada; ALERTAR sólo avisa", () => {
    expect(conFeriado("IGNORAR").alertas).toHaveLength(0);
    const r = conFeriado("ALERTAR");
    expect(total(r)).toBe("1000.00");
    expect(niveles(r)).toEqual(["REVISAR"]);
  });

  it("DESCONTAR_FERIADO lo descuenta y deja el riesgo legal (Art. 339)", () => {
    const r = conFeriado("DESCONTAR_FERIADO");
    expect(r.lineas.map((l) => l.concepto)).toEqual(["AUSENCIA", "FERIADO"]);
    expect(total(r)).toBe("2000.00");
    expect(r.alertas.find((a) => a.nivel === "RIESGO_LEGAL")?.fundamento).toMatch(/Art\. 339/);
  });
});

describe("D. protecciones y avisos", () => {
  it("lo descontado no pasa del salario del período", () => {
    const r = correr([{ tipo: "AUSENCIA", fecha: "2026-11-03", clasificacion: "INJUSTIFICADA" }, { tipo: "AUSENCIA", fecha: "2026-11-04", clasificacion: "INJUSTIFICADA" }], politica(), { salarioDelPeriodo: 1500 });
    expect(total(r)).toBe("1500.00");
    expect(niveles(r)).toContain("REVISAR");
  });

  it("todo lo descontado es salario no devengado", () => {
    const r = correr([{ tipo: "TARDANZA", fecha: "2026-11-03", minutos: 30 }, { tipo: "AUSENCIA", fecha: "2026-11-04", clasificacion: "INJUSTIFICADA" }]);
    expect(r.lineas.every((l) => l.reduceSalarioDevengado)).toBe(true);
  });

  it("Art. 112 h): avisa de dos días seguidos, aunque haya un fin de semana en medio", () => {
    const r = correr([{ tipo: "AUSENCIA", fecha: "2026-11-06", clasificacion: "INJUSTIFICADA" }, { tipo: "AUSENCIA", fecha: "2026-11-09", clasificacion: "INJUSTIFICADA" }]);
    expect(r.alertas.find((a) => a.fundamento?.includes("Art. 112"))).toBeTruthy();
  });

  it("una incidencia fuera del período se ignora con aviso", () => {
    const r = correr([{ tipo: "TARDANZA", fecha: "2026-12-01", minutos: 30 }]);
    expect(r.lineas).toHaveLength(0);
    expect(niveles(r)).toEqual(["REVISAR"]);
  });

  it("la política se valida al leerla", () => {
    expect(leerPolitica(POLITICA_POR_OMISION)).toEqual(POLITICA_POR_OMISION);
    expect(() => leerPolitica({ ...POLITICA_POR_OMISION, tardanzas: { tolerancia: { modo: "POR_EVENTO", minutos: 0, descontarCompletoSiExcede: true }, redondeo: { modo: "MINUTO_EXACTO" } } })).toThrow();
    expect(() => leerPolitica({ ...POLITICA_POR_OMISION, divisor: { tipo: "LABORABLES" } })).toThrow();
  });
});
