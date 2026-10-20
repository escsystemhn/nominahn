/**
 * Migración única: saca los archivos subidos de `public/uploads` (donde Next los
 * servía SIN autenticación) al directorio privado, y reescribe las URLs
 * guardadas en la BD de `/uploads/<x>` a `/api/uploads/<x>` (ruta autenticada).
 *
 * Correr UNA vez por entorno tras desplegar la Fase 4:
 *     npx tsx scripts/migrar-uploads-privados.ts
 *
 * Es idempotente: reejecutarlo no rompe nada (los archivos ya movidos no están,
 * las URLs ya reescritas no vuelven a matchear). No borra el directorio público.
 */

import { readdir, rename, mkdir, stat } from "fs/promises";
import path from "path";
import { prisma } from "../src/lib/prisma";
import { directorioUploads } from "../src/lib/uploads";

async function moverArchivos() {
  const publico = path.join(process.cwd(), "public", "uploads");
  const privado = directorioUploads();

  let archivos: string[];
  try {
    archivos = await readdir(publico);
  } catch {
    console.log("No hay public/uploads; nada que mover.");
    return;
  }

  await mkdir(privado, { recursive: true });
  let movidos = 0;
  for (const nombre of archivos) {
    const origen = path.join(publico, nombre);
    if (!(await stat(origen)).isFile()) continue;
    try {
      await rename(origen, path.join(privado, nombre));
      movidos++;
    } catch (e) {
      console.warn(`  no se pudo mover ${nombre}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Archivos movidos a privado: ${movidos} (de ${archivos.length}).`);
}

async function reescribirUrls() {
  // Candidato.cvUrl es el único campo cableado hoy a /api/uploads. Si en el
  // futuro se cablean Documento.archivoUrl, Contrato.archivoUrl, etc., añadir
  // aquí el mismo reemplazo `/uploads/` → `/api/uploads/`.
  const candidatos = await prisma.candidato.findMany({
    where: { cvUrl: { startsWith: "/uploads/" } },
    select: { id: true, cvUrl: true },
  });
  for (const c of candidatos) {
    await prisma.candidato.update({
      where: { id: c.id },
      data: { cvUrl: c.cvUrl!.replace(/^\/uploads\//, "/api/uploads/") },
    });
  }
  console.log(`URLs de CV reescritas: ${candidatos.length}.`);
}

async function main() {
  await moverArchivos();
  await reescribirUrls();
  await prisma.$disconnect();
  console.log("Migración completada.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
