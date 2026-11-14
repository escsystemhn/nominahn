/**
 * Configuración → SAP - Conexión: datos del Service Layer, de la base de datos
 * de SAP (SQL Server, sólo lectura) y comportamiento del envío de asientos.
 *
 * Sólo con `configuracion.sap` (por omisión SUPER_ADMIN): quien controla esta
 * pantalla decide qué se contabiliza en SAP y con qué credenciales.
 *
 * Las contraseñas entran, se cifran y no vuelven a salir: el GET sólo dice si
 * hay una guardada. En el formulario, dejarla vacía significa «no la cambies»,
 * salvo que haya cambiado el servidor: entonces hay que escribirla de nuevo.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { cifrar, cifradoDisponible } from "@/lib/seguridad/cifrado";
import { cambioDestinoBd, cambioDestinoSl, MENSAJE_PASSWORD_BD, MENSAJE_PASSWORD_SL } from "@/lib/sap/credenciales";
import { nombreBaseValido } from "@/lib/sap/base-datos";

const schema = z.object({
  urlBase: z
    .string()
    .trim()
    .min(1, "requerido")
    .max(500)
    .refine((u) => /^https?:\/\/[^\s]+$/i.test(u), "debe ser una URL http(s), p. ej. https://servidor:50000/b1s/v1/"),
  companyDb: z
    .string()
    .trim()
    .min(1, "requerido")
    .max(100)
    .refine(nombreBaseValido, "sólo letras, números, guion, guion bajo, punto y espacio"),
  usuario: z.string().trim().min(1, "requerido").max(100),
  /** Vacía = conservar la guardada. `null` explícito = borrarla. */
  password: z.string().max(500).optional().nullable(),
  activo: z.boolean().optional(),
  modoEnvio: z.enum(["MANUAL", "AL_APROBAR", "AL_PAGAR"]),
  incluirProvisiones: z.boolean(),
  porCentroCosto: z.boolean(),
  dimensionCentro: z.coerce.number().int().min(1).max(5),
  fechaContable: z.enum(["PAGO", "FIN_PERIODO"]),
  codigoTransaccion: z.string().trim().max(4, "máximo 4 caracteres").optional().nullable(),
  serie: z.coerce.number().int().positive().optional().nullable(),
  memoPlantilla: z.string().trim().min(1, "requerido").max(200),
  /** SAP con varias sucursales: cada línea del asiento lleva BPLID. */
  usaSucursales: z.boolean().optional(),
  /** Sucursal de SAP para las planillas de toda la empresa. */
  sapBplIdPorDefecto: z.coerce.number().int().positive().optional().nullable(),
  // ─── Base de datos (SQL Server) ─────────────────────────────────────────────
  /** Vacío = sin conexión a la base (se borran también usuario y contraseña). */
  dbServidor: z.string().trim().max(255).optional().nullable(),
  dbPuerto: z.coerce.number().int().min(1).max(65535).optional().nullable(),
  dbInstancia: z.string().trim().max(128).optional().nullable(),
  dbUsuario: z.string().trim().max(128).optional().nullable(),
  /** Vacía = conservar la guardada. `null` explícito = borrarla. */
  dbPassword: z.string().max(500).optional().nullable(),
  dbCifrar: z.boolean().optional(),
  dbConfiarCertificado: z.boolean().optional(),
});

