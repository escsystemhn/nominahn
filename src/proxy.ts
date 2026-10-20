import NextAuth from "next-auth";
import { middlewareAuthConfig } from "@/lib/auth/middleware-config";
import { EDICION_INSTALABLE } from "@/lib/licencia/edicion";
import { origenAceptado, origenesPermitidos } from "@/lib/auth/origen";

const { auth } = NextAuth(middlewareAuthConfig);

const ORIGENES_PERMITIDOS = origenesPermitidos(process.env.ORIGENES_PERMITIDOS, process.env.AUTH_URL);

/**
 * Lo único que sigue abierto con la licencia bloqueada: entrar, ver el estado y
 * activar. Todo lo demás —páginas, API, portal público y crons— se detiene.
 *
 * `/mi-cuenta` va aquí porque una contraseña temporal encierra la cuenta en esa
 * pantalla (más abajo): si la licencia la mandara a /licencia y la contraseña de
 * vuelta a /mi-cuenta, el navegador quedaría rebotando entre las dos.
 */
const SIEMPRE_ABIERTO = [
  "/licencia", "/api/licencia", "/login", "/api/auth", "/api/estado", "/mi-cuenta", "/api/mi-cuenta/password",
];

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;

  // CSRF: un navegador ajeno no puede provocar escrituras. Ver lib/auth/origen.ts.
  if (
    pathname.startsWith("/api") &&
    !origenAceptado({
      metodo: req.method,
      origen: req.headers.get("origin"),
      host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
      permitidos: ORIGENES_PERMITIDOS,
    })
  ) {
    return Response.json(
      { error: "Origen no permitido", codigo: "ORIGEN_NO_PERMITIDO" },
      { status: 403, headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  }

  /**
   * Licencia de la edición instalable (evaluación de 30 días o licencia de SDL).
   *
   * Va en el proxy y no en cada ruta para que no haya forma de olvidarla al
   * añadir una pantalla. `EDICION_INSTALABLE` se fija al compilar: en el `next
   * dev` y en el VPS es false y el módulo ni se carga. Un fallo al consultar NO
   * bloquea: el estado «indeterminado» (base caída) deja seguir, y la propia
   * página dará su error de base de datos.
   */
  if (EDICION_INSTALABLE && !SIEMPRE_ABIERTO.some((p) => pathname.startsWith(p))) {
    const { estadoLicencia } = await import("@/lib/licencia/estado");
    const estado = await estadoLicencia().catch(() => null);
    if (estado?.modo === "bloqueada") {
      if (pathname.startsWith("/api")) {
        return Response.json(
          { error: estado.mensaje, codigo: "LICENCIA_BLOQUEADA" },
          { status: 402, headers: { "Cache-Control": "private, no-store, max-age=0" } }
        );
      }
      return Response.redirect(new URL("/licencia", req.url));
    }
  }

  // /empleos y /api/empleos: portal público de vacantes. Sólo muestra las
  // publicadas a propósito y la postulación se defiende sola (ver su ruta).
  //
  // /api/cron: los llama una tarea programada, sin sesión. Cada ruta exige el
  // encabezado x-cron-secret (ver cobertura-rutas.test.ts). Sin esta entrada el
  // proxy los mandaba al login con un 302 y ningún cron llegaba a ejecutarse.
  const publicPrefixes = [
    "/login", "/evaluar", "/api/evaluar", "/api/auth", "/api/estado", "/empleos", "/api/empleos", "/api/cron/",
  ];
  const isPublic =
    publicPrefixes.some((p) => pathname.startsWith(p)) ||
    pathname === "/";

  if (!isLoggedIn && !isPublic) {
    return Response.redirect(new URL("/login", req.url));
  }

  if (isLoggedIn && pathname === "/login") {
    return Response.redirect(new URL("/dashboard", req.url));
  }

  /**
   * Contraseña temporal: la cuenta queda encerrada en /mi-cuenta.
   *
   * Una clave temporal la fija otra persona, así que hay una ventana en la que
   * dos personas pueden entrar con ella y nada de lo que haga la cuenta es
   * atribuible a su titular. Se cierra obligando a cambiarla antes de tocar el
   * sistema, no con un aviso que se puede ignorar.
   *
   * SÓLO SE REDIRIGEN PÁGINAS. Las rutas API siguen su curso hasta la guardia,
   * que responde un 403 con el código `PASSWORD_TEMPORAL`: un `Response.redirect`
   * contra un `fetch` daría un HTML donde el cliente espera JSON.
   */
  if (isLoggedIn && req.auth?.user?.debeCambiarPassword) {
    const esApi = pathname.startsWith("/api");
    const yaEstaEnSuCuenta = pathname === "/mi-cuenta";
    if (!esApi && !yaEstaEnSuCuenta) {
      return Response.redirect(new URL("/mi-cuenta", req.url));
    }
  }
});

/**
 * Qué NO pasa por esta comprobación.
 *
 * El `public` que había aquí no excluía nada: los archivos de `public/` se
 * sirven desde la RAÍZ (`/logo.png`), no bajo `/public/logo.png`, así que la
 * petición entraba al middleware y se iba redirigida a `/login`. Estuvo latente
 * mientras la aplicación sólo usaba SVG en línea y el favicon —que sí estaba
 * excluido—, y salió a la luz al añadir el logo: el optimizador de imágenes de
 * Next pide el archivo con una petición propia SIN la cookie de sesión, recibía
 * el HTML del login y respondía 400 «isn't a valid image» en todas las páginas.
 *
 * Se sustituye por las extensiones estáticas, y sólo en la raíz: `[^/]+` impide
 * que la exención alcance rutas con subcarpetas como `/api/uploads/<archivo>`,
 * que deben seguir pasando por aquí porque sirven documentos privados.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|[^/]+\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|woff|woff2|ttf)$).*)",
  ],
};
