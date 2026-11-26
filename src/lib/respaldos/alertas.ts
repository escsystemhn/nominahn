/**
 * Que alguien se entere cuando los respaldos fallan (auditoría del 2026-11-25). SERVIDOR.
 *
 *   - Correo a cada usuario activo con el permiso `configuracion.respaldos` cuando un
 *     respaldo termina con error o parcial, cuando lleva más de un día (o una semana)
 *     sin uno bueno y cuando falla la prueba de restauración semanal.
 *   - Lo mismo, como pendiente, en Inicio (`pendientesDeRespaldos`).
 *
 * Cada aviso «de estado» (atrasado, prueba fallida) se manda una vez por día como mucho:
 * el cron corre cada pocos minutos.
 */

import { prisma } from "@/lib/prisma";
import { permisosEfectivos, tienePermiso } from "@/lib/auth/permisos";
import { configSmtpVigente, sendEmail } from "@/lib/email/send";
import { CLAVE_ALERTAS, CLAVE_PRUEBA_RESTAURACION, normalizarConfig, CLAVE_RESPALDOS, estaAtrasado, leerPrueba } from "./config";

export const PERMISO_RESPALDOS = "configuracion.respaldos";
const DIA = 24 * 3_600_000;
const ENLACE = "/configuracion?seccion=respaldos";

const fecha = (d: Date | string) => new Date(d).toLocaleString("es-HN", { timeZone: "America/Tegucigalpa", dateStyle: "medium", timeStyle: "short" });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Los correos de quienes administran respaldos (permisos efectivos: perfil o rol). */
export async function destinatarios(): Promise<string[]> {
  const usuarios = await prisma.user.findMany({
    where: { activo: true, OR: [{ empleado: { is: null } }, { empleado: { is: { estado: { not: "INACTIVO" } } } }] },
    select: { email: true, role: true, perfil: { select: { permisos: true, activo: true } } },
  });
  return [...new Set(usuarios.filter((u) => u.email && tienePermiso(permisosEfectivos(u), PERMISO_RESPALDOS)).map((u) => u.email))];
}

