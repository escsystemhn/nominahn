import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { formatDate } from "@/lib/utils";
import { cargarPlan } from "@/lib/payroll/plan-cuentas";
import {
  generarPartidaContable,
  generarPartidaPorCentroCosto,
  type GrupoCentroCosto,
} from "@/lib/payroll/partida-contable";
import { aNumero, esCero, type Money } from "@/lib/payroll/money";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("planillas.contabilidad");
  if (!g.ok) return g.response;

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const formato = (searchParams.get("formato") ?? "JSON").toUpperCase();
  const incluirProvisiones = searchParams.get("provisiones") !== "false";

  /**
   * ?centros=1 desglosa el gasto por centro de costo.
   *
   * Es una vista ADICIONAL, no un reemplazo: el asiento consolidado sigue siendo
   * el documento contable, y el desglose se concilia contra él al céntimo.
   */
  const porCentros = searchParams.get("centros") === "1";

  const planilla = await prisma.planilla.findUnique({
    where: { id },
    include: {
      empresa: { select: { nombre: true } },
      detalles: porCentros
        ? {
            include: {
              // El centro del EMPLEADO prevalece; si no tiene, hereda el de su
              // departamento. Es la regla que refleja la realidad: casi todo el
              // mundo imputa a su área, y la excepción se marca en la persona.
              empleado: {
                select: {
                  centroCosto: { select: { id: true, codigo: true, nombre: true, cuentaGasto: true } },
                  departamento: {
                    select: {
                      centroCosto: { select: { id: true, codigo: true, nombre: true, cuentaGasto: true } },
                    },
                  },
                },
              },
            },
          }
        : true,
    },
  });

  if (!planilla) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // Los `Decimal` de Prisma entran tal cual: convertirlos a `number` aquí era
  // exactamente el paso que perdía precisión antes de sumar 200 líneas.
  // El catálogo del contador prevalece sobre el plan de ejemplo; lo que no haya
  // remapeado cae al valor por omisión.
  const plan = await cargarPlan(prisma);
  const partida = generarPartidaContable(planilla.detalles, { incluirProvisiones, plan });
  const concepto = `Planilla ${planilla.tipo} ${formatDate(planilla.fechaInicio)} al ${formatDate(planilla.fechaFin)} — ${planilla.empresa.nombre}`;

  // ─── Desglose por centro de costo ───────────────────────────────────────────
  if (porCentros) {
    type DetalleConCentro = (typeof planilla.detalles)[number] & {
      empleado?: {
        centroCosto: { id: string; codigo: string; nombre: string; cuentaGasto: string | null } | null;
        departamento: {
          centroCosto: { id: string; codigo: string; nombre: string; cuentaGasto: string | null } | null;
        } | null;
      };
    };

    const grupos = new Map<string, GrupoCentroCosto>();
    for (const d of planilla.detalles as DetalleConCentro[]) {
      const centro = d.empleado?.centroCosto ?? d.empleado?.departamento?.centroCosto ?? null;
      // Quien no tiene centro no desaparece del desglose: se agrupa aparte, para
      // que el reparto sume el 100% del gasto y el hueco se vea.
      const clave = centro?.id ?? "__sin_centro__";
      if (!grupos.has(clave)) {
        grupos.set(clave, {
          centroCostoId: centro?.id ?? null,
          codigo: centro?.codigo ?? "SIN-CENTRO",
          nombre: centro?.nombre ?? "Sin centro de costo asignado",
          cuentaGasto: centro?.cuentaGasto ?? null,
          detalles: [],
        });
      }
      grupos.get(clave)!.detalles.push(d);
    }

    const desglose = generarPartidaPorCentroCosto([...grupos.values()], { incluirProvisiones, plan });

    if (formato === "CSV") {
      const fmtc = (m: Money) => (esCero(m) ? "" : m.toFixed(2));
      const filas = [
        ["Centro", "Nombre del centro", "Cuenta", "Descripción", "Debe", "Haber"],
        ...desglose.gastoPorCentro.map((l) => [
          l.centroCodigo, l.centroNombre, l.cuenta, l.nombre, fmtc(l.debe), fmtc(l.haber),
        ]),
        // Los pasivos van al final SIN centro: son obligaciones de la empresa
        // frente a terceros, no consumo de un área.
        ...desglose.pasivos.map((l) => ["", "(empresa)", l.cuenta, l.nombre, fmtc(l.debe), fmtc(l.haber)]),
      ];
      if (!desglose.conciliado) {
        filas.push(["", "", "", `AVISO: el desglose no concilia con el consolidado. Diferencia ${desglose.diferenciaConciliacion.toFixed(2)}`, "", ""]);
      }
      for (const a of desglose.anomalias) filas.push(["", "", "", `AVISO: ${a}`, "", ""]);

      const csv = filas
        .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      return new NextResponse("\uFEFF" + csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="partida-centros-costo-${id}.csv"`,
        },
      });
    }

    return NextResponse.json({
      concepto,
      fecha: planilla.fechaPago ?? planilla.fechaFin,
      porCentroCosto: true,
      gastoPorCentro: desglose.gastoPorCentro.map((l) => ({
        ...l, debe: aNumero(l.debe), haber: aNumero(l.haber),
      })),
      pasivos: desglose.pasivos.map((l) => ({ ...l, debe: aNumero(l.debe), haber: aNumero(l.haber) })),
      totalesPorCentro: desglose.totalesPorCentro.map((t) => ({ ...t, gasto: aNumero(t.gasto) })),
      totalGasto: aNumero(desglose.totalGasto),
      totalPasivos: aNumero(desglose.totalPasivos),
      conciliado: desglose.conciliado,
      diferenciaConciliacion: aNumero(desglose.diferenciaConciliacion),
      anomalias: desglose.anomalias,
    });
  }

  if (formato === "CSV") {
    const fmt = (m: Money) => (esCero(m) ? "" : m.toFixed(2));
    const filas = [
      ["Cuenta", "Descripción", "Debe", "Haber"],
      ...partida.lineas.map((l) => [l.cuenta, l.nombre, fmt(l.debe), fmt(l.haber)]),
      ["", "TOTALES", partida.totalDebe.toFixed(2), partida.totalHaber.toFixed(2)],
    ];
    // Un asiento descuadrado no se exporta en silencio: la advertencia viaja en
    // el propio archivo, que es lo que el contador va a abrir.
    if (!partida.cuadra) {
      filas.push(["", `AVISO: el asiento NO cuadra. Diferencia ${partida.diferencia.toFixed(2)}`, "", ""]);
    }
    for (const a of partida.anomalias) filas.push(["", `AVISO: ${a}`, "", ""]);

    const csv = filas
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    return new NextResponse("\uFEFF" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="partida-contable-${id}.csv"`,
      },
    });
  }

  // Frontera de presentación: los importes salen como `number` para no romper el
  // contrato JSON del endpoint. Es el único punto donde se convierte, y ya no
  // queda ningún cálculo después (ver la doctrina en lib/payroll/money.ts).
  return NextResponse.json({
    concepto,
    fecha: planilla.fechaPago ?? planilla.fechaFin,
    lineas: partida.lineas.map((l) => ({ ...l, debe: aNumero(l.debe), haber: aNumero(l.haber) })),
    totalDebe: aNumero(partida.totalDebe),
    totalHaber: aNumero(partida.totalHaber),
    diferencia: aNumero(partida.diferencia),
    cuadra: partida.cuadra,
    anomalias: partida.anomalias,
  });
}
