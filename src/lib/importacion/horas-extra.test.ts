import { describe, it, expect } from "vitest";
import { validar, type CatalogosHorasExtra, type EmpleadoRef, type MarcajeRef } from "./horas-extra";
import type { ModoImportacion } from "./tipos";

const ANA: EmpleadoRef = {
  id: "e1", codigo: "EMP-0001", nombre: "Ana Núñez", sucursalId: "s1", departamentoId: "d1",
  estado: "ACTIVO", fechaIngreso: "2024-01-15", fechaSalida: null,
};

const RELOJ: MarcajeRef = {
  diurnas: "1.50", mixtas: "0", nocturnas: "0", feriado: "0", esAusencia: false, fuente: "BIOMETRICO", observacion: null,
};

function catalogos(over: Partial<CatalogosHorasExtra> & { empleado?: Partial<EmpleadoRef> } = {}): CatalogosHorasExtra {
  const { empleado, ...resto } = over;
  return {
    empleados: new Map([
      ["emp-0001", { ...ANA, ...empleado }],
      ["emp-0002", { ...ANA, id: "e2", codigo: "EMP-0002", nombre: "Luis Discua", sucursalId: "s2" }],
    ]),
    marcajes: new Map(),
    planillas: [],
    hoy: "2026-11-03",
    ...resto,
  };
}

const CABECERA = "Codigo Empleado,Fecha,Extra 25%,Extra 50%,Extra 75%,Extra 100%,Observacion";
const correr = (
  filas: string,
  cat: CatalogosHorasExtra = catalogos(),
  modo: ModoImportacion = "CREAR_O_ACTUALIZAR",
  alcanza: (e: { sucursalId: string }) => boolean = () => true
) => validar(`${CABECERA}\n${filas}`, cat, modo, alcanza);

const errores = (r: ReturnType<typeof validar>) => r.incidencias.filter((i) => i.severidad === "ERROR");
const avisos = (r: ReturnType<typeof validar>) => r.incidencias.filter((i) => i.severidad === "AVISO");

describe("altas", () => {
  it("registra las horas por jornada, y lo que va en blanco vale cero", () => {
    const r = correr("EMP-0001,02/11/2026,2.5,,1,,Inventario");
    expect(errores(r)).toEqual([]);
    expect(r.filas[0]).toMatchObject({
      accion: "CREAR", empleadoId: "e1", fecha: "2026-11-02T00:00:00.000Z",
      diurnas: "2.50", mixtas: "0.00", nocturnas: "1.00", feriado: "0.00", observacion: "Inventario",
    });
  });

  it("lee la fecha con el día primero", () => {
    expect(correr("EMP-0001,03/04/2026,1").filas[0].fecha).toBe("2026-04-03T00:00:00.000Z");
  });

  it("un cero en un día sin marcaje no escribe nada", () => {
    const r = correr("EMP-0001,02/11/2026,0");
    expect(r.filas).toEqual([]);
    expect(r.totalOmitir).toBe(1);
  });
});

