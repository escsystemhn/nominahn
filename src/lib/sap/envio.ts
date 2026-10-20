/**
 * Envío de asientos a SAP: la cola de salida (outbox) y su procesamiento.
 *
 * FLUJO
 *   encolar (en la transacción del cambio de estado o desde el botón)
 *     → fila SapEnvioAsiento PENDIENTE con el payload ya construido y la huella
 *       de la planilla
 *   procesarEnvio (al momento, en segundo plano, o desde el cron)
 *     → bloqueo de la fila → verificación de la huella → reconciliación por
 *       Reference2 en SAP → POST JournalEntries → ENVIADO
 *     → error transitorio: PENDIENTE con espera creciente
 *     → error de negocio: ERROR hasta que alguien corrija y reintente
 *
 * Nunca se llama a SAP dentro de una transacción de la base.
 */

import { Prisma, type PrismaClient, type SapEnvioAsiento, type TipoEnvioSap } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cargarPlan } from "@/lib/payroll/plan-cuentas";
import {
  CUENTAS,
  generarPartidaContable,
  generarPartidaPorCentroCosto,
  type ClaveCuenta,
  type GrupoCentroCosto,
  type PartidaContable,
  type PartidaPorCentroCosto,
} from "@/lib/payroll/partida-contable";
import { cargarConfigSap, exigirConexion, ConfigSapIncompleta, type ConfigSap } from "./config";
import { ServiceLayer } from "./service-layer";
import { ErrorServiceLayer, traducir } from "./errores";
import { construirAsiento, type MapeoSap, type PayloadJournalEntry, type ResultadoAsiento } from "./asiento";
import { MAX_INTENTOS, proximoIntento } from "./reintentos";

export { ESPERAS_REINTENTO_MIN, MAX_INTENTOS, proximoIntento } from "./reintentos";

type Db = PrismaClient | Prisma.TransactionClient;

const BLOQUEO_MS = 2 * 60_000;

// ─── Mapeo y payload ──────────────────────────────────────────────────────────

export async function cargarMapeoSap(db: Db): Promise<MapeoSap> {
  const [mapeos, centros] = await Promise.all([
    db.mapeoContable.findMany({
      include: { cuenta: { select: { codigo: true, nombre: true, sapAcctCode: true } } },
    }),
    db.centroCosto.findMany({ select: { id: true, codigo: true, nombre: true, sapCostingCode: true, sapProjectCode: true } }),
  ]);
  const porClave: MapeoSap["porClave"] = {};
  for (const m of mapeos) {
    if (!(m.clave in CUENTAS) || !m.cuenta) continue;
    porClave[m.clave as ClaveCuenta] = { acctCode: m.cuenta.sapAcctCode ?? null, nombre: m.cuenta.nombre, codigoLocal: m.cuenta.codigo };
  }
  return {
    porClave,
    centros: Object.fromEntries(
      centros.map((c) => [c.id, { codigo: c.codigo, nombre: c.nombre, costingCode: c.sapCostingCode ?? null, projectCode: c.sapProjectCode ?? null }])
    ),
  };
}

export interface PayloadPlanilla extends ResultadoAsiento {
  hashCalculo: string | null;
  estado: string;
  tipoPlanilla: string;
}

