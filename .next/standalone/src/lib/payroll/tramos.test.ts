import { describe, it, expect } from "vitest";
import { validarTramosISR, validarTramosVecinal, derivarCuotasISR } from "@/lib/payroll/tramos";
import { TABLA_ISR_ANUAL_2026, TABLA_VECINAL_SPS } from "@/lib/payroll/calculos-hn";

const isr2026 = TABLA_ISR_ANUAL_2026.map((t) => ({ ...t }));
const vecinalSPS = TABLA_VECINAL_SPS.map((t) => ({ ...t }));

describe("tabla ISR", () => {
  it("la tabla 2026 del SAR es válida (tramos separados por un centavo)", () => {
    expect(validarTramosISR(isr2026)).toEqual([]);
  });

  it("también acepta tramos que empiezan justo donde termina el anterior", () => {
    const t = isr2026.map((x, i) => (i === 1 ? { ...x, desde: isr2026[0].hasta! } : x));
    expect(validarTramosISR(t)).toEqual([]);
  });

  it("rechaza un hueco entre tramos", () => {
    const t = isr2026.map((x, i) => (i === 2 ? { ...x, desde: 350000 } : x));
    expect(validarTramosISR(t).join(" ")).toMatch(/hueco entre los tramos 2 y 3/);
  });

  it("rechaza tramos solapados", () => {
    const t = isr2026.map((x, i) => (i === 2 ? { ...x, desde: 300000 } : x));
    expect(validarTramosISR(t).join(" ")).toMatch(/solapan/);
  });

  it("el último tramo queda abierto y los demás tienen techo", () => {
    const cerrado = isr2026.map((x, i) => (i === 3 ? { ...x, hasta: 2000000 } : x));
    expect(validarTramosISR(cerrado).join(" ")).toMatch(/último tramo no lleva/);
    const abierto = isr2026.map((x, i) => (i === 1 ? { ...x, hasta: null } : x));
    expect(validarTramosISR(abierto).join(" ")).toMatch(/sólo el último/);
  });

  it("el primer tramo empieza en 0 y el porcentaje va entre 0 y 100 %", () => {
    expect(validarTramosISR(isr2026.map((x, i) => (i === 0 ? { ...x, desde: 1 } : x))).join(" ")).toMatch(/empezar en 0/);
    expect(validarTramosISR(isr2026.map((x, i) => (i === 1 ? { ...x, porcentaje: 1.5 } : x))).join(" ")).toMatch(/porcentaje/);
  });

  it("rechaza una tabla vacía", () => {
    expect(validarTramosISR([])).not.toEqual([]);
  });

  it("derivarCuotasISR reproduce las cuotas fijas publicadas por el SAR", () => {
    const derivada = derivarCuotasISR(isr2026.map(({ desde, hasta, porcentaje }) => ({ desde, hasta, porcentaje })));
    expect(derivada.map((t) => t.cuotaFija)).toEqual(isr2026.map((t) => t.cuotaFija));
    expect(derivada.map((t) => t.excedenteDesde)).toEqual(isr2026.map((t) => t.excedenteDesde));
    expect(validarTramosISR(derivada)).toEqual([]);
  });
});

describe("tabla del impuesto vecinal", () => {
  it("la tabla de San Pedro Sula es válida", () => {
    expect(validarTramosVecinal(vecinalSPS)).toEqual([]);
  });

  it("exige que cada tramo empiece exactamente donde termina el anterior", () => {
    // Un centavo de hueco en el vecinal deja una porción sin tributar.
    const t = vecinalSPS.map((x, i) => (i === 1 ? { ...x, desde: 5000.01 } : x));
    expect(validarTramosVecinal(t).join(" ")).toMatch(/debe empezar donde termina/);
  });

  it("rechaza tarifas negativas", () => {
    const t = vecinalSPS.map((x, i) => (i === 0 ? { ...x, porMillar: -1 } : x));
    expect(validarTramosVecinal(t).join(" ")).toMatch(/por millar/);
  });
});
