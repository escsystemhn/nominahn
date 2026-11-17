import { describe, expect, it } from "vitest";
import { calcularDeduccionesAsistencia } from "./motor";
import { EJEMPLOS } from "./ejemplos";
import { leerPolitica } from "./politica";

// Montos calculados a mano, línea por línea (cada línea se redondea a centavos).
const ESPERADO: Record<string, { lineas: [string, string, number, string][]; total: string; alertas: Record<string, number> }> = {
  "Maquila, semanal, reglamento estricto": {
    // día 400, minuto 0.833333
    lineas: [
      ["2026-11-03", "TARDANZA", 7, "5.83"], // 7 > 5 de gracia → completos; bloque de 15 topado en 7
      ["2026-11-05", "TARDANZA", 150, "125.00"], // umbral 120 → media jornada (240) topada en 150
      ["2026-11-06", "SALIDA_ANTICIPADA", 20, "16.67"], // bloque de 15 → 30, topado en 20
      ["2026-11-04", "AUSENCIA", 480, "400.00"],
      ["2026-11-04", "SEPTIMO_DIA", 480, "400.00"],
    ],
    total: "947.50",
    alertas: { INFO: 3 },
  },
  "Oficina administrativa, mensual, flexible": {
    // día 1,000, minuto 2.083333
    lineas: [
      ["2026-11-12", "TARDANZA", 7, "14.58"], // bolsa de 30: 10 + 15 caben (el 25 se compensó), del 12 sobran 7
      ["2026-11-18", "SALIDA_ANTICIPADA", 20, "41.67"], // 30 − 10 de gracia
      ["2026-11-19", "AUSENCIA", 480, "1000.00"], // sin goce
      ["2026-11-24", "AUSENCIA", 480, "1000.00"], // injustificada, política B: sin séptimo
    ],
    total: "2056.25",
    alertas: {},
  },
  "Tienda, quincenal, jornada mixta": {
    // noviembre tiene 30 días: día 600, minuto 1.428571
    lineas: [
      ["2026-11-04", "TARDANZA", 25, "35.71"], // excedente 15 → bloque de 30, topado en los 25 reales
      ["2026-11-13", "TARDANZA", 200, "285.71"], // umbral 180 → media jornada (210) topada en 200
      ["2026-11-09", "AUSENCIA", 420, "600.00"],
      ["2026-11-11", "AUSENCIA", 420, "600.00"],
      ["2026-11-09", "SEPTIMO_DIA", 140, "200.00"], // proporcional 2/6
    ],
    total: "1721.42",
    alertas: { INFO: 2 },
  },
  "Seguridad nocturna, quincenal, reglamento agresivo": {
    // 15,000 ÷ 26 = 576.923077 al día; la hora nocturna, 96.153846
    lineas: [
      ["2026-10-19", "TARDANZA", 60, "96.15"], // bolsa de 15 agotada: 19 acumulados → bloque de 60, PERMITIDO
      ["2026-10-23", "TARDANZA", 60, "96.15"], // 5 → bloque de 60, PERMITIDO
      ["2026-10-20", "AUSENCIA", 360, "576.92"],
      ["2026-10-20", "SEPTIMO_DIA", 360, "576.92"],
      ["2026-10-21", "FERIADO", 360, "576.92"], // falta el día antes del feriado
    ],
    total: "1923.06",
    alertas: { RIESGO_LEGAL: 3 },
  },
};

describe("cuatro perfiles de empresa", () => {
  for (const { nombre, entrada } of EJEMPLOS) {
    it(nombre, () => {
      leerPolitica(entrada.politica); // cada perfil es una política válida
      const r = calcularDeduccionesAsistencia(entrada);
      const e = ESPERADO[nombre];
      expect(r.lineas.map((l) => [l.fecha, l.concepto, l.minutos, l.monto.toFixed(2)])).toEqual(e.lineas);
      expect(r.totales.monto.toFixed(2)).toBe(e.total);
      const cuenta: Record<string, number> = {};
      for (const a of r.alertas) cuenta[a.nivel] = (cuenta[a.nivel] ?? 0) + 1;
      expect(cuenta).toEqual(e.alertas);
    });
  }
});
