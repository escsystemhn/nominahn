/**
 * Mapeo hacia SAP: qué AcctCode de SAP corresponde a cada cuenta local que
 * recibe conceptos de nómina, qué CostingCode a cada centro de costo y, si SAP
 * usa varias sucursales, qué BPLID a cada sucursal local.
 *
 * El mapeo concepto → cuenta local ya existe (`MapeoContable`); aquí sólo se
 * añade el código de SAP a la cuenta local. Así, si el contador cambia la
 * cuenta de un concepto, el envío a SAP lo sigue sin segunda configuración.
 * Con el catálogo importado de SAP, cada cuenta ya trae su código.
 *
 * PUT con `verificar: true` consulta cada código en SAP y guarda nombre y
 * estado leídos, para que el mapeo se vea confirmado antes del primer envío.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { CUENTAS, type ClaveCuenta } from "@/lib/payroll/partida-contable";
import { cargarConfigSap, exigirConexion, ConfigSapIncompleta } from "@/lib/sap/config";
import { ServiceLayer } from "@/lib/sap/service-layer";
import { ErrorServiceLayer, traducir } from "@/lib/sap/errores";

const schema = z.object({
  cuentas: z
    .array(
      z.object({
        cuentaId: z.string().min(1).max(64),
        sapAcctCode: z.string().trim().max(50).nullable(),
      })
    )
    .max(500),
  centros: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        sapCostingCode: z.string().trim().max(50).nullable(),
        sapProjectCode: z.string().trim().max(50).nullable(),
      })
    )
    .max(500),
  sucursales: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        sapBplId: z.coerce.number().int().positive().nullable(),
        sapBplNombre: z.string().trim().max(120).nullable().optional(),
      })
    )
    .max(200)
    .optional(),
  verificar: z.boolean().optional(),
});

async function leerMapeo() {
  const [mapeos, centros, sucursales, cfg] = await Promise.all([
    prisma.mapeoContable.findMany({
      include: {
        cuenta: {
          select: { id: true, codigo: true, nombre: true, activa: true, esDetalle: true, sapAcctCode: true, sapNombre: true, sapActiva: true, sapVerificadaAt: true },
        },
      },
    }),
    prisma.centroCosto.findMany({
      orderBy: { codigo: "asc" },
      select: { id: true, codigo: true, nombre: true, activo: true, sapCostingCode: true, sapProjectCode: true },
    }),
    prisma.sucursal.findMany({
      orderBy: { nombre: "asc" },
      select: { id: true, codigo: true, nombre: true, activa: true, sapBplId: true, sapBplNombre: true },
    }),
    prisma.integracionSap.findUnique({
      where: { id: "default" },
      select: { usaSucursales: true, sapBplIdPorDefecto: true, catalogoOrigen: true, catalogoImportadoAt: true, catalogoCuentas: true },
    }),
  ]);
  const porClave = new Map(mapeos.map((m) => [m.clave, m.cuenta]));
  const conceptos = (Object.keys(CUENTAS) as ClaveCuenta[]).map((clave) => ({
    clave,
    concepto: CUENTAS[clave].nombre,
    naturaleza: CUENTAS[clave].naturaleza,
    codigoPorOmision: CUENTAS[clave].cuenta,
    cuenta: porClave.get(clave) ?? null,
  }));
  return {
    conceptos,
    centros,
    sucursales,
    usaSucursales: cfg?.usaSucursales ?? false,
    sapBplIdPorDefecto: cfg?.sapBplIdPorDefecto ?? null,
    catalogo: { origen: cfg?.catalogoOrigen ?? "LOCAL", importadoAt: cfg?.catalogoImportadoAt ?? null, cuentas: cfg?.catalogoCuentas ?? null },
  };
}

export async function GET() {
  const g = await requerirPermiso("configuracion.sap");
  if (!g.ok) return g.response;
  return NextResponse.json(await leerMapeo());
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.sap");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  await prisma.$transaction(async (tx) => {
    for (const c of d.cuentas) {
      const actual = await tx.cuentaContable.findUnique({ where: { id: c.cuentaId }, select: { sapAcctCode: true } });
      if (!actual) continue;
      const nuevo = c.sapAcctCode || null;
      // Al cambiar el código, lo verificado para el anterior deja de valer.
      const cambio = actual.sapAcctCode !== nuevo;
      await tx.cuentaContable.update({
        where: { id: c.cuentaId },
        data: cambio ? { sapAcctCode: nuevo, sapNombre: null, sapActiva: null, sapVerificadaAt: null } : {},
      });
    }
    for (const c of d.centros) {
      await tx.centroCosto.update({
        where: { id: c.id },
        data: { sapCostingCode: c.sapCostingCode || null, sapProjectCode: c.sapProjectCode || null },
      }).catch(() => undefined);
    }
    for (const s of d.sucursales ?? []) {
      await tx.sucursal.update({
        where: { id: s.id },
        data: { sapBplId: s.sapBplId ?? null, sapBplNombre: s.sapBplId ? (s.sapBplNombre ?? null) : null },
      }).catch(() => undefined);
    }
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "CuentaContable",
    registroId: "mapeo-sap",
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { cuentas: d.cuentas, centros: d.centros, sucursales: d.sucursales ?? [] },
    ip,
    userAgent,
  });

  // ─── Verificación contra SAP ────────────────────────────────────────────────
  let verificacion: { ok: boolean; error?: string; resultados?: Array<{ cuentaId: string; sapAcctCode: string; existe: boolean; nombre: string | null; activa: boolean | null }> } | null = null;
  if (d.verificar) {
    let cfg;
    try {
      cfg = await cargarConfigSap(prisma);
      exigirConexion(cfg);
    } catch (e) {
      verificacion = { ok: false, error: e instanceof ConfigSapIncompleta ? e.message : "Configuración de SAP ilegible." };
    }
    if (cfg?.password) {
      const sl = new ServiceLayer({ urlBase: cfg.urlBase, companyDb: cfg.companyDb, usuario: cfg.usuario, password: cfg.password });
      const resultados: NonNullable<typeof verificacion>["resultados"] = [];
      try {
        const aVerificar = d.cuentas.filter((c) => c.sapAcctCode);
        for (const c of aVerificar) {
          const codigo = c.sapAcctCode as string;
          const cuentaSap = await sl.obtenerCuenta(codigo);
          const existe = !!cuentaSap;
          // En SAP, ActiveAccount = tYES es cuenta activa (recibe asientos); tNO es de título.
          const activa = cuentaSap ? cuentaSap.ActiveAccount !== "tNO" : null;
          await prisma.cuentaContable.update({
            where: { id: c.cuentaId },
            data: {
              // Si el usuario tecleó el código visible (FormatCode), se guarda el interno.
              sapAcctCode: cuentaSap?.Code ?? codigo,
              sapNombre: cuentaSap?.Name ?? null,
              sapActiva: existe ? activa : false,
              sapVerificadaAt: new Date(),
            },
          });
          resultados.push({ cuentaId: c.cuentaId, sapAcctCode: cuentaSap?.Code ?? codigo, existe, nombre: cuentaSap?.Name ?? null, activa });
        }
        verificacion = { ok: true, resultados };
      } catch (e) {
        const error = e instanceof ErrorServiceLayer ? traducir(e, { usuario: cfg.usuario }) : e instanceof Error ? e.message : "Error desconocido";
        verificacion = { ok: false, error, resultados };
      } finally {
        await sl.logout();
      }
    }
  }

  return NextResponse.json({ ok: true, verificacion, ...(await leerMapeo()) });
}
