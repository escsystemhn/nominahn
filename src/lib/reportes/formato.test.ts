import { describe, it, expect } from "vitest";
import {
  escaparHtml,
  celdaCsv,
  nombreArchivoSeguro,
  normalizarFormato,
  BOM_UTF8,
} from "./formato";

describe("escaparHtml", () => {
  it("neutraliza etiquetas guardadas en la base", () => {
    // Un nombre o una observación con etiquetas se ejecutaría al abrir el
    // reporte descargado si no se escapara.
    const html = escaparHtml('<script>alert("xss")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
  });

  it("escapa atributos y comillas simples", () => {
    expect(escaparHtml(`" onerror='x'`)).toBe("&quot; onerror=&#39;x&#39;");
  });

  it("escapa el & primero, sin doble escapado invertido", () => {
    expect(escaparHtml("Ávila & Cía <hijos>")).toBe("Ávila &amp; Cía &lt;hijos&gt;");
  });

  it("deja intacto el texto normal, acentos incluidos", () => {
    expect(escaparHtml("María Peña — L. 25,000.00")).toBe("María Peña — L. 25,000.00");
  });
});

describe("celdaCsv", () => {
  it("entrecomilla y duplica las comillas internas", () => {
    expect(celdaCsv('Empleado "El Rápido"')).toBe('"Empleado ""El Rápido"""');
  });

  it("preserva comas y saltos dentro de la celda", () => {
    expect(celdaCsv("Tegucigalpa, F.M.")).toBe('"Tegucigalpa, F.M."');
    expect(celdaCsv("linea1\nlinea2")).toBe('"linea1\nlinea2"');
  });

  it("neutraliza fórmulas que Excel ejecutaría", () => {
    for (const peligroso of ["=1+1", "+1", "-1", "@SUM(A1)", "=HYPERLINK(\"http://x\",\"y\")"]) {
      const celda = celdaCsv(peligroso);
      expect(celda.startsWith('"\'')).toBe(true);
    }
  });

  it("no toca valores que sólo contienen esos signos en medio", () => {
    expect(celdaCsv("Bono 2026-2027")).toBe('"Bono 2026-2027"');
    expect(celdaCsv("a=b")).toBe('"a=b"');
  });

  it("un importe negativo se preserva legible tras el apóstrofo", () => {
    // El apóstrofo es la convención de Excel para "esto es texto"; el valor
    // sigue siendo visible tal cual en la celda.
    expect(celdaCsv("-1500.00")).toBe("\"'-1500.00\"");
  });
});

describe("nombreArchivoSeguro", () => {
  it("descarta lo que podría romper la cabecera Content-Disposition", () => {
    expect(nombreArchivoSeguro('planilla"; x=y')).toBe("planillaxy");
    expect(nombreArchivoSeguro("a\r\nb")).toBe("ab");
    expect(nombreArchivoSeguro("../../etc/passwd")).toBe("etcpasswd");
  });

  it("conserva los identificadores reales de los reportes", () => {
    expect(nombreArchivoSeguro("planilla-detallada")).toBe("planilla-detallada");
    expect(nombreArchivoSeguro("ihss_historico")).toBe("ihss_historico");
  });

  it("cae a un nombre por defecto si no queda nada", () => {
    expect(nombreArchivoSeguro("")).toBe("reporte");
    expect(nombreArchivoSeguro("///")).toBe("reporte");
  });
});

describe("normalizarFormato", () => {
  it("mapea los valores actuales", () => {
    expect(normalizarFormato("CSV")).toBe("CSV");
    expect(normalizarFormato("HTML")).toBe("HTML");
  });

  it("Excel y PDF son formatos propios, y EXCEL se acepta como alias", () => {
    expect(normalizarFormato("EXCEL")).toBe("XLSX");
    expect(normalizarFormato("XLSX")).toBe("XLSX");
    expect(normalizarFormato("PDF")).toBe("PDF");
    expect(normalizarFormato("JSON")).toBe("JSON");
  });

  it("cualquier otra cosa cae en HTML", () => {
    expect(normalizarFormato(null)).toBe("HTML");
    expect(normalizarFormato("docx")).toBe("HTML");
  });
});

describe("BOM_UTF8", () => {
  it("es el carácter que hace que Excel lea UTF-8", () => {
    expect(BOM_UTF8).toBe("﻿");
    expect(BOM_UTF8).toHaveLength(1);
  });
});
