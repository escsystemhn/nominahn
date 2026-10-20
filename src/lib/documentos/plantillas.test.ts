import { describe, it, expect } from "vitest";
import {
  construirContexto,
  nacionalidadConcordada,
  resolverPlantilla,
  variablesDesconocidas,
  fechaLarga,
  fechaEnLetras,
  aniosCumplidos,
  textoAntiguedad,
  PLANTILLAS_POR_OMISION,
  LINEA_VACIA,
  type DatosContexto,
} from "./plantillas";

const f = (s: string) => new Date(`${s}T00:00:00Z`);

const base: DatosContexto = {
  empleado: {
    primerNombre: "Wendy", segundoNombre: "Paola", primerApellido: "Andino", segundoApellido: "Cruz",
    identidad: "0501-1990-01234", rtn: null, codigo: "SPS-002", genero: "F", estadoCivil: "Soltera",
    nacionalidad: "Hondureña", direccion: "Col. Trejo, San Pedro Sula", fechaNacimiento: f("1990-03-20"),
    fechaIngreso: f("2023-08-01"), tipoContrato: "INDEFINIDO", tipoPlanilla: "QUINCENAL", salarioBase: 13250,
    cuentaBancaria: "123456789", puesto: "Analista de RRHH", departamento: "Recursos Humanos",
    sucursal: "Sucursal San Pedro Sula", sucursalDireccion: "Barrio Guamilito",
  },
  contrato: { fechaInicio: f("2023-08-01"), jornada: null, horario: null },
  turno: { jornada: "diurna", horario: "de lunes a viernes de 08:00 a 17:00" },
  empresa: { nombre: "Comercial del Valle, S. de R.L.", rtn: "05019000123456", direccion: "SPS", telefono: null },
  firmante: { nombre: "Ana Mejía", cargo: "Gerente de RRHH", identidad: "0501-1980-00001", ciudad: "San Pedro Sula" },
  destinatario: "",
  hoy: f("2026-10-15"),
  moneda: (n) => `L ${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
};

describe("fechas y tiempos", () => {
  it("fecha larga y en letras", () => {
    expect(fechaLarga(f("2026-10-15"))).toBe("15 de octubre de 2026");
    expect(fechaEnLetras(f("2026-10-15"))).toBe("a los quince días del mes de octubre del año dos mil veintiséis");
    expect(fechaEnLetras(f("2026-01-01"))).toBe("al primer día del mes de enero del año dos mil veintiséis");
    expect(fechaEnLetras(f("2026-03-21"))).toBe("a los veintiún días del mes de marzo del año dos mil veintiséis");
  });
  it("edad y antigüedad por calendario", () => {
    expect(aniosCumplidos(f("1990-03-20"), f("2026-03-19"))).toBe(35);
    expect(aniosCumplidos(f("1990-03-20"), f("2026-03-20"))).toBe(36);
    expect(textoAntiguedad(f("2023-08-01"), f("2026-10-15"))).toBe("3 años y 2 meses");
    expect(textoAntiguedad(f("2026-09-20"), f("2026-10-15"))).toBe("menos de un mes");
    expect(textoAntiguedad(f("2025-10-15"), f("2026-10-15"))).toBe("1 año");
  });
});

describe("contexto y resolución", () => {
  it("trato y concordancia según el género", () => {
    const c = construirContexto(base);
    expect(c["empleado.tratamiento"]).toBe("la señora");
    expect(c["empleado.identificadoA"]).toBe("identificada");
    expect(construirContexto({ ...base, empleado: { ...base.empleado, genero: "Masculino" } })["empleado.tratamiento"]).toBe("el señor");
  });

  it("salario en número y en letras, turno sobre contrato, destinatario por omisión", () => {
    const c = construirContexto(base);
    expect(c["empleado.salarioMensual"]).toBe("L 13,250.00");
    expect(c["empleado.salarioMensualLetras"]).toBe("TRECE MIL DOSCIENTOS CINCUENTA LEMPIRAS CON 00/100");
    expect(c["contrato.horario"]).toBe("de lunes a viernes de 08:00 a 17:00");
    expect(c["contrato.formaPago"]).toBe("quincenal");
    expect(c["contrato.medioPago"]).toMatch(/depósito/);
    expect(c.destinatario).toBe("A quien interese");
    expect(c["empleado.edad"]).toBe("36");
  });

  it("un dato vacío queda como línea para llenar y se informa", () => {
    const c = construirContexto({ ...base, empleado: { ...base.empleado, identidad: null } });
    const r = resolverPlantilla("Identidad {{empleado.identidad}} de {{ empleado.nombreCompleto }}.", c);
    expect(r.texto).toBe(`Identidad ${LINEA_VACIA} de Wendy Paola Andino Cruz.`);
    expect(r.faltantes).toEqual(["empleado.identidad"]);
  });

  it("una variable mal escrita se conserva y se informa", () => {
    const r = resolverPlantilla("Hola {{empleado.nombre}}", construirContexto(base));
    expect(r.texto).toBe("Hola {{empleado.nombre}}");
    expect(r.desconocidas).toEqual(["empleado.nombre"]);
    expect(variablesDesconocidas("{{empleado.puesto}} {{x.y}}")).toEqual(["x.y"]);
  });

  it("las plantillas por omisión sólo usan variables del catálogo y resuelven completas con un expediente lleno", () => {
    for (const p of PLANTILLAS_POR_OMISION) {
      expect(variablesDesconocidas(p.contenido), p.codigo).toEqual([]);
      const r = resolverPlantilla(p.contenido, construirContexto(base));
      expect(r.desconocidas, p.codigo).toEqual([]);
      expect(r.faltantes, p.codigo).toEqual([]);
    }
    const constancia = resolverPlantilla(PLANTILLAS_POR_OMISION[1].contenido, construirContexto(base)).texto;
    expect(constancia).toContain("la señora **Wendy Paola Andino Cruz**, identificada");
    expect(constancia).toContain("(TRECE MIL DOSCIENTOS CINCUENTA LEMPIRAS CON 00/100)");
    expect(constancia).toContain("San Pedro Sula, a los quince días del mes de octubre del año dos mil veintiséis.");
  });
});

describe("nacionalidad en el contrato", () => {
  it("concuerda con el sexo del trabajador", () => {
    expect(nacionalidadConcordada("Hondureño", "F")).toBe("hondureña");
    expect(nacionalidadConcordada("Hondureño", "M")).toBe("hondureño");
    expect(nacionalidadConcordada("Hondureña", "M")).toBe("hondureño");
    expect(nacionalidadConcordada("Guatemalteco", "Femenino")).toBe("guatemalteca");
    expect(nacionalidadConcordada("Nicaragüense", "F")).toBe("nicaragüense");
    expect(nacionalidadConcordada(null, "F")).toBe("");
  });
});
