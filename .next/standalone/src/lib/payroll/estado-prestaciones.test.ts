import { describe, it, expect } from "vitest";
import { PERMISOS_POR_ROL, expandir, COMODIN } from "@/lib/auth/permisos";
import {
  validarTransicionLiquidacion,
  validarTransicionDecimo,
  accionesLiquidacion,
  accionesDecimo,
} from "./estado-prestaciones";

const rrhh = PERMISOS_POR_ROL.ADMIN_RRHH;
const contador = PERMISOS_POR_ROL.CONTADOR;
const admin = expandir([COMODIN]);

describe("liquidaciones", () => {
  it("RRHH aprueba y Contabilidad paga; ninguno hace lo del otro", () => {
    expect(validarTransicionLiquidacion("BORRADOR", "APROBADA", rrhh)).toEqual({ ok: true });
    expect(validarTransicionLiquidacion("BORRADOR", "APROBADA", contador)).toMatchObject({ ok: false, status: 403 });
    expect(validarTransicionLiquidacion("APROBADA", "PAGADA", contador)).toEqual({ ok: true });
    expect(validarTransicionLiquidacion("APROBADA", "PAGADA", rrhh)).toMatchObject({ ok: false, status: 403 });
  });

  it("no se salta estados ni se vuelve atrás", () => {
    expect(validarTransicionLiquidacion("BORRADOR", "PAGADA", admin)).toMatchObject({ ok: false, status: 409 });
    expect(validarTransicionLiquidacion("PAGADA", "APROBADA", admin)).toMatchObject({ ok: false, status: 409 });
    expect(validarTransicionLiquidacion("ANULADA", "BORRADOR", admin)).toMatchObject({ ok: false, status: 409 });
    expect(validarTransicionLiquidacion("APROBADA", "APROBADA", admin)).toMatchObject({ ok: false, status: 422 });
  });

  it("anular lo aprobado o pagado exige motivo; anular un borrador no", () => {
    expect(validarTransicionLiquidacion("BORRADOR", "ANULADA", rrhh)).toEqual({ ok: true });
    expect(validarTransicionLiquidacion("APROBADA", "ANULADA", rrhh)).toMatchObject({ ok: false, status: 422 });
    expect(validarTransicionLiquidacion("APROBADA", "ANULADA", rrhh, "error de cálculo")).toEqual({ ok: true });
  });

  it("anular una liquidación pagada queda para el super administrador", () => {
    expect(validarTransicionLiquidacion("PAGADA", "ANULADA", rrhh, "x")).toMatchObject({ ok: false, status: 403 });
    expect(validarTransicionLiquidacion("PAGADA", "ANULADA", contador, "x")).toMatchObject({ ok: false, status: 403 });
    expect(validarTransicionLiquidacion("PAGADA", "ANULADA", admin, "x")).toEqual({ ok: true });
  });

  it("acciones visibles según estado y permisos", () => {
    expect(accionesLiquidacion("BORRADOR", rrhh)).toEqual(["APROBADA", "ANULADA"]);
    expect(accionesLiquidacion("BORRADOR", contador)).toEqual(["ANULADA"]);
    expect(accionesLiquidacion("APROBADA", contador)).toEqual(["PAGADA"]);
    expect(accionesLiquidacion("PAGADA", rrhh)).toEqual([]);
    expect(accionesLiquidacion("PAGADA", admin)).toEqual(["ANULADA"]);
  });
});

describe("décimos", () => {
  it("Contabilidad registra el pago; quien calcula puede anular lo calculado", () => {
    expect(validarTransicionDecimo("CALCULADA", "PAGADA", contador)).toEqual({ ok: true });
    expect(validarTransicionDecimo("CALCULADA", "PAGADA", rrhh)).toMatchObject({ ok: false, status: 403 });
    expect(validarTransicionDecimo("CALCULADA", "ANULADA", rrhh)).toEqual({ ok: true });
    expect(validarTransicionDecimo("PAGADA", "ANULADA", contador, "x")).toMatchObject({ ok: false, status: 403 });
    expect(validarTransicionDecimo("PAGADA", "ANULADA", admin)).toMatchObject({ ok: false, status: 422 });
    expect(accionesDecimo("CALCULADA", contador)).toEqual(["PAGADA", "ANULADA"]);
  });
});
