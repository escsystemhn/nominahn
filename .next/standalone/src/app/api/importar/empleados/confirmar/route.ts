/**
 * Fase 2 de la importación de empleados: APLICAR.
 *
 * Toma un lote que ya pasó la validación y lo escribe. Tres garantías:
 *
 * · TODO O NADA. Una sola transacción. Un fallo en la fila 300 deshace las 299
 *   anteriores, porque media plantilla actualizada es peor que ninguna.
 *
 * · EL LOTE ES DE QUIEN LO SUBIÓ y no ha caducado ni se aplicó ya. Lo comprueba
 *   `tomarLote`, y es lo que impide que confirmar dos veces cobre dos veces.
 *
 * · QUEDA RASTRO de la operación completa y del historial salarial de cada
 *   empleado cuyo sueldo cambió.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { z } from "zod";
import { aplicar, ErrorCicloJerarquia, type FilaEmpleado } from "@/lib/importacion/empleados";
import { tomarLote, marcarAplicado } from "@/lib/importacion/lote";
import type { ResultadoImportacion } from "@/lib/importacion/tipos";

const schema = z.object({ loteId: zId });

/**
 * Margen para la transacción. El valor por omisión de Prisma (5 s) se queda
 * corto con miles de filas, y agotarlo aborta el lote entero a mitad de camino.
 */
const TIMEOUT_MS = 120_000;

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("empleados.importar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const tomado = await tomarLote(prisma, parsed.data.loteId, "EMPLEADOS", g.usuario.id);
  if (!tomado.ok) {
    return NextResponse.json({ error: tomado.motivo }, { status: tomado.codigo });
  }

  const filas = tomado.lote.filas as unknown as FilaEmpleado[];
  if (!Array.isArray(filas) || filas.length === 0) {
    return NextResponse.json({ error: "El lote no tiene filas que aplicar." }, { status: 409 });
  }

  let resultado;
  try {
    resultado = await prisma.$transaction(
      (tx) => aplicar(tx, filas, { id: g.usuario.id, email: g.usuario.email }),
      { timeout: TIMEOUT_MS, maxWait: 10_000 }
    );
  } catch (e) {
    // No se marca el lote como aplicado: nada se escribió, y el usuario puede
    // corregir y reintentar con el mismo archivo.

    // Un ciclo en la jerarquía no es un fallo del sistema sino del archivo, y el
    // mensaje ya dice qué línea y qué códigos revisar. Devolverlo como un 500
    // genérico obligaría a repasar las trescientas filas a mano.
    if (e instanceof ErrorCicloJerarquia) {
      return NextResponse.json(
        { error: e.message, codigo: "CICLO_JERARQUIA", linea: e.linea },
        { status: 422 }
      );
    }

    console.error("[importar/empleados] falló la transacción", e);
    return NextResponse.json(
      { error: "No se pudo aplicar la importación. No se guardó ningún cambio." },
      { status: 500 }
    );
  }

  await marcarAplicado(prisma, tomado.lote.id, resultado);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "IMPORT",
    tabla: "Empleado",
    registroId: tomado.lote.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      archivo: tomado.lote.nombreArchivo,
      creados: resultado.creados,
      actualizados: resultado.actualizados,
      // Los ids concretos permiten reconstruir qué tocó este lote sin tener que
      // cruzar marcas de tiempo.
      empleados: resultado.ids,
    },
    ip,
    userAgent,
  });

  const respuesta: ResultadoImportacion = {
    loteId: tomado.lote.id,
    creados: resultado.creados,
    actualizados: resultado.actualizados,
    omitidos: 0,
  };
  return NextResponse.json(respuesta);
}
