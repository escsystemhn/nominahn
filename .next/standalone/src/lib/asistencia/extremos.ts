/**
 * Deducción de la entrada y la salida del día a partir de marcas sueltas.
 *
 * Está en su propio módulo, sin tocar la base, por la misma razón que
 * `calculos-hn.ts`: es la regla que decide cuántas horas se pagan, y una regla
 * así tiene que poder probarse sin levantar PostgreSQL.
 *
 * POR QUÉ HACE FALTA DEDUCIRLO. ZKTeco no reporta el tipo de marca:
 * `getAttendances()` devuelve un timestamp pelado. Así que incluso con un único
 * turno diurno, decidir cuál marca es la entrada YA ES UNA INFERENCIA. Cuando el
 * equipo sí etiqueta (Hikvision en algunos modelos), se respeta su dato.
 */

export interface MarcaMinima {
  ocurridoEn: Date;
  tipo: "ENTRADA" | "SALIDA" | "DESCONOCIDO";
}

export function extremos(marcas: MarcaMinima[]): { entrada: Date | null; salida: Date | null } {
  // Los equipos no garantizan que el buffer venga cronológico.
  const orden = [...marcas].sort((a, b) => a.ocurridoEn.getTime() - b.ocurridoEn.getTime());

  const comoEntrada = orden.filter((m) => m.tipo === "ENTRADA");
  const comoSalida = orden.filter((m) => m.tipo === "SALIDA");

  const entrada = comoEntrada.length > 0 ? comoEntrada[0].ocurridoEn : orden[0]?.ocurridoEn ?? null;

  // Con una sola marca la salida queda en `null`, NO igualada a la entrada:
  // igualarlas daría una jornada de cero horas para alguien que sí trabajó. El
  // día se registra como incompleto y sale a revisión.
  const salida =
    comoSalida.length > 0
      ? comoSalida[comoSalida.length - 1].ocurridoEn
      : orden.length > 1
        ? orden[orden.length - 1].ocurridoEn
        : null;

  return { entrada, salida };
}
