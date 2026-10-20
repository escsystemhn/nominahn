/**
 * Busca cuentas en el plan de cuentas de SAP (ChartOfAccounts) por prefijo de
 * código, para el selector del mapeo. Lectura en vivo: no se copia el plan de
 * SAP a la base local.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { cargarConfigSap, exigirConexion, ConfigSapIncompleta } from "@/lib/sap/config";
import { ServiceLayer } from "@/lib/sap/service-layer";
import { ErrorServiceLayer, traducir } from "@/lib/sap/errores";

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("configuracion.sap");
  if (!g.ok) return g.response;

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 1 || q.length > 50) {
    return NextResponse.json({ ok: false, error: "Escriba el inicio del código de la cuenta (1 a 50 caracteres)." });
  }

  let cfg;
  try {
    cfg = await cargarConfigSap(prisma);
    exigirConexion(cfg);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof ConfigSapIncompleta ? e.message : "Configuración de SAP ilegible." });
  }

  const sl = new ServiceLayer({ urlBase: cfg.urlBase, companyDb: cfg.companyDb, usuario: cfg.usuario, password: cfg.password });
  try {
    const cuentas = await sl.buscarCuentas(q, 25);
    return NextResponse.json({
      ok: true,
      cuentas: cuentas.map((c) => ({
        code: c.Code,
        name: c.Name,
        formatCode: c.FormatCode ?? null,
        activa: c.ActiveAccount !== "tNO",
      })),
    });
  } catch (e) {
    const error = e instanceof ErrorServiceLayer ? traducir(e, { usuario: cfg.usuario }) : e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ ok: false, error });
  } finally {
    await sl.logout();
  }
}
