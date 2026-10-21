/**
 * Esquema y datos iniciales de la base de Seenode, desde este equipo.
 *
 * El despliegue NO toca la base: ni el build ni el arranque ejecutan `db push`
 * ni semillas. Esto se hace a mano, en tres pasos que se pueden repetir:
 *
 *   node scripts/preparar-bd-remota.mjs revisar   # sólo lee: muestra el SQL pendiente
 *   node scripts/preparar-bd-remota.mjs aplicar   # db push + índices y triggers
 *   node scripts/preparar-bd-remota.mjs sembrar <instalacion|demo|demo-con-datos>
 *
 * La URL va en DATABASE_URL_REMOTA (la «externa» de la pestaña Connection de la
 * base en Seenode), NUNCA en .env.local. Prisma y las semillas cargan .env.local,
 * que apunta a la base real de desarrollo: si este script dependiera de que
 * alguien exportara DATABASE_URL, un olvido bastaría para escribir en ella. Por
 * eso además se niega a trabajar contra localhost.
 *
 * `aplicar` y `sembrar` piden escribir el nombre de la base para confirmar.
 * `db push` va SIN --accept-data-loss: si un cambio de esquema borrara datos,
 * Prisma se detiene y no aplica nada. Al terminar bien, `aplicar` deja la
 * huella del esquema en prisma/esquema-aplicado.txt, que el workflow exige
 * antes de desplegar (ver scripts/huella-esquema.mjs).
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { ARCHIVO_HUELLA, huellaEsquema, huellaRegistrada, registrarHuella } from "./huella-esquema.mjs";

const raiz = process.cwd();
const [accion, modoSiembra] = process.argv.slice(2);

function abortar(mensaje) {
  console.error(`\n✗ ${mensaje}\n`);
  process.exit(1);
}

const remota = process.env.DATABASE_URL_REMOTA?.trim();
if (!remota) {
  abortar(
    "Falta DATABASE_URL_REMOTA. En PowerShell:\n" +
      // Comillas simples: en PowerShell las dobles expanden cualquier `$` de la clave.
      "    $env:DATABASE_URL_REMOTA = 'postgres://usuario:clave@host-externo:puerto/base'\n" +
      "  Cópiela de la pestaña Connection de la base en Seenode (formato URI)."
  );
}

let url;
try {
  url = new URL(remota);
} catch {
  abortar("DATABASE_URL_REMOTA no es una URL válida (postgres://usuario:clave@host:puerto/base).");
}
if (!["postgres:", "postgresql:"].includes(url.protocol)) abortar("DATABASE_URL_REMOTA debe empezar por postgres:// o postgresql://.");

const host = url.hostname.replace(/^\[|\]$/g, "");
if (/^(localhost|127\.|0\.0\.0\.0$|::1$|host\.docker\.internal$)/i.test(host)) {
  abortar(`DATABASE_URL_REMOTA apunta a este equipo (${host}). Este script es sólo para la base de Seenode.`);
}

const base = decodeURIComponent(url.pathname.replace(/^\//, ""));
const visible = `${url.protocol}//${decodeURIComponent(url.username)}:****@${url.host}/${base}`;

// Todo lo que se lanza desde aquí ve la base remota como DATABASE_URL, que pesa
// más que la de .env.local (dotenv no sobrescribe variables ya definidas).
const entorno = { ...process.env, DATABASE_URL: remota, TZ: "America/Tegucigalpa" };

function ejecutar(rutaCli, args, envExtra = {}) {
  const r = spawnSync(process.execPath, [join(raiz, rutaCli), ...args], {
    cwd: raiz,
    stdio: "inherit",
    env: { ...entorno, ...envExtra },
  });
  if (r.status !== 0) abortar(`Falló: ${rutaCli} ${args.join(" ")}`);
}

const prisma = (...args) => ejecutar("node_modules/prisma/build/index.js", args);
const tsx = (archivo, envExtra) => ejecutar("node_modules/tsx/dist/cli.mjs", [archivo], envExtra);

async function confirmar(queHara) {
  console.log(`\n  Base de destino: ${visible}`);
  console.log(`  Se va a: ${queHara}\n`);
  if (!process.stdin.isTTY) abortar("Hace falta una terminal interactiva para confirmar.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const respuesta = (await rl.question(`  Escriba el nombre de la base (${base}) para continuar: `)).trim();
  rl.close();
  if (respuesta !== base) abortar("No coincide. No se hizo nada.");
}

console.log(`\nNominaHN — base remota: ${visible}`);

switch (accion) {
  case "revisar": {
    console.log("\nSQL que `aplicar` ejecutaría (vacío = la base ya está al día):\n");
    prisma("migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script");
    console.log(
      "\nRevise que no haya DROP TABLE ni DROP COLUMN. Los DROP INDEX de índices parciales son\n" +
        "normales: `aplicar` los vuelve a crear con prisma/sql/ justo después.\n"
    );
    const registrada = huellaRegistrada(raiz);
    console.log(
      registrada === null
        ? `${ARCHIVO_HUELLA}: no existe todavía (el workflow sólo avisa hasta el primer \`aplicar\`).\n`
        : registrada === huellaEsquema(raiz)
          ? `${ARCHIVO_HUELLA}: coincide con el esquema actual; el workflow dejará desplegar.\n`
          : `${ARCHIVO_HUELLA}: NO coincide con el esquema actual; el workflow detendrá el despliegue hasta \`aplicar\`.\n`
    );
    break;
  }

  case "aplicar": {
    await confirmar("sincronizar el esquema (prisma db push, sin aceptar pérdida de datos) y crear índices y triggers");
    prisma("db", "push");
    tsx("prisma/sql/apply.ts");
    // Sólo se registra si los dos pasos terminaron bien: `ejecutar` aborta en
    // cuanto uno falla, y entonces la huella vieja sigue frenando el despliegue.
    registrarHuella(raiz);
    console.log(
      `\n✓ Esquema aplicado. Huella guardada en ${ARCHIVO_HUELLA}.\n` +
        "  Súbela con el cambio de esquema; sin ella el workflow no despliega:\n" +
        `    git add ${ARCHIVO_HUELLA}\n` +
        '    git commit -m "Esquema aplicado en Seenode"\n' +
        "    git push\n"
    );
    break;
  }

  case "sembrar": {
    // Prisma 7 no genera el cliente al instalar ni con `db push`: en un clon
    // recién hecho las semillas fallarían con «Cannot find module .prisma/client».
    // Va después de confirmar, para que nada se adelante a la pregunta.
    const generarCliente = () => prisma("generate");
    if (modoSiembra === "instalacion") {
      for (const v of ["SEED_ADMIN_EMAIL", "SEED_ADMIN_PASSWORD"]) {
        if (!process.env[v]) abortar(`El modo instalacion necesita ${v} (y opcionalmente SEED_EMPRESA_NOMBRE).`);
      }
      await confirmar("crear catálogos, perfiles y UNA cuenta de administrador (sin cuentas de demostración)");
      generarCliente();
      tsx("prisma/seed.ts", { SEED_INSTALACION: "1" });
    } else if (modoSiembra === "demo" || modoSiembra === "demo-con-datos") {
      // Las cuentas de demostración llevan por omisión Admin1234!, que está
      // publicada: en una URL de internet eso es una puerta abierta.
      if (!process.env.SEED_DEMO_PASSWORD) {
        abortar("El modo demo necesita SEED_DEMO_PASSWORD: en internet no se siembra la clave publicada Admin1234!.");
      }
      const extra = modoSiembra === "demo-con-datos" ? " y los datos de prueba de la sucursal SPS (16 empleados, planillas)" : "";
      await confirmar(`crear la empresa de ejemplo con cuentas de demostración${extra}`);
      generarCliente();
      tsx("prisma/seed.ts", { SEED_INSTALACION: "" });
      if (modoSiembra === "demo-con-datos") tsx("prisma/seed-pruebas.ts");
    } else {
      abortar("Indique el modo: sembrar instalacion | demo | demo-con-datos");
    }
    console.log("\n✓ Siembra terminada.\n");
    break;
  }

  default:
    abortar("Uso: node scripts/preparar-bd-remota.mjs <revisar | aplicar | sembrar instalacion|demo|demo-con-datos>");
}
