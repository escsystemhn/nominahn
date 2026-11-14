/**
 * Reemplazo del catálogo local por el plan de cuentas de SAP (lado de la base).
 *
 * «SAP manda»: tras importar, el catálogo local es un espejo de sólo lectura
 * (`IntegracionSap.catalogoOrigen = "SAP"`) y se vuelve a importar desde la
 * misma pantalla cuando cambie en SAP. El mapeo concepto → cuenta sigue siendo
 * decisión local y se conserva en lo posible (por código de SAP y por código
 * visible); lo que no encaja queda sin cuenta, a la vista, para el contador.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as prismaGlobal } from "@/lib/prisma";
import { CUENTAS, type ClaveCuenta } from "@/lib/payroll/partida-contable";
import { ServiceLayer } from "./service-layer";
import { construirCatalogoDesdeSap, reasignarMapeos, type ResultadoCatalogoSap, type MapeoAnterior, type ResultadoReasignacion } from "./catalogo-sap";

export interface VistaPreviaImportacion {
  catalogo: Omit<ResultadoCatalogoSap, "filas">;
  muestra: Array<{ codigo: string; nombre: string; tipo: string; nivel: number; esDetalle: boolean }>;
  local: { cuentas: number; mapeosConCuenta: number; origen: "LOCAL" | "SAP" };
  mapeos: ResultadoReasignacion;
}

async function mapeosActuales(db: PrismaClient): Promise<MapeoAnterior[]> {
  const filas = await db.mapeoContable.findMany({ include: { cuenta: { select: { codigo: true, sapAcctCode: true } } } });
  const porClave = new Map(filas.map((m) => [m.clave, m]));
  // Todos los conceptos del motor, tengan o no fila: así la vista previa lista
  // también los que nunca se mapearon.
  return (Object.keys(CUENTAS) as ClaveCuenta[]).map((clave) => {
    const m = porClave.get(clave);
    return { clave, codigo: m?.cuenta?.codigo ?? null, sapAcctCode: m?.cuenta?.sapAcctCode ?? null };
  });
}

/** Lee el plan completo de SAP y calcula qué pasaría al reemplazar, sin escribir nada. */
export async function previsualizarImportacion(sl: ServiceLayer, db: PrismaClient = prismaGlobal): Promise<{ vista: VistaPreviaImportacion; resultado: ResultadoCatalogoSap }> {
  const cuentasSap = await sl.listarPlanCuentas();
  const resultado = construirCatalogoDesdeSap(cuentasSap);
  const [cuentasLocales, mapeosConCuenta, cfg, anteriores] = await Promise.all([
    db.cuentaContable.count(),
    db.mapeoContable.count({ where: { cuentaId: { not: null } } }),
    db.integracionSap.findUnique({ where: { id: "default" }, select: { catalogoOrigen: true } }),
    mapeosActuales(db),
  ]);
  const mapeos = reasignarMapeos(anteriores, resultado.filas);
  const { filas, ...catalogo } = resultado;
  return {
    resultado,
    vista: {
      catalogo,
      muestra: filas.slice(0, 12).map((f) => ({ codigo: f.codigo, nombre: f.nombre, tipo: f.tipo, nivel: f.nivel, esDetalle: f.esDetalle })),
      local: { cuentas: cuentasLocales, mapeosConCuenta, origen: cfg?.catalogoOrigen === "SAP" ? "SAP" : "LOCAL" },
      mapeos,
    },
  };
}

export interface ResultadoReemplazo {
  cuentasAntes: number;
  cuentasDespues: number;
  reasignados: number;
  sinCuenta: ResultadoReasignacion["sinCuenta"];
  mapeosAnteriores: MapeoAnterior[];
}

/**
 * Borra el catálogo local y lo sustituye por el de SAP, en UNA transacción:
 * los mapeos se desenganchan, se crean las cuentas nuevas y se vuelven a
 * enganchar donde hay equivalencia. Si algo falla, no cambia nada.
 */
export async function reemplazarCatalogo(resultado: ResultadoCatalogoSap, db: PrismaClient = prismaGlobal): Promise<ResultadoReemplazo> {
  if (resultado.filas.length === 0) throw new Error("SAP no devolvió ninguna cuenta: no se reemplaza el catálogo.");
  if (!resultado.filas.some((f) => f.esDetalle)) throw new Error("El plan de SAP no tiene cuentas de detalle: no se reemplaza el catálogo.");

  return db.$transaction(
    async (tx) => {
      const mapeosAnteriores = await mapeosActuales(tx as unknown as PrismaClient);
      const cuentasAntes = await tx.cuentaContable.count();

      await tx.mapeoContable.updateMany({ data: { cuentaId: null } });
      await tx.cuentaContable.deleteMany({});

      const ahora = new Date();
      await tx.cuentaContable.createMany({
        data: resultado.filas.map((f) => ({
          codigo: f.codigo,
          nombre: f.nombre,
          descripcion: null,
          tipo: f.tipo,
          naturaleza: f.naturaleza,
          padreCodigo: f.padreCodigo,
          esDetalle: f.esDetalle,
          esSistema: false,
          activa: f.activa,
          sapAcctCode: f.sapAcctCode,
          sapNombre: f.sapNombre,
          // En SAP, «activa» es la cuenta que recibe asientos (no de título).
          sapActiva: f.esDetalle,
          sapVerificadaAt: ahora,
        })),
      });

      const nuevas = await tx.cuentaContable.findMany({ select: { id: true, codigo: true } });
      const idPorCodigo = new Map(nuevas.map((c) => [c.codigo, c.id]));
      const { asignaciones, sinCuenta } = reasignarMapeos(mapeosAnteriores, resultado.filas);
      for (const a of asignaciones) {
        const cuentaId = idPorCodigo.get(a.codigo);
        if (!cuentaId) continue;
        await tx.mapeoContable.upsert({ where: { clave: a.clave }, create: { clave: a.clave, cuentaId }, update: { cuentaId } });
      }

      await tx.integracionSap.update({
        where: { id: "default" },
        data: { catalogoOrigen: "SAP", catalogoImportadoAt: ahora, catalogoCuentas: resultado.filas.length },
      });

      return { cuentasAntes, cuentasDespues: resultado.filas.length, reasignados: asignaciones.length, sinCuenta, mapeosAnteriores };
    },
    { timeout: 120_000 }
  );
}