/** Construye el asiento de una planilla con la configuración y el mapeo actuales. */
export async function construirPayloadPlanilla(
  db: Db,
  planillaId: string,
  cfg: ConfigSap,
  tipo: TipoEnvioSap = "ASIENTO"
): Promise<PayloadPlanilla> {
  const planilla = await db.planilla.findUnique({
    where: { id: planillaId },
    include: {
      empresa: { select: { nombre: true } },
      sucursal: { select: { nombre: true, sapBplId: true } },
      detalles: {
        include: {
          empleado: {
            select: {
              centroCostoId: true,
              centroCosto: { select: { id: true, codigo: true, nombre: true, cuentaGasto: true } },
              departamento: { select: { centroCosto: { select: { id: true, codigo: true, nombre: true, cuentaGasto: true } } } },
            },
          },
        },
      },
    },
  });
  if (!planilla) throw new Error("Planilla no encontrada");

  const [plan, mapeo] = await Promise.all([cargarPlan(db), cargarMapeoSap(db)]);
  const opts = { incluirProvisiones: cfg.incluirProvisiones, plan };

  let partida: PartidaContable | PartidaPorCentroCosto;
  if (cfg.porCentroCosto) {
    const grupos = new Map<string, GrupoCentroCosto>();
    for (const d of planilla.detalles) {
      const centro = d.empleado.centroCosto ?? d.empleado.departamento?.centroCosto ?? null;
      const clave = centro?.id ?? "__sin_centro__";
      let grupo = grupos.get(clave);
      if (!grupo) {
        grupo = {
          centroCostoId: centro?.id ?? null,
          codigo: centro?.codigo ?? "SIN-CENTRO",
          nombre: centro?.nombre ?? "Sin centro de costo asignado",
          cuentaGasto: centro?.cuentaGasto ?? null,
          detalles: [],
        };
        grupos.set(clave, grupo);
      }
      grupo.detalles.push(d);
    }
    partida = generarPartidaPorCentroCosto([...grupos.values()], opts);
  } else {
    partida = generarPartidaContable(planilla.detalles, opts);
  }

  const resultado = construirAsiento(partida, mapeo, {
    planillaId: planilla.id,
    tipoPlanilla: planilla.tipo,
    empresa: planilla.empresa.nombre,
    fechaInicio: planilla.fechaInicio,
    fechaFin: planilla.fechaFin,
    fechaPago: planilla.fechaPago,
    fechaContable: cfg.fechaContable,
    porCentroCosto: cfg.porCentroCosto,
    dimensionCentro: cfg.dimensionCentro,
    codigoTransaccion: cfg.codigoTransaccion,
    serie: cfg.serie,
    memoPlantilla: cfg.memoPlantilla,
    longitudes: cfg.longitudes,
    reverso: tipo === "REVERSO",
    // Con varias sucursales en SAP, la planilla de una sucursal va a su BPLID y
    // la de toda la empresa a la sucursal por omisión. Sin equivalencia: error.
    sucursal: cfg.usaSucursales
      ? {
          usa: true,
          bplId: planilla.sucursalId ? (planilla.sucursal?.sapBplId ?? null) : cfg.sapBplIdPorDefecto,
          nombre: planilla.sucursal?.nombre ?? null,
        }
      : undefined,
  });

  return { ...resultado, hashCalculo: planilla.hashCalculo, estado: planilla.estado, tipoPlanilla: planilla.tipo };
}

// ─── Cola ─────────────────────────────────────────────────────────────────────

export interface ResultadoEncolar {
  envio: SapEnvioAsiento;
  /** `true` si ya estaba ENVIADO y no se tocó. */
  yaEnviado: boolean;
}

/**
 * Deja (o reutiliza) la fila de salida de una planilla. Una planilla ya
 * ENVIADA no se vuelve a encolar; un ERROR o CANCELADO vuelve a PENDIENTE con
 * el payload recién construido.
 */
export async function encolar(
  db: Db,
  datos: {
    planillaId: string;
    tipo: TipoEnvioSap;
    construido: ResultadoAsiento;
    hashCalculo: string;
    creadoPor: string | null;
    reversoDeId?: string | null;
  }
): Promise<ResultadoEncolar> {
  const existente = await db.sapEnvioAsiento.findUnique({ where: { planillaId_tipo: { planillaId: datos.planillaId, tipo: datos.tipo } } });
  if (existente?.estado === "ENVIADO") return { envio: existente, yaEnviado: true };
  if (existente?.estado === "ENVIANDO") return { envio: existente, yaEnviado: false };

  const conPayload = datos.construido.payload !== null;
  const comun = {
    hashCalculo: datos.hashCalculo,
    payload: (datos.construido.payload ?? { errores: datos.construido.errores }) as unknown as Prisma.InputJsonValue,
    estado: conPayload ? ("PENDIENTE" as const) : ("ERROR" as const),
    intentos: 0,
    proximoIntentoAt: conPayload ? new Date() : null,
    bloqueadoHasta: null,
    errorCodigo: conPayload ? null : "MAPEO",
    errorMensaje: conPayload ? null : datos.construido.errores.join(" "),
    errorTraducido: conPayload ? null : datos.construido.errores.join(" "),
    esTransitorio: conPayload ? null : false,
    respuesta: Prisma.JsonNull,
    sapTransId: null,
    sapNumero: null,
    enviadoAt: null,
    reversoDeId: datos.reversoDeId ?? null,
  };

  const envio = existente
    ? await db.sapEnvioAsiento.update({ where: { id: existente.id }, data: comun })
    : await db.sapEnvioAsiento.create({ data: { ...comun, planillaId: datos.planillaId, tipo: datos.tipo, creadoPor: datos.creadoPor } });
  return { envio, yaEnviado: false };
}

/**
 * Al cambiar de estado una planilla: encola el asiento si el modo lo pide, y
 * el reverso si se anula una planilla ya enviada. Se llama DENTRO de la
 * transacción del cambio, después de actualizar la planilla.
 */
