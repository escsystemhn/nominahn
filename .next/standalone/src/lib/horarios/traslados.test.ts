import { describe, expect, it } from "vitest";
import { destinoEn, erroresDeTraslado, tramosSeguidos, type TrasladoPlan } from "./traslados";

const t = (over: Partial<TrasladoPlan> = {}): TrasladoPlan => ({
  id: "t1", empleadoId: "e1", sucursalOrigenId: "SPS", sucursalDestinoId: "CHO", desde: "2026-11-02", hasta: "2026-11-04", motivo: null, ...over,
});

describe("destinoEn", () => {
  it("dentro de las fechas, la sucursal de destino (los extremos cuentan)", () => {
    expect(destinoEn([t()], "e1", "2026-11-02")).toBe("CHO");
    expect(destinoEn([t()], "e1", "2026-11-04")).toBe("CHO");
  });
  it("fuera de fechas o de otra persona, nada", () => {
    expect(destinoEn([t()], "e1", "2026-11-05")).toBeNull();
    expect(destinoEn([t()], "e2", "2026-11-03")).toBeNull();
  });
});

describe("erroresDeTraslado", () => {
  const nuevo = { empleadoId: "e1", sucursalDestinoId: "CHO", desde: "2026-11-10", hasta: "2026-11-12" };
  it("uno válido no da errores", () => {
    expect(erroresDeTraslado(nuevo, "SPS", [t()])).toEqual([]);
  });
  it("a su propia sucursal, no", () => {
    expect(erroresDeTraslado({ ...nuevo, sucursalDestinoId: "SPS" }, "SPS", [])).toHaveLength(1);
  });
  it("fechas al revés, no", () => {
    expect(erroresDeTraslado({ ...nuevo, desde: "2026-11-12", hasta: "2026-11-10" }, "SPS", [])[0]).toContain("anterior");
  });
  it("cruzado con otro suyo, no (aunque sea a otra sucursal)", () => {
    const e = erroresDeTraslado({ ...nuevo, desde: "2026-11-04", sucursalDestinoId: "EP" }, "SPS", [t()]);
    expect(e[0]).toContain("del 02/11/2026 al 04/11/2026");
  });
  it("el de otra persona no estorba", () => {
    expect(erroresDeTraslado({ ...nuevo, desde: "2026-11-03" }, "SPS", [t({ empleadoId: "e2" })])).toEqual([]);
  });
});

describe("tramosSeguidos", () => {
  it("une días seguidos y separa los saltos, sin importar el orden ni repetidos", () => {
    expect(tramosSeguidos(["2026-11-06", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-03"])).toEqual([
      { desde: "2026-11-02", hasta: "2026-11-04" },
      { desde: "2026-11-06", hasta: "2026-11-06" },
    ]);
  });
  it("cruza fin de mes", () => {
    expect(tramosSeguidos(["2026-10-31", "2026-11-01"])).toEqual([{ desde: "2026-10-31", hasta: "2026-11-01" }]);
  });
});