describe("reemplaza lo del día", () => {
  const conReloj = () => catalogos({ marcajes: new Map([["e1|2026-11-02", RELOJ]]) });

  it("actualiza y avisa de que pisa lo del reloj", () => {
    const r = correr("EMP-0001,02/11/2026,3", conReloj());
    expect(r.filas[0].accion).toBe("ACTUALIZAR");
    expect(r.filas[0].cambios).toEqual(["Extra 25% 1.50 → 3.00"]);
    expect(avisos(r)[0].mensaje).toContain("por el reloj");
  });

  it("subir lo mismo otra vez no cambia nada", () => {
    const r = correr("EMP-0001,02/11/2026,1.50", conReloj());
    expect(r.filas).toEqual([]);
    expect(r.totalOmitir).toBe(1);
    expect(avisos(r)).toEqual([]);
  });

  it("un cero borra las horas que tenía", () => {
    expect(correr("EMP-0001,02/11/2026,0", conReloj()).filas[0].diurnas).toBe("0.00");
  });

  it("no avisa si lo que reemplaza vino de otra plantilla", () => {
    const cat = catalogos({ marcajes: new Map([["e1|2026-11-02", { ...RELOJ, fuente: "PLANTILLA" }]]) });
    expect(avisos(correr("EMP-0001,02/11/2026,3", cat))).toEqual([]);
  });

  it("una observación en blanco conserva la que tenía", () => {
    const cat = catalogos({ marcajes: new Map([["e1|2026-11-02", { ...RELOJ, observacion: "Vieja" }]]) });
    const r = correr("EMP-0001,02/11/2026,3,,,,", cat);
    expect(r.filas[0].observacion).toBeNull();
    expect(r.filas[0].cambios).toEqual(["Extra 25% 1.50 → 3.00"]);
  });

  it("respeta los modos", () => {
    expect(correr("EMP-0001,02/11/2026,3", conReloj(), "CREAR").filas).toEqual([]);
    expect(correr("EMP-0001,01/11/2026,3", conReloj(), "ACTUALIZAR").filas).toEqual([]);
  });

  it("no le carga horas a un día con ausencia", () => {
    const cat = catalogos({ marcajes: new Map([["e1|2026-11-02", { ...RELOJ, esAusencia: true }]]) });
    expect(errores(correr("EMP-0001,02/11/2026,3", cat))[0].mensaje).toContain("ausencia");
  });
});

describe("filas que no se pueden pagar", () => {
  it("rechaza fechas futuras, anteriores al ingreso y posteriores a la salida", () => {
    expect(errores(correr("EMP-0001,04/11/2026,1"))[0].mensaje).toContain("futura");
    expect(errores(correr("EMP-0001,14/01/2024,1"))[0].mensaje).toContain("ingreso");
    const conSalida = catalogos({ empleado: { estado: "INACTIVO", fechaSalida: "2026-10-31" } });
    expect(errores(correr("EMP-0001,01/11/2026,1", conSalida))[0].mensaje).toContain("salida");
    expect(errores(correr("EMP-0001,31/10/2026,1", conSalida))).toEqual([]);
  });

  it("rechaza a un suspendido y a un inactivo sin fecha de salida", () => {
    expect(errores(correr("EMP-0001,02/11/2026,1", catalogos({ empleado: { estado: "SUSPENDIDO" } })))[0].mensaje).toContain("suspendido");
    expect(errores(correr("EMP-0001,02/11/2026,1", catalogos({ empleado: { estado: "INACTIVO" } })))[0].mensaje).toContain("inactivo");
  });

  it("sólo avisa si está de vacaciones o con permiso", () => {
    const r = correr("EMP-0001,02/11/2026,1", catalogos({ empleado: { estado: "VACACIONES" } }));
    expect(errores(r)).toEqual([]);
    expect(avisos(r)[0].mensaje).toContain("vacaciones");
    expect(r.filas).toHaveLength(1);
  });

  it("rechaza un día de una planilla aprobada o pagada en la que está", () => {
    const planillas = [{ inicio: "2026-11-01", fin: "2026-11-15", estado: "APROBADA", empleados: new Set(["e1"]) }];
    expect(errores(correr("EMP-0001,02/11/2026,1", catalogos({ planillas })))[0].mensaje).toContain("aprobada");
  });

  it("no le afecta la planilla de otra sucursal", () => {
    const planillas = [{ inicio: "2026-11-01", fin: "2026-11-15", estado: "PAGADA", empleados: new Set(["e2"]) }];
    expect(errores(correr("EMP-0001,02/11/2026,1", catalogos({ planillas })))).toEqual([]);
  });

  it("en un borrador avisa que hay que recalcularlo", () => {
    const planillas = [{ inicio: "2026-11-01", fin: "2026-11-15", estado: "BORRADOR", empleados: new Set(["e1"]) }];
    const r = correr("EMP-0001,02/11/2026,1", catalogos({ planillas }));
    expect(errores(r)).toEqual([]);
    expect(avisos(r)[0].mensaje).toContain("pulse Recalcular en ese borrador");
  });

  it("en una calculada avisa que hay que volverla a borrador", () => {
    const planillas = [{ inicio: "2026-11-01", fin: "2026-11-15", estado: "CALCULADA", empleados: new Set(["e1"]) }];
    const r = correr("EMP-0001,02/11/2026,1", catalogos({ planillas }));
    expect(errores(r)).toEqual([]);
    expect(avisos(r)[0].mensaje).toContain("vuélvala a borrador");
  });

  it("rechaza a quien está fuera de su alcance", () => {
    const r = correr("EMP-0002,02/11/2026,1", catalogos(), "CREAR_O_ACTUALIZAR", (e) => e.sucursalId === "s1");
    expect(errores(r)[0].mensaje).toContain("alcance");
    expect(r.filas).toEqual([]);
  });
});

