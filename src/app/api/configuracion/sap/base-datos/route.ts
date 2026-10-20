/**
 * Base de datos de SAP (SQL Server), sólo lectura:
 *
 *   POST { accion: "probar",   …formulario }  → conecta a la base de la empresa y la describe
 *   POST { accion: "empresas", …formulario }  → empresas del servidor (SBO-COMMON.dbo.SRGC)
 *
 * Trabaja con lo que hay en el FORMULARIO, sin guardarlo, para poder probar
 * antes de guardar. Si la contraseña viene vacía se usa la guardada, pero sólo
 * contra el mismo servidor para el que se guardó.
 *
 * Responde 200 con ok:false cuando la prueba corrió y falló.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { parsearBody } from "@/lib/http/validar";
import { descifrar } from "@/lib/seguridad/cifrado";
import { probarBaseDatos, listarEmpresas, nombreBaseValido, ErrorBaseDatos, type ConfigBaseDatosSap } from "@/lib/sap/base-datos";
import { cambioDestinoBd, MENSAJE_PASSWORD_BD } from "@/lib/sap/credenciales";

const schema = z.object({
  accion: z.enum(["probar", "empresas"]),
  servidor: z.string().trim().min(1, "requerido").max(255),
  puerto: z.coerce.number().int().min(1).max(65535).optional().nullable(),
  instancia: z.string().trim().max(128).optional().nullable(),
  usuario: z.string().trim().min(1, "requerido").max(128),
  password: z.string().max(500).optional().nullable(),
  cifrar: z.boolean().optional(),
  confiarCertificado: z.boolean().optional(),
  companyDb: z.string().trim().max(100).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.sap");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const guardada = await prisma.integracionSap.findUnique({
    where: { id: "default" },
    select: { companyDb: true, dbServidor: true, dbPuerto: true, dbInstancia: true, dbPasswordCifrado: true },
  });

  const destino = { servidor: d.servidor, puerto: d.puerto ?? 1433, instancia: d.instancia?.trim() || null };
  let password = d.password || null;
  if (!password && guardada?.dbPasswordCifrado) {
    if (cambioDestinoBd(destino, { servidor: guardada.dbServidor, puerto: guardada.dbPuerto, instancia: guardada.dbInstancia })) {
      return NextResponse.json({ ok: false, error: MENSAJE_PASSWORD_BD });
    }
    try {
      password = descifrar(guardada.dbPasswordCifrado);
    } catch {
      return NextResponse.json({ ok: false, error: "No se pudo leer la contraseña guardada de SQL Server (¿cambió CIFRADO_KEY?). Vuelva a escribirla." });
    }
  }
  if (!password) return NextResponse.json({ ok: false, error: "Escriba la contraseña del usuario de SQL Server." });

  const cfg: ConfigBaseDatosSap = {
    servidor: destino.servidor,
    puerto: destino.puerto,
    instancia: destino.instancia,
    usuario: d.usuario,
    password,
    cifrar: d.cifrar ?? false,
    confiarCertificado: d.confiarCertificado ?? true,
  };

  // La última prueba sólo se anota si es contra el destino guardado.
  const esDestinoGuardado = !!guardada?.dbServidor && !cambioDestinoBd(destino, { servidor: guardada.dbServidor, puerto: guardada.dbPuerto, instancia: guardada.dbInstancia });
  const anotar = async (ok: boolean, detalle: string) => {
    if (!esDestinoGuardado) return;
    await prisma.integracionSap
      .update({ where: { id: "default" }, data: { dbUltimaPruebaAt: new Date(), dbUltimaPruebaOk: ok, dbUltimaPruebaDetalle: detalle } })
      .catch(() => undefined);
  };

  try {
    if (d.accion === "empresas") {
      const r = await listarEmpresas(cfg);
      return NextResponse.json({ ok: true, ...r });
    }

    const companyDb = d.companyDb?.trim() || guardada?.companyDb || "";
    if (!companyDb) return NextResponse.json({ ok: false, error: "Escriba o elija la base de datos de la empresa." });
    if (!nombreBaseValido(companyDb)) return NextResponse.json({ ok: false, error: `El nombre de base «${companyDb}» no es válido.` });

    const r = await probarBaseDatos(cfg, companyDb);
    const detalle =
      `Conectado a ${r.servidor} como ${r.login}. Base ${r.baseDatos}` +
      (r.esBaseSap ? `: ${r.empresa ?? "empresa sin nombre"}${r.moneda ? `, moneda ${r.moneda}` : ""}${r.versionB1 ? `, SAP ${r.versionB1}` : ""}.` : ", que no es de SAP Business One.");
    await anotar(r.esBaseSap, detalle + (r.avisos.length ? ` ${r.avisos.join(" ")}` : ""));
    return NextResponse.json({ ok: r.esBaseSap, detalle, resultado: r, error: r.esBaseSap ? undefined : r.avisos[0] });
  } catch (e) {
    const err = e instanceof ErrorBaseDatos ? e : new ErrorBaseDatos("OTRO", e instanceof Error ? e.message : "Error desconocido");
    if (d.accion === "probar") await anotar(false, err.message);
    return NextResponse.json({ ok: false, error: err.message, detalleTecnico: err.detalle ?? null, codigo: err.codigo });
  }
}
