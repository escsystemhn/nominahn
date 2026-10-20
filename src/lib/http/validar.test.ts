import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  parsearBody,
  zId,
  zMonto,
  zMontoPositivo,
  zPorcentaje,
  zFecha,
  zEnteroNoNeg,
  zMontoAnulable,
  zCorreoOpcional,
} from "./validar";

const ok = <T>(s: z.ZodType<T>, v: unknown) => s.safeParse(v).success;

// ─── PRIMITIVAS ──────────────────────────────────────────────────────────────

describe("zMonto — el fin de los NaN escritos como dinero", () => {
  it("REGRESIÓN: rechaza lo que parseFloat convertía en NaN", () => {
    expect(ok(zMonto, undefined)).toBe(false);
    expect(ok(zMonto, "")).toBe(false);
    expect(ok(zMonto, "abc")).toBe(false);
    expect(ok(zMonto, null)).toBe(false);
  });

  it("acepta número y string numérico (el frontend manda strings)", () => {
    expect(zMonto.parse(1500)).toBe(1500);
    expect(zMonto.parse("1500.50")).toBe(1500.5);
    expect(zMonto.parse(0)).toBe(0);
  });

  it("rechaza negativos e infinito", () => {
    expect(ok(zMonto, -1)).toBe(false);
    expect(ok(zMonto, Infinity)).toBe(false);
  });
});

describe("zMontoPositivo", () => {
  it("exige mayor que cero", () => {
    expect(ok(zMontoPositivo, 0)).toBe(false);
    expect(ok(zMontoPositivo, "0")).toBe(false);
    expect(zMontoPositivo.parse("250")).toBe(250);
  });
});

describe("zPorcentaje — acota el aumento colectivo", () => {
  it("REGRESIÓN: un porcentaje ausente ya no llega como NaN al cálculo", () => {
    expect(ok(zPorcentaje, undefined)).toBe(false);
    expect(ok(zPorcentaje, "")).toBe(false);
  });

  it("rechaza fuera de 0–100 (evita un aumento de 100000%)", () => {
    expect(ok(zPorcentaje, 100001)).toBe(false);
    expect(ok(zPorcentaje, -5)).toBe(false);
    expect(zPorcentaje.parse("12.5")).toBe(12.5);
  });
});

describe("zFecha", () => {
  it("coacciona ISO válido y rechaza basura", () => {
    expect(zFecha.parse("2026-07-20")).toBeInstanceOf(Date);
    expect(ok(zFecha, "no-es-fecha")).toBe(false);
    expect(ok(zFecha, undefined)).toBe(false);
  });
});

describe("zEnteroNoNeg", () => {
  it("exige entero no negativo", () => {
    expect(zEnteroNoNeg.parse("6")).toBe(6);
    expect(ok(zEnteroNoNeg, 2.5)).toBe(false);
    expect(ok(zEnteroNoNeg, -1)).toBe(false);
  });
});

describe("zId", () => {
  it("rechaza vacío y recorta espacios", () => {
    expect(ok(zId, "")).toBe(false);
    expect(ok(zId, "   ")).toBe(false);
    expect(zId.parse("  abc123  ")).toBe("abc123");
  });
});

// ─── parsearBody ─────────────────────────────────────────────────────────────

describe("parsearBody", () => {
  const schema = z.object({ nombre: z.string().min(1), monto: zMontoPositivo });
  const req = (body: unknown) =>
    new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  it("devuelve data tipada cuando el cuerpo es válido", async () => {
    const r = await parsearBody(req({ nombre: "Préstamo", monto: "500" }), schema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ nombre: "Préstamo", monto: 500 });
  });

  it("responde 400 con detalle por campo cuando es inválido", async () => {
    const r = await parsearBody(req({ nombre: "", monto: "abc" }), schema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(400);
      const body = await r.response.json();
      expect(body.error).toBe("Datos inválidos");
      expect(body.detalles.nombre).toBeDefined();
      expect(body.detalles.monto).toBeDefined();
    }
  });

  it("responde 400 si el cuerpo no es JSON", async () => {
    const bad = new Request("http://x/api", { method: "POST", body: "{no-json" });
    const r = await parsearBody(bad, schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });
});

describe("zMontoAnulable — IHSS fijo borrable", () => {
  const parse = (v: unknown) => zMontoAnulable.safeParse(v);

  it("vacío o null borran el valor: vuelve al cálculo por porcentaje", () => {
    expect(parse("")).toMatchObject({ success: true, data: null });
    expect(parse(null)).toMatchObject({ success: true, data: null });
  });

  it("ausente no toca el campo", () => {
    expect(parse(undefined)).toMatchObject({ success: true, data: undefined });
  });

  it("acepta montos, incluido el cero, y rechaza negativos o texto", () => {
    expect(parse("297.58")).toMatchObject({ success: true, data: 297.58 });
    expect(parse(0)).toMatchObject({ success: true, data: 0 });
    expect(parse(-5).success).toBe(false);
    expect(parse("abc").success).toBe(false);
  });
});

describe("zCorreoOpcional — correo del empleado", () => {
  const parse = (v: unknown) => zCorreoOpcional.safeParse(v);

  it("vacío borra el correo", () => {
    expect(parse("  ")).toMatchObject({ success: true, data: null });
  });

  it("normaliza a minúsculas y quita espacios", () => {
    expect(parse("  Ana.Mejia@Gmail.COM ")).toMatchObject({ success: true, data: "ana.mejia@gmail.com" });
  });

  it("rechaza lo que no es un correo: el comprobante simplemente no llegaría", () => {
    expect(parse("ana@").success).toBe(false);
    expect(parse("ana gmail.com").success).toBe(false);
  });
});