/** Manda el aviso. Nunca lanza: un respaldo no falla porque el correo no salga. */
export async function enviarAlerta(asunto: string, parrafos: string[]): Promise<{ enviados: number; motivo?: string }> {
  try {
    if (!(await configSmtpVigente())) return { enviados: 0, motivo: "sin servidor de correo" };
    const para = await destinatarios();
    const base = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2a30">
      ${parrafos.map((p) => `<p>${esc(p)}</p>`).join("")}
      ${base ? `<p><a href="${esc(base + ENLACE)}">Abrir Configuración → Respaldos</a></p>` : ""}
      <p style="color:#55656e;font-size:12px">Gestión360 Nómina. Lo recibe por tener el permiso de respaldos.</p></div>`;
    let enviados = 0;
    for (const to of para) {
      try {
        await sendEmail({ to, subject: asunto, html });
        enviados++;
      } catch (e) {
        console.error("[respaldos] no se pudo enviar la alerta a", to, e instanceof Error ? e.message : e);
      }
    }
    return { enviados };
  } catch (e) {
    console.error("[respaldos] alerta sin enviar:", e instanceof Error ? e.message : e);
    return { enviados: 0, motivo: "error" };
  }
}

/** Después de cada respaldo: avisa si falló o si no llegó a todos los destinos. */
export async function alertarResultado(r: { estado: string; error: string | null; archivo: string | null; tipo: string }): Promise<void> {
  if (r.estado !== "ERROR" && r.estado !== "PARCIAL") return;
  const que = r.tipo === "AUTOMATICO" ? "El respaldo automático" : "El respaldo manual";
  await enviarAlerta(
    r.estado === "ERROR" ? "Respaldo de la nómina con error" : "Respaldo de la nómina incompleto",
    [
      r.estado === "ERROR"
        ? `${que} del ${fecha(new Date())} falló: no quedó ninguna copia nueva.`
        : `${que} del ${fecha(new Date())} no llegó a todos los destinos.`,
      `Motivo: ${r.error ?? "sin detalle"}`,
      ...(r.tipo === "AUTOMATICO" ? ["El sistema lo reintenta hasta 3 veces, con una hora entre cada intento."] : []),
    ],
  );
}

async function leerAvisos(): Promise<Record<string, string>> {
  const fila = await prisma.configuracionSistema.findUnique({ where: { clave: CLAVE_ALERTAS } });
  try { return fila?.valor ? (JSON.parse(fila.valor) as Record<string, string>) : {}; } catch { return {}; }
}

async function anotarAviso(clave: string, valor: string): Promise<void> {
  const avisos = { ...(await leerAvisos()), [clave]: valor };
  const texto = JSON.stringify(avisos);
  await prisma.configuracionSistema.upsert({
    where: { clave: CLAVE_ALERTAS },
    update: { valor: texto },
    create: { clave: CLAVE_ALERTAS, valor: texto, descripcion: "Respaldos: cuándo se avisó por última vez de cada problema." },
  });
}

/** Lo que el cron revisa en cada vuelta: respaldo atrasado y prueba de restauración fallida. */
export async function vigilarRespaldos(ahora = new Date()): Promise<string[]> {
  const avisados: string[] = [];
  const [filaConfig, filaPrueba, ultimoBueno, avisos] = await Promise.all([
    prisma.configuracionSistema.findUnique({ where: { clave: CLAVE_RESPALDOS } }),
    prisma.configuracionSistema.findUnique({ where: { clave: CLAVE_PRUEBA_RESTAURACION } }),
    prisma.respaldo.findFirst({ where: { estado: { in: ["OK", "PARCIAL"] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    leerAvisos(),
  ]);
  const config = normalizarConfig(filaConfig?.valor ?? null);

  const hace = (iso: string | undefined) => (iso ? ahora.getTime() - new Date(iso).getTime() : Infinity);
  if (estaAtrasado(config, ultimoBueno?.createdAt ?? null, ahora) && hace(avisos.atrasado) > DIA) {
    await enviarAlerta("Los respaldos de la nómina están atrasados", [
      ultimoBueno ? `El último respaldo correcto es del ${fecha(ultimoBueno.createdAt)}.` : "Todavía no hay ningún respaldo correcto.",
      "Revise que el equipo esté encendido, que los destinos estén conectados y el historial de respaldos.",
    ]);
    await anotarAviso("atrasado", ahora.toISOString());
    avisados.push("atrasado");
  }

  const prueba = leerPrueba(filaPrueba?.valor);
  if (prueba && !prueba.ok && avisos.prueba !== prueba.fecha) {
    await enviarAlerta("Falló la prueba de restauración de los respaldos", [
      `La prueba del ${fecha(prueba.fecha)} no pudo restaurar el respaldo${prueba.archivo ? ` ${prueba.archivo}` : ""}.`,
      `Motivo: ${prueba.detalle}`,
      "Un respaldo que no se puede restaurar no protege los datos: revíselo cuanto antes.",
    ]);
    await anotarAviso("prueba", prueba.fecha);
    avisados.push("prueba");
  }
  return avisados;
}

export interface PendienteRespaldo { n: number; titulo: string; detalle: string; href: string }

/** Lo que Inicio muestra a quien administra respaldos, de lo más grave a lo menos. */
export async function pendientesDeRespaldos(ahora = new Date(), conPgDump = true): Promise<PendienteRespaldo[]> {
  const [filaConfig, filaPrueba, ultimo, ultimoBueno] = await Promise.all([
    prisma.configuracionSistema.findUnique({ where: { clave: CLAVE_RESPALDOS } }),
    prisma.configuracionSistema.findUnique({ where: { clave: CLAVE_PRUEBA_RESTAURACION } }),
    prisma.respaldo.findFirst({ where: { estado: { not: "EN_CURSO" } }, orderBy: { createdAt: "desc" }, select: { estado: true, error: true, createdAt: true } }),
    prisma.respaldo.findFirst({ where: { estado: { in: ["OK", "PARCIAL"] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const config = normalizarConfig(filaConfig?.valor ?? null);
  const salida: PendienteRespaldo[] = [];
  const corto = (s: string | null) => (s && s.length > 140 ? `${s.slice(0, 137)}…` : s ?? "sin detalle");

  if (ultimo && (ultimo.estado === "ERROR" || ultimo.estado === "PARCIAL")) {
    salida.push({
      n: 1,
      titulo: ultimo.estado === "ERROR" ? "Respaldo con error" : "Respaldo incompleto",
      detalle: `${fecha(ultimo.createdAt)}: ${corto(ultimo.error)}`,
      href: ENLACE,
    });
  }
  if (estaAtrasado(config, ultimoBueno?.createdAt ?? null, ahora)) {
    salida.push({
      n: 1,
      titulo: "Respaldos atrasados",
      detalle: ultimoBueno ? `El último respaldo correcto es del ${fecha(ultimoBueno.createdAt)}.` : "Todavía no hay ningún respaldo correcto.",
      href: ENLACE,
    });
  }
  const prueba = leerPrueba(filaPrueba?.valor);
  if (prueba && !prueba.ok) {
    salida.push({ n: 1, titulo: "Falló la prueba de restauración", detalle: `${fecha(prueba.fecha)}: ${corto(prueba.detalle)}`, href: ENLACE });
  }
  // Sin el automático, la única copia es la diaria de la instalación, en el mismo equipo que la base.
  if (!config.automatico.activo && conPgDump) {
    salida.push({
      n: 1,
      titulo: "Respaldos automáticos apagados",
      detalle: "Encienda el respaldo automático con un destino fuera de este equipo (disco extraíble, red o nube).",
      href: ENLACE,
    });
  }
  return salida;
}
