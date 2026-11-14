import { describe, expect, it } from "vitest";
import { validar, type CatalogosHorarios } from "./horarios";

const emp = (id: string, codigo: string, sucursalId: string, extra = {}) => ({
  id, codigo, nombre: `Persona ${codigo}`, sucursalId, departamentoId: "d1", estado: "ACTIVO", conPuesto: true,
  fechaIngreso: "2024-01-01", fechaSalida: null, ...extra,
});

function cat(over: Partial<CatalogosHorarios> = {}): CatalogosHorarios {
  const ana = emp("e1", "SPS-1", "SPS");
  const luis = emp("e2", "CHO-1", "CHO");
  const eva = emp("e3", "EP-1", "EP");
  return {
    plan: { id: "p1", nombre: "Semana 2", estado: "BORRADOR", desde: "2026-11-02", hasta: "2026-11-08", sucursalesIds: ["SPS", "CHO"] },
    empleados: new Map([["sps-1", ana], ["cho-1", luis], ["ep-1", eva]]),
    porIdentidad: new Map([["0501199801234", ana]]),
    sucursales: new Map([
      ["san pedro sula", { id: "SPS", nombre: "San Pedro Sula" }], ["sps", { id: "SPS", nombre: "San Pedro Sula" }],
      ["choloma", { id: "CHO", nombre: "Choloma" }], ["el progreso", { id: "EP", nombre: "El Progreso" }],
    ]),
    turnos: new Map([
      ["tda-m", { id: "t1", codigo: "TDA-M", entrada: 480, salida: 1020, pausa: 60, almuerzoMinutos: 60, almuerzoDesdeMin: 360 }],
      ["noche", { id: "t2", codigo: "NOCHE", entrada: 1320, salida: 1800, pausa: 0, almuerzoMinutos: 60, almuerzoDesdeMin: 600 }],
    ]),
    existentes: new Map(),
    enOtrosPlanes: new Map(),
    traslados: [],
    ...over,
  };
}

const CAB = "Codigo Empleado,DNI,Fecha,Sucursal,Turno,Entrada,Salida,Observacion";
const correr = (filas: string, c = cat(), modo: "CREAR" | "ACTUALIZAR" | "CREAR_O_ACTUALIZAR" = "CREAR_O_ACTUALIZAR") =>
  validar(`${CAB}\n${filas}`, c, modo, () => true);
const errores = (r: ReturnType<typeof validar>) => r.incidencias.filter((i) => i.severidad === "ERROR");

describe("horarios: filas válidas", () => {
  it("turno del catálogo en su sucursal", () => {
    const r = correr("SPS-1,,02/11/2026,,TDA-M,,,");
    expect(errores(r)).toEqual([]);
    expect(r.filas[0]).toMatchObject({ empleadoId: "e1", fecha: "2026-11-02", crearTrasladoA: null });
    expect(r.filas[0].datos).toMatchObject({ estado: "TURNO", turnoId: "t1", entrada: 480, salida: 1020, pausa: 60, sucursalId: "SPS", esTraslado: false });
  });

  it("por DNI, descanso y ausencia con su motivo", () => {
    const r = correr("SPS-1,,02/11/2026,,D,,,\n,0501-1998-01234,03/11/2026,,A,,,Cita médica");
    expect(errores(r)).toEqual([]);
    expect(r.filas.map((f) => f.datos.estado)).toEqual(["DESCANSO", "AUSENCIA"]);
    expect(r.filas[1].datos.motivo).toBe("Cita médica");
  });

  it("horas propias; una salida menor que la entrada termina al día siguiente", () => {
    const r = correr("SPS-1,,02/11/2026,,,22:00,06:00,");
    expect(errores(r)).toEqual([]);
    expect(r.filas[0].datos).toMatchObject({ entrada: 1320, salida: 1800, turnoId: null });
  });

  it("otra sucursal del plan para alguien del plan: traslado interno, sin crear traslado", () => {
    const r = correr("SPS-1,,02/11/2026,Choloma,TDA-M,,,");
    expect(r.filas[0].datos).toMatchObject({ sucursalId: "CHO", esTraslado: true });
    expect(r.filas[0].crearTrasladoA).toBeNull();
  });

  it("alguien de fuera del plan con sucursal: se crea su traslado temporal", () => {
    const r = correr("EP-1,,02/11/2026,SPS,TDA-M,,,");
    expect(errores(r)).toEqual([]);
    expect(r.filas[0]).toMatchObject({ crearTrasladoA: "SPS" });
    expect(r.filas[0].cambios).toContain("Crea el traslado temporal desde El Progreso");
  });

  it("la observación de la fila queda como motivo del traslado que crea", () => {
    const r = correr("EP-1,,02/11/2026,SPS,TDA-M,,,Inventario de fin de mes");
    expect(errores(r)).toEqual([]);
    expect(r.filas[0]).toMatchObject({ crearTrasladoA: "SPS", observacion: "Inventario de fin de mes" });
  });

  it("alguien de fuera ya trasladado: sin sucursal, va a la del traslado", () => {
    const c = cat({ traslados: [{ id: "t", empleadoId: "e3", sucursalOrigenId: "EP", sucursalDestinoId: "CHO", desde: "2026-11-01", hasta: "2026-11-05", motivo: null, empleadoNombre: "", origenNombre: "El Progreso", destinoNombre: "Choloma" }] });
    const r = correr("EP-1,,03/11/2026,,TDA-M,,,", c);
    expect(errores(r)).toEqual([]);
    expect(r.filas[0]).toMatchObject({ crearTrasladoA: null });
    expect(r.filas[0].datos.sucursalId).toBe("CHO");
  });
});

