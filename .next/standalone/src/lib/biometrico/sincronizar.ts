/**
 * Ciclo completo de sincronización de un dispositivo.
 *
 *   driver.leerEventos → normalizar → guardar crudos → agregar a jornadas
 *
 * La idempotencia NO se resuelve aquí sino en la base: `MarcajeEvento` tiene una
 * clave única `(dispositivoId, pin, ocurridoEn)` y la inserción usa
 * `skipDuplicates`. Por eso releer todo el buffer del reloj es inofensivo —
 * importa para el volumen, no para la corrección— y por eso una sincronización
 * interrumpida a la mitad se puede repetir sin limpiar nada.
 */

import { prisma } from "@/lib/prisma";
import { driverPara } from "./driver";
import { normalizarLote } from "./normalizar";
import { agregarEventosPendientes, type ResumenAgregacion } from "@/lib/asistencia/agregar";
import type { DispositivoBiometrico } from "@prisma/client";

export interface ResumenSync {
  dispositivo: string;
  eventosLeidos: number;
  eventosNuevos: number;
  enCuarentena: number;
  agregacion: ResumenAgregacion;
}

/** PIN → empleadoId para un dispositivo concreto. */
async function pinesDe(dispositivoId: string): Promise<Map<string, string>> {
  const pines = await prisma.empleadoPin.findMany({
    where: { dispositivoId },
    select: { pin: true, empleadoId: true },
  });
  return new Map(pines.map((p) => [p.pin, p.empleadoId]));
}

export async function sincronizarDispositivo(
  dispositivo: DispositivoBiometrico
): Promise<ResumenSync> {
  const driver = driverPara(dispositivo);

  const crudos = await driver.leerEventos(dispositivo.ultimoEventoEn);
  const normalizados = normalizarLote({
    dispositivoId: dispositivo.id,
    offsetMinutos: dispositivo.offsetMinutos,
    eventos: crudos,
    pinesConocidos: await pinesDe(dispositivo.id),
  });

  const insercion = await prisma.marcajeEvento.createMany({
    data: normalizados.map((e) => ({
      dispositivoId: e.dispositivoId,
      pin: e.pin,
      empleadoId: e.empleadoId,
      ocurridoEn: e.ocurridoEn,
      fechaLocal: e.fechaLocal,
      tipo: e.tipo,
      estado: e.estado,
      verificacion: e.verificacion,
      crudo: e.crudo === null ? undefined : (e.crudo as object),
    })),
    skipDuplicates: true,
  });

  // La marca de agua sólo avanza hasta el evento más nuevo REALMENTE ingerido.
  // Avanzarla al reloj del servidor perdería las marcas que el equipo aún no
  // había volcado cuando respondió.
  const masNuevo = normalizados.reduce<Date | null>(
    (max, e) => (max === null || e.ocurridoEn > max ? e.ocurridoEn : max),
    null
  );

  await prisma.dispositivoBiometrico.update({
    where: { id: dispositivo.id },
    data: {
      ultimaSync: new Date(),
      ...(masNuevo && (!dispositivo.ultimoEventoEn || masNuevo > dispositivo.ultimoEventoEn)
        ? { ultimoEventoEn: masNuevo }
        : {}),
    },
  });

  return {
    dispositivo: dispositivo.nombre,
    eventosLeidos: crudos.length,
    eventosNuevos: insercion.count,
    enCuarentena: normalizados.filter((e) => e.estado === "CUARENTENA").length,
    agregacion: await agregarEventosPendientes(),
  };
}
