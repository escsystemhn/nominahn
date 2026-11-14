/**
 * Sucursales (BusinessPlaces) de la empresa en SAP, leídas en vivo, para
 * elegir a cuál corresponde cada sucursal local cuando SAP usa varias.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { cargarConfigSap, exigirConexion, ConfigSapIncompleta } from "@/lib/sap/config";
import { ServiceLayer } from "@/lib/sap/service-layer";
import { ErrorServiceLayer, traducir } from "@/lib/sap/errores";

export async function GET() {
  const g = await requerirPermiso("configuracion.sap");
  if (!g.ok) return g.response;

  let cfg;
  try {
    cfg = await cargarConfigSap(prisma);
    exigirConexion(cfg);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof ConfigSapIncompleta ? e.message : "Configuración de SAP ilegible." });
  }

  const sl = new ServiceLayer({ urlBase: cfg.urlBase, companyDb: cfg.companyDb, usuario: cfg.usuario, password: cfg.password });
  try {
    const lista = await sl.listarSucursales();
    return NextResponse.json({
      ok: true,
      sucursales: lista.map((s) => ({ bplId: s.BPLID, nombre: s.BPLName, activa: s.Disabled !== "tYES" })),
    });
  } catch (e) {
    if (e instanceof ErrorServiceLayer && e.http === 404) {
      return NextResponse.json({ ok: false, error: "Este SAP no expone sucursales (BusinessPlaces): la empresa no usa varias sucursales o la versión no lo publica." });
    }
    const error = e instanceof ErrorServiceLayer ? traducir(e, { usuario: cfg.usuario }) : e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ ok: false, error });
  } finally {
    await sl.logout();
  }
}