export async function GET() {
  const g = await requerirPermiso("configuracion.sap");
  if (!g.ok) return g.response;

  const [c, pendientes, errores, enviados, envios] = await Promise.all([
    prisma.integracionSap.findUnique({ where: { id: "default" } }),
    prisma.sapEnvioAsiento.count({ where: { estado: { in: ["PENDIENTE", "ENVIANDO"] } } }),
    prisma.sapEnvioAsiento.count({ where: { estado: { in: ["ERROR", "CANCELADO"] } } }),
    prisma.sapEnvioAsiento.count({ where: { estado: "ENVIADO" } }),
    prisma.sapEnvioAsiento.findMany({
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: {
        id: true,
        planillaId: true,
        tipo: true,
        estado: true,
        intentos: true,
        sapNumero: true,
        sapTransId: true,
        errorTraducido: true,
        proximoIntentoAt: true,
        enviadoAt: true,
        updatedAt: true,
        planilla: { select: { tipo: true, fechaInicio: true, fechaFin: true, estado: true } },
      },
    }),
  ]);

  return NextResponse.json({
    configuracion: c
      ? {
          activo: c.activo,
          urlBase: c.urlBase,
          companyDb: c.companyDb,
          usuario: c.usuario,
          tienePassword: !!c.passwordCifrado,
          modoEnvio: c.modoEnvio,
          incluirProvisiones: c.incluirProvisiones,
          porCentroCosto: c.porCentroCosto,
          dimensionCentro: c.dimensionCentro,
          fechaContable: c.fechaContable,
          codigoTransaccion: c.codigoTransaccion,
          serie: c.serie,
          memoPlantilla: c.memoPlantilla,
          longitudes: { memo: c.longitudMemo, lineMemo: c.longitudLineMemo, referencia: c.longitudReferencia },
          usaSucursales: c.usaSucursales,
          sapBplIdPorDefecto: c.sapBplIdPorDefecto,
          catalogoOrigen: c.catalogoOrigen,
          catalogoImportadoAt: c.catalogoImportadoAt,
          catalogoCuentas: c.catalogoCuentas,
          baseDatos: {
            servidor: c.dbServidor,
            puerto: c.dbPuerto,
            instancia: c.dbInstancia,
            usuario: c.dbUsuario,
            tienePassword: !!c.dbPasswordCifrado,
            cifrar: c.dbCifrar,
            confiarCertificado: c.dbConfiarCertificado,
            ultimaPruebaAt: c.dbUltimaPruebaAt,
            ultimaPruebaOk: c.dbUltimaPruebaOk,
            ultimaPruebaDetalle: c.dbUltimaPruebaDetalle,
          },
          ultimaPruebaAt: c.ultimaPruebaAt,
          ultimaPruebaOk: c.ultimaPruebaOk,
          ultimaPruebaDetalle: c.ultimaPruebaDetalle,
          versionSap: c.versionSap,
          actualizadoPor: c.actualizadoPor,
          updatedAt: c.updatedAt,
        }
      : null,
    cifradoDisponible: cifradoDisponible(),
    cola: { pendientes, errores, enviados },
    envios,
  });
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.sap");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  if ((d.password || d.dbPassword) && !cifradoDisponible()) {
    return NextResponse.json(
      {
        error:
          "Falta CIFRADO_KEY en el entorno del servidor. Sin ella no se guardan contraseñas, " +
          "porque no se almacenan en claro.",
      },
      { status: 503 }
    );
  }

  const anterior = await prisma.integracionSap.findUnique({ where: { id: "default" } });

  // ─── Service Layer ──────────────────────────────────────────────────────────
  const urlBase = d.urlBase.endsWith("/") ? d.urlBase : `${d.urlBase}/`;
  if (anterior?.passwordCifrado && !d.password && d.password !== null && cambioDestinoSl({ urlBase }, anterior)) {
    return NextResponse.json({ error: MENSAJE_PASSWORD_SL, campo: "password" }, { status: 400 });
  }
  // Contraseña: nueva → se cifra; null → se borra; vacía o ausente → no se toca.
  const password =
    d.password === null ? { passwordCifrado: null }
    : d.password ? { passwordCifrado: cifrar(d.password) }
    : {};

  // ─── Base de datos ──────────────────────────────────────────────────────────
  const dbServidor = d.dbServidor?.trim() || null;
  let baseDatos: Record<string, unknown>;
  if (!dbServidor) {
    // Sin servidor no hay conexión: no se guarda un usuario ni una contraseña sueltos.
    baseDatos = { dbServidor: null, dbInstancia: null, dbUsuario: null, dbPasswordCifrado: null, dbPuerto: 1433, dbCifrar: false, dbConfiarCertificado: true };
  } else {
    if (!d.dbUsuario?.trim()) {
      return NextResponse.json({ error: "Falta el usuario de SQL Server.", campo: "dbUsuario" }, { status: 400 });
    }
    const destino = { servidor: dbServidor, puerto: d.dbPuerto ?? 1433, instancia: d.dbInstancia?.trim() || null };
    const guardado = anterior ? { servidor: anterior.dbServidor, puerto: anterior.dbPuerto, instancia: anterior.dbInstancia } : null;
    if (anterior?.dbPasswordCifrado && !d.dbPassword && d.dbPassword !== null && cambioDestinoBd(destino, guardado)) {
      return NextResponse.json({ error: MENSAJE_PASSWORD_BD, campo: "dbPassword" }, { status: 400 });
    }
    baseDatos = {
      dbServidor,
      dbPuerto: destino.puerto,
      dbInstancia: destino.instancia,
      dbUsuario: d.dbUsuario.trim(),
      dbCifrar: d.dbCifrar ?? false,
      dbConfiarCertificado: d.dbConfiarCertificado ?? true,
      ...(d.dbPassword === null ? { dbPasswordCifrado: null } : d.dbPassword ? { dbPasswordCifrado: cifrar(d.dbPassword) } : {}),
    };
    // Otro destino: la última prueba ya no dice nada de éste.
    if (cambioDestinoBd(destino, guardado)) Object.assign(baseDatos, { dbUltimaPruebaAt: null, dbUltimaPruebaOk: null, dbUltimaPruebaDetalle: null });
  }

  const comun = {
    urlBase,
    companyDb: d.companyDb,
    usuario: d.usuario,
    activo: d.activo ?? false,
    modoEnvio: d.modoEnvio,
    incluirProvisiones: d.incluirProvisiones,
    porCentroCosto: d.porCentroCosto,
    dimensionCentro: d.dimensionCentro,
    fechaContable: d.fechaContable,
    codigoTransaccion: d.codigoTransaccion || null,
    serie: d.serie ?? null,
    memoPlantilla: d.memoPlantilla,
    usaSucursales: d.usaSucursales ?? false,
    sapBplIdPorDefecto: d.usaSucursales ? (d.sapBplIdPorDefecto ?? null) : null,
    actualizadoPor: g.usuario.email ?? null,
  };

  await prisma.integracionSap.upsert({
    where: { id: "default" },
    create: { id: "default", ...comun, ...password, ...baseDatos },
    update: { ...comun, ...password, ...baseDatos },
  });

  const { ip, userAgent } = getClientInfo(req);
  const { dbPasswordCifrado: _omitida, ...baseDatosAuditable } = baseDatos as { dbPasswordCifrado?: unknown } & Record<string, unknown>;
  void _omitida;
  await audit({
    accion: "UPDATE",
    tabla: "IntegracionSap",
    registroId: "default",
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: anterior
      ? {
          urlBase: anterior.urlBase,
          companyDb: anterior.companyDb,
          usuario: anterior.usuario,
          activo: anterior.activo,
          modoEnvio: anterior.modoEnvio,
          usaSucursales: anterior.usaSucursales,
          dbServidor: anterior.dbServidor,
          dbPuerto: anterior.dbPuerto,
          dbInstancia: anterior.dbInstancia,
          dbUsuario: anterior.dbUsuario,
        }
      : null,
    // Las contraseñas no quedan en el rastro, sólo si cambiaron.
    valorNuevo: {
      ...comun,
      ...baseDatosAuditable,
      passwordCambiada: d.password ? true : d.password === null ? "borrada" : false,
      dbPasswordCambiada: d.dbPassword ? true : d.dbPassword === null || !dbServidor ? "borrada" : false,
    },
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true });
}
