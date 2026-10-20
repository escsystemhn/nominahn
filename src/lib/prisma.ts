import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "@/lib/env"; // valida la configuración al cargar: falla al arrancar, no en la primera petición

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // El `!` anterior silenciaba justo el caso que debe detener el arranque.
    throw new Error("DATABASE_URL no está definida: revisa .env.local");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // El formato por omisión copia en el mensaje de error la llamada entera, con
    // sus argumentos: salarios, identidades y cuentas acababan en los logs del
    // proveedor (y en algún `e.message` que la API devuelve). En producción
    // basta el código y el modelo.
    errorFormat: process.env.NODE_ENV === "production" ? "minimal" : "pretty",
  });
}

/**
 * ¿El cliente cacheado conoce todos los modelos del cliente RECIÉN generado?
 *
 * EL PROBLEMA QUE RESUELVE. En desarrollo el cliente se guarda en `globalThis`
 * para que el hot reload no abra una conexión nueva en cada recarga. Pero ese
 * caché sobrevive también a `prisma generate`: al añadir un modelo al esquema, el
 * módulo se reimporta, encuentra la instancia VIEJA y la sigue usando. El
 * resultado es `prisma.modeloNuevo` → `undefined`, y en la pantalla un
 * «Cannot read properties of undefined (reading 'findMany')» que no menciona
 * Prisma por ningún lado ni sugiere que haya que reiniciar.
 *
 * `Prisma.ModelName` viene del cliente recién importado, así que basta con
 * comprobar que la instancia cacheada expone todos esos modelos. Si falta
 * alguno, está desfasada y se descarta.
 */
function clienteAlDia(cliente: PrismaClient): boolean {
  const cache = cliente as unknown as Record<string, unknown>;
  return Object.keys(Prisma.ModelName).every((modelo) => {
    // Prisma expone cada modelo con la inicial en minúscula: `CentroCosto` → `centroCosto`.
    const propiedad = modelo.charAt(0).toLowerCase() + modelo.slice(1);
    return cache[propiedad] !== undefined;
  });
}

function obtenerCliente(): PrismaClient {
  const cacheado = globalForPrisma.prisma;
  if (!cacheado) return createPrismaClient();

  if (clienteAlDia(cacheado)) return cacheado;

  // Desfasado: se sustituye y se cierra el pool anterior para no filtrar
  // conexiones en cada recarga. El aviso deja constancia de que ocurrió, porque
  // si se repite mucho es señal de que el flujo de desarrollo lo está forzando.
  console.warn(
    "[prisma] el cliente en memoria estaba desfasado respecto al esquema generado " +
      "(pasa al ejecutar `prisma generate` con el servidor levantado). Se ha recreado."
  );
  void cacheado.$disconnect().catch(() => {});
  return createPrismaClient();
}

export const prisma = obtenerCliente();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
