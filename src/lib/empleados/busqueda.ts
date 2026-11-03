import type { Prisma } from "@prisma/client";

/** Más palabras que esto no afinan la búsqueda: sólo hacen más larga la consulta. */
const MAX_PALABRAS = 6;

/**
 * Buscar empleados por lo que la persona recuerda. Cada palabra debe aparecer en
 * algún dato, en cualquier orden: «Ana Mejía» encuentra a «Ana Lucía Mejía Cruz», cosa
 * que no pasaba al buscar el texto entero dentro de cada columna.
 *
 * `conIdentidad` sólo para quien puede ver ese dato: buscar por él le revelaría a los
 * demás el número que no se les muestra.
 */
export function filtroBusquedaEmpleados(texto: string, { conIdentidad }: { conIdentidad: boolean }): Prisma.EmpleadoWhereInput {
  const palabras = texto.trim().split(/\s+/).filter(Boolean).slice(0, MAX_PALABRAS);
  if (palabras.length === 0) return {};

  return {
    AND: palabras.map((p) => {
      const contiene = { contains: p, mode: "insensitive" as const };
      return {
        OR: [
          { primerNombre: contiene },
          { segundoNombre: contiene },
          { primerApellido: contiene },
          { segundoApellido: contiene },
          { codigo: contiene },
          ...(conIdentidad ? [{ identidad: contiene }] : []),
        ],
      };
    }),
  };
}
