import { describe, it, expect } from "vitest";
import {
  aplicarDeducciones,
  cuotaDelPeriodo,
  estaLiquidada,
  revertirAmortizacion,
  registrosDeAmortizacion,
  type DeduccionVigente,
  type EstadoDeduccion,
} from "@/lib/payroll/deducciones";
import { aNumero as n, money } from "@/lib/payroll/money";

/** Préstamo de 3 cuotas de 400 sobre un saldo de 1,000. */
function prestamo(over: Partial<DeduccionVigente> = {}): DeduccionVigente {
  return {
    id: "d1",
    monto: 400,
    saldo: 1000,
    cuotasMeses: 3,
    cuotasPagadas: 0,
    tipo: "PRESTAMO",
    ...over,
  };
}

// ─── VIGENCIA ────────────────────────────────────────────────────────────────

describe("estaLiquidada — una deducción a plazo se agota", () => {
  it("no está liquidada al inicio", () => {
    expect(estaLiquidada(prestamo())).toBe(false);
  });

  it("se liquida al completar el plazo de cuotas", () => {
    expect(estaLiquidada(prestamo({ cuotasPagadas: 3 }))).toBe(true);
    expect(estaLiquidada(prestamo({ cuotasPagadas: 4 }))).toBe(true);
  });

  it("se liquida al agotar el saldo aunque queden cuotas", () => {
    expect(estaLiquidada(prestamo({ saldo: 0, cuotasPagadas: 1 }))).toBe(true);
  });

  it("una deducción recurrente indefinida nunca se liquida", () => {
    const recurrente = prestamo({ saldo: null, cuotasMeses: null, cuotasPagadas: 99 });
    expect(estaLiquidada(recurrente)).toBe(false);
  });
});

// ─── CUOTA DEL PERÍODO ───────────────────────────────────────────────────────

describe("cuotaDelPeriodo — la última cuota no sobrecobra", () => {
  it("cobra la cuota íntegra mientras hay saldo suficiente", () => {
    expect(n(cuotaDelPeriodo(prestamo()))).toBe(400);
  });

  it("REGRESIÓN: la última cuota se acota al saldo pendiente", () => {
    // 1,000 en cuotas de 400 → 400 + 400 + 200, no 400 + 400 + 400.
    expect(n(cuotaDelPeriodo(prestamo({ saldo: 200, cuotasPagadas: 2 })))).toBe(200);
  });

  it("una deducción liquidada no cobra nada", () => {
    expect(n(cuotaDelPeriodo(prestamo({ cuotasPagadas: 3 })))).toBe(0);
    expect(n(cuotaDelPeriodo(prestamo({ saldo: 0 })))).toBe(0);
  });

  it("un monto cero o negativo no cobra nada", () => {
    expect(n(cuotaDelPeriodo(prestamo({ monto: 0 })))).toBe(0);
    expect(n(cuotaDelPeriodo(prestamo({ monto: -100 })))).toBe(0);
  });
});

// ─── AMORTIZACIÓN ────────────────────────────────────────────────────────────

describe("aplicarDeducciones — amortización", () => {
  it("REGRESIÓN: cobrar una cuota consume cuota y saldo", () => {
    const r = aplicarDeducciones([prestamo()]);
    expect(n(r.prestamos)).toBe(400);
    expect(r.amortizaciones).toHaveLength(1);
    expect(r.amortizaciones[0].cuotasPagadas).toBe(1);
    expect(n(r.amortizaciones[0].saldo!)).toBe(600);
    expect(r.amortizaciones[0].desactivar).toBe(false);
  });

  it("REGRESIÓN: un préstamo nunca cobra más que su saldo original", () => {
    // Ciclo completo: 3 cuotas de 400 sobre un saldo de 1,000 → 400 + 400 + 200.
    let d = prestamo();
    let cobrado = 0;
    for (let i = 0; i < 3; i++) {
      const r = aplicarDeducciones([d]);
      const a = r.amortizaciones[0];
      cobrado += n(r.prestamos);
      d = { ...d, cuotasPagadas: a.cuotasPagadas, saldo: n(a.saldo!) };
      expect(a.desactivar).toBe(i === 2);
    }
    expect(cobrado).toBe(1000);   // exactamente el préstamo, ni un centavo más
    expect(n(d.saldo as number)).toBe(0);

    // Y una vez agotado deja de descontarse para siempre.
    expect(n(aplicarDeducciones([d]).prestamos)).toBe(0);
    expect(aplicarDeducciones([d]).amortizaciones).toHaveLength(0);
  });

  it("REGRESIÓN: sin amortización el descuento sería perpetuo", () => {
    const liquidado = prestamo({ cuotasPagadas: 3, saldo: 0 });
    expect(n(aplicarDeducciones([liquidado]).total)).toBe(0);
    expect(aplicarDeducciones([liquidado]).amortizaciones).toHaveLength(0);
  });

  it("se desactiva al agotar el saldo aunque queden cuotas de plazo", () => {
    const r = aplicarDeducciones([prestamo({ monto: 400, saldo: 400, cuotasMeses: 5, cuotasPagadas: 1 })]);
    expect(n(r.amortizaciones[0].saldo!)).toBe(0);
    expect(r.amortizaciones[0].desactivar).toBe(true);
  });

  it("una deducción recurrente indefinida se cobra pero no amortiza", () => {
    const sindicato: DeduccionVigente = {
      id: "s1", monto: 50, saldo: null, cuotasMeses: null, cuotasPagadas: 0, tipo: "OTRO",
    };
    const r = aplicarDeducciones([sindicato]);
    expect(n(r.otros)).toBe(50);
    expect(r.amortizaciones).toHaveLength(0);
  });

  it("una deducción con plazo pero sin saldo amortiza solo la cuota", () => {
    const r = aplicarDeducciones([prestamo({ saldo: null, cuotasMeses: 2, cuotasPagadas: 1 })]);
    expect(r.amortizaciones[0].saldo).toBeNull();
    expect(r.amortizaciones[0].cuotasPagadas).toBe(2);
    expect(r.amortizaciones[0].desactivar).toBe(true);
  });
});

