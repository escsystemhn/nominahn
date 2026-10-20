/**
 * Siembra SÓLO el catálogo contable de ejemplo y el mapeo de conceptos, sin
 * tocar nada más (el seed completo reescribe tablas de ISR, vecinal y
 * configuración, que en una base en uso pueden tener valores propios).
 *
 * Idempotente: el catálogo sólo si está vacío; el mapeo sólo para conceptos sin
 * cuenta. Deja contados los resultados.
 *
 *   npx tsx prisma/ejemplos/sembrar-catalogo.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { prisma } = await import("../../src/lib/prisma");
  const { sembrarCatalogo } = await import("../../src/lib/payroll/plan-cuentas");

  const antes = { cuentas: await prisma.cuentaContable.count(), mapeos: await prisma.mapeoContable.count({ where: { cuentaId: { not: null } } }) };
  const r = await sembrarCatalogo(prisma);
  const despues = { cuentas: await prisma.cuentaContable.count(), mapeos: await prisma.mapeoContable.count({ where: { cuentaId: { not: null } } }) };

  console.log(`Catálogo: ${antes.cuentas} → ${despues.cuentas} cuentas (${r.cuentas} sembradas)`);
  console.log(`Mapeo:    ${antes.mapeos} → ${despues.mapeos} conceptos con cuenta (${r.mapeos} asignados ahora)`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
