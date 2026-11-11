import { describe, it, expect } from "vitest";
import { construirBoleta, nombreArchivoComprobante, sucursalDeBoleta, type DetalleBoleta } from "./boleta";
import { remitenteFormateado } from "@/lib/email/send";

const detalle = (over: Partial<DetalleBoleta> = {}): DetalleBoleta => ({
  salarioBase: 10000, montoHorasExtra: 0, bonificaciones: 0, otrosIngresos: 0,
  ihssEmpleado: 297.58, ivmEmpleado: 148.79, rapEmpleado: 0, afpEmpleado: 0, isr: 0,
  impuestoVecinal: 0, cooperativa: 0, prestamos: 0, adelantos: 0, ausencias: 0,
  otrosDeducciones: 0, totalBruto: 10000, totalDeducciones: 297.58, salarioNeto: 9702.42,
  diasTrabajados: 15, horasExtra: 0, ...over,
});
const ctx = {
  empresa: { nombre: "Comercial del Valle, S. de R.L.", rtn: "05019025147852" },
  empleado: { codigo: "EMP-0001", identidad: null, primerNombre: "Ana", primerApellido: "Mejía" },
  planilla: { tipo: "QUINCENAL", fechaInicio: new Date("2026-08-16T00:00:00Z"), fechaFin: new Date("2026-08-31T00:00:00Z") },
};
const conceptos = (d: DetalleBoleta) => construirBoleta(d, ctx).deducciones.map(([c]) => c);

describe("boleta — IHSS", () => {
  it("por porcentaje se muestra desglosado en EM e IVM", () => {
    expect(conceptos(detalle())).toEqual(["IHSS — Enfermedad y Maternidad", "IHSS — Invalidez, Vejez y Muerte"]);
  });

  it("con monto fijo se muestra en UNA línea que dice lo que es", () => {
    expect(conceptos(detalle({ ihssFijo: true, ihssEmpleado: 200, ivmEmpleado: 100 })))
      .toEqual(["IHSS — monto fijo"]);
  });
});

describe("boleta — lo que identifica el documento", () => {
  it("dice el tipo de planilla en palabras, no el nombre interno", () => {
    expect(construirBoleta(detalle(), ctx).tipoPlanilla).toBe("Planilla quincenal");
  });

  it("no redondea los días de una media jornada", () => {
    expect(construirBoleta(detalle({ diasTrabajados: 14.5 }), ctx).diasTrabajados).toBe("14.5");
    expect(construirBoleta(detalle({ diasTrabajados: 15 }), ctx).diasTrabajados).toBe("15");
  });

  it("escribe el neto en letras", () => {
    expect(construirBoleta(detalle(), ctx).netoEnLetras).toBe("NUEVE MIL SETECIENTOS DOS LEMPIRAS CON 42/100");
  });

  it("un neto negativo no impide emitir: se queda sin letras", () => {
    const b = construirBoleta(detalle({ salarioNeto: -50 }), ctx);
    expect(b.netoEnLetras).toBeNull();
    expect(b.salarioNeto).toContain("50.00");
  });

  it("lleva la fecha de pago sólo si la planilla la tiene", () => {
    expect(construirBoleta(detalle(), ctx).fechaPago).toBeNull();
    const conFecha = { ...ctx, planilla: { ...ctx.planilla, fechaPago: new Date("2026-08-31T00:00:00Z") } };
    expect(construirBoleta(detalle(), conFecha).fechaPago).toBe("31/08/2026");
  });
});

describe("boleta — dónde estaba la persona al pagarle", () => {
  const actual = { sucursal: { id: "hoy", nombre: "Oriente", direccion: "Calle actual", telefono: "1111" }, departamento: { nombre: "Ventas" } };
  const conEmpleado = { ...ctx, empleado: { ...ctx.empleado, ...actual } };

  it("usa la ubicación de la línea, aunque después se haya trasladado", () => {
    const b = construirBoleta(detalle(), {
      ...conEmpleado,
      ubicacion: { sucursal: { id: "antes", nombre: "Norte", direccion: "Calle vieja", telefono: "2222" }, division: { nombre: "Mayoreo" }, departamento: { nombre: "Finanzas" } },
    });
    expect(b).toMatchObject({ sucursal: "Norte", direccion: "Calle vieja", telefono: "2222", division: "Mayoreo", departamento: "Finanzas" });
  });

  it("las líneas que no la guardaron usan la actual del empleado", () => {
    const b = construirBoleta(detalle(), { ...conEmpleado, ubicacion: { sucursal: null, division: null, departamento: null } });
    expect(b).toMatchObject({ sucursal: "Oriente", departamento: "Ventas", division: null });
  });

  it("sucursalDeBoleta da la misma que el documento, de ahí sale el logo", () => {
    expect(sucursalDeBoleta({ sucursal: { id: "antes", nombre: "Norte" } }, conEmpleado.empleado)?.id).toBe("antes");
    expect(sucursalDeBoleta({ sucursal: null }, conEmpleado.empleado)?.id).toBe("hoy");
    expect(sucursalDeBoleta(undefined, ctx.empleado)).toBeNull();
  });

  it("no repite el nombre cuando la sucursal se llama como la empresa", () => {
    const b = construirBoleta(detalle(), { ...ctx, ubicacion: { sucursal: { nombre: " comercial DEL VALLE, s. de r.l. " } } });
    expect(b.sucursal).toBeNull();
  });

  it("sin dirección de la sucursal usa la de la empresa", () => {
    const b = construirBoleta(detalle(), { ...ctx, empresa: { ...ctx.empresa, direccion: "Sede", telefono: "9999" }, ubicacion: { sucursal: { nombre: "Norte" } } });
    expect(b).toMatchObject({ direccion: "Sede", telefono: "9999" });
  });
});

describe("nombreArchivoComprobante", () => {
  const fin = new Date("2026-08-31T00:00:00Z");

  it("dice de quién y de qué fecha es", () => {
    expect(nombreArchivoComprobante("EMP-0001", fin)).toBe("comprobante-EMP-0001-2026-08-31.pdf");
  });

  it("no deja que un código raro rompa el encabezado de la descarga", () => {
    expect(nombreArchivoComprobante('A"B\r\nX: y/../z', fin)).toBe("comprobante-A-B-X-y-z-2026-08-31.pdf");
    expect(nombreArchivoComprobante("///", fin)).toBe("comprobante-empleado-2026-08-31.pdf");
  });
});

describe("remitenteFormateado — encabezado From", () => {
  it("arma el formato estándar", () => {
    expect(remitenteFormateado("Recursos Humanos", "rrhh@x.hn")).toBe('"Recursos Humanos" <rrhh@x.hn>');
  });

  it("no permite que el nombre inyecte encabezados ni rompa las comillas", () => {
    // Un salto de línea en el nombre abriría la puerta a añadir un Bcc oculto.
    const r = remitenteFormateado('RRHH"\r\nBcc: espia@x.com', "rrhh@x.hn");
    expect(r).not.toMatch(/[\r\n]/);
    expect(r).toBe('"RRHHBcc: espia@x.com" <rrhh@x.hn>');
  });
});