// ─── CATEGORIZACIÓN ──────────────────────────────────────────────────────────

describe("aplicarDeducciones — reparto por categoría", () => {
  const cartera: DeduccionVigente[] = [
    prestamo({ id: "p", monto: 400, tipo: "PRESTAMO" }),
    prestamo({ id: "a", monto: 300, tipo: "ADELANTO" }),
    prestamo({ id: "c", monto: 200, tipo: "COOPERATIVA" }),
    prestamo({ id: "o", monto: 100, tipo: "VOLUNTARIA" }),
  ];

  it("reparte cada deducción en su categoría", () => {
    const r = aplicarDeducciones(cartera);
    expect(n(r.prestamos)).toBe(400);
    expect(n(r.adelantos)).toBe(300);
    expect(n(r.cooperativa)).toBe(200);
    expect(n(r.otros)).toBe(100);
  });

  it("el total es la suma exacta de las cuatro categorías", () => {
    const r = aplicarDeducciones(cartera);
    expect(n(r.total)).toBe(1000);
    expect(n(r.total)).toBe(n(r.prestamos) + n(r.adelantos) + n(r.cooperativa) + n(r.otros));
  });

  it("acumula varias deducciones de la misma categoría sin perder centavos", () => {
    const centavos = Array.from({ length: 3 }, (_, i) =>
      prestamo({ id: `x${i}`, monto: "0.10", saldo: null, cuotasMeses: null }));
    expect(n(aplicarDeducciones(centavos).prestamos)).toBe(0.3);
  });

  it("una cartera vacía no produce cobros ni amortizaciones", () => {
    const r = aplicarDeducciones([]);
    expect(n(r.total)).toBe(0);
    expect(r.amortizaciones).toHaveLength(0);
  });
});

// ─── AFP ─────────────────────────────────────────────────────────────────────

describe("aplicarDeducciones — AFP", () => {
  const afp = prestamo({ id: "afp", monto: 1200, tipo: "AFP", saldo: null, cuotasMeses: null });

  it("REGRESIÓN: la AFP se cobra desde la deducción del empleado", () => {
    // Antes se buscaba un TipoDeduccionConfig con codigo "AFP" —que no existe,
    // la fila configurada es "AFP-ATL"— y la deducción valía cero para todos.
    const r = aplicarDeducciones([afp]);
    expect(n(r.afp)).toBe(1200);
  });

  it("NO entra en `total`: tiene columna propia y se resta de la base del ISR", () => {
    const r = aplicarDeducciones([afp]);
    expect(n(r.total)).toBe(0);
  });

  it("convive con el resto de categorías sin mezclarse", () => {
    const r = aplicarDeducciones([
      afp,
      prestamo({ id: "p", monto: 400, tipo: "PRESTAMO" }),
      prestamo({ id: "c", monto: 200, tipo: "COOPERATIVA" }),
    ]);
    expect(n(r.afp)).toBe(1200);
    expect(n(r.prestamos)).toBe(400);
    expect(n(r.cooperativa)).toBe(200);
    expect(n(r.total)).toBe(600); // préstamo + cooperativa, sin la AFP
  });

  it("acumula varias AFP del mismo empleado", () => {
    const r = aplicarDeducciones([
      afp,
      prestamo({ id: "afp2", monto: "300.50", tipo: "AFP", saldo: null, cuotasMeses: null }),
    ]);
    expect(n(r.afp)).toBe(1500.5);
  });

  it("una AFP a plazo respeta su saldo y se desactiva al liquidarse", () => {
    const conPlazo = prestamo({ id: "afpP", monto: 500, tipo: "AFP", saldo: 500, cuotasMeses: 1 });
    const r = aplicarDeducciones([conPlazo]);
    expect(n(r.afp)).toBe(500);
    expect(r.amortizaciones[0].desactivar).toBe(true);
  });
});

// ─── REVERSIÓN AL ANULAR UNA PLANILLA ────────────────────────────────────────