describe("horarios: errores por fila", () => {
  it("fuera del plan, empleado o turno inexistentes", () => {
    expect(errores(correr("SPS-1,,20/11/2026,,TDA-M,,,"))[0].mensaje).toContain("fuera del plan");
    expect(errores(correr("XX-9,,02/11/2026,,TDA-M,,,"))[0].mensaje).toContain("XX-9");
    expect(errores(correr("SPS-1,,02/11/2026,,ZZZ,,,"))[0].columna).toBe("Turno");
  });

  it("sin turno ni horas; hora mal escrita; descanso con horas", () => {
    expect(errores(correr("SPS-1,,02/11/2026,,,,,"))[0].mensaje).toContain("Ponga el turno");
    expect(errores(correr("SPS-1,,02/11/2026,,,8am,17:00,"))[0].columna).toBe("Entrada");
    expect(errores(correr("SPS-1,,02/11/2026,,D,08:00,17:00,"))[0].mensaje).toContain("no lleva entrada");
  });

  it("sucursal que no está en el plan o inexistente", () => {
    expect(errores(correr("SPS-1,,02/11/2026,El Progreso,TDA-M,,,"))[0].mensaje).toContain("no está en este plan");
    expect(errores(correr("SPS-1,,02/11/2026,Tegucigalpa,TDA-M,,,"))[0].columna).toBe("Sucursal");
  });

  it("alguien de fuera sin sucursal ni traslado: hay que decir a dónde va", () => {
    expect(errores(correr("EP-1,,02/11/2026,,TDA-M,,,"))[0].mensaje).toContain("indique a cuál se traslada");
  });

  it("alguien del plan prestado fuera ese día no trabaja aquí", () => {
    const c = cat({ traslados: [{ id: "t", empleadoId: "e1", sucursalOrigenId: "SPS", sucursalDestinoId: "EP", desde: "2026-11-02", hasta: "2026-11-03", motivo: null, empleadoNombre: "", origenNombre: "San Pedro Sula", destinoNombre: "El Progreso" }] });
    expect(errores(correr("SPS-1,,02/11/2026,,TDA-M,,,", c))[0].mensaje).toContain("trasladado a El Progreso");
  });

  it("cruce de turnos: ya tiene turno ese día en otro plan publicado", () => {
    const c = cat({ enOtrosPlanes: new Map([["e1|2026-11-02", "Semana 2 Choloma"]]) });
    expect(errores(correr("SPS-1,,02/11/2026,,TDA-M,,,", c))[0].mensaje).toContain("Semana 2 Choloma");
    // Un descanso no se cruza con nada.
    expect(errores(correr("SPS-1,,02/11/2026,,D,,,", c))).toEqual([]);
  });

  it("dos filas para la misma persona y día", () => {
    expect(errores(correr("SPS-1,,02/11/2026,,TDA-M,,,\nSPS-1,,02/11/2026,,D,,,"))[0].mensaje).toContain("línea 2");
  });

  it("un plan publicado no se importa", () => {
    const r = correr("SPS-1,,02/11/2026,,TDA-M,,,", cat({ plan: { ...cat().plan, estado: "PUBLICADO" } }));
    expect(errores(r)[0].mensaje).toContain("borrador");
    expect(r.filas).toEqual([]);
  });
});

describe("horarios: modos", () => {
  const c = cat({ existentes: new Map([["e1|2026-11-02", { estado: "DESCANSO", turnoCodigo: null, sucursalId: null }]]) });
  it("crear y actualizar dice qué había antes", () => {
    const r = correr("SPS-1,,02/11/2026,,TDA-M,,,", c);
    expect(r.filas[0].accion).toBe("ACTUALIZAR");
    expect(r.filas[0].cambios[0]).toBe("Antes: descanso");
  });
  it("sólo altas omite lo que ya está", () => {
    const r = correr("SPS-1,,02/11/2026,,TDA-M,,,", c, "CREAR");
    expect(r.filas).toEqual([]);
    expect(r.totalOmitir).toBe(1);
  });
});
