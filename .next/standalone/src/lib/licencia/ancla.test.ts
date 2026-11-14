import { describe, it, expect } from "vitest";
import { firmarAncla, leerAncla, combinarAnclas, type LecturaAncla } from "./ancla";

const EQUIPO = "6f1e2d3c-aaaa-4e9c-8445-def84dd2ece3";
const OTRO = "0b7c9d10-bbbb-4c4c-8053-b9c04f4e4334";

const token = (inicio: string, mayorVisto = inicio, guid = EQUIPO) => firmarAncla({ inicio, mayorVisto }, guid);

describe("leerAncla", () => {
  it("lee lo que firmó el mismo equipo", () => {
    const l = leerAncla(token("2026-10-19T22:00:00.000Z"), EQUIPO);
    expect(l.estado).toBe("valida");
    if (l.estado === "valida") expect(l.datos.inicio).toBe("2026-10-19T22:00:00.000Z");
  });

  it("un registro copiado de otro equipo se reconoce como tal", () => {
    expect(leerAncla(token("2026-10-19T22:00:00.000Z", undefined, OTRO), EQUIPO).estado).toBe("otro_equipo");
  });

  it("cambiar la fecha a mano rompe la firma", () => {
    const original = token("2026-10-19T22:00:00.000Z");
    const [p, datos, firma] = original.split(".");
    const json = JSON.parse(Buffer.from(datos, "base64url").toString());
    json.inicio = "2026-12-01T00:00:00.000Z";
    const editado = `${p}.${Buffer.from(JSON.stringify(json)).toString("base64url")}.${firma}`;
    expect(leerAncla(editado, EQUIPO).estado).toBe("alterada");
  });

  it("basura y firmas truncadas cuentan como alteradas", () => {
    expect(leerAncla("hola", EQUIPO).estado).toBe("alterada");
    expect(leerAncla(token("2026-10-19T22:00:00.000Z").slice(0, -4), EQUIPO).estado).toBe("alterada");
  });
});

describe("combinarAnclas", () => {
  const valida = (inicio: string, mayorVisto = inicio) =>
    leerAncla(token(inicio, mayorVisto), EQUIPO) as LecturaAncla;

  it("sin registros no hay evaluación previa", () => {
    expect(combinarAnclas([]).estado).toBe("sin_registro");
  });

  it("manda el inicio más antiguo y la mayor fecha vista", () => {
    const r = combinarAnclas([
      valida("2026-10-19T22:00:00.000Z", "2026-10-25T10:00:00.000Z"),
      valida("2026-10-21T22:00:00.000Z", "2026-11-02T10:00:00.000Z"),
    ]);
    expect(r).toMatchObject({ estado: "valida", validas: 2 });
    if (r.estado === "valida") {
      expect(r.inicio.toISOString()).toBe("2026-10-19T22:00:00.000Z");
      expect(r.mayorVisto.toISOString()).toBe("2026-11-02T10:00:00.000Z");
    }
  });

  it("un solo registro alterado bloquea aunque otro sea válido", () => {
    expect(combinarAnclas([valida("2026-10-19T22:00:00.000Z"), { estado: "alterada" }]).estado).toBe("alterada");
  });

  it("un registro de otro equipo bloquea", () => {
    expect(combinarAnclas([valida("2026-10-19T22:00:00.000Z"), { estado: "otro_equipo" }]).estado).toBe("otro_equipo");
  });
});
