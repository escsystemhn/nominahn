import { describe, it, expect } from "vitest";
import { esPdf, schemaPostulacion, notasDePostulacion, textoSalario, ipParaLimite, FILTRO_VACANTE_PUBLICA } from "./empleos";

const base = { nombre: "Ana Lucía Pineda", email: "Ana@Correo.hn", consentimiento: "si" };

describe("portal de empleo", () => {
  it("sólo publica vacantes abiertas, publicadas y no internas", () => {
    expect(FILTRO_VACANTE_PUBLICA).toEqual({ estado: "ABIERTA", publicada: true, esInterna: false });
  });

  it("reconoce un PDF por su firma y no por la extensión", () => {
    expect(esPdf(new TextEncoder().encode("%PDF-1.7\n..."))).toBe(true);
    expect(esPdf(new TextEncoder().encode("<html>%PDF-"))).toBe(false);
    expect(esPdf(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBe(false); // .docx (zip)
    expect(esPdf(new Uint8Array([0x25, 0x50, 0x44]))).toBe(false);
  });

  it("exige el consentimiento y normaliza el correo", () => {
    expect(schemaPostulacion.safeParse({ ...base, consentimiento: undefined }).success).toBe(false);
    expect(schemaPostulacion.safeParse({ ...base, consentimiento: "no" }).success).toBe(false);
    const r = schemaPostulacion.safeParse(base);
    expect(r.success && r.data.email).toBe("ana@correo.hn");
  });

  it("valida nombre y teléfono", () => {
    expect(schemaPostulacion.safeParse({ ...base, nombre: "A" }).success).toBe(false);
    expect(schemaPostulacion.safeParse({ ...base, telefono: "abc" }).success).toBe(false);
    expect(schemaPostulacion.safeParse({ ...base, telefono: "+504 9999-0000" }).success).toBe(true);
    expect(schemaPostulacion.safeParse({ ...base, telefono: "" }).success).toBe(true);
  });

  it("deja el mensaje del candidato en las notas", () => {
    const p = schemaPostulacion.parse({ ...base, mensaje: "Tengo cinco años en contabilidad." });
    const n = notasDePostulacion(p, new Date("2026-10-15T15:00:00Z"));
    expect(n).toContain("2026-10-15");
    expect(n).toContain("Tengo cinco años en contabilidad.");
  });

  it("escribe el rango salarial sólo si existe", () => {
    const f = (n: number) => `L ${n}`;
    expect(textoSalario(null, null, f)).toBeNull();
    expect(textoSalario(15000, 20000, f)).toBe("L 15000 a L 20000");
    expect(textoSalario(15000, null, f)).toBe("Desde L 15000");
    expect(textoSalario(null, 20000, f)).toBe("Hasta L 20000");
  });

  it("toma la IP que añade el proxy más cercano, no la que escribe el cliente", () => {
    expect(ipParaLimite("1.2.3.4, 10.0.0.7", null)).toBe("10.0.0.7");
    expect(ipParaLimite("203.0.113.9", null)).toBe("203.0.113.9");
    expect(ipParaLimite(null, "198.51.100.2")).toBe("198.51.100.2");
    expect(ipParaLimite(" , ", null)).toBe("desconocida");
  });
});
