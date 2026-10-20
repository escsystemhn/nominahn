/**
 * Fechas y moneda de Honduras.
 *
 * El defecto que estas pruebas fijan sólo aparecía al configurar la zona
 * horaria correcta del país: una columna `@db.Date` vuelve de Prisma como
 * medianoche UTC, y formatearla en hora local (UTC−6) la imprimía un día antes.
 * Es decir, el sistema iba a empezar a fechar mal las planillas justo al
 * desplegarse bien.
 */

import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatDateLong,
  formatDateTime,
  formatCurrency,
  hoyHN,
  fechaCalendario,
  TZ_HN,
  MONEDA,
} from "@/lib/utils";

/** Una fecha de calendario tal y como la devuelve Prisma para `@db.Date`. */
const fechaDb = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe("configuración local de Honduras", () => {
  it("la zona horaria es America/Tegucigalpa", () => {
    expect(TZ_HN).toBe("America/Tegucigalpa");
  });

  it("la moneda base es el Lempira", () => {
    expect(MONEDA).toBe("HNL");
  });
});

describe("formatDate — fechas de calendario", () => {
  it("REGRESIÓN: no desplaza el día al formatear una columna @db.Date", () => {
    // Con la implementación anterior (date-fns en hora local) y el servidor en
    // UTC−6, esto imprimía "30/08/2026".
    expect(formatDate(fechaDb("2026-08-31"))).toBe("31/08/2026");
  });

  it("respeta el último día del mes y el fin de año", () => {
    expect(formatDate(fechaDb("2026-01-01"))).toBe("01/01/2026");
    expect(formatDate(fechaDb("2026-12-31"))).toBe("31/12/2026");
    expect(formatDate(fechaDb("2028-02-29"))).toBe("29/02/2028"); // bisiesto
  });

  it("acepta la cadena ISO además del Date", () => {
    expect(formatDate("2026-08-31T00:00:00.000Z")).toBe("31/08/2026");
  });

  it("el formato largo tampoco se desplaza", () => {
    expect(formatDateLong(fechaDb("2026-08-31"))).toContain("31");
    expect(formatDateLong(fechaDb("2026-08-31"))).toContain("agosto");
    expect(formatDateLong(fechaDb("2026-08-31"))).toContain("2026");
  });
});

describe("formatDateTime — instantes reales", () => {
  it("muestra la hora de Honduras, no la del servidor", () => {
    // 2026-08-31T02:30:00Z son las 20:30 del 30 de agosto en Tegucigalpa.
    const salida = formatDateTime(new Date("2026-08-31T02:30:00.000Z"));
    expect(salida).toContain("30");
    expect(salida).toMatch(/8:30|20:30/);
  });
});

describe("hoyHN y fechaCalendario", () => {
  it("hoyHN devuelve medianoche UTC, comparable con una columna @db.Date", () => {
    const hoy = hoyHN();
    expect(hoy.getUTCHours()).toBe(0);
    expect(hoy.getUTCMinutes()).toBe(0);
    expect(hoy.getUTCSeconds()).toBe(0);
    expect(hoy.getUTCMilliseconds()).toBe(0);
  });

  it("hoyHN corresponde al día que es en Honduras", () => {
    const enHonduras = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ_HN,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(hoyHN().toISOString().split("T")[0]).toBe(enHonduras);
  });

  it("fechaCalendario convierte el valor de un input type=date sin desplazarlo", () => {
    const f = fechaCalendario("2026-08-31");
    expect(f.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(formatDate(f)).toBe("31/08/2026");
  });
});

describe("formatCurrency — Lempiras", () => {
  it("siempre dos decimales", () => {
    expect(formatCurrency(1000)).toMatch(/1,000\.00/);
    expect(formatCurrency(0)).toMatch(/0\.00/);
  });

  it("REGRESIÓN: nunca imprime tres decimales", () => {
    // Sin `maximumFractionDigits` explícito, el valor por defecto de Intl es 3.
    expect(formatCurrency(1234.567)).toMatch(/\.57$/);
  });

  it("acepta el Decimal de Prisma y la cadena, no sólo el number", () => {
    expect(formatCurrency("15000.5")).toMatch(/15,000\.50/);
    expect(formatCurrency({ toString: () => "15000.50" })).toMatch(/15,000\.50/);
  });

  it("marca el importe como Lempiras", () => {
    expect(formatCurrency(1500)).toMatch(/L/);
  });

  it("maneja negativos sin perder los decimales", () => {
    expect(formatCurrency(-250.5)).toMatch(/250\.50/);
  });
});
