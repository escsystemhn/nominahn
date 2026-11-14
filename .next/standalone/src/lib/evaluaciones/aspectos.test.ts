import { describe, expect, it } from "vitest";
import { ASPECTOS_BASE, elegirAspectos, type FilaGeneral, type FilaPuesto } from "./aspectos";

const comp = (id: string, extra: Partial<FilaPuesto["competencia"]> = {}) => ({
  id, nombre: id.toUpperCase(), descripcion: null, activa: true, tipoEvaluacion: null, ...extra,
});

describe("elegirAspectos", () => {
  it("usa los del puesto, con su peso y nivel", () => {
    const r = elegirAspectos("DESEMPENO_MENSUAL", [
      { peso: "3.00", nivelRequerido: "AVANZADO", competencia: comp("caja") },
      { peso: 1, nivelRequerido: "BASICO", competencia: comp("orden") },
    ], [{ ...comp("general"), peso: 1 }]);
    expect(r.origen).toBe("PUESTO");
    expect(r.aspectos).toEqual([
      { competenciaId: "caja", nombre: "CAJA", descripcion: null, peso: 3, nivelRequerido: "AVANZADO" },
      { competenciaId: "orden", nombre: "ORDEN", descripcion: null, peso: 1, nivelRequerido: "BASICO" },
    ]);
  });

  it("filtra por tipo de evaluación y por activa", () => {
    const r = elegirAspectos("COMPETENCIA_TRIMESTRAL", [
      { peso: 1, nivelRequerido: "BASICO", competencia: comp("mensual", { tipoEvaluacion: "DESEMPENO_MENSUAL" }) },
      { peso: 1, nivelRequerido: "BASICO", competencia: comp("vieja", { activa: false }) },
      { peso: 1, nivelRequerido: "BASICO", competencia: comp("trimestral", { tipoEvaluacion: "COMPETENCIA_TRIMESTRAL" }) },
    ], []);
    expect(r.aspectos.map((a) => a.competenciaId)).toEqual(["trimestral"]);
  });

  it("sin aspectos del puesto para ese tipo, usa los generales", () => {
    const generales: FilaGeneral[] = [
      { ...comp("puntualidad"), peso: "2" },
      { ...comp("solo-trimestral", { tipoEvaluacion: "COMPETENCIA_TRIMESTRAL" }), peso: 1 },
    ];
    const r = elegirAspectos("DESEMPENO_MENSUAL", [
      { peso: 1, nivelRequerido: "BASICO", competencia: comp("t", { tipoEvaluacion: "COMPETENCIA_TRIMESTRAL" }) },
    ], generales);
    expect(r.origen).toBe("GENERAL");
    expect(r.aspectos).toEqual([{ competenciaId: "puntualidad", nombre: "PUNTUALIDAD", descripcion: null, peso: 2, nivelRequerido: null }]);
  });

  it("sin nada configurado, la lista base del tipo (copia, no la misma referencia)", () => {
    const r = elegirAspectos("DESEMPENO_MENSUAL", [], []);
    expect(r.origen).toBe("BASE");
    expect(r.aspectos.map((a) => a.nombre)[0]).toBe("Puntualidad y asistencia");
    r.aspectos[0].peso = 9;
    expect(ASPECTOS_BASE.DESEMPENO_MENSUAL[0].peso).toBe(1);
  });

  it("un peso 0 deja fuera al aspecto", () => {
    const r = elegirAspectos("DESEMPENO_MENSUAL", [{ peso: 0, nivelRequerido: "BASICO", competencia: comp("cero") }], []);
    expect(r.origen).toBe("BASE");
  });
});
