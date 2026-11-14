import { describe, expect, it, vi } from "vitest";
import { filtroPlanes, filtroSucursalesPlanificables, planesCompletos, rechazoDeAccion, recortarPlan, vistaDePlan, type PlanValidado, type VistaPlan } from "./alcance";

const SUPERVISOR = { alcance: "SUCURSAL" as const, sucursalesIds: ["A"] };
const JEFE_DEPTO = { alcance: "DEPARTAMENTO" as const, departamentoId: "d1", sucursalesIds: [] };

/** Base falsa: las sucursales que alcanza, la gente suya del plan y los planes con gente ajena. */
function base(o: { plan?: { id: string; sucursalesIds: string[] } | null; sucursales?: string[]; suyos?: string[]; conAjenos?: string[] }) {
  return {
    planHorario: { findUnique: vi.fn().mockResolvedValue(o.plan ?? null) },
    sucursal: { findMany: vi.fn().mockResolvedValue((o.sucursales ?? []).map((id) => ({ id }))) },
    horarioDia: {
      findMany: vi.fn().mockImplementation(({ select }: { select: { planId?: true } }) =>
        Promise.resolve(select.planId ? (o.conAjenos ?? []).map((planId) => ({ planId })) : (o.suyos ?? []).map((empleadoId) => ({ empleadoId })))
      ),
    },
  };
}

describe("vistaDePlan", () => {
  it("con alcance total no consulta nada", async () => {
    const db = base({});
    expect(await vistaDePlan(db as never, { alcance: "TODO" }, "p")).toEqual({ acceso: "total" });
    expect(db.planHorario.findUnique).not.toHaveBeenCalled();
  });

  it("un id inexistente y un plan sin nada suyo se responden igual", async () => {
    const inexistente = await vistaDePlan(base({ plan: null, sucursales: ["A"] }) as never, SUPERVISOR, "p");
    const ajeno = await vistaDePlan(base({ plan: { id: "p", sucursalesIds: ["B"] }, sucursales: ["A"] }) as never, SUPERVISOR, "p");
    expect(inexistente).toEqual({ acceso: "ninguno" });
    expect(ajeno).toEqual({ acceso: "ninguno" });
  });

  it("un plan de varias sucursales con parte en su alcance es parcial", async () => {
    const vista = await vistaDePlan(base({ plan: { id: "p", sucursalesIds: ["A", "B"] }, sucursales: ["A"], suyos: ["e1"] }) as never, SUPERVISOR, "p");
    expect(vista).toEqual({ acceso: "parcial", empleados: new Set(["e1"]), sucursales: new Set(["A"]) });
  });

  it("un plan sólo de su sucursal es entero", async () => {
    const vista = await vistaDePlan(base({ plan: { id: "p", sucursalesIds: ["A"] }, sucursales: ["A"], suyos: ["e1"] }) as never, SUPERVISOR, "p");
    expect(vista).toEqual({ acceso: "total" });
  });

  it("gente de otra sucursal metida a mano en su plan lo vuelve parcial", async () => {
    const vista = await vistaDePlan(base({ plan: { id: "p", sucursalesIds: ["A"] }, sucursales: ["A"], suyos: ["e1"], conAjenos: ["p"] }) as never, SUPERVISOR, "p");
    expect(vista.acceso).toBe("parcial");
  });

  it("quien alcanza un departamento nunca tiene un plan entero: el plan es de la sucursal", async () => {
    const vista = await vistaDePlan(base({ plan: { id: "p", sucursalesIds: ["A"] }, sucursales: ["A"], suyos: ["e1"] }) as never, JEFE_DEPTO, "p");
    expect(vista.acceso).toBe("parcial");
  });
});

describe("planesCompletos", () => {
  it("con alcance total, todos", async () => {
    const r = await planesCompletos(base({}) as never, { alcance: "TODO" }, [{ id: "p", sucursalesIds: ["Z"] }]);
    expect(r).toEqual(new Set(["p"]));
  });

  it("deja fuera los que tienen otra sucursal o gente ajena", async () => {
    const planes = [
      { id: "suyo", sucursalesIds: ["A"] },
      { id: "mixto", sucursalesIds: ["A", "B"] },
      { id: "colado", sucursalesIds: ["A"] },
    ];
    expect(await planesCompletos(base({ conAjenos: ["colado"] }) as never, SUPERVISOR, planes)).toEqual(new Set(["suyo"]));
  });
});

describe("filtroPlanes", () => {
  it("no acota con alcance total", async () => {
    expect(await filtroPlanes(base({}) as never, { alcance: "TODO" })).toEqual({});
  });

  it("une los de sus sucursales con los que programan a su gente", async () => {
    expect(await filtroPlanes(base({ sucursales: ["A"] }) as never, SUPERVISOR)).toEqual({
      OR: [{ sucursalesIds: { hasSome: ["A"] } }, { dias: { some: { empleado: { sucursalId: { in: ["A"] } } } } }],
    });
  });
});

describe("filtroSucursalesPlanificables", () => {
  it("deja generar a quien alcanza la sucursal entera", () => {
    expect(filtroSucursalesPlanificables({ alcance: "TODO" })).toEqual({});
    expect(filtroSucursalesPlanificables(SUPERVISOR)).toEqual({ id: { in: ["A"] } });
  });

  it("no deja generar a quien alcanza sólo un departamento o su expediente", () => {
    expect(filtroSucursalesPlanificables(JEFE_DEPTO)).toEqual({ id: { in: [] } });
    expect(filtroSucursalesPlanificables({ alcance: "PROPIO", empleadoId: "e1" })).toEqual({ id: { in: [] } });
  });
});

