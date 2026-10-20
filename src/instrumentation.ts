/**
 * Arranque del servidor: valida la configuración antes de la primera petición.
 *
 * `lib/env.ts` ya lanzaba en producción, pero sólo cuando algún módulo lo
 * importaba, es decir, en la primera petición que tocaba la base. El proceso
 * quedaba vivo y respondía 500 a todo, y en un panel como el de Seenode eso se
 * ve como «Deploy is live» con la app rota. Ver instrumentation-node.ts.
 *
 * Next llama a `register` una vez al iniciar el servidor (también en `next dev`,
 * donde env.ts sólo avisa y deja seguir). El import va aparte porque este
 * archivo también se compila para el runtime Edge, que no tiene `process.exit`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