export async function encolarPorTransicion(
  tx: Db,
  planilla: { id: string; hashCalculo: string | null },
  nuevoEstado: string,
  usuarioId: string | null
): Promise<{ envioId: string | null; motivo: string }> {
  let cfg: ConfigSap | null;
  try {
    cfg = await cargarConfigSap(tx);
  } catch (e) {
    return { envioId: null, motivo: e instanceof Error ? e.message : "Configuración de SAP ilegible" };
  }
  if (!cfg?.activo) return { envioId: null, motivo: "Integración con SAP desactivada" };

  if (nuevoEstado === "ANULADA") {
    const enviado = await tx.sapEnvioAsiento.findUnique({ where: { planillaId_tipo: { planillaId: planilla.id, tipo: "ASIENTO" } } });
    if (!enviado || enviado.estado !== "ENVIADO") return { envioId: null, motivo: "La planilla no tenía asiento enviado: no hay reverso" };
    const construido = await construirPayloadPlanilla(tx, planilla.id, cfg, "REVERSO");
    const r = await encolar(tx, { planillaId: planilla.id, tipo: "REVERSO", construido, hashCalculo: planilla.hashCalculo ?? enviado.hashCalculo, creadoPor: usuarioId, reversoDeId: enviado.id });
    return { envioId: r.envio.id, motivo: "Reverso encolado" };
  }

  const dispara = (cfg.modoEnvio === "AL_APROBAR" && nuevoEstado === "APROBADA") || (cfg.modoEnvio === "AL_PAGAR" && nuevoEstado === "PAGADA");
  if (!dispara) return { envioId: null, motivo: `Modo ${cfg.modoEnvio}: no se envía al pasar a ${nuevoEstado}` };
  if (!planilla.hashCalculo) return { envioId: null, motivo: "La planilla no tiene huella de cierre" };

  const construido = await construirPayloadPlanilla(tx, planilla.id, cfg, "ASIENTO");
  const r = await encolar(tx, { planillaId: planilla.id, tipo: "ASIENTO", construido, hashCalculo: planilla.hashCalculo, creadoPor: usuarioId });
  return { envioId: r.envio.id, motivo: r.yaEnviado ? "Ya estaba enviado" : "Asiento encolado" };
}

// ─── Procesamiento ────────────────────────────────────────────────────────────

async function bitacora(envioId: string, intento: number, datos: { httpStatus?: number | null; duracionMs: number; resultado: "OK" | "ERROR" | "RECONCILIADO" | "CANCELADO"; errorCodigo?: string | null; mensaje?: string | null }) {
  await prisma.sapBitacora.create({ data: { envioId, intento, ...datos } });
}

/**
 * Procesa UNA fila de la cola. Devuelve la fila como quedó. Es seguro llamarla
 * varias veces a la vez: la primera que tome el bloqueo la procesa, las demás
 * devuelven el estado actual.
 */
