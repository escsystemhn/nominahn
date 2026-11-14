import { Prisma, type PrismaClient } from "@prisma/client";
import { palabrasDeBusqueda } from "@/lib/texto-busqueda";

/** El texto como patrón de LIKE: un «%» o un «_» que escriba la persona es literal. */
export function patronLike(palabra: string): string {
  return `%${palabra.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * Buscar empleados por lo que la persona recuerda. Cada palabra debe aparecer en algún
 * dato, en cualquier orden y sin importar las tildes: «ana mejia» encuentra a «Ana Lucía
 * Mejía Cruz». Prisma no sabe comparar sin tildes, y `translate` no necesita instalar
 * ninguna extensión en la base.
 *
 * `conIdentidad` sólo para quien puede ver ese dato: buscar por él le revelaría a los
 * demás el número que no se les muestra.
 */
export async function filtroBusquedaEmpleados(
  db: Pick<PrismaClient, "$queryRaw">,
  texto: string,
  { conIdentidad }: { conIdentidad: boolean }
): Promise<Prisma.EmpleadoWhereInput> {
  const palabras = palabrasDeBusqueda(texto);
  if (palabras.length === 0) return {};

  const datos = conIdentidad
    ? Prisma.sql`"primerNombre", "segundoNombre", "primerApellido", "segundoApellido", codigo, identidad`
    : Prisma.sql`"primerNombre", "segundoNombre", "primerApellido", "segundoApellido", codigo`;
  const condiciones = palabras.map(
    (p) => Prisma.sql`translate(lower(concat_ws(' ', ${datos})), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') LIKE ${patronLike(p)}`
  );
  const filas = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Empleado" WHERE ${Prisma.join(condiciones, " AND ")}`;
  return { id: { in: filas.map((f) => f.id) } };
}
