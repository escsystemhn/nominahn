/**
 * Prueba la conexión con el Service Layer: Login → lee una cuenta del plan →
 * lee las longitudes del $metadata → Logout.
 *
 * Usa la configuración GUARDADA. Si el servidor todavía no tiene CIFRADO_KEY,
 * se acepta la contraseña en el cuerpo sólo para esta prueba: no se guarda.
 *
 * Responde 200 con ok:false cuando la prueba corrió y falló; el resultado es
 * la información pedida, no un error de la API.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { parsearBody } from "@/lib/http/validar";
import { cargarConfigSap, exigirConexion, ConfigSapIncompleta } from "@/lib/sap/config";
import { ServiceLayer } from "@/lib/sap/service-layer";
import { ErrorServiceLayer, traducir } from "@/lib/sap/errores";

const schema = z.object({
  /** Sólo para esta prueba; no se guarda. */
  password: z.string().max(500).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.sap");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  let cfg;
  try {
    cfg = await cargarConfigSap(prisma);
    if (cfg && parsed.data.password) cfg = { ...cfg, password: parsed.data.password };
    exigirConexion(cfg);
  } catch (e) {
    const error = e instanceof ConfigSapIncompleta ? e.message : "No se pudo leer la configuración de SAP.";
    return NextResponse.json({ ok: false, error }, { status: 200 });
  }

  const inicio = Date.now();
  const sl = new ServiceLayer({ urlBase: cfg.urlBase, companyDb: cfg.companyDb, usuario: cfg.usuario, password: cfg.password });
  const host = (() => {
    try {
      return new URL(cfg.urlBase).host;
    } catch {
      return cfg.urlBase;
    }
  })();

  try {
    const r = await sl.probar();
    const detalle = `Conectado a ${host} (${cfg.companyDb}), SAP ${r.version || "versión desconocida"}, sesión de ${r.sessionTimeout} min. Plan de cuentas ${r.cuentas ? "legible" : "no legible"}.`;
    await prisma.integracionSap.update({
      where: { id: "default" },
      data: {
        ultimaPruebaAt: new Date(),
        ultimaPruebaOk: true,
        ultimaPruebaDetalle: detalle,
        versionSap: r.version || null,
        longitudMemo: r.longitudes.memo,
        longitudLineMemo: r.longitudes.lineMemo,
        longitudReferencia: r.longitudes.referencia,
      },
    });
    return NextResponse.json({ ok: true, detalle, version: r.version, longitudes: r.longitudes, ms: Date.now() - inicio });
  } catch (e) {
    const err = e instanceof ErrorServiceLayer ? e : null;
    const error = err ? traducir(err, { host, usuario: cfg.usuario }) : e instanceof Error ? e.message : "Error desconocido";
    await prisma.integracionSap.update({
      where: { id: "default" },
      data: { ultimaPruebaAt: new Date(), ultimaPruebaOk: false, ultimaPruebaDetalle: error },
    });
    return NextResponse.json({
      ok: false,
      error,
      detalleTecnico: err ? `HTTP ${err.http} ${err.codigo}: ${err.message}` : null,
      ms: Date.now() - inicio,
    });
  }
}
