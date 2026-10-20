import { describe, it, expect, afterEach } from "vitest";
import path from "path";
import {
  nombreArchivoValido,
  extensionPermitida,
  tipoContenido,
  directorioUploads,
  maxBytes,
} from "./uploads";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("uploads — validación de nombre (anti path-traversal)", () => {
  it("acepta un UUID con extensión permitida", () => {
    expect(nombreArchivoValido(`${UUID}.pdf`)).toBe(true);
    expect(nombreArchivoValido(`${UUID}.JPEG`)).toBe(true);
  });

  it("RECHAZA intentos de path traversal", () => {
    expect(nombreArchivoValido("../../.env")).toBe(false);
    expect(nombreArchivoValido(`../${UUID}.pdf`)).toBe(false);
    expect(nombreArchivoValido(`foo/${UUID}.pdf`)).toBe(false);
    expect(nombreArchivoValido(`${UUID}.pdf/../../secret`)).toBe(false);
    expect(nombreArchivoValido("..\\..\\windows\\system32")).toBe(false);
  });

  it("rechaza extensiones peligrosas o no permitidas", () => {
    expect(nombreArchivoValido(`${UUID}.html`)).toBe(false);
    expect(nombreArchivoValido(`${UUID}.svg`)).toBe(false);
    expect(nombreArchivoValido(`${UUID}.exe`)).toBe(false);
    expect(nombreArchivoValido(`${UUID}`)).toBe(false); // sin extensión
  });

  it("rechaza un nombre que no es un UUID (no adivinable a mano)", () => {
    expect(nombreArchivoValido("boleta.pdf")).toBe(false);
    expect(nombreArchivoValido("1.pdf")).toBe(false);
  });
});

describe("uploads — extensión y tipo de contenido", () => {
  it("valida la lista de extensiones sin importar mayúsculas", () => {
    expect(extensionPermitida(".PDF")).toBe(true);
    expect(extensionPermitida(".webp")).toBe(true);
    expect(extensionPermitida(".html")).toBe(false);
  });

  it("mapea la extensión a su MIME", () => {
    expect(tipoContenido(`${UUID}.pdf`)).toBe("application/pdf");
    expect(tipoContenido(`${UUID}.png`)).toBe("image/png");
    expect(tipoContenido(`${UUID}.jpg`)).toBe("image/jpeg");
  });
});

describe("uploads — configuración por entorno", () => {
  const envPrevia = { ...process.env };
  afterEach(() => {
    process.env = { ...envPrevia };
  });

  it("el directorio por defecto NO está bajo public/", () => {
    delete process.env.UPLOAD_DIR;
    const dir = directorioUploads();
    expect(dir.includes(`${path.sep}public${path.sep}`)).toBe(false);
    expect(dir.endsWith(path.join("var", "uploads"))).toBe(true);
  });

  it("respeta UPLOAD_DIR cuando está definido", () => {
    process.env.UPLOAD_DIR = path.join("D:", "datos", "subidas");
    expect(directorioUploads()).toBe(path.resolve(process.env.UPLOAD_DIR));
  });

  it("maxBytes cae al default con valores inválidos", () => {
    process.env.MAX_FILE_SIZE = "no-numero";
    expect(maxBytes()).toBe(5 * 1024 * 1024);
    process.env.MAX_FILE_SIZE = "1048576";
    expect(maxBytes()).toBe(1048576);
  });
});
