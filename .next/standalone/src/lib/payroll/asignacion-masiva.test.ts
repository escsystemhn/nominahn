import { describe, it, expect } from "vitest";
import { decidirAsignacion, opcionesSiYaLaTiene, resumenExistentes, type DeduccionDelTipo } from "@/lib/payroll/asignacion-masiva";

const cadaPlanilla = (monto: number, id = "f"): DeduccionDelTipo => ({ id, monto, saldo: null, cuotasMeses: null, cuotasPagadas: 0 });
const prestamo = (saldo: number, id = "p"): DeduccionDelTipo => ({ id, monto: 6000, saldo, cuotasMeses: 12, cuotasPagadas: 3 });

describe("asignar a varios: quien ya lo tiene", () => {
  it("las opciones dependen de la forma de cobro", () => {
    expect(opcionesSiYaLaTiene("SIEMPRE")).toEqual(["SALTAR", "ACTUALIZAR"]);
    expect(opcionesSiYaLaTiene("CUOTAS")).toEqual(["SALTAR", "AGREGAR"]);
  });

  it("cada planilla: quien no la tiene la recibe; quien la tiene se salta o se le cambia el monto", () => {
    expect(decidirAsignacion("SIEMPRE", "SALTAR", [], 1000)).toEqual({ accion: "CREAR" });
    expect(decidirAsignacion("SIEMPRE", "SALTAR", [cadaPlanilla(900)], 1000)).toMatchObject({ accion: "SALTAR" });
    const r = decidirAsignacion("SIEMPRE", "ACTUALIZAR", [cadaPlanilla(900)], 1000);
    expect(r).toMatchObject({ accion: "ACTUALIZAR", id: "f" });
    if (r.accion === "ACTUALIZAR") expect(r.antes.toFixed(2)).toBe("900.00");
  });

  it("cada planilla con el mismo monto, o con dos del tipo, no se toca", () => {
    expect(decidirAsignacion("SIEMPRE", "ACTUALIZAR", [cadaPlanilla(1000)], "1000.00")).toMatchObject({ accion: "SALTAR", motivo: "ya tiene ese mismo monto" });
    expect(decidirAsignacion("SIEMPRE", "ACTUALIZAR", [cadaPlanilla(1000, "a"), cadaPlanilla(200, "b")], 300)).toMatchObject({ accion: "SALTAR" });
  });

  it("un préstamo del tipo no cuenta como «ya la tiene» para una de cada planilla", () => {
    expect(decidirAsignacion("SIEMPRE", "SALTAR", [prestamo(4500)], 1000)).toEqual({ accion: "CREAR" });
  });

  it("una vez o en cuotas: con saldo pendiente se salta o se agrega otra; un préstamo ya pagado no cuenta", () => {
    expect(decidirAsignacion("CUOTAS", "SALTAR", [prestamo(4500)], 3000)).toMatchObject({ accion: "SALTAR" });
    expect(decidirAsignacion("CUOTAS", "AGREGAR", [prestamo(4500)], 3000)).toEqual({ accion: "CREAR" });
    expect(decidirAsignacion("UNA_VEZ", "SALTAR", [prestamo(0)], 500)).toEqual({ accion: "CREAR" });
    expect(decidirAsignacion("UNA_VEZ", "SALTAR", [cadaPlanilla(100)], 500)).toEqual({ accion: "CREAR" });
  });

  it("resume lo que ya tiene para mostrarlo en la lista", () => {
    const r = resumenExistentes([cadaPlanilla(1000), prestamo(4500), prestamo(0, "pagado")]);
    expect(r.cadaPlanilla?.toFixed(2)).toBe("1000.00");
    expect(r.pendiente?.toFixed(2)).toBe("4500.00");
    expect(resumenExistentes([])).toEqual({ cadaPlanilla: null, pendiente: null });
  });
});