describe("rechazoDeAccion", () => {
  it("deja pasar sólo el acceso total", () => {
    expect(rechazoDeAccion({ acceso: "total" })).toBeNull();
  });

  it("sin nada suyo responde que no existe", async () => {
    const r = rechazoDeAccion({ acceso: "ninguno" })!;
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Plan no encontrado" });
  });

  it("con parte de la gente responde que sólo puede consultar", () => {
    expect(rechazoDeAccion({ acceso: "parcial", empleados: new Set(), sucursales: new Set() })!.status).toBe(403);
  });
});

describe("recortarPlan", () => {
  const dia = (empleadoId: string) => ({ empleadoId });
  const plan = {
    plan: { id: "p", sucursalesIds: ["A", "B"], dias: [dia("a1"), dia("b1")], resumen: { errores: 7 } },
    ctx: {
      empleados: [{ id: "a1", puestoId: "pa", sucursalId: "A" }, { id: "b1", puestoId: "pb", sucursalId: "B" }],
      sucursales: [{ id: "A", nombre: "Sucursal A" }, { id: "B", nombre: "Sucursal B" }],
      requisitos: [{ sucursalId: "A" }, { sucursalId: "B" }],
      horarioAtencion: [{ sucursalId: "A" }, { sucursalId: "B" }],
      feriados: [{ sucursalId: null, nombre: "Nacional" }, { sucursalId: "A", nombre: "Local A" }, { sucursalId: "B", nombre: "Local B" }],
      ausencias: [dia("a1"), dia("b1")],
      historial: [dia("a1"), dia("b1")],
      nombres: { sucursales: { A: "Sucursal A", B: "Sucursal B" }, puestos: { pa: "Cajero", pb: "Bodeguero", pc: "Vigilante" } },
    },
    dias: [dia("a1"), dia("b1")],
    validacion: {
      dias: [dia("a1"), dia("b1")],
      resumen: [dia("a1"), dia("b1")],
      alertas: [
        { codigo: "PERSONA", empleadoId: "a1", mensaje: "de su gente" },
        { codigo: "PERSONA", empleadoId: "b1", mensaje: "de la otra sucursal" },
        { codigo: "COBERTURA", sucursalId: "A", mensaje: "su sucursal" },
        { codigo: "COBERTURA", sucursalId: "B", mensaje: "la otra sucursal" },
        { codigo: "RARA", mensaje: "de nadie" },
      ],
      faltantes: [{ sucursalId: "A", puestoId: "pa" }, { sucursalId: "B", puestoId: "pb" }],
    },
    notas: [
      { codigo: "GEN_TURNO_DESCARTADO", mensaje: "del catálogo" },
      { codigo: "GEN_MENOR_DE_14", mensaje: "No se programó a Fulana (13 años)" },
      { codigo: "GEN_SIN_COBERTURA", mensaje: "1 persona: Zutano" },
    ],
  } as unknown as PlanValidado;

  const parcial: VistaPlan = { acceso: "parcial", empleados: new Set(["a1"]), sucursales: new Set(["A"]) };

  it("con acceso total devuelve el mismo plan", () => {
    expect(recortarPlan(plan, { acceso: "total" })).toBe(plan);
  });

  it("no deja salir nada de la otra sucursal", () => {
    const texto = JSON.stringify(recortarPlan(plan, parcial));
    for (const ajeno of ["b1", "Sucursal B", "Bodeguero", "Vigilante", "Local B", "la otra sucursal", "de la otra sucursal", "de nadie", "Fulana", "Zutano"]) {
      expect(texto, ajeno).not.toContain(ajeno);
    }
  });

  it("conserva lo de su gente y su sucursal", () => {
    const r = recortarPlan(plan, parcial);
    expect(r.ctx.empleados.map((e) => e.id)).toEqual(["a1"]);
    expect(r.ctx.feriados.map((f) => f.nombre)).toEqual(["Nacional", "Local A"]);
    expect(r.validacion.alertas.map((a) => a.mensaje)).toEqual(["de su gente", "su sucursal"]);
    expect(r.validacion.faltantes.map((f) => f.puestoId)).toEqual(["pa"]);
    expect(r.ctx.nombres.puestos).toEqual({ pa: "Cajero" });
    expect(r.plan.sucursalesIds).toEqual(["A"]);
    expect(r.notas.map((n) => n.codigo)).toEqual(["GEN_TURNO_DESCARTADO"]);
  });

  it("el resumen guardado, que es del plan entero, no sale", () => {
    expect(recortarPlan(plan, parcial).plan.resumen).toBeNull();
  });

  it("con acceso ninguno queda en cero filas, no en todas", () => {
    const r = recortarPlan(plan, { acceso: "ninguno" });
    expect(r.ctx.empleados).toEqual([]);
    expect(r.validacion.dias).toEqual([]);
  });

  it("el plan original no se toca: el resumen a guardar sigue siendo el del plan entero", () => {
    recortarPlan(plan, parcial);
    expect(plan.validacion.alertas).toHaveLength(5);
    expect(plan.ctx.empleados).toHaveLength(2);
  });
});
