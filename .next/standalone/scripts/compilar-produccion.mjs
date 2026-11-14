/**
 * Compilación de producción para Seenode (o cualquier servidor Linux con Node).
 *
 *   npm run build:prod                      # compila
 *   npm run build:prod -- --liberar-espacio # y borra lo que el servidor no usa
 *
 * 1. `prisma generate`: el cliente no se genera solo al instalar.
 * 2. `next build` con salida standalone (SALIDA_STANDALONE=1, ver next.config.ts).
 * 3. Copia public/ y .next/static/ dentro del standalone: Next no lo hace, y sin
 *    ellos el servidor responde 404 a los estilos, los scripts y el logo.
 * 4. Comprueba que el standalone traiga lo que el servidor carga en tiempo de
 *    ejecución y que no se haya colado ningún .env (Next copia lo que encuentra).
 * 5. Con --liberar-espacio borra node_modules y la caché de compilación: el
 *    standalone lleva sus propias dependencias y el plan Basic de Seenode tiene
 *    750 MB de disco, menos de lo que ocupa node_modules completo.
 *
 * NO toca la base de datos. El esquema se aplica aparte y a mano, con
 * scripts/preparar-bd-remota.mjs, para que un despliegue nunca altere tablas.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const raiz = process.cwd();
const liberarEspacio = process.argv.includes("--liberar-espacio");
const standalone = join(raiz, ".next", "standalone");

function abortar(mensaje) {
  console.error(`\n✗ ${mensaje}`);
  process.exit(1);
}

function paso(mensaje) {
  console.log(`\n▸ ${mensaje}`);
}

/** Ejecuta una CLI de node_modules con el mismo Node, sin depender de la shell. */
function ejecutarCli(rutaCli, args, envExtra = {}) {
  const r = spawnSync(process.execPath, [join(raiz, rutaCli), ...args], {
    cwd: raiz,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...envExtra },
  });
  if (r.status !== 0) abortar(`Falló: ${rutaCli} ${args.join(" ")}`);
}

if (!existsSync(join(raiz, "node_modules", "next"))) {
  abortar("No hay node_modules: ejecute antes `npm ci`.");
}

paso("Generando el cliente de Prisma");
ejecutarCli("node_modules/prisma/build/index.js", ["generate"]);

paso("Compilando Next.js (salida standalone, ajustes para 512 MB)");
ejecutarCli("node_modules/next/dist/bin/next", ["build", ...(process.argv.includes("--webpack") ? ["--webpack"] : [])], {
  SALIDA_STANDALONE: "1",
  COMPILACION_LIGERA: "1",
});

if (!existsSync(join(standalone, "server.js"))) {
  abortar("No se generó .next/standalone/server.js. ¿Está SALIDA_STANDALONE en next.config.ts?");
}

paso("Copiando public/ y .next/static/ al standalone");
cpSync(join(raiz, "public"), join(standalone, "public"), { recursive: true });
cpSync(join(raiz, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });

paso("Comprobando el standalone");
const envColados = readdirSync(standalone, { recursive: true }).filter((f) =>
  String(f).split(/[\\/]/).pop().startsWith(".env")
);
if (envColados.length > 0) {
  abortar(`El standalone contiene archivos .env (${envColados.join(", ")}): bórrelos del proyecto antes de compilar.`);
}
// Los mismos que exige instalador/construir.ps1: si el rastreo de archivos de
// Next deja alguno fuera, el servidor arranca y falla en la primera planilla.
for (const requerido of ["node_modules/.prisma/client", "node_modules/@prisma/adapter-pg", "node_modules/pg", "node_modules/pdfmake", "node_modules/exceljs"]) {
  if (!existsSync(join(standalone, requerido))) {
    abortar(`Falta ${requerido} en el standalone (revise serverExternalPackages en next.config.ts).`);
  }
}
console.log("  ok");

if (liberarEspacio) {
  paso("Liberando espacio: node_modules y .next/cache");
  rmSync(join(raiz, "node_modules"), { recursive: true, force: true });
  rmSync(join(raiz, ".next", "cache"), { recursive: true, force: true });
}

console.log("\n✓ Listo. Arranque con: node --max-old-space-size=320 scripts/iniciar-produccion.mjs\n");
