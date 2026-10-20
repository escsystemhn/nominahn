import { describe, it, expect } from "vitest";
import { construirBoleta, type DetalleBoleta } from "./boleta";
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
