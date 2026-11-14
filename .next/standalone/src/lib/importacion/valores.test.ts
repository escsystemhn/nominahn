import { describe, it, expect } from "vitest";
import {
  normalizarNumero,
  decimal,
  entero,
  fecha,
  enumerado,
  booleano,
  identidad,
  rtn,
  correo,
  texto,
  vacia,
} from "./valores";

/** Ayuda a leer los tests: extrae el valor o falla con el error. */
function valor<T>(r: { ok: true; valor: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(`esperaba éxito, hubo error: ${r.error}`);
  return r.valor;
}
function err<T>(r: { ok: true; valor: T } | { ok: false; error: string }): string {
  if (r.ok) throw new Error("esperaba error, hubo éxito");
  return r.error;
}

describe("normalizarNumero", () => {
  it("acepta el formato hondureño (coma de millar, punto decimal)", () => {
    expect(normalizarNumero("12,500.00")).toBe("12500.00");
    expect(normalizarNumero("1,234,567.89")).toBe("1234567.89");
  });

  it("acepta el formato europeo que produce Excel en español", () => {
    expect(normalizarNumero("12.500,00")).toBe("12500.00");
    expect(normalizarNumero("1.234.567,89")).toBe("1234567.89");
  });

  it("un solo símbolo repetido es agrupación", () => {
    expect(normalizarNumero("1.234.567")).toBe("1234567");
    expect(normalizarNumero("1,234,567")).toBe("1234567");
  });

  /**
   * El único caso genuinamente ambiguo. Se resuelve por la convención de
   * Honduras: tres dígitos detrás del símbolo = separador de millar.
   */
  it("resuelve el caso ambiguo con la regla de los tres dígitos", () => {
    expect(normalizarNumero("12,500")).toBe("12500");
    expect(normalizarNumero("12.500")).toBe("12500");
    expect(normalizarNumero("12,5")).toBe("12.5");
    expect(normalizarNumero("12.50")).toBe("12.50");
  });

  it("descarta símbolo de moneda y espacios", () => {
    expect(normalizarNumero("L 12,500.00")).toBe("12500.00");
    expect(normalizarNumero("L. 12,500.00")).toBe("12500.00");
    expect(normalizarNumero("HNL 12500")).toBe("12500");
    expect(normalizarNumero(" 12 500,50 ")).toBe("12500.50");
  });

  it("entiende la notación contable de los negativos", () => {
    expect(normalizarNumero("(1,200.00)")).toBe("-1200.00");
  });
});

describe("decimal", () => {
  it("devuelve un importe exacto redondeado a centavos", () => {
    expect(valor(decimal("12,500.00")).toString()).toBe("12500");
    expect(valor(decimal("1500.5551")).toString()).toBe("1500.56"); // half-up
    expect(valor(decimal("1500.5650")).toString()).toBe("1500.57");
  });

  /**
   * El borde conocido de la regla de los tres dígitos: "1500.555" se lee como
   * agrupación (un millón y medio), no como un importe con tres decimales. Es
   * consciente —tres decimales no existen en Lempiras— pero convierte un error
   * de tecleo en una cifra mil veces mayor, y por eso las importaciones acotan
   * el máximo con `max` en vez de confiar sólo en el parseo.
   */
  it("un lone separador con tres dígitos es agrupación, y el tope lo ataja", () => {
    expect(valor(decimal("1500.555")).toString()).toBe("1500555");
    expect(err(decimal("1500.555", { max: 10_000_000 / 10 }))).toContain("menor o igual");
  });

  /**
   * El fallo que ya documenta lib/http/validar.ts: `parseFloat("")` es NaN y un
   * NaN escrito como salario corrompe la fila sin avisar.
   */
  it("rechaza vacío en vez de convertirlo en cero", () => {
    expect(err(decimal(""))).toBe("requerido");
    expect(err(decimal("   "))).toBe("requerido");
    expect(err(decimal(undefined))).toBe("requerido");
  });

  it("rechaza texto", () => {
    expect(err(decimal("mil quinientos"))).toContain("no es un número válido");
    expect(err(decimal("N/A"))).toContain("no es un número válido");
    expect(err(decimal("-"))).toContain("no es un número válido");
  });

  it("respeta los límites", () => {
    expect(err(decimal("-5", { min: 0 }))).toContain("mayor o igual que 0");
    expect(err(decimal("999999999", { max: 1000 }))).toContain("menor o igual que 1000");
  });
});

describe("entero", () => {
  it("acepta enteros y rechaza decimales", () => {
    expect(valor(entero("12"))).toBe(12);
    expect(err(entero("12.5"))).toContain("no es un número entero");
  });

  it("no admite negativos por omisión", () => {
    expect(err(entero("-1"))).toContain("mayor o igual que 0");
  });
});

describe("fecha", () => {
  it("acepta ISO", () => {
    expect(valor(fecha("2026-08-31")).toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("acepta DD/MM/AAAA con distintos separadores", () => {
    for (const v of ["31/08/2026", "31-08-2026", "31.08.2026"]) {
      expect(valor(fecha(v)).toISOString(), v).toBe("2026-08-31T00:00:00.000Z");
    }
  });

  /**
   * La decisión que más silencio puede provocar: 03/04/2026 es el 3 de abril.
   * Interpretarlo como 4 de marzo cambiaría antigüedades y devengos de décimo
   * sin que ninguna pantalla lo delate.
   */
  it("es DÍA primero, siempre, aunque el valor sea válido en ambos órdenes", () => {
    expect(valor(fecha("03/04/2026")).toISOString()).toBe("2026-04-03T00:00:00.000Z");
  });

  it("guarda medianoche UTC, no medianoche local", () => {
    // Es lo que exige una columna @db.Date; con hora local, formatDate imprime
    // el día anterior en UTC−6.
    const d = valor(fecha("31/08/2026"));
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCDate()).toBe(31);
  });

  it("acepta el año de dos cifras que abrevia Excel", () => {
    expect(valor(fecha("15/03/85")).getUTCFullYear()).toBe(1985);
    expect(valor(fecha("15/03/05")).getUTCFullYear()).toBe(2005);
  });

  // `new Date(2026, 1, 31)` no falla: devuelve el 3 de marzo.
  it("rechaza fechas que no existen en vez de correrlas al mes siguiente", () => {
    expect(err(fecha("31/02/2026"))).toContain("no es una fecha real");
    expect(err(fecha("30/02/2025"))).toContain("no es una fecha real");
    expect(err(fecha("29/02/2025"))).toContain("no es una fecha real"); // 2025 no es bisiesto
    expect(valor(fecha("29/02/2024")).getUTCDate()).toBe(29); // 2024 sí
  });

  it("rechaza meses y días imposibles", () => {
    expect(err(fecha("15/13/2026"))).toContain("el mes 13 no existe");
    expect(err(fecha("00/05/2026"))).toContain("el día 0 no existe");
  });

  it("rechaza texto y formatos desconocidos", () => {
    expect(err(fecha("ayer"))).toContain("no es una fecha válida");
    expect(err(fecha("2026/31/08"))).toContain("no es una fecha válida");
    expect(err(fecha(""))).toBe("requerido");
  });
});

describe("enumerado", () => {
  const OPCIONES = ["INDEFINIDO", "TEMPORAL", "PRUEBA", "SERVICIO"] as const;

  it("acepta el valor exacto", () => {
    expect(valor(enumerado("TEMPORAL", OPCIONES))).toBe("TEMPORAL");
  });

  it("ignora mayúsculas, tildes y espacios", () => {
    expect(valor(enumerado("temporal", OPCIONES))).toBe("TEMPORAL");
    expect(valor(enumerado("  Temporal  ", OPCIONES))).toBe("TEMPORAL");
    expect(valor(enumerado("indefinído", OPCIONES))).toBe("INDEFINIDO");
  });

  it("acepta espacios donde el enum lleva guión bajo", () => {
    expect(valor(enumerado("sin goce", ["SIN_GOCE", "OTRO"]))).toBe("SIN_GOCE");
  });

  it("al fallar, enumera las opciones válidas", () => {
    const mensaje = err(enumerado("EVENTUAL", OPCIONES));
    expect(mensaje).toContain("EVENTUAL");
    expect(mensaje).toContain("INDEFINIDO, TEMPORAL, PRUEBA, SERVICIO");
  });
});

describe("booleano", () => {
  it("entiende lo que se escribe en una hoja de cálculo", () => {
    for (const v of ["Sí", "si", "S", "TRUE", "1", "X", "Verdadero"]) {
      expect(valor(booleano(v)), v).toBe(true);
    }
    for (const v of ["No", "n", "FALSE", "0", "Falso"]) {
      expect(valor(booleano(v)), v).toBe(false);
    }
  });

  it("usa el valor por omisión cuando la celda está vacía", () => {
    expect(valor(booleano("", true))).toBe(true);
    expect(err(booleano(""))).toBe("requerido");
  });

  it("rechaza lo que no es un sí ni un no", () => {
    expect(err(booleano("quizá"))).toContain("no es Sí/No");
  });
});

describe("identidad y rtn", () => {
  it("normalizan quitando guiones, para no burlar el índice único", () => {
    expect(valor(identidad("0801-1990-12345"))).toBe("0801199012345");
    expect(valor(identidad("0801199012345"))).toBe("0801199012345");
    expect(valor(rtn("08011990123451"))).toBe("08011990123451");
  });

  it("exigen la longitud correcta", () => {
    expect(err(identidad("0801-1990-1234"))).toContain("13 dígitos");
    expect(err(rtn("0801199012345"))).toContain("14 dígitos");
  });

  it("rechazan letras", () => {
    expect(err(identidad("0801-ABCD-12345"))).toContain("identidad válida");
  });
});

describe("correo", () => {
  it("normaliza a minúsculas", () => {
    expect(valor(correo("  Ana.Perez@Empresa.HN "))).toBe("ana.perez@empresa.hn");
  });

  it("descarta lo evidentemente inválido", () => {
    expect(err(correo("ana@"))).toContain("no es un correo válido");
    expect(err(correo("ana empresa.hn"))).toContain("no es un correo válido");
  });
});

describe("texto y vacia", () => {
  it("recorta y limita la longitud", () => {
    expect(valor(texto("  Ana  "))).toBe("Ana");
    expect(err(texto("x".repeat(300), 255))).toContain("supera los 255");
  });

  it("vacia trata el espacio en blanco como vacío", () => {
    expect(vacia("")).toBe(true);
    expect(vacia("   ")).toBe(true);
    expect(vacia(undefined)).toBe(true);
    expect(vacia("0")).toBe(false);
  });
});
