import { describe, it, expect } from "vitest";
import { writeFileSync } from "fs";
import { generarPlan, esDescansoSemanal, type EntradaGenerador } from "./generar";
import { validarPlan } from "./validar";
import { jornadaDeHoras, VISPERA_HORA_MAX } from "./ley";
import { diaIso, sumarDias, diasEntre } from "./fechas";
import { PREFERENCIAS_VACIAS, REGLAS_POR_OMISION, type EmpleadoPlan, type Preferencias, type Requisito, type TurnoCatalogo } from "./tipos";

/**
 * Escenario: cadena de restaurantes con dos sucursales que abren de 07:00 a 21:00.
 * Centro tiene plantilla suficiente (contando la media jornada de la víspera del
 * descanso, Art. 341); Norte sólo dos gerentes para dos turnos diarios, así que
 * depende de que Centro le preste.
 */
const turno = (id: string, nombre: string, entrada: string, salida: string, pausa: number, horas: number): TurnoCatalogo => {
  const j = jornadaDeHoras(entrada, salida, pausa)!;
  return { id, codigo: id, nombre, entrada: j.entrada, salida: j.salida, pausa, ordinariasPactadasH: horas };
};
const TURNOS: TurnoCatalogo[] = [
  turno("APE", "Apertura", "06:30", "15:30", 60, 8),
  turno("INT", "Intermedio", "11:00", "19:00", 30, 8),
  turno("CIE", "Cierre", "14:30", "21:30", 30, 7), // 2.5 h nocturnas: mixta de 7 h
  turno("C22", "Cierre largo", "14:00", "22:00", 60, 7), // 3 h nocturnas: NOCTURNA, máx 6 h → se descarta
  turno("MED", "Media jornada", "07:00", "11:00", 0, 4), // víspera del descanso: 5 × 8 h + 4 h = 44 h
];

const h = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const req = (sucursalId: string, puestoId: string, desde: string, hasta: string, minimo: number): Requisito => ({
  sucursalId, puestoId, dias: [1, 2, 3, 4, 5, 6, 7], desde: h(desde), hasta: h(hasta), minimo, etiqueta: null,
});
const REQUISITOS: Requisito[] = [
  ...["CEN", "NOR"].map((s) => req(s, "GER", "07:00", "21:00", 1)),
  req("CEN", "CAJ", "07:00", "21:00", 1),
  req("CEN", "CAJ", "11:30", "14:00", 2),
  req("CEN", "CAJ", "18:00", "20:30", 2),
  req("CEN", "COC", "07:00", "21:00", 1),
  req("CEN", "COC", "11:30", "14:00", 2),
];

let n = 0;
const persona = (sucursalId: string, puestoId: string, cambios: Partial<EmpleadoPlan> & { pref?: Partial<Preferencias> } = {}): EmpleadoPlan => {
  n++;
  const { pref, ...resto } = cambios;
  return {
    id: `E${String(n).padStart(2, "0")}`, codigo: `E${String(n).padStart(2, "0")}`, nombre: `Persona ${n}`,
    puestoId, sucursalId, edad: 30, exento: false,
    preferencias: { ...PREFERENCIAS_VACIAS, ...pref },
    ...resto,
  };
};

