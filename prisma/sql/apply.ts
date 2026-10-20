/**
 * Aplica los objetos de base de datos que Prisma no puede declarar en el schema:
 * índices parciales y triggers de integridad.
 *
 * IMPORTANTE — este proyecto usa `prisma db push`, que sincroniza la base contra
 * el schema y en el camino puede ELIMINAR índices que no reconoce. Por eso hay
 * que ejecutar este script DESPUÉS de cada push:
 *
 *     npm run db:push && npm run db:constraints
 *
 * Los scripts son idempotentes (IF NOT EXISTS / CREATE OR REPLACE / DROP
 * TRIGGER IF EXISTS), así que puede ejecutarse cuantas veces haga falta.
 */

import { readdir, readFile } from "fs/promises";
import path from "path";
import { Client } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const dir = path.join(process.cwd(), "prisma", "sql");
  const archivos = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  if (archivos.length === 0) {
    console.log("No hay scripts .sql que aplicar.");
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    for (const archivo of archivos) {
      const sql = await readFile(path.join(dir, archivo), "utf8");
      process.stdout.write(`  ${archivo} … `);
      // Cada script va en su propia transacción: si uno falla, no deja a medias
      // los objetos que ya había creado.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
        console.log("ok");
      } catch (e) {
        await client.query("ROLLBACK");
        console.log("FALLÓ");
        throw e;
      }
    }
    console.log(`\n${archivos.length} script(s) aplicados correctamente.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
