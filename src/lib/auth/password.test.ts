import { describe, it, expect } from "vitest";
import {
  validarPassword,
  generarPasswordTemporal,
  hashear,
  comparar,
  LONGITUD_MINIMA,
} from "./password";

describe("validarPassword", () => {
  it("acepta una contraseña que cumple la política", () => {
    expect(validarPassword("Tegucigalpa#2026").ok).toBe(true);
  });

  it("enumera TODOS los incumplimientos de una vez", () => {
    // Corta, sin números y sin símbolos: los tres errores a la vez.
    const r = validarPassword("abcdef");
    expect(r.ok).toBe(false);
    expect(r.errores.length).toBeGreaterThanOrEqual(3);
  });

  it("exige la longitud mínima", () => {
    expect(validarPassword("Ab1!cd").errores.some((e) => e.includes(`${LONGITUD_MINIMA}`))).toBe(true);
  });

  it("exige letra, número y símbolo", () => {
    expect(validarPassword("1234567890!").errores.some((e) => e.includes("letra"))).toBe(true);
    expect(validarPassword("abcdefghij!").errores.some((e) => e.includes("número"))).toBe(true);
    expect(validarPassword("abcdefghij1").errores.some((e) => e.includes("símbolo"))).toBe(true);
  });

  it("rechaza las contraseñas de diccionario, aunque cumplan el resto", () => {
    const r = validarPassword("Admin1234!x");
    expect(r.ok).toBe(false);
    expect(r.errores.some((e) => e.includes("demasiado común"))).toBe(true);
  });

  it("ignora tildes al comparar con el diccionario", () => {
    expect(validarPassword("Contraseña1!").ok).toBe(false);
  });

  /**
   * Una contraseña derivada del propio correo no protege de quien ya sabe a
   * quién ataca, que es el escenario habitual dentro de una empresa.
   */
  it("no admite la contraseña que contiene el nombre o el correo", () => {
    const r = validarPassword("Lainez#2026x", ["edbin.lainez@empresa.hn", "Edbin Lainez"]);
    expect(r.ok).toBe(false);
    expect(r.errores.some((e) => e.includes("su nombre ni su correo"))).toBe(true);
  });

  it("no se deja engañar por fragmentos cortos del correo", () => {
    // "hn" tiene menos de 4 caracteres: no debería descartar cualquier clave.
    expect(validarPassword("Tegucigalpa#26", ["ana@empresa.hn"]).ok).toBe(true);
  });

  it("bcrypt ignora más de 72 bytes, así que no se aceptan", () => {
    expect(validarPassword("A1!" + "x".repeat(100)).ok).toBe(false);
  });
});

describe("generarPasswordTemporal", () => {
  it("la temporal siempre pasa la propia política", () => {
    for (let i = 0; i < 50; i++) {
      const p = generarPasswordTemporal();
      const r = validarPassword(p);
      expect(r.ok, `"${p}" falló: ${r.errores.join(" ")}`).toBe(true);
    }
  });

  it("respeta la longitud pedida", () => {
    expect(generarPasswordTemporal(14)).toHaveLength(14);
    expect(generarPasswordTemporal(20)).toHaveLength(20);
  });

  it("no repite valores", () => {
    const generadas = new Set(Array.from({ length: 200 }, () => generarPasswordTemporal()));
    expect(generadas.size).toBe(200);
  });

  /** Se dictan por teléfono más de lo que a nadie le gustaría admitir. */
  it("evita los caracteres que se confunden al dictarla", () => {
    for (let i = 0; i < 50; i++) {
      expect(generarPasswordTemporal()).not.toMatch(/[O0lI1]/);
    }
  });

  /**
   * Sin el barajado, las tres primeras posiciones serían siempre letra, dígito y
   * símbolo: un atacante empezaría por ahí.
   */
  it("baraja las posiciones sembradas", () => {
    const muestras = Array.from({ length: 100 }, () => generarPasswordTemporal());
    const primeraEsDigito = muestras.filter((p) => /\d/.test(p[0])).length;
    expect(primeraEsDigito).toBeGreaterThan(0);
    expect(primeraEsDigito).toBeLessThan(muestras.length);
  });
});

describe("hashear y comparar", () => {
  it("la comparación acierta y falla donde debe", async () => {
    const hash = await hashear("Tegucigalpa#2026");
    expect(await comparar("Tegucigalpa#2026", hash)).toBe(true);
    expect(await comparar("Tegucigalpa#2027", hash)).toBe(false);
  });

  it("el mismo texto da hashes distintos (sal aleatoria)", async () => {
    const [a, b] = await Promise.all([hashear("Tegucigalpa#2026"), hashear("Tegucigalpa#2026")]);
    expect(a).not.toBe(b);
  });
});