const EMPLEADOS: EmpleadoPlan[] = [
  // Centro: 5 gerentes (aceptan traslado a Norte), 9 cajeros (el menor sólo
  // cuenta 4 h diarias, Código de la Niñez, Art. 125), 6 cocineros.
  persona("CEN", "GER", { pref: { permiteTraslado: true } }),
  persona("CEN", "GER", { pref: { permiteTraslado: true } }),
  persona("CEN", "GER", { pref: { permiteTraslado: true } }),
  persona("CEN", "GER", { pref: { permiteTraslado: true } }),
  persona("CEN", "GER", { pref: { permiteTraslado: true } }),
  persona("CEN", "CAJ", { nombre: "Estudiante", pref: { noDespuesDe: h("15:00"), diasRestriccion: [1, 2, 3, 4, 5], motivo: "estudios" } }),
  persona("CEN", "CAJ", { nombre: "Menor de 16", edad: 15 }),
  persona("CEN", "CAJ"),
  persona("CEN", "CAJ"),
  persona("CEN", "CAJ"),
  persona("CEN", "CAJ"),
  persona("CEN", "CAJ"),
  persona("CEN", "CAJ"),
  persona("CEN", "CAJ"),
  persona("CEN", "COC", { nombre: "Sólo diurna", pref: { soloDiurna: true, motivo: "salud" } }),
  persona("CEN", "COC"),
  persona("CEN", "COC"),
  persona("CEN", "COC"),
  persona("CEN", "COC"),
  persona("CEN", "COC"),
  // Norte: sólo 2 gerentes para 2 turnos diarios los 7 días.
  persona("NOR", "GER"),
  persona("NOR", "GER"),
];

const DESDE = "2026-11-02"; // lunes
const HASTA = "2026-11-29"; // domingo, 4 semanas

const entrada = (cambios: Partial<EntradaGenerador> = {}): EntradaGenerador => ({
  desde: DESDE, hasta: HASTA, empleados: EMPLEADOS, historial: [], turnos: TURNOS, requisitos: REQUISITOS,
  horarioAtencion: [], feriados: [], ausencias: [], reglas: { ...REGLAS_POR_OMISION }, ...cambios,
});

const resultado = generarPlan(entrada());
const turnosDe = (id: string) => resultado.plan.filter((d) => d.empleadoId === id && d.estado === "TURNO");

