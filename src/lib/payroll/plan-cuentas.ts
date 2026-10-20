/**
 * Catálogo contable y mapeo de conceptos: la capa de datos.
 *
 * El motor de la partida (`partida-contable.ts`) es lógica PURA: recibe el plan
 * ya resuelto. Este módulo lo trae de la base, mantiene el catálogo (árbol de
 * cuentas) y decide qué cuenta de detalle recibe cada concepto de la nómina.
 *
 * Mismas reglas que Gestión360:
 *   · Sólo una cuenta de DETALLE, ACTIVA y del TIPO admitido puede recibir un
 *     concepto. Mandar «Sueldos» a un pasivo no descuadra nada —partida doble—
 *     y el error sólo aparecería en los estados financieros.
 *   · Una cuenta asignada a un concepto no se desactiva ni se borra: primero
 *     se asigna otra en su lugar.
 *   · Las cuentas de sistema (las sembradas) se renombran y se desactivan, pero
 *     no se recodifican ni se borran.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { CUENTAS, type ClaveCuenta, type PlanCuentas } from "./partida-contable";
import {
  CATALOGO_POR_OMISION,
  CUENTA_POR_OMISION,
  TIPOS_PERMITIDOS,
  ETIQUETA_TIPO,
  validarCuenta,
  type CuentaCatalogo,
  type DatosCuenta,
} from "./catalogo-contable";

/** Cliente de Prisma o el `tx` de una transacción. */
type Db = PrismaClient | Prisma.TransactionClient;

export type ResultadoOp = { ok: true } | { ok: false; error: string };

/**
 * `true` cuando el catálogo se importó de SAP Business One: entonces SAP manda y
 * aquí no se crean, editan ni borran cuentas (se vuelve a importar desde
 * Configuración → SAP - Conexión). El mapeo concepto → cuenta sí sigue siendo
 * decisión local.
 */
export async function catalogoGobernadoPorSap(db: Db): Promise<boolean> {
  const c = await db.integracionSap.findUnique({ where: { id: "default" }, select: { catalogoOrigen: true } });
  return c?.catalogoOrigen === "SAP";
}

export const MENSAJE_CATALOGO_SAP =
  "El catálogo viene de SAP Business One y se actualiza desde Configuración → SAP - Conexión: aquí no se crean, editan ni eliminan cuentas.";

/** Todas las claves del motor, en el orden en que se declaran. */
export const CLAVES: readonly ClaveCuenta[] = Object.keys(CUENTAS) as ClaveCuenta[];

const esClave = (c: string): c is ClaveCuenta => c in CUENTAS;

// ─── Plan para el motor ───────────────────────────────────────────────────────

/**
 * Plan listo para pasar al motor: SÓLO los conceptos con cuenta asignada. El
 * motor cae al valor por omisión para lo que no esté, de modo que un concepto
 * nuevo en el código no rompe una instalación ya configurada.
 */
export async function cargarPlan(db: Db): Promise<PlanCuentas> {
  const filas = await db.mapeoContable.findMany({
    where: { cuentaId: { not: null } },
    include: { cuenta: { select: { codigo: true, nombre: true } } },
  });
  const plan: PlanCuentas = {};
  for (const f of filas) {
    if (!esClave(f.clave) || !f.cuenta) continue;
    plan[f.clave] = { cuenta: f.cuenta.codigo, nombre: f.cuenta.nombre };
  }
  return plan;
}

// ─── Mapeo completo para la pantalla ─────────────────────────────────────────

export interface CuentaResumen {
  id: string;
  codigo: string;
  nombre: string;
  tipo: CuentaCatalogo["tipo"];
  activa: boolean;
  esDetalle: boolean;
}

export interface ConceptoMapeado {
  clave: ClaveCuenta;
  /** Nombre con el que el motor presenta la línea cuando no hay cuenta asignada. */
  nombreMotor: string;
  naturaleza: "GASTO" | "PASIVO";
  tiposPermitidos: CuentaCatalogo["tipo"][];
  cuenta: CuentaResumen | null;
  /** Cuenta de ejemplo del concepto, si existe en el catálogo. */
  porOmision: { codigo: string; cuentaId: string | null };
}

const resumen = (c: CuentaResumen) => c;