describe("tope diario", () => {
  it("avisa al pasar de 4 extras con jornada de 8 horas", () => {
    const r = correr("EMP-0001,02/11/2026,4,0.5");
    expect(errores(r)).toEqual([]);
    expect(avisos(r)[0].mensaje).toContain("Art. 332");
  });

  it("exactamente 4 no avisa", () => {
    expect(avisos(correr("EMP-0001,02/11/2026,2,2"))).toEqual([]);
  });

  it("rechaza más de 12 extras en un día", () => {
    expect(errores(correr("EMP-0001,02/11/2026,7,6"))[0].mensaje).toContain("Art. 332");
  });

  it("las horas al 100 % no cuentan para el tope de extras", () => {
    expect(avisos(correr("EMP-0001,02/11/2026,1,,,8"))).toEqual([]);
  });
});

describe("formato", () => {
  it("cada porcentaje llega a su jornada", () => {
    const r = correr("EMP-0001,02/11/2026,1,2,3,4");
    expect(r.filas[0]).toMatchObject({ diurnas: "1.00", mixtas: "2.00", nocturnas: "3.00", feriado: "4.00" });
  });

  it("acepta el porcentaje escrito con un espacio", () => {
    const r = validar("Codigo Empleado,Fecha,Extra 25 %\nEMP-0001,02/11/2026,1", catalogos(), "CREAR_O_ACTUALIZAR", () => true);
    expect(r.columnasDesconocidas).toEqual([]);
    expect(r.filas[0].diurnas).toBe("1.00");
  });

  it("una fila repetida en el archivo es un error", () => {
    expect(errores(correr("EMP-0001,02/11/2026,1\nEMP-0001,2026-11-02,2"))[0].mensaje).toContain("línea 2");
  });

  it("una fila sin horas es un error, no un cero", () => {
    expect(errores(correr("EMP-0001,02/11/2026,,,,,"))[0].mensaje).toContain("No indica horas");
  });

  it("rechaza horas imposibles o escritas mal", () => {
    expect(errores(correr("EMP-0001,02/11/2026,25"))[0].columna).toBe("Extra 25%");
    expect(errores(correr("EMP-0001,02/11/2026,dos"))[0].columna).toBe("Extra 25%");
    expect(errores(correr("EMP-0001,02/11/2026,-1"))[0].columna).toBe("Extra 25%");
  });

  it("exige las columnas obligatorias y alguna de horas", () => {
    expect(errores(validar("Fecha,Extra 25%\n02/11/2026,1", catalogos(), "CREAR_O_ACTUALIZAR", () => true))[0].mensaje).toContain("empleado_codigo");
    expect(errores(validar("Codigo Empleado,Fecha\nEMP-0001,02/11/2026", catalogos(), "CREAR_O_ACTUALIZAR", () => true))[0].mensaje).toContain("columna de horas");
  });

  it("ignora la columna informativa del nombre al volver a subir una exportación", () => {
    const r = validar("Codigo Empleado,Empleado,Fecha,Extra 25%\nEMP-0001,Ana,02/11/2026,1", catalogos(), "CREAR_O_ACTUALIZAR", () => true);
    expect(r.columnasDesconocidas).toEqual([]);
    expect(r.filas).toHaveLength(1);
  });
});
