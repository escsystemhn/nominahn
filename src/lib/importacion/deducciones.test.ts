import { describe, it, expect } from "vitest";
import { validar, type CatalogosDeducciones, type DeduccionExistente } from "./deducciones";
import type { ModoImportacion } from "./tipos";

const PRESTAMO_VIGENTE: DeduccionExistente = {
  id: "d1",
  empleadoId: "e1",
  tipoDeduccionId: "t-prestamo",
  fechaInicio: "2026-01-01",
  monto: "3000",
  cuotasMeses: 10,
  cuotasPagadas: 0,
  fechaFin: null,
  activo: true,
  observacion: null,
};

/** Un préstamo del que la planilla ya cobró cuotas: su saldo ya no deriva del monto. */
const PRESTAMO_AMORTIZADO: DeduccionExistente = {
  ...PRESTAMO_VIGENTE,
  id: "d2",
  empleadoId: "e2",
  fechaInicio: "2026-02-01",
  cuotasPagadas: 4,
};

function catalogos(): CatalogosDeducciones {
  return {
    empleados: new Map([
      [
        "emp-0001",
        {
          id: "e1", codigo: "EMP-0001", nombre: "Ana Núñez",
          sucursalId: "suc-tgu", departamentoId: "dep-conta",
          ultimoPeriodoCerrado: new Date("2026-07-31T00:00:00.000Z"),
        },
      ],
      [
        "emp-0002",
        {
          id: "e2", codigo: "EMP-0002", nombre: "Luis Discua",
          sucursalId: "suc-sps", departamentoId: "dep-ventas",
          ultimoPeriodoCerrado: null,
        },
      ],
    ]),
    tipos: new Map([
      ["prestamo", { id: "t-prestamo", nombre: "Préstamo Personal", activo: true, esLegal: false }],
      ["coop", { id: "t-coop", nombre: "Cooperativa", activo: true, esLegal: false }],
      ["ihss", { id: "t-ihss", nombre: "IHSS", activo: true, esLegal: true }],
      ["viejo", { id: "t-viejo", nombre: "Fondo Antiguo", activo: false, esLegal: false }],
    ]),
    porClaveNatural: new Map([
      ["e1|t-prestamo|2026-01-01", PRESTAMO_VIGENTE],
      ["e2|t-prestamo|2026-02-01", PRESTAMO_AMORTIZADO],
    ]),
    activasPorTipo: new Map([
      ["e1|t-prestamo", [PRESTAMO_VIGENTE]],
      ["e2|t-prestamo", [PRESTAMO_AMORTIZADO]],
    ]),
  };
}

const CABECERA = "Codigo Empleado,Codigo Deduccion,Monto,Cuotas,Fecha Inicio";
const correr = (
  csv: string,
  modo: ModoImportacion = "CREAR_O_ACTUALIZAR",
  alcanza: (e: { id: string; sucursalId: string; departamentoId: string }) => boolean = () => true
) => validar(csv, catalogos(), modo, alcanza);

const errores = (r: ReturnType<typeof validar>) => r.incidencias.filter((i) => i.severidad === "ERROR");
const avisos = (r: ReturnType<typeof validar>) => r.incidencias.filter((i) => i.severidad === "AVISO");

describe("altas", () => {
  it("acepta una deducción nueva y arranca el saldo con el monto", () => {
    const r = correr(`${CABECERA}\nEMP-0002,COOP,1200.00,6,01/09/2026`);
    expect(errores(r)).toHaveLength(0);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({
      accion: "CREAR",
      empleadoId: "e2",
      tipoDeduccionId: "t-coop",
      monto: "1200.00",
      cuotasMeses: 6,
      activo: true,
      inicializaSaldo: true,
    });
  });

  it("rechaza un empleado o un tipo que no existen", () => {
    const r = correr(`${CABECERA}\nEMP-9999,COOP,1200,6,01/09/2026\nEMP-0001,INVENTADO,500,,01/09/2026`);
    expect(errores(r).some((e) => e.columna === "Codigo Empleado")).toBe(true);
    expect(errores(r).some((e) => e.columna === "Codigo Deduccion")).toBe(true);
    expect(r.filas).toHaveLength(0);
  });

  it("rechaza un tipo de deducción desactivado", () => {
    const r = correr(`${CABECERA}\nEMP-0002,VIEJO,500,,01/09/2026`);
    expect(errores(r).some((e) => e.mensaje.includes("desactivado"))).toBe(true);
  });

  /**
   * IHSS, RAP e INFOP los calcula el motor de nómina a partir de su
   * configuración. Asignarlos además como deducción individual los cobraría
   * dos veces al mismo trabajador.
   */
  it("no deja asignar a mano una deducción legal", () => {
    const r = correr(`${CABECERA}\nEMP-0002,IHSS,500,,01/09/2026`);
    expect(errores(r).some((e) => e.mensaje.includes("legal"))).toBe(true);
    expect(r.filas).toHaveLength(0);
  });

  it("exige un monto mayor que cero", () => {
    const r = correr(`${CABECERA}\nEMP-0002,COOP,0,,01/09/2026`);
    expect(errores(r).some((e) => e.columna === "Monto")).toBe(true);
  });

  it("avisa cuando el empleado ya tiene otra deducción activa del mismo tipo", () => {
    const r = correr(`${CABECERA}\nEMP-0001,PRESTAMO,5000,12,01/10/2026`);
    expect(errores(r)).toHaveLength(0);
    expect(avisos(r).some((a) => a.mensaje.includes("ya tiene 1 deducción"))).toBe(true);
    expect(r.filas).toHaveLength(1); // se permite: puede ser un segundo préstamo
  });

  it("avisa cuando arranca dentro de un período ya cerrado", () => {
    const r = correr(`${CABECERA}\nEMP-0001,COOP,800,4,01/06/2026`);
    expect(errores(r)).toHaveLength(0);
    expect(avisos(r).some((a) => a.columna === "Fecha Inicio")).toBe(true);
  });
});

