/**
 * Retira los empleados de ejemplo que crea `organigrama-demo.csv`.
 *
 *   npx tsx prisma/ejemplos/quitar-organigrama-demo.ts
 *
 * Sólo toca los códigos EMP-90xx, que no colisionan con la numeración real
 * (EMP-0001, EMP-0002, …) que genera el sistema al dar de alta.
 *
 * QUÉ SE BORRA Y QUÉ NO. Se borran el empleado y su historial salarial, que no
 * tienen sentido sin él. NO se toca el registro de auditoría: es inmutable por
 * diseño (ver `prisma/sql/04-auditlog-inmutable.sql`) y debe conservar que la
 * importación ocurrió, aunque después se deshiciera. Un rastro que se puede
 * borrar no es un rastro.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/** Los códigos que produce el CSV de ejemplo. */
const PATRON_DEMO = "EMP-90";

async function main() {
  const demo = await prisma.empleado.findMany({
    where: { codigo: { startsWith: PATRON_DEMO } },
    select: { id: true, codigo: true, primerNombre: true, primerApellido: true },
  });

  if (demo.length === 0) {
    console.log("No hay empleados de ejemplo que retirar.");
    return;
  }

  console.log(`Se retirarán ${demo.length} empleado(s) de ejemplo:`);
  for (const e of demo) console.log(`  ${e.codigo} · ${e.primerNombre} ${e.primerApellido}`);

  const ids = demo.map((e) => e.id);

  await prisma.$transaction(async (tx) => {
    // Primero se sueltan las referencias entre ellos: si uno es jefe de otro,
    // borrarlos en cualquier orden chocaría contra la clave foránea.
    await tx.empleado.updateMany({ where: { id: { in: ids } }, data: { supervisorId: null } });
    // Y también las de empleados REALES que hubieran quedado colgando de uno.
    await tx.empleado.updateMany({ where: { supervisorId: { in: ids } }, data: { supervisorId: null } });

    await tx.historialSalario.deleteMany({ where: { empleadoId: { in: ids } } });
    await tx.deduccionEmpleado.deleteMany({ where: { empleadoId: { in: ids } } });
    await tx.empleado.deleteMany({ where: { id: { in: ids } } });
  });

  console.log(`\n✓ Retirados. Compruebe el organigrama en /organigrama.`);
}

main()
  .catch((e) => {
    console.error("No se pudo completar:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