export async function cargarMapeoCompleto(db: Db): Promise<ConceptoMapeado[]> {
  const [mapeos, predeterminadas] = await Promise.all([
    db.mapeoContable.findMany({
      include: { cuenta: { select: { id: true, codigo: true, nombre: true, tipo: true, activa: true, esDetalle: true } } },
    }),
    db.cuentaContable.findMany({
      where: { codigo: { in: Object.values(CUENTA_POR_OMISION) } },
      select: { id: true, codigo: true },
    }),
  ]);
  const porClave = new Map(mapeos.map((m) => [m.clave, m]));
  const idPorCodigo = new Map(predeterminadas.map((p) => [p.codigo, p.id]));

  return CLAVES.map((clave) => {
    const m = porClave.get(clave);
    const codigo = CUENTA_POR_OMISION[clave];
    return {
      clave,
      nombreMotor: CUENTAS[clave].nombre,
      naturaleza: CUENTAS[clave].naturaleza,
      tiposPermitidos: TIPOS_PERMITIDOS[clave],
      cuenta: m?.cuenta ? resumen(m.cuenta) : null,
      porOmision: { codigo, cuentaId: idPorCodigo.get(codigo) ?? null },
    };
  });
}

/** Asigna (o quita, con `null`) la cuenta que recibe un concepto. */
export async function asignarCuenta(db: Db, clave: string, cuentaId: string | null): Promise<ResultadoOp> {
  if (!esClave(clave)) return { ok: false, error: "Concepto desconocido." };

  if (cuentaId) {
    const c = await db.cuentaContable.findUnique({
      where: { id: cuentaId },
      select: { codigo: true, nombre: true, tipo: true, esDetalle: true, activa: true },
    });
    if (!c) return { ok: false, error: "La cuenta no existe." };
    if (!c.activa) return { ok: false, error: `La cuenta ${c.codigo} está inactiva.` };
    if (!c.esDetalle) {
      return { ok: false, error: `La cuenta ${c.codigo} es de grupo: elija una cuenta de detalle, que es la que recibe asientos.` };
    }
    const permitidos = TIPOS_PERMITIDOS[clave];
    if (!permitidos.includes(c.tipo)) {
      return {
        ok: false,
        error: `La cuenta ${c.codigo} es de ${ETIQUETA_TIPO[c.tipo]}; aquí se espera una cuenta de ${permitidos.map((t) => ETIQUETA_TIPO[t]).join(" o ")}.`,
      };
    }
  }

  await db.mapeoContable.upsert({
    where: { clave },
    update: { cuentaId },
    create: { clave, cuentaId },
  });
  return { ok: true };
}

/** Devuelve un concepto a su cuenta de ejemplo. */
export async function restablecerMapeo(db: Db, clave: string): Promise<ResultadoOp> {
  if (!esClave(clave)) return { ok: false, error: "Concepto desconocido." };
  const codigo = CUENTA_POR_OMISION[clave];
  const cuenta = await db.cuentaContable.findUnique({ where: { codigo }, select: { id: true } });
  if (!cuenta) return { ok: false, error: `La cuenta predeterminada ${codigo} no está en el catálogo.` };
  return asignarCuenta(db, clave, cuenta.id);
}

// ─── Catálogo ─────────────────────────────────────────────────────────────────

export async function listarCatalogo(db: Db): Promise<CuentaCatalogo[]> {
  return db.cuentaContable.findMany({ orderBy: { codigo: "asc" } });
}

/** Las cuentas que pueden recibir un concepto: de detalle y activas. */
export async function listarCuentasAsignables(db: Db): Promise<CuentaResumen[]> {
  return db.cuentaContable.findMany({
    where: { esDetalle: true, activa: true },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true, tipo: true, activa: true, esDetalle: true },
  });
}

export async function crearCuenta(db: Db, d: DatosCuenta): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (await catalogoGobernadoPorSap(db)) return { ok: false, error: MENSAJE_CATALOGO_SAP };
  const existentes = await db.cuentaContable.findMany({ select: { codigo: true, esDetalle: true } });
  const errores = validarCuenta(d, existentes);
  if (errores.length > 0) return { ok: false, error: errores.join(" ") };

  const codigo = d.codigo.trim();
  if (existentes.some((e) => e.codigo === codigo)) return { ok: false, error: `Ya existe una cuenta con el código ${codigo}.` };

  const creada = await db.cuentaContable.create({
    data: {
      codigo,
      nombre: d.nombre.trim(),
      descripcion: d.descripcion?.trim() || null,
      tipo: d.tipo,
      naturaleza: d.naturaleza,
      padreCodigo: d.padreCodigo?.trim() || null,
      esDetalle: d.esDetalle,
      esSistema: false,
      activa: d.activa ?? true,
    },
  });
  return { ok: true, id: creada.id };
}

