/**
 * Arranque en producción del servidor standalone (Seenode).
 *
 *   node --max-old-space-size=320 scripts/iniciar-produccion.mjs
 *
 * Se llama así, con `node` y no con `npm run`, porque npm se queda vivo como
 * proceso padre y se lleva unos 50 MB de los 512 del plan Basic.
 *
 * PUERTO. Seenode no inyecta PORT: enruta al número que se escribe en el campo
 * «Port» del servicio. Use 3000 en los dos: con un puerto menor que 1024 un
 * proceso sin privilegios (lo normal en Kubernetes) no puede escuchar (EACCES).
 * Hay que declarar PORT en Envs con ese mismo valor; si falta, Next usaría su
 * puerto por omisión y, si no coincide con el campo, Seenode respondería 502
 * sin más explicación. Aquí se detiene con el motivo.
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
import { getHeapStatistics } from "node:v8";

/**
 * Todo por stdout. El primer despliegue en Seenode fallaba «sin imprimir nada»:
 * los errores de arranque (los de aquí y los de Next) salen por stderr, y su
 * panel de Runtime no los mostraba. Con esto cualquier fallo queda a la vista.
 */
process.stderr.write = process.stdout.write.bind(process.stdout);

function abortar(mensaje) {
  console.log(`[arranque] ${mensaje}`);
  process.exit(1);
}

const servidor = join(process.cwd(), ".next", "standalone", "server.js");
console.log(
  `[arranque] Node ${process.version} · cwd ${process.cwd()} · PORT=${process.env.PORT ?? "(sin definir)"} · ` +
    `uid ${process.getuid?.() ?? "-"} · heap máx. ${Math.round(getHeapStatistics().heap_size_limit / 1048576)} MB · ` +
    `server.js ${existsSync(servidor) ? "sí" : "NO"} · next ${existsSync(join(process.cwd(), ".next", "standalone", "node_modules", "next")) ? "sí" : "NO"}`
);
process.on("exit", (codigo) => {
  if (codigo !== 0) console.log(`[arranque] el proceso terminó con código ${codigo}`);
});

if (!existsSync(servidor)) {
  abortar("No existe .next/standalone/server.js: la compilación no corrió o no fue con `npm run build:prod`.");
}

const puerto = Number(process.env.PORT);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
  abortar(
    `PORT no es válido (${JSON.stringify(process.env.PORT ?? null)}). ` +
      "Defínalo en Envs con el mismo número que el campo «Port» del servicio en Seenode (se recomienda 3000)."
  );
}

process.env.HOSTNAME = "0.0.0.0";
process.env.NEXT_TELEMETRY_DISABLED = "1";

try {
  await import(pathToFileURL(servidor).href);
} catch (e) {
  abortar(`No se pudo cargar el servidor: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
}
