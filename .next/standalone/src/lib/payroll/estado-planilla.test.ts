import { describe, it, expect } from "vitest";
import {
  validarTransicion,
  esEstadoCerrado,
  esEstadoTerminal,
  puedeEditarCampo,
  calcularHashPlanilla,
  verificarIntegridad,
  ocupaPeriodo,
  ESTADOS_OCUPAN_PERIODO,
  TRANSICIONES,
  type EstadoPlanilla,
} from "@/lib/payroll/estado-planilla";
import { PERMISOS_POR_ROL } from "@/lib/auth/permisos";
import type { UserRole } from "@prisma/client";

/**
 * Permisos efectivos de un rol.
 *
 * La matriz de transiciones pasó de roles a permisos, pero el reparto que
 * producía tiene que ser EL MISMO. Los tests siguen escritos en términos de rol
 * y traducen aquí: así comprueban la migración, no sólo el código nuevo.
 */
const comoRol = (rol: string): readonly string[] =>
  PERMISOS_POR_ROL[rol as UserRole] ?? [];

// ─── OCUPACIÓN DE PERÍODO ────────────────────────────────────────────────────

describe("ocupaPeriodo — unicidad del período de planilla", () => {
  it("toda planilla viva ocupa su período e impide emitir otra igual", () => {
    expect(ocupaPeriodo("BORRADOR")).toBe(true);
    expect(ocupaPeriodo("CALCULADA")).toBe(true);
    expect(ocupaPeriodo("APROBADA")).toBe(true);
    expect(ocupaPeriodo("PAGADA")).toBe(true);
  });

  it("una planilla ANULADA libera su período para poder reemitirlo", () => {
    // El flujo de corrección del sistema es anular y reemitir; si ANULADA
    // ocupara el período, un error de cálculo lo dejaría bloqueado para siempre.
    expect(ocupaPeriodo("ANULADA")).toBe(false);
  });

  it("cubre todos los estados salvo el terminal", () => {
    const todos = Object.keys(TRANSICIONES) as EstadoPlanilla[];
    expect([...ESTADOS_OCUPAN_PERIODO].sort())
      .toEqual(todos.filter((e) => e !== "ANULADA").sort());
  });

  it("el índice único parcial en BD debe replicar exactamente esta lista", () => {
    // Documenta el acoplamiento con prisma/sql/01-planilla-periodo-unico.sql:
    // aquel filtra WHERE estado <> 'ANULADA', que es el complemento de esta lista.
    expect(ESTADOS_OCUPAN_PERIODO).not.toContain("ANULADA");
    expect(ESTADOS_OCUPAN_PERIODO).toHaveLength(4);
  });
});

const TODOS: EstadoPlanilla[] = ["BORRADOR", "CALCULADA", "APROBADA", "PAGADA", "ANULADA"];

const detalles = [
  { empleadoId: "emp-b", totalBruto: 15000, totalDeducciones: 1500, salarioNeto: 13500 },
  { empleadoId: "emp-a", totalBruto: 20000, totalDeducciones: 2500, salarioNeto: 17500 },
];

// ─── TRANSICIONES ────────────────────────────────────────────────────────────