describe("clave natural", () => {
  /**
   * Empleado + tipo + fecha de inicio. Sin ella, subir el mismo archivo dos
   * veces le cobraría dos veces al trabajador.
   */
  it("reimportar la misma fila actualiza en vez de duplicar", () => {
    const r = correr(`${CABECERA}\nEMP-0001,PRESTAMO,3500,10,01/01/2026`);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].accion).toBe("ACTUALIZAR");
    expect(r.filas[0].deduccionId).toBe("d1");
  });

  it("una fila idéntica a lo guardado no genera escritura", () => {
    const r = correr(`${CABECERA}\nEMP-0001,PRESTAMO,3000,10,01/01/2026`);
    expect(r.filas).toHaveLength(0);
    expect(r.totalOmitir).toBe(1);
  });

  it("detecta dos filas del archivo con la misma clave natural", () => {
    const csv =
      `${CABECERA}\nEMP-0001,PRESTAMO,3500,10,01/01/2026\nEMP-0001,PRESTAMO,4000,10,01/01/2026`;
    expect(errores(correr(csv)).some((e) => e.mensaje.includes("línea 2"))).toBe(true);
  });
});

describe("protección del saldo", () => {
  /**
   * En cuanto una planilla cobró una cuota, `saldo` y `cuotasPagadas` dejan de
   * derivarse del monto. Reescribirlo desde un CSV dejaría el pendiente
   * descuadrado sin que nada lo delate.
   */
  it("no deja cambiar el monto de una deducción ya amortizada", () => {
    const r = correr(`${CABECERA}\nEMP-0002,PRESTAMO,9000,10,01/02/2026`);
    const e = errores(r).find((x) => x.columna === "Monto");
    expect(e?.mensaje).toContain("4 cuota(s) cobrada(s)");
    expect(r.filas).toHaveLength(0);
  });

  it("sí deja cambiar otros campos de una deducción amortizada", () => {
    const csv =
      "Codigo Empleado,Codigo Deduccion,Monto,Cuotas,Fecha Inicio,Activa\n" +
      "EMP-0002,PRESTAMO,3000,10,01/02/2026,No";
    const r = correr(csv);
    expect(errores(r)).toHaveLength(0);
    expect(r.filas[0].activo).toBe(false);
    expect(r.filas[0].cambios).toContain("Desactivar");
  });

  it("cambiar el monto de una deducción sin cuotas cobradas sí se permite", () => {
    const r = correr(`${CABECERA}\nEMP-0001,PRESTAMO,3500,10,01/01/2026`);
    expect(errores(r)).toHaveLength(0);
    expect(r.filas[0].cambios.some((c) => c.startsWith("Monto"))).toBe(true);
  });
});

describe("alcance de datos", () => {
  it("bloquea asignar una deducción a un empleado fuera del alcance", () => {
    const soloTgu = (e: { sucursalId: string }) => e.sucursalId === "suc-tgu";
    const r = correr(`${CABECERA}\nEMP-0002,COOP,1200,6,01/09/2026`, "CREAR_O_ACTUALIZAR", soloTgu);
    expect(errores(r).some((e) => e.mensaje.includes("fuera de su alcance"))).toBe(true);
    expect(r.filas).toHaveLength(0);
  });
});

describe("cabeceras obligatorias", () => {
  it("un archivo sin las columnas mínimas se rechaza con un mensaje claro", () => {
    const r = correr("Codigo Empleado,Monto\nEMP-0001,500");
    expect(errores(r).some((e) => e.mensaje.includes("tipo_deduccion_codigo"))).toBe(true);
    expect(errores(r).some((e) => e.mensaje.includes("fecha_inicio"))).toBe(true);
    expect(r.filas).toHaveLength(0);
  });

  it("acepta un archivo generado por la propia exportación", () => {
    const csv =
      "Codigo Empleado,Empleado,Codigo Deduccion,Tipo Deduccion,Monto,Cuotas,Fecha Inicio,Fecha Fin,Activa,Observacion,Saldo,Cuotas Pagadas\n" +
      'EMP-0002,Luis Discua,COOP,Cooperativa,1200.00,6,01/09/2026,,Si,"Aporte mensual",1200.00,0';
    const r = correr(csv);
    expect(errores(r)).toHaveLength(0);
    expect(r.columnasDesconocidas).toEqual([]);
    expect(r.filas[0].observacion).toBe("Aporte mensual");
  });
});

describe("fechas", () => {
  it("rechaza una fecha fin anterior al inicio", () => {
    const csv = `${CABECERA},Fecha Fin\nEMP-0002,COOP,1200,6,01/09/2026,01/08/2026`;
    expect(errores(correr(csv)).some((e) => e.columna === "Fecha Fin")).toBe(true);
  });
});
