import { describe, it, expect } from "vitest";
import { tipoDeDispositivo } from "./dispositivo";

describe("tipoDeDispositivo", () => {
  it("con mouse es computadora, aunque la ventana o la pantalla sean chicas", () => {
    expect(tipoDeDispositivo({ conDedo: false, anchoPantalla: 1920, altoPantalla: 1080 })).toBe("COMPUTADORA");
    expect(tipoDeDispositivo({ conDedo: false, anchoPantalla: 1366, altoPantalla: 768 })).toBe("COMPUTADORA");
    expect(tipoDeDispositivo({ conDedo: false, anchoPantalla: 500, altoPantalla: 400 })).toBe("COMPUTADORA");
  });

  it.each([
    [360, 740], [390, 844], [430, 932], // celulares de pie
    [844, 390], [932, 430], // y acostados
  ])("un celular de %s × %s es celular", (ancho, alto) => {
    expect(tipoDeDispositivo({ conDedo: true, anchoPantalla: ancho, altoPantalla: alto })).toBe("CELULAR");
  });

  it.each([
    [768, 1024], [1024, 768], [820, 1180], [1180, 820], [1024, 1366], [600, 960],
  ])("una tablet de %s × %s es tablet, de pie o acostada", (ancho, alto) => {
    expect(tipoDeDispositivo({ conDedo: true, anchoPantalla: ancho, altoPantalla: alto })).toBe("TABLET");
  });
});
