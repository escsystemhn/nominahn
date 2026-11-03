import { describe, expect, it } from "vitest";
import { filtroCapacitaciones, filtroCapacitacionesCompletas } from "./alcance";

const SUPERVISOR = { id: "u1", alcance: "SUCURSAL" as const, sucursalesIds: ["A"] };
const SU_GENTE = { empleado: { sucursalId: { in: ["A"] } } };

describe("filtroCapacitaciones", () => {
  it("no acota con alcance total", () => {
    expect(filtroCapacitaciones({ alcance: "TODO" })).toEqual({});
  });

  it("deja ver las que tienen a alguien de su alcance y las que creó", () => {
    expect(filtroCapacitaciones(SUPERVISOR)).toEqual({ OR: [{ participantes: { some: SU_GENTE } }, { creadoPor: "u1" }] });
  });

  it("una cuenta sin id no ve las de creadoPor vacío: sólo por sus participantes", () => {
    expect(filtroCapacitaciones({ alcance: "SUCURSAL", sucursalesIds: ["A"] })).toEqual({ OR: [{ participantes: { some: SU_GENTE } }] });
  });

  it("sin sucursales asignadas falla cerrado: el filtro de participantes no deja a nadie", () => {
    expect(filtroCapacitaciones({ alcance: "SUCURSAL", sucursalesIds: [] })).toEqual({
      OR: [{ participantes: { some: { empleado: { id: { in: [] } } } } }],
    });
  });
});

describe("filtroCapacitacionesCompletas", () => {
  it("no acota con alcance total", () => {
    expect(filtroCapacitacionesCompletas({ alcance: "TODO" })).toEqual({});
  });

  it("exige a todos los participantes en su alcance, salvo que la haya creado", () => {
    expect(filtroCapacitacionesCompletas(SUPERVISOR)).toEqual({
      OR: [{ AND: [{ participantes: { some: SU_GENTE } }, { participantes: { none: { NOT: SU_GENTE } } }] }, { creadoPor: "u1" }],
    });
  });
});