describe("generador de horarios: cumplimiento legal", () => {
  it("no deja ningún error legal", () => {
    const errores = resultado.alertas.filter((a) => a.nivel === "ERROR" && a.tipo === "LEGAL");
    expect(errores.map((a) => a.mensaje)).toEqual([]);
  });

  it("no programa horas extra ni excede el tope semanal", () => {
    for (const r of resultado.resumen) expect(r.extraH, r.empleadoId).toBe(0);
    expect(resultado.alertas.filter((a) => a.codigo === "TOPE_SEMANAL" || a.codigo === "HORA_EXTRA")).toEqual([]);
  });

  it("nadie trabaja más de 6 días seguidos", () => {
    for (const r of resultado.resumen) expect(r.maxConsecutivos, r.empleadoId).toBeLessThanOrEqual(6);
  });

  it("respeta el descanso de 12 h (política) entre jornadas", () => {
    for (const p of EMPLEADOS) {
      const t = turnosDe(p.id);
      for (let i = 1; i < t.length; i++) {
        const descanso = diasEntre(t[i - 1].fecha, t[i].fecha) * 1440 + t[i].entrada! - t[i - 1].salida!;
        expect(descanso, `${p.id} ${t[i].fecha}`).toBeGreaterThanOrEqual(12 * 60);
      }
    }
  });

  it("la víspera del descanso sale a más tardar a la 1:00 p. m. (Art. 341)", () => {
    for (const d of resultado.plan.filter((x) => x.estado === "TURNO")) {
      const manana = resultado.plan.find((x) => x.empleadoId === d.empleadoId && x.fecha === sumarDias(d.fecha, 1));
      if (esDescansoSemanal(manana)) expect(d.salida!, `${d.empleadoId} ${d.fecha}`).toBeLessThanOrEqual(VISPERA_HORA_MAX);
    }
  });

  it("descarta el cierre de 14:00 a 22:00 porque es jornada nocturna y lo explica", () => {
    expect(resultado.plan.some((d) => d.turnoId === "C22")).toBe(false);
    const nota = resultado.notas.find((a) => a.codigo === "GEN_TURNO_DESCARTADO");
    expect(nota?.mensaje).toContain("Cierre largo");
    expect(nota?.mensaje).toContain("nocturna");
  });

  it("el menor de 16 descansa todos los domingos, no hace nada nocturno y no pasa de 4 h (Código de la Niñez, Art. 125)", () => {
    const menor = EMPLEADOS.find((p) => p.edad < 16)!;
    for (const d of resultado.plan.filter((x) => x.empleadoId === menor.id)) {
      if (diaIso(d.fecha) === 7) expect(d.estado, d.fecha).not.toBe("TURNO");
      if (d.estado === "TURNO") {
        expect(d.salida!, d.fecha).toBeLessThanOrEqual(19 * 60);
        expect(d.salida! - d.entrada! - (d.pausa > 30 ? d.pausa : 0), d.fecha).toBeLessThanOrEqual(4 * 60);
      }
    }
    expect(turnosDe(menor.id).length).toBeGreaterThan(15);
  });

  it("de 16 y 17 años: hasta 6 h y nada nocturno; a los menores de 14 no los programa", () => {
    const [cajero17, cajero13] = EMPLEADOS.filter((p) => p.sucursalId === "CEN" && p.puestoId === "CAJ" && p.edad === 30 && !p.preferencias.motivo);
    const empleados = EMPLEADOS.map((p) => (p === cajero17 ? { ...p, edad: 17 } : p === cajero13 ? { ...p, edad: 13 } : p));
    const r = generarPlan(entrada({ empleados, turnos: [...TURNOS, turno("J6", "Seis horas", "13:00", "19:00", 0, 6)] }));
    expect(r.alertas.filter((a) => a.nivel === "ERROR" && a.tipo === "LEGAL").map((a) => a.mensaje)).toEqual([]);
    const t17 = r.plan.filter((d) => d.empleadoId === cajero17.id && d.estado === "TURNO");
    expect(t17.length).toBeGreaterThan(15);
    for (const d of t17) {
      expect(["J6", "MED"], d.fecha).toContain(d.turnoId);
      expect(d.salida!, d.fecha).toBeLessThanOrEqual(19 * 60);
    }
    expect(r.plan.some((d) => d.empleadoId === cajero13.id)).toBe(false);
    expect(r.notas.find((a) => a.codigo === "GEN_MENOR_DE_14")?.mensaje).toContain("13 años");
    expect(r.alertas.some((a) => a.codigo === "MENOR_REQUISITOS" && a.empleadoId === cajero17.id)).toBe(true);
  });

  it("respeta las restricciones personales", () => {
    const estudiante = EMPLEADOS.find((p) => p.nombre === "Estudiante")!;
    for (const d of turnosDe(estudiante.id)) if (diaIso(d.fecha) <= 5) expect(d.salida!, d.fecha).toBeLessThanOrEqual(15 * 60);
    const diurna = EMPLEADOS.find((p) => p.nombre === "Sólo diurna")!;
    for (const d of turnosDe(diurna.id)) expect(d.salida!, d.fecha).toBeLessThanOrEqual(19 * 60);
  });
});

