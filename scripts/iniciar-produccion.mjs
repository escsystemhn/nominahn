/**
 * Arranque en producción del servidor standalone (Seenode).
 *
 *   node --max-old-space-size=320 scripts/iniciar-produccion.mjs
 *
 * Se llama así, con `node` y no con `npm run`, porque npm se queda vivo como
 * proceso padre y se lleva unos 50 MB de los 512 del plan Basic.
 *
 * PUERTO. Seenode no inyecta PORT: enruta al número que se escribe en el campo
 * «Port» del servicio (80 por omisión). Hay que declarar PORT en Envs con ese
 * mismo valor; si falta, el servidor de Next escucharía en 3000 y Seenode
 * respondería 502 sin más explicación. Aquí se detiene con el motivo.
 *
 * HOSTNAME. Los contenedores definen HOSTNAME con su propio nombre, y el
 * servidor standalone lo usa como dirección de escucha: atendería sólo en esa
 * interfaz. Seenode exige 0.0.0.0, así que se fija aquí.
 *
 * El resto de la configuración la valida src/instrumentation.ts al arrancar.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function abortar(mensaje) {
  console.error(`[arranque] ${mensaje}`);
  process.exit(1);
}

const servidor = join(process.cwd(), ".next", "standalone", "server.js");
if (!existsSync(servidor)) {
  abortar("No existe .next/standalone/server.js: la compilación no corrió o no fue con `npm run build:prod`.");
}

const puerto = Number(process.env.PORT);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
  abortar(
    `PORT no es válido (${JSON.stringify(process.env.PORT ?? null)}). ` +
      "Defínalo en Envs con el mismo número que el campo «Port» del servicio en Seenode (80 por omisión)."
  );
}

process.env.HOSTNAME = "0.0.0.0";
process.env.NEXT_TELEMETRY_DISABLED = "1";

await import(pathToFileURL(servidor).href);