export async function procesarEnvio(envioId: string): Promise<SapEnvioAsiento> {
  const ahora = new Date();
  const tomado = await prisma.sapEnvioAsiento.updateMany({
    where: { id: envioId, estado: "PENDIENTE", OR: [{ bloqueadoHasta: null }, { bloqueadoHasta: { lt: ahora } }] },
    data: { estado: "ENVIANDO", bloqueadoHasta: new Date(ahora.getTime() + BLOQUEO_MS) },
  });
  const actual = await prisma.sapEnvioAsiento.findUniqueOrThrow({ where: { id: envioId } });
  if (tomado.count === 0) return actual;

  const intento = actual.intentos + 1;
  const inicio = Date.now();

  const planilla = await prisma.planilla.findUnique({ where: { id: actual.planillaId }, select: { hashCalculo: true, estado: true, fechaPago: true, fechaFin: true } });
  const payload = actual.payload as unknown as PayloadJournalEntry;

  // La huella de cierre tiene que ser la misma con la que se construyó el
  // asiento: si la planilla se reabrió y recalculó, este payload ya no vale.
  if (!planilla || (actual.tipo === "ASIENTO" && planilla.hashCalculo !== actual.hashCalculo)) {
    const mensaje = "La planilla cambió después de encolar el asiento (huella distinta). Vuelva a enviarla.";
    await bitacora(envioId, intento, { duracionMs: Date.now() - inicio, resultado: "CANCELADO", errorCodigo: "HUELLA", mensaje });
    return prisma.sapEnvioAsiento.update({
      where: { id: envioId },
      data: { estado: "CANCELADO", intentos: intento, bloqueadoHasta: null, errorCodigo: "HUELLA", errorMensaje: mensaje, errorTraducido: mensaje, esTransitorio: false },
    });
  }

  let cfg: ConfigSap | null;
  try {
    cfg = await cargarConfigSap(prisma);
    exigirConexion(cfg);
    if (!cfg.activo) throw new ConfigSapIncompleta("La integración con SAP está desactivada.");
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : "Configuración de SAP incompleta";
    await bitacora(envioId, intento, { duracionMs: Date.now() - inicio, resultado: "ERROR", errorCodigo: "CONFIG", mensaje });
    return prisma.sapEnvioAsiento.update({
      where: { id: envioId },
      data: { estado: "ERROR", intentos: intento, bloqueadoHasta: null, errorCodigo: "CONFIG", errorMensaje: mensaje, errorTraducido: mensaje, esTransitorio: false },
    });
  }

  const sl = new ServiceLayer({ urlBase: cfg.urlBase, companyDb: cfg.companyDb, usuario: cfg.usuario, password: cfg.password });
  const ctx = { host: hostDe(cfg.urlBase), usuario: cfg.usuario, fecha: payload.ReferenceDate };

  try {
    // Reconciliación: si un intento anterior sí llegó a SAP pero la respuesta
    // se perdió, el asiento ya existe con esta Reference2. No se duplica.
    const previos = await sl.buscarAsientosPorReferencia2(payload.Reference2);
    const creado = previos[0] ?? (await sl.crearAsiento(payload));
    const reconciliado = previos.length > 0;

    await bitacora(envioId, intento, {
      httpStatus: reconciliado ? 200 : 201,
      duracionMs: Date.now() - inicio,
      resultado: reconciliado ? "RECONCILIADO" : "OK",
      mensaje: `Asiento ${creado.Number ?? creado.JdtNum} (JdtNum ${creado.JdtNum})${reconciliado ? ", ya existía en SAP" : ""}`,
    });
    return prisma.sapEnvioAsiento.update({
      where: { id: envioId },
      data: {
        estado: "ENVIADO",
        intentos: intento,
        bloqueadoHasta: null,
        sapTransId: creado.JdtNum,
        sapNumero: creado.Number ?? creado.JdtNum,
        respuesta: { JdtNum: creado.JdtNum, Number: creado.Number, reconciliado } as Prisma.InputJsonValue,
        enviadoAt: new Date(),
        errorCodigo: null,
        errorMensaje: null,
        errorTraducido: null,
        esTransitorio: null,
        proximoIntentoAt: null,
      },
    });
  } catch (e) {
    const err = e instanceof ErrorServiceLayer ? e : new ErrorServiceLayer({ http: 0, codigo: "INTERNO", mensaje: e instanceof Error ? e.message : String(e), transitorio: false });
    const traducido = traducir(err, ctx);
    const reintentar = err.transitorio && intento < MAX_INTENTOS;
    await bitacora(envioId, intento, { httpStatus: err.http || null, duracionMs: Date.now() - inicio, resultado: "ERROR", errorCodigo: err.codigo, mensaje: err.message });
    return prisma.sapEnvioAsiento.update({
      where: { id: envioId },
      data: {
        estado: reintentar ? "PENDIENTE" : "ERROR",
        intentos: intento,
        bloqueadoHasta: null,
        proximoIntentoAt: reintentar ? proximoIntento(intento) : null,
        errorCodigo: err.codigo,
        errorMensaje: err.message,
        errorTraducido: traducido,
        esTransitorio: err.transitorio,
      },
    });
  } finally {
    await sl.logout();
  }
}

/** Worker: procesa las filas pendientes cuyo turno llegó. */
export async function procesarPendientes(limite = 10): Promise<{ procesados: number; enviados: number; errores: number; pendientes: number }> {
  const ahora = new Date();
  const filas = await prisma.sapEnvioAsiento.findMany({
    where: { estado: "PENDIENTE", OR: [{ proximoIntentoAt: null }, { proximoIntentoAt: { lte: ahora } }] },
    orderBy: { createdAt: "asc" },
    take: limite,
    select: { id: true },
  });
  let enviados = 0, errores = 0, pendientes = 0;
  for (const f of filas) {
    const r = await procesarEnvio(f.id);
    if (r.estado === "ENVIADO") enviados++;
    else if (r.estado === "PENDIENTE") pendientes++;
    else errores++;
  }
  return { procesados: filas.length, enviados, errores, pendientes };
}

/** Dispara el procesamiento sin esperar (tras el commit de una transacción). */
export function procesarEnSegundoPlano(envioId: string): void {
  void procesarEnvio(envioId).catch((e) => {
    console.error("[sap] fallo al procesar envío", envioId, e instanceof Error ? e.message : e);
  });
}

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