describe("revertirAmortizacion — deshacer lo cobrado al anular", () => {
  /** Aplica una cartera y devuelve el estado resultante de la deducción. */
  function aplicarA(d: DeduccionVigente): { estado: EstadoDeduccion; registro: ReturnType<typeof registrosDeAmortizacion>[0] } {
    const r = aplicarDeducciones([d]);
    const a = r.amortizaciones[0];
    return {
      estado: { saldo: a.saldo, cuotasPagadas: a.cuotasPagadas, activo: !a.desactivar },
      registro: registrosDeAmortizacion(r.amortizaciones)[0],
    };
  }

  it("la amortización expone el importe realmente cobrado", () => {
    const r = aplicarDeducciones([prestamo()]);
    expect(n(r.amortizaciones[0].montoAplicado)).toBe(400);
  });

  it("la última cuota registra el importe ACOTADO, no la cuota nominal", () => {
    // Préstamo de 1,000 en cuotas de 400: la tercera sólo cobra 200.
    const ultima = prestamo({ saldo: 200, cuotasPagadas: 2 });
    const r = aplicarDeducciones([ultima]);
    expect(n(r.amortizaciones[0].montoAplicado)).toBe(200);
  });

  it("REGRESIÓN: aplicar y revertir devuelve el estado original", () => {
    // Es la propiedad que hace correcto el flujo anular-y-reemitir. Sin ella,
    // recalcular un período anulado volvía a consumir la cuota.
    const original = prestamo();
    const { estado, registro } = aplicarA(original);
    const revertido = revertirAmortizacion(estado, registro);

    expect(n(revertido.saldo!)).toBe(n(money(original.saldo!)));
    expect(revertido.cuotasPagadas).toBe(original.cuotasPagadas);
    expect(revertido.activo).toBe(true);
  });

  it("revertir la última cuota reactiva la deducción liquidada", () => {
    const ultima = prestamo({ saldo: 400, cuotasPagadas: 2 });
    const { estado, registro } = aplicarA(ultima);

    expect(estado.activo).toBe(false); // quedó liquidada
    const revertido = revertirAmortizacion(estado, registro);
    expect(revertido.activo).toBe(true);
    expect(n(revertido.saldo!)).toBe(400);
    expect(revertido.cuotasPagadas).toBe(2);
  });

  it("una deducción sin saldo no toca la columna al revertir", () => {
    const sinSaldo = prestamo({ saldo: null, cuotasMeses: 6, cuotasPagadas: 1 });
    const { estado, registro } = aplicarA(sinSaldo);

    expect(registro.llevaSaldo).toBe(false);
    const revertido = revertirAmortizacion(estado, registro);
    expect(revertido.saldo).toBeNull();
    expect(revertido.cuotasPagadas).toBe(1);
  });

  it("la reversión es independiente del orden: devolver un delta, no restaurar un estado", () => {
    // Dos planillas cobran cuotas del mismo préstamo de 1,000.
    const inicial = prestamo();
    const p1 = aplicarDeducciones([inicial]);
    const tras1 = p1.amortizaciones[0];

    const p2 = aplicarDeducciones([
      prestamo({ saldo: tras1.saldo!, cuotasPagadas: tras1.cuotasPagadas }),
    ]);
    const tras2 = p2.amortizaciones[0];
    expect(n(tras2.saldo!)).toBe(200); // 1000 − 400 − 400

    // Se anula la PRIMERA planilla, con la segunda aún vigente.
    const revertido = revertirAmortizacion(
      { saldo: tras2.saldo, cuotasPagadas: tras2.cuotasPagadas, activo: true },
      registrosDeAmortizacion(p1.amortizaciones)[0]
    );

    // Debe quedar como si SÓLO la segunda hubiera cobrado: 1000 − 400 = 600.
    expect(n(revertido.saldo!)).toBe(600);
    expect(revertido.cuotasPagadas).toBe(1);
  });

  it("el contador de cuotas nunca baja de cero", () => {
    const revertido = revertirAmortizacion(
      { saldo: money(1000), cuotasPagadas: 0, activo: true },
      { deduccionId: "x", montoAplicado: 400, llevaSaldo: true, desactivo: false }
    );
    expect(revertido.cuotasPagadas).toBe(0);
  });

  it("revertir una deducción que seguía activa no la desactiva", () => {
    const revertido = revertirAmortizacion(
      { saldo: money(600), cuotasPagadas: 1, activo: true },
      { deduccionId: "x", montoAplicado: 400, llevaSaldo: true, desactivo: false }
    );
    expect(revertido.activo).toBe(true);
  });

  it("sólo se registran las deducciones a plazo, no las recurrentes", () => {
    const cartera: DeduccionVigente[] = [
      prestamo({ id: "p", monto: 400 }),
      prestamo({ id: "sind", monto: 100, saldo: null, cuotasMeses: null, tipo: "VOLUNTARIA" }),
    ];
    const registros = registrosDeAmortizacion(aplicarDeducciones(cartera).amortizaciones);
    expect(registros).toHaveLength(1);
    expect(registros[0].deduccionId).toBe("p");
  });
});