export async function actualizarCuenta(db: Db, id: string, d: DatosCuenta): Promise<ResultadoOp> {
  if (await catalogoGobernadoPorSap(db)) return { ok: false, error: MENSAJE_CATALOGO_SAP };
  const actual = await db.cuentaContable.findUnique({ where: { id } });
  if (!actual) return { ok: false, error: "Cuenta no encontrada." };

  const asignada = await db.mapeoContable.count({ where: { cuentaId: id } });

  // Desactivar una cuenta asignada la dejaría recibiendo asientos sin aparecer
  // en ninguna lista: primero se asigna otra en su lugar.
  if (actual.activa && d.activa === false && asignada > 0) {
    return {
      ok: false,
      error: `La cuenta ${actual.codigo} ${actual.nombre} está asignada en Configuración contable y recibe la partida de la nómina. Asigne otra cuenta en su lugar antes de desactivarla.`,
    };
  }

  // Las cuentas de sistema conservan código, tipo, naturaleza y lugar en el árbol.
  if (actual.esSistema) {
    await db.cuentaContable.update({
      where: { id },
      data: { nombre: d.nombre.trim(), descripcion: d.descripcion?.trim() || null, activa: d.activa ?? actual.activa },
    });
    return { ok: true };
  }

  const existentes = (await db.cuentaContable.findMany({ select: { codigo: true, esDetalle: true } })).filter(
    (e) => e.codigo !== actual.codigo
  );
  const errores = validarCuenta(d, existentes);
  if (errores.length > 0) return { ok: false, error: errores.join(" ") };

  const codigo = d.codigo.trim();
  if (codigo !== actual.codigo && existentes.some((e) => e.codigo === codigo)) {
    return { ok: false, error: `Ya existe una cuenta con el código ${codigo}.` };
  }

  const hijas = await db.cuentaContable.count({ where: { padreCodigo: actual.codigo } });
  if (d.esDetalle && hijas > 0) {
    return { ok: false, error: `La cuenta ${actual.codigo} tiene ${hijas} subcuenta(s): una cuenta con subcuentas es de grupo.` };
  }
  if (!d.esDetalle && asignada > 0) {
    return { ok: false, error: `La cuenta ${actual.codigo} está asignada a un concepto de la nómina y debe seguir siendo de detalle.` };
  }

  await db.cuentaContable.update({
    where: { id },
    data: {
      codigo,
      nombre: d.nombre.trim(),
      descripcion: d.descripcion?.trim() || null,
      tipo: d.tipo,
      naturaleza: d.naturaleza,
      padreCodigo: d.padreCodigo?.trim() || null,
      esDetalle: d.esDetalle,
      activa: d.activa ?? actual.activa,
    },
  });
  // Las subcuentas cuelgan del CÓDIGO de la madre: si cambia, se arrastran.
  if (codigo !== actual.codigo && hijas > 0) {
    await db.cuentaContable.updateMany({ where: { padreCodigo: actual.codigo }, data: { padreCodigo: codigo } });
  }
  return { ok: true };
}

export async function eliminarCuenta(db: Db, id: string): Promise<ResultadoOp> {
  if (await catalogoGobernadoPorSap(db)) return { ok: false, error: MENSAJE_CATALOGO_SAP };
  const actual = await db.cuentaContable.findUnique({ where: { id }, select: { codigo: true, esSistema: true } });
  if (!actual) return { ok: false, error: "Cuenta no encontrada." };
  if (actual.esSistema) return { ok: false, error: "Una cuenta del sistema no se elimina; puede desactivarla." };

  const hijas = await db.cuentaContable.count({ where: { padreCodigo: actual.codigo } });
  if (hijas > 0) return { ok: false, error: `La cuenta ${actual.codigo} tiene subcuentas.` };

  const asignada = await db.mapeoContable.count({ where: { cuentaId: id } });
  if (asignada > 0) return { ok: false, error: `La cuenta ${actual.codigo} está asignada a un concepto de la nómina.` };

  await db.cuentaContable.delete({ where: { id } });
  return { ok: true };
}

// ─── Siembra ──────────────────────────────────────────────────────────────────

/**
 * Catálogo de ejemplo y mapeo por omisión. Idempotente: el catálogo sólo se
 * siembra si está vacío, y cada concepto sólo se mapea si no tiene cuenta. Un
 * `db:seed` nunca revierte lo que el contador haya asignado.
 */
export async function sembrarCatalogo(db: Db): Promise<{ cuentas: number; mapeos: number }> {
  let cuentas = 0;
  if ((await db.cuentaContable.count()) === 0) {
    await db.cuentaContable.createMany({
      data: CATALOGO_POR_OMISION.map(([codigo, nombre, tipo, naturaleza, padre, detalle]) => ({
        codigo,
        nombre,
        tipo,
        naturaleza,
        padreCodigo: padre || null,
        esDetalle: detalle === 1,
        esSistema: true,
      })),
    });
    cuentas = CATALOGO_POR_OMISION.length;
  }

  const existentes = await db.mapeoContable.findMany({ where: { cuentaId: { not: null } }, select: { clave: true } });
  const mapeadas = new Set(existentes.map((m) => m.clave));
  let mapeos = 0;
  for (const clave of CLAVES) {
    if (mapeadas.has(clave)) continue;
    const r = await restablecerMapeo(db, clave);
    if (r.ok) mapeos++;
  }
  return { cuentas, mapeos };
}
