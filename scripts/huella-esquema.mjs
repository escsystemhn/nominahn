/**
 * Huella del esquema de base de datos aplicado en Seenode.
 *
 * El despliegue automático nunca toca la base (README-DEPLOY.md): si un push
 * cambia el esquema y nadie corre `npm run db:remota -- aplicar`, el código
 * nuevo llega a producción buscando tablas o columnas que no existen, y esas
 * pantallas fallan hasta que alguien se da cuenta. GitHub no puede preguntarle
 * a la base porque, a propósito, no guarda ninguna credencial. En su lugar:
 *
 *   · `aplicar` (scripts/preparar-bd-remota.mjs), al terminar bien, guarda la
 *     huella de prisma/schema.prisma y prisma/sql/*.sql en
 *     prisma/esquema-aplicado.txt, que se sube con el commit;
 *   · el workflow recalcula la huella y, si no coincide, detiene el despliegue
 *     antes de compilar.
 *
 *   node scripts/huella-esquema.mjs             # imprime la huella actual
 *   node scripts/huella-esquema.mjs verificar   # la compara con la registrada
 *
 * Sólo usa módulos de Node: el workflow la corre antes de `npm ci`.
 *
 * Los saltos de línea se normalizan: Git para Windows deja CRLF en la copia de
 * trabajo y el runner de GitHub LF; sin esto la huella nunca coincidiría.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const ARCHIVO_HUELLA = "prisma/esquema-aplicado.txt";

/** Lo que define la base: el esquema de Prisma y los triggers/índices de prisma/sql/. */
function archivosEsquema(raiz) {
  const sql = readdirSync(join(raiz, "prisma", "sql"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return ["prisma/schema.prisma", ...sql.map((f) => `prisma/sql/${f}`)];
}

export function huellaEsquema(raiz = process.cwd()) {
  const hash = createHash("sha256");
  for (const relativa of archivosEsquema(raiz)) {
    const contenido = readFileSync(join(raiz, relativa), "utf8").replace(/\r\n/g, "\n");
    // El nombre entra en la huella: renombrar un .sql cambia el orden en que
    // prisma/sql/apply.ts los ejecuta.
    hash.update(`${relativa}\0${contenido}\0`);
  }
  return hash.digest("hex");
}

/** La huella guardada por el último `aplicar`, o null si nunca se aplicó. */
export function huellaRegistrada(raiz = process.cwd()) {
  const ruta = join(raiz, ARCHIVO_HUELLA);
  if (!existsSync(ruta)) return null;
  const linea = readFileSync(ruta, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^[0-9a-f]{64}$/.test(l));
  return linea ?? null;
}

export function registrarHuella(raiz = process.cwd()) {
  const huella = huellaEsquema(raiz);
  writeFileSync(
    join(raiz, ARCHIVO_HUELLA),
    "# Huella del esquema aplicado en la base de Seenode con `npm run db:remota -- aplicar`.\n" +
      "# La comprueba .github/workflows/compilar-seenode.yml antes de desplegar. No la edite a mano.\n" +
      `${huella}\n`
  );
  return huella;
}

// ─── Línea de comandos ────────────────────────────────────────────────────────

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (esPrincipal && process.argv[2] === "verificar") {
  const enGitHub = process.env.GITHUB_ACTIONS === "true";
  const resumen = (texto) => {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${texto}\n`);
  };
  const actual = huellaEsquema();
  const registrada = huellaRegistrada();

  if (registrada === actual) {
    console.log("✓ El esquema coincide con el último aplicado en Seenode.");
  } else if (registrada === null) {
    // Primer despliegue: el repositorio se sube antes de crear la base, así que
    // todavía no hay nada aplicado. A partir del primer `aplicar` ya se exige.
    const aviso =
      `Aún no hay ${ARCHIVO_HUELLA}: el esquema nunca se aplicó en Seenode. ` +
      "Antes de crear el servicio, corre `npm run db:remota -- aplicar` y sube ese archivo.";
    console.log(enGitHub ? `::warning title=Esquema sin registrar::${aviso}` : `⚠ ${aviso}`);
    resumen(`### ⚠ Esquema sin registrar\n\n${aviso}`);
  } else {
    const error =
      "El esquema (prisma/schema.prisma o prisma/sql/) cambió y no consta aplicado en la base de Seenode. " +
      "No se despliega: el código nuevo buscaría tablas o columnas que no existen.";
    const pasos =
      "En tu equipo, dentro de nominahn/:\n\n" +
      "```powershell\n" +
      '$env:DATABASE_URL_REMOTA = "<URI pública de la base>"\n' +
      "npm run db:remota -- revisar\n" +
      "npm run db:remota -- aplicar\n" +
      `git add ${ARCHIVO_HUELLA}\n` +
      'git commit -m "Esquema aplicado en Seenode"\n' +
      "git push\n" +
      "```";
    console.log(enGitHub ? `::error title=Esquema sin aplicar::${error}` : `✗ ${error}`);
    console.log(`\n${pasos}\n\n  registrada: ${registrada}\n  actual:     ${actual}`);
    resumen(`### ✗ Esquema sin aplicar\n\n${error}\n\n${pasos}`);
    process.exit(1);
  }
} else if (esPrincipal) {
  console.log(huellaEsquema());
}