describe("generador de horarios: operación", () => {
  /** Minutos-persona requeridos y descubiertos de una sucursal en el período. */
  const cobertura = (r: typeof resultado, sucursalId: string) => {
    let requeridos = 0;
    for (const req of REQUISITOS.filter((x) => x.sucursalId === sucursalId)) requeridos += (req.hasta - req.desde) * req.minimo * 28;
    const descubiertos = r.faltantes.filter((f) => f.sucursalId === sucursalId).reduce((s, f) => s + (f.hasta - f.desde) * (f.requeridos - f.programados), 0);
    return 1 - descubiertos / requeridos;
  };

  it("cubre al menos el 99 % de los mínimos de Centro y avisa de cada hueco", () => {
    expect(cobertura(resultado, "CEN")).toBeGreaterThan(0.99);
    const huecos = resultado.faltantes.filter((f) => f.sucursalId === "CEN").length;
    expect(resultado.alertas.filter((a) => a.codigo === "COBERTURA" && a.sucursalId === "CEN")).toHaveLength(huecos);
  });

  it("traslada gerentes de Centro para cubrir lo que falta en Norte", () => {
    const traslados = resultado.plan.filter((d) => d.esTraslado);
    expect(traslados.length).toBeGreaterThan(0);
    expect(traslados.every((d) => d.sucursalId === "NOR")).toBe(true);
    // Sin permiso de traslado, Norte queda mucho más corta.
    const sinTraslados = generarPlan(entrada({
      empleados: EMPLEADOS.map((p) => ({ ...p, preferencias: { ...p.preferencias, permiteTraslado: false } })),
    }));
    const minutos = (r: typeof resultado) => r.faltantes.filter((f) => f.sucursalId === "NOR").reduce((s, f) => s + f.hasta - f.desde, 0);
    expect(minutos(resultado)).toBeLessThan(minutos(sinTraslados) / 2);
    // Prestar le cuesta poco a Centro (reacomoda sus descansos) y la red completa gana.
    expect(cobertura(resultado, "CEN")).toBeGreaterThan(0.99);
    const red = (r: typeof resultado) => r.faltantes.reduce((s, f) => s + (f.hasta - f.desde) * (f.requeridos - f.programados), 0);
    expect(red(resultado)).toBeLessThan(red(sinTraslados));
  });

  it("todos descansan al menos un fin de semana en el mes", () => {
    for (const r of resultado.resumen) expect(r.descansosFinDeSemana, r.empleadoId).toBeGreaterThan(0);
  });

  it("es determinista", () => {
    expect(generarPlan(entrada()).plan).toEqual(resultado.plan);
  });

  it("con horas extra autorizadas las marca y clasifica en vez de dejar el hueco", () => {
    const solo = EMPLEADOS.filter((p) => p.sucursalId === "NOR");
    const r = generarPlan(entrada({ empleados: solo, requisitos: REQUISITOS.filter((x) => x.sucursalId === "NOR"), reglas: { ...REGLAS_POR_OMISION, permitirExtra: true } }));
    const extra = r.alertas.filter((a) => a.codigo === "HORA_EXTRA");
    expect(extra.length).toBeGreaterThan(0);
    expect(r.alertas.filter((a) => a.nivel === "ERROR" && a.tipo === "LEGAL").map((a) => a.mensaje)).toEqual([]);
  });

  it("explica cuando la media jornada empieza demasiado temprano para quien cerró", () => {
    const solo = entrada({ empleados: EMPLEADOS.filter((p) => p.sucursalId === "NOR"), requisitos: REQUISITOS.filter((x) => x.sucursalId === "NOR") });
    const nota = generarPlan(solo).notas.find((a) => a.codigo === "GEN_MEDIA_JORNADA_TEMPRANA");
    expect(nota?.mensaje).toContain("terminan a las 19:00");
    expect(nota?.mensaje).toContain("de 09:30 a 13:00");
    // Un turno de noche del catálogo que nadie de estos puestos toma no cambia la explicación.
    const conNoche = generarPlan({ ...solo, turnos: [...TURNOS, turno("NOC", "Noche", "23:00", "05:00", 0, 6)] });
    expect(conNoche.notas.find((a) => a.codigo === "GEN_MEDIA_JORNADA_TEMPRANA")?.mensaje).toContain("quien cierra a las 21:30");
    const tarde = generarPlan({ ...solo, turnos: [...TURNOS.filter((t) => t.id !== "MED"), turno("MT", "Media tarde", "09:30", "13:00", 0, 3.5)] });
    expect(tarde.notas.some((a) => a.codigo === "GEN_MEDIA_JORNADA_TEMPRANA")).toBe(false);
  });
});

