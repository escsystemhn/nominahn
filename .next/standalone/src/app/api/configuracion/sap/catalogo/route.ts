/**
 * Importar el plan de cuentas de SAP y REEMPLAZAR el catálogo local.
 *
 *   POST { accion: "previsualizar" }                      → qué pasaría, sin escribir
 *   POST { accion: "reemplazar", confirmacion: "REEMPLAZAR" } → lo hace, en una transacción
 *
 * Después de reemplazar, SAP manda: el catálogo local queda de sólo lectura y
 * se vuelve a importar desde aquí cuando cambie en SAP. Los mapeos de la nómina
 * se conservan donde hay equivalencia; el resto queda sin cuenta, a la vista.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { cargarConfigSap, exigirConexion, ConfigSapIncompleta } from "@/lib/sap/config";
import { ServiceLayer } from "@/lib/sap/service-layer";
import { ErrorServiceLayer, traducir } from "@/lib/sap/errores";
import { previsualizarImportacion, reemplazarCatalogo } from "@/lib/sap/catalogo";

const schema = z.object({
  accion: z.enum(["previsualizar", "reemplazar"]),
  confirmacion: z.string().max(20).optional(),
});

export async function POST(req: NextRequest) {
  // Reemplazar el catálogo toca TODAS las planillas futuras: es tan sensible
  // como la conexión misma.
  const g = await requerirPermiso("configuracion.sap");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { accion, confirmacion } = parsed.data;

  if (accion === "reemplazar" && confirmacion !== "REEMPLAZAR") {
    return NextResponse.json({ error: "Para reemplazar el catálogo escriba REEMPLAZAR en la confirmación." }, { status: 400 });
  }

  let cfg;
  try {
    cfg = await cargarConfigSap(prisma);
    exigirConexion(cfg);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof ConfigSapIncompleta ? e.message : "Configuración de SAP ilegible." });
  }

  const sl = new ServiceLayer({ urlBase: cfg.urlBase, companyDb: cfg.companyDb, usuario: cfg.usuario, password: cfg.password, timeoutMs: 60_000 });
  const inicio = Date.now();
  try {
    const { vista, resultado } = await previsualizarImportacion(sl, prisma);
    if (accion === "previsualizar") {
      return NextResponse.json({ ok: true, vista, ms: Date.now() - inicio });
    }

    const r = await reemplazarCatalogo(resultado, prisma);

    const { ip, userAgent } = getClientInfo(req);
    await audit({
      accion: "UPDATE",
      tabla: "CuentaContable",
      registroId: "catalogo-sap",
      usuarioId: g.usuario.id,
      usuarioEmail: g.usuario.email ?? undefined,
      // Lo anterior queda en el rastro: es lo único que permitiría reconstruir el mapeo previo.
      valorAnterior: { cuentas: r.cuentasAntes, mapeos: r.mapeosAnteriores },
      valorNuevo: { origen: "SAP", cuentas: r.cuentasDespues, reasignados: r.reasignados, sinCuenta: r.sinCuenta, avisos: resultado.avisos },
      ip,
      userAgent,
    });

    return NextResponse.json({
      ok: true,
      resultado: { cuentasAntes: r.cuentasAntes, cuentasDespues: r.cuentasDespues, reasignados: r.reasignados, sinCuenta: r.sinCuenta, avisos: resultado.avisos },
      ms: Date.now() - inicio,
    });
  } catch (e) {
    const error = e instanceof ErrorServiceLayer ? traducir(e, { usuario: cfg.usuario }) : e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ ok: false, error, ms: Date.now() - inicio });
  } finally {
    await sl.logout();
  }
}
