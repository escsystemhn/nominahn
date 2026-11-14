import { describe, expect, it } from "vitest";
import { TAMANO_PARTE, nuevaSubida, revisarCierre, revisarParte, subidaValida } from "./subida";

const MAX = 500 * 1024 * 1024;
const yo = { usuarioId: "u1", capacitacionId: "c1" };

describe("identificador de la subida", () => {
  it("nuevaSubida da un UUID v4 que subidaValida acepta", () => {
    for (let i = 0; i < 20; i++) expect(subidaValida(nuevaSubida())).toBe(true);
  });
  it("rechaza lo que podría salirse de la carpeta", () => {
    for (const malo of ["../../etc/passwd", "abc", "", null, "00000000-0000-1000-8000-000000000000", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"]) {
      expect(subidaValida(malo)).toBe(false);
    }
  });
});

describe("revisarParte", () => {
  it("la primera parte empieza una subida nueva", () => {
    expect(revisarParte(null, { ...yo, desde: 0, largo: TAMANO_PARTE, max: MAX })).toEqual({ ok: true });
  });
  it("cada parte sigue donde terminó la anterior", () => {
    const estado = { ...yo, bytes: TAMANO_PARTE };
    expect(revisarParte(estado, { ...yo, desde: TAMANO_PARTE, largo: 10, max: MAX })).toEqual({ ok: true });
    expect(revisarParte(estado, { ...yo, desde: 2 * TAMANO_PARTE, largo: 10, max: MAX })).toMatchObject({ ok: false, status: 409 });
  });
  it("una parte suelta sin subida empezada no se acepta", () => {
    expect(revisarParte(null, { ...yo, desde: TAMANO_PARTE, largo: 10, max: MAX })).toMatchObject({ ok: false, status: 409 });
  });
  it("otra persona u otra capacitación no puede seguir la subida", () => {
    const estado = { ...yo, bytes: 0 };
    expect(revisarParte(estado, { usuarioId: "u2", capacitacionId: "c1", desde: 0, largo: 10, max: MAX })).toMatchObject({ ok: false, status: 409 });
    expect(revisarParte(estado, { usuarioId: "u1", capacitacionId: "c2", desde: 0, largo: 10, max: MAX })).toMatchObject({ ok: false, status: 409 });
  });
  it("respeta el tamaño de parte y el máximo del archivo", () => {
    expect(revisarParte(null, { ...yo, desde: 0, largo: TAMANO_PARTE + 1, max: MAX })).toMatchObject({ ok: false, status: 413 });
    expect(revisarParte({ ...yo, bytes: MAX - 5 }, { ...yo, desde: MAX - 5, largo: 10, max: MAX })).toMatchObject({ ok: false, status: 413 });
    expect(revisarParte(null, { ...yo, desde: 0, largo: 0, max: MAX })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("revisarCierre", () => {
  it("cierra sólo si llegaron todos los bytes", () => {
    expect(revisarCierre({ ...yo, bytes: 25_080_300 }, { ...yo, total: 25_080_300 })).toEqual({ ok: true });
    const r = revisarCierre({ ...yo, bytes: 10_427_635 }, { ...yo, total: 25_080_300 });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(!r.ok && r.error).toContain("incompleto");
  });
  it("sin subida, de otra persona o sin tamaño, no", () => {
    expect(revisarCierre(null, { ...yo, total: 10 })).toMatchObject({ ok: false, status: 409 });
    expect(revisarCierre({ usuarioId: "u2", capacitacionId: "c1", bytes: 10 }, { ...yo, total: 10 })).toMatchObject({ ok: false, status: 409 });
    expect(revisarCierre({ ...yo, bytes: 10 }, { ...yo, total: 0 })).toMatchObject({ ok: false, status: 400 });
  });
});