describe("Máquina de estados — transiciones legales", () => {
  it("recorre el ciclo de vida normal", () => {
    expect(validarTransicion("BORRADOR", "CALCULADA", comoRol("CONTADOR")).ok).toBe(true);
    expect(validarTransicion("CALCULADA", "APROBADA", comoRol("ADMIN_RRHH")).ok).toBe(true);
    expect(validarTransicion("APROBADA", "PAGADA", comoRol("CONTADOR")).ok).toBe(true);
  });

  it("REGRESIÓN: una planilla PAGADA no puede volver a BORRADOR", () => {
    const r = validarTransicion("PAGADA", "BORRADOR", comoRol("SUPER_ADMIN"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });

  it("REGRESIÓN: una planilla PAGADA no puede volver a CALCULADA ni APROBADA", () => {
    expect(validarTransicion("PAGADA", "CALCULADA", comoRol("SUPER_ADMIN")).ok).toBe(false);
    expect(validarTransicion("PAGADA", "APROBADA", comoRol("SUPER_ADMIN")).ok).toBe(false);
  });

  it("desde PAGADA la única salida es la anulación", () => {
    expect(TRANSICIONES.PAGADA).toEqual(["ANULADA"]);
    expect(validarTransicion("PAGADA", "ANULADA", comoRol("SUPER_ADMIN"), { motivo: "Error de cálculo" }).ok).toBe(true);
  });

  it("ANULADA es terminal: ninguna transición sale de ahí", () => {
    expect(esEstadoTerminal("ANULADA")).toBe(true);
    for (const destino of TODOS) {
      const r = validarTransicion("ANULADA", destino, comoRol("SUPER_ADMIN"), { motivo: "x" });
      expect(r.ok, `ANULADA → ${destino} debe rechazarse`).toBe(false);
    }
  });

  it("rechaza una transición al mismo estado", () => {
    const r = validarTransicion("APROBADA", "APROBADA", comoRol("SUPER_ADMIN"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });

  it("permite reabrir una planilla aprobada, pero no una pagada", () => {
    expect(validarTransicion("APROBADA", "CALCULADA", comoRol("SUPER_ADMIN"), { motivo: "Corrección de horas" }).ok).toBe(true);
    expect(validarTransicion("PAGADA", "CALCULADA", comoRol("SUPER_ADMIN"), { motivo: "x" }).ok).toBe(false);
  });

  it("ningún estado permite transiciones no declaradas en la tabla", () => {
    for (const origen of TODOS) {
      for (const destino of TODOS) {
        if (origen === destino) continue;
        const declarada = TRANSICIONES[origen].includes(destino);
        const r = validarTransicion(origen, destino, comoRol("SUPER_ADMIN"), { motivo: "justificación" });
        expect(r.ok, `${origen} → ${destino}`).toBe(declarada);
      }
    }
  });
});

// ─── PERMISOS DE ROL ─────────────────────────────────────────────────────────

describe("Permisos por transición — separación de funciones", () => {
  it("REGRESIÓN: CONTADOR no puede aprobar la planilla que él calcula", () => {
    const r = validarTransicion("CALCULADA", "APROBADA", comoRol("CONTADOR"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("ADMIN_RRHH aprueba pero no ejecuta el pago", () => {
    expect(validarTransicion("CALCULADA", "APROBADA", comoRol("ADMIN_RRHH")).ok).toBe(true);
    expect(validarTransicion("APROBADA", "PAGADA", comoRol("ADMIN_RRHH")).ok).toBe(false);
  });

  it("solo SUPER_ADMIN puede anular una planilla ya pagada", () => {
    const motivo = { motivo: "Doble pago detectado" };
    expect(validarTransicion("PAGADA", "ANULADA", comoRol("SUPER_ADMIN"), motivo).ok).toBe(true);
    expect(validarTransicion("PAGADA", "ANULADA", comoRol("ADMIN_RRHH"), motivo).ok).toBe(false);
    expect(validarTransicion("PAGADA", "ANULADA", comoRol("CONTADOR"), motivo).ok).toBe(false);
  });

  it("los roles de solo lectura no pueden mover ningún estado", () => {
    for (const rol of ["AUDITOR", "EMPLEADO", "SUPERVISOR", "GERENTE"]) {
      for (const origen of TODOS) {
        for (const destino of TRANSICIONES[origen]) {
          const r = validarTransicion(origen, destino, comoRol(rol), { motivo: "x" });
          expect(r.ok, `${rol} no debería ejecutar ${origen} → ${destino}`).toBe(false);
        }
      }
    }
  });

  it("sin permisos, o con una lista vacía, se rechaza", () => {
    expect(validarTransicion("CALCULADA", "APROBADA", undefined).ok).toBe(false);
    expect(validarTransicion("CALCULADA", "APROBADA", []).ok).toBe(false);
  });
});

// ─── MOTIVO OBLIGATORIO ──────────────────────────────────────────────────────

describe("Justificación obligatoria en actos excepcionales", () => {
  it("exige motivo para reabrir una planilla aprobada", () => {
    expect(validarTransicion("APROBADA", "CALCULADA", comoRol("SUPER_ADMIN")).ok).toBe(false);
    expect(validarTransicion("APROBADA", "CALCULADA", comoRol("SUPER_ADMIN"), { motivo: "  " }).ok).toBe(false);
    expect(validarTransicion("APROBADA", "CALCULADA", comoRol("SUPER_ADMIN"), { motivo: "Error en horas extra" }).ok).toBe(true);
  });

  it("exige motivo para anular una planilla pagada", () => {
    expect(validarTransicion("PAGADA", "ANULADA", comoRol("SUPER_ADMIN")).ok).toBe(false);
    expect(validarTransicion("PAGADA", "ANULADA", comoRol("SUPER_ADMIN"), { motivo: "Reverso bancario" }).ok).toBe(true);
  });

  it("no exige motivo en el flujo normal", () => {
    const r = validarTransicion("CALCULADA", "APROBADA", comoRol("ADMIN_RRHH"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.requiereMotivo).toBe(false);
  });
});

// ─── INMUTABILIDAD DE CAMPOS ─────────────────────────────────────────────────

describe("Inmutabilidad de planillas cerradas", () => {
  it("BORRADOR y CALCULADA son editables", () => {
    expect(esEstadoCerrado("BORRADOR")).toBe(false);
    expect(esEstadoCerrado("CALCULADA")).toBe(false);
    expect(puedeEditarCampo("CALCULADA", "totalNeto")).toBe(true);
  });

  it("REGRESIÓN: los montos quedan congelados al cerrar", () => {
    for (const estado of ["APROBADA", "PAGADA", "ANULADA"] as EstadoPlanilla[]) {
      expect(esEstadoCerrado(estado)).toBe(true);
      expect(puedeEditarCampo(estado, "totalNeto"), estado).toBe(false);
      expect(puedeEditarCampo(estado, "totalBruto"), estado).toBe(false);
      expect(puedeEditarCampo(estado, "fechaPago"), estado).toBe(false);
    }
  });

  it("las observaciones siguen siendo editables tras el cierre", () => {
    expect(puedeEditarCampo("PAGADA", "observaciones")).toBe(true);
  });
});

// ─── HASH DE INTEGRIDAD ──────────────────────────────────────────────────────

describe("Sello de integridad del cálculo", () => {
  it("produce un SHA-256 estable", () => {
    const h = calcularHashPlanilla(detalles);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(calcularHashPlanilla(detalles)).toBe(h);
  });

  it("no depende del orden de lectura de los detalles", () => {
    expect(calcularHashPlanilla([...detalles].reverse())).toBe(calcularHashPlanilla(detalles));
  });

  it("es indiferente al tipo del monto (Decimal, string o number)", () => {
    const comoString = detalles.map((d) => ({
      ...d,
      totalBruto: String(d.totalBruto),
      totalDeducciones: String(d.totalDeducciones),
      salarioNeto: String(d.salarioNeto),
    }));
    expect(calcularHashPlanilla(comoString)).toBe(calcularHashPlanilla(detalles));
  });

  it("REGRESIÓN: detecta la alteración de un monto tras el cierre", () => {
    const sello = calcularHashPlanilla(detalles);
    const alterado = detalles.map((d, i) => (i === 0 ? { ...d, salarioNeto: 13500.01 } : d));
    expect(verificarIntegridad(sello, alterado).intacta).toBe(false);
  });

  it("detecta un empleado agregado o eliminado tras el cierre", () => {
    const sello = calcularHashPlanilla(detalles);
    const conExtra = [...detalles, { empleadoId: "emp-c", totalBruto: 9000, totalDeducciones: 900, salarioNeto: 8100 }];
    expect(verificarIntegridad(sello, conExtra).intacta).toBe(false);
    expect(verificarIntegridad(sello, [detalles[0]]).intacta).toBe(false);
  });

  it("confirma integridad cuando nada cambió", () => {
    const r = verificarIntegridad(calcularHashPlanilla(detalles), detalles);
    expect(r.intacta).toBe(true);
    expect(r.sinHashRegistrado).toBe(false);
  });

  it("señala las planillas heredadas cerradas sin sello", () => {
    const r = verificarIntegridad(null, detalles);
    expect(r.intacta).toBe(false);
    expect(r.sinHashRegistrado).toBe(true);
    expect(r.hashActual).toMatch(/^[a-f0-9]{64}$/);
  });
});
