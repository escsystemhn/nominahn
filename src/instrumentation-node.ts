/**
 * Validación del entorno al arrancar, sólo en el runtime de Node.
 *
 * Si falta una variable crítica el proceso termina con el detalle, que es lo que
 * aparece en los logs de Runtime de Seenode, en vez de quedar vivo devolviendo
 * 500 a cada petición.
 */
export {};

try {
  await import("@/lib/env");
} catch (e) {
  console.error(`[arranque] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
