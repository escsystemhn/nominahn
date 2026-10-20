/**
 * Postulación pública a una vacante (sin cuenta).
 *
 * POST multipart/form-data: nombre, email, telefono, mensaje, consentimiento=si,
 * cv (PDF) y el campo trampa vacío.
 *
 * Al ser la única escritura sin sesión de toda la aplicación, se defiende sola:
 *   - sólo vacantes abiertas, publicadas y no internas (las demás dan 404);
 *   - límite por IP en memoria, y un techo por vacante que no depende de la IP;
 *   - tamaño comprobado antes de leer el cuerpo;
 *   - el CV debe ser un PDF por su firma, no por la extensión;
 *   - campo trampa: si viene lleno se responde como si todo saliera bien y no
 *     se guarda nada, para no enseñarle al bot qué lo delató;
 *   - repetir la postulación con el mismo correo no crea otro candidato.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { audit, getClientInfo } from "@/lib/audit";
import { estado, registrarFallo } from "@/lib/auth/rate-limit";
import { directorioUploads, maxBytes } from "@/lib/uploads";
import {
  CAMPO_TRAMPA,
  FILTRO_VACANTE_PUBLICA,
  FUENTE_PORTAL,
  LIMITE_POSTULACIONES,
  LIMITE_POR_VACANTE,
  esPdf,
  ipParaLimite,
  notasDePostulacion,
  schemaPostulacion,
} from "@/lib/talento/empleos";

const RECIBIDA = { ok: true, mensaje: "Recibimos su postulación. Si su perfil avanza, le escribiremos al correo que indicó." };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ip, userAgent } = getClientInfo(req);
  // Sin proxy delante no hay IP: todos caerían en el mismo cubo y cinco
  // postulaciones bloquearían a cualquiera. Ahí sólo rige el techo por vacante.
  const ipLimite = ipParaLimite(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip"));
  const clave = ipLimite === "desconocida" ? null : `empleos:${ipLimite}`;
  const claveVacante = `empleos-vacante:${id}`;

  if (clave && estado(clave, Date.now(), LIMITE_POSTULACIONES).bloqueado) {
    return NextResponse.json({ error: "Recibimos demasiadas postulaciones desde su conexión. Intente de nuevo en una hora." }, { status: 429 });
  }
  if (estado(claveVacante, Date.now(), LIMITE_POR_VACANTE).bloqueado) {
    return NextResponse.json({ error: "Esta vacante recibió muchas postulaciones en la última hora. Intente de nuevo más tarde." }, { status: 429 });
  }

  // El margen cubre los campos de texto y los separadores del multipart.
  const largo = Number(req.headers.get("content-length") ?? 0);
  if (largo > maxBytes() + 64 * 1024) {
    return NextResponse.json({ error: `El currículo no puede pasar de ${Math.floor(maxBytes() / 1024 / 1024)} MB.` }, { status: 413 });
  }

  const vacante = await prisma.vacante.findFirst({ where: { id, ...FILTRO_VACANTE_PUBLICA }, select: { id: true, titulo: true } });
  if (!vacante) return NextResponse.json({ error: "Esta vacante ya no recibe postulaciones." }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "No se pudo leer el formulario." }, { status: 400 });
  }

  // Cuenta para el límite aunque falle la validación: probar en bucle también es abuso.
  if (clave) registrarFallo(clave, Date.now(), LIMITE_POSTULACIONES);
  registrarFallo(claveVacante, Date.now(), LIMITE_POR_VACANTE);

  const trampa = form.get(CAMPO_TRAMPA);
  if (typeof trampa === "string" && trampa.trim() !== "") return NextResponse.json(RECIBIDA, { status: 201 });

  const texto = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const parsed = schemaPostulacion.safeParse({
    nombre: texto("nombre"),
    email: texto("email"),
    telefono: texto("telefono"),
    mensaje: texto("mensaje"),
    consentimiento: texto("consentimiento"),
  });
  if (!parsed.success) {
    const detalles: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (detalles[String(i.path[0] ?? "formulario")] ??= []).push(i.message);
    return NextResponse.json({ error: "Revise los datos del formulario.", detalles }, { status: 400 });
  }
  const p = parsed.data;

  const cv = form.get("cv");
  if (!cv || typeof cv === "string" || cv.size === 0) {
    return NextResponse.json({ error: "Adjunte su currículo en PDF.", detalles: { cv: ["Adjunte su currículo en PDF."] } }, { status: 400 });
  }
  if (cv.size > maxBytes()) {
    return NextResponse.json({ error: `El currículo no puede pasar de ${Math.floor(maxBytes() / 1024 / 1024)} MB.`, detalles: { cv: ["Archivo demasiado grande."] } }, { status: 413 });
  }
  const bytes = new Uint8Array(await cv.arrayBuffer());
  if (!esPdf(bytes)) {
    return NextResponse.json({ error: "El currículo debe ser un archivo PDF.", detalles: { cv: ["Sólo se aceptan archivos PDF."] } }, { status: 400 });
  }

  const repetida = await prisma.candidato.findFirst({ where: { vacanteId: vacante.id, email: p.email }, select: { id: true } });
  if (repetida) return NextResponse.json(RECIBIDA, { status: 201 });

  const nombreArchivo = `${randomUUID()}.pdf`;
  const dir = directorioUploads();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, nombreArchivo), bytes);

  const ahora = new Date();
  const candidato = await prisma.candidato.create({
    data: {
      vacanteId: vacante.id,
      nombre: p.nombre,
      email: p.email,
      telefono: p.telefono || null,
      cvUrl: `/api/uploads/${nombreArchivo}`,
      fuente: FUENTE_PORTAL,
      notas: notasDePostulacion(p, ahora),
      consentimientoAt: ahora,
    },
    select: { id: true },
  });

  await audit({
    accion: "CREATE",
    tabla: "Candidato",
    registroId: candidato.id,
    usuarioEmail: p.email,
    valorNuevo: { origen: FUENTE_PORTAL, vacante: vacante.titulo, consentimientoAt: ahora.toISOString() },
    ip,
    userAgent,
  });

  return NextResponse.json(RECIBIDA, { status: 201 });
}