describe("validación de ediciones manuales", () => {
  it("detecta un cierre seguido de una apertura con menos de 10 h", () => {
    const p = EMPLEADOS[5];
    const dias = resultado.plan.map((d) => ({ ...d }));
    const lunes = dias.find((d) => d.empleadoId === p.id && d.fecha === "2026-11-09")!;
    const martes = dias.find((d) => d.empleadoId === p.id && d.fecha === "2026-11-10")!;
    Object.assign(lunes, { estado: "TURNO", sucursalId: "CEN", turnoId: "CIE", entrada: h("14:30"), salida: h("21:30"), pausa: 30, manual: true });
    Object.assign(martes, { estado: "TURNO", sucursalId: "CEN", turnoId: "APE", entrada: h("06:30"), salida: h("15:30"), pausa: 60, manual: true });
    const v = validarPlan({ ...entrada(), dias });
    expect(v.alertas.some((a) => a.codigo === "DESCANSO_ENTRE_JORNADAS" && a.empleadoId === p.id && a.articulo === "Art. 327")).toBe(true);
  });

  it("detecta la jornada larga de un menor y distingue la salida autorizable de un adolescente", () => {
    const menor = EMPLEADOS.find((p) => p.edad < 16)!;
    const adolescente = { ...EMPLEADOS[7], edad: 16 };
    const empleados = EMPLEADOS.map((p) => (p.id === adolescente.id ? adolescente : p));
    const dias = resultado.plan.map((d) => ({ ...d }));
    const poner = (id: string, fecha: string, entrada: string, salida: string) =>
      Object.assign(dias.find((d) => d.empleadoId === id && d.fecha === fecha)!, { estado: "TURNO", sucursalId: "CEN", turnoId: null, entrada: h(entrada), salida: h(salida), pausa: 0, manual: true, motivo: null });
    poner(menor.id, "2026-11-11", "07:00", "13:00"); // 6 h a los 15 años
    poner(adolescente.id, "2026-11-11", "14:00", "20:00"); // hasta las 8:00 p. m.: sólo con autorización
    poner(adolescente.id, "2026-11-18", "15:00", "21:00"); // pasa de las 8:00 p. m.: prohibido
    const v = validarPlan({ ...entrada({ empleados }), dias });
    const de = (id: string, fecha: string) => v.alertas.filter((a) => a.empleadoId === id && a.fecha === fecha);
    expect(de(menor.id, "2026-11-11").find((a) => a.codigo === "MENOR_JORNADA")?.nivel).toBe("ERROR");
    expect(de(adolescente.id, "2026-11-11").find((a) => a.codigo === "ADOLESCENTE_NOCTURNO")?.nivel).toBe("AVISO");
    expect(de(adolescente.id, "2026-11-11").some((a) => a.codigo === "MENOR_JORNADA")).toBe(false);
    expect(de(adolescente.id, "2026-11-18").find((a) => a.codigo === "ADOLESCENTE_NOCTURNO")?.nivel).toBe("ERROR");
  });
});

if (process.env.DEPURAR) {
  it("depurar", () => {
    const fechas = [...new Set(resultado.plan.map((d) => d.fecha))].sort();
    const lineas: string[] = [];
    for (const p of EMPLEADOS) {
      const celdas = fechas.map((f) => {
        const d = resultado.plan.find((x) => x.empleadoId === p.id && x.fecha === f);
        if (!d) return "  ?  ";
        if (d.estado !== "TURNO") return d.estado === "DESCANSO" ? (d.motivo ? " d+  " : " --  ") : " AUS ";
        return `${d.turnoId}${d.esTraslado ? "*" : " "} `;
      });
      lineas.push(`${p.id} ${p.sucursalId} ${p.puestoId} ${celdas.join("")}`);
    }
    writeFileSync(process.env.DEPURAR!, [
      lineas.join("\n"), "",
      resultado.alertas.filter((a) => a.nivel === "ERROR").slice(0, 15).map((a) => a.mensaje).join("\n"), "",
      resultado.faltantes.slice(0, 12).map((f) => `${f.sucursalId} ${f.puestoId} ${f.fecha} ${f.desde / 60}-${f.hasta / 60} ${f.programados}/${f.requeridos}`).join("\n"), "",
      resultado.notas.map((a) => a.mensaje).join("\n"),
    ].join("\n"));
  });
}
