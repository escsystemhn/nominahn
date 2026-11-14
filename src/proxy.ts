import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { configMiddleware } from "@/lib/auth/middleware-config";
import { RUTA_LATIDO } from "@/lib/auth/inactividad";
import { EDICION_INSTALABLE } from "@/lib/licencia/edicion";
import { origenAceptado, origenesPermitidos } from "@/lib/auth/origen";

// Dos instancias con la misma clave: sólo la del latido marca actividad en el token.
// (La configuración «perezosa» por petición de next-auth devuelve una promesa en vez
// de la función del proxy, y Next la rechaza: por eso no se usa.)
const { auth } = NextAuth(configMiddleware(false));
const { auth: authLatido } = NextAuth(configMiddleware(true));

const SIN_CACHE = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * Una API sin sesión responde 401 en JSON, no la página del login: antes el `fetch`
 * de una pantalla abierta recibía el HTML del login, no lo podía leer y la pantalla
 * quedaba como trabada, sin decir que la sesión había terminado.
 */
const sesionTerminada = () =>
  Response.json({ error: "Su sesión terminó. Vuelva a ingresar.", codigo: "SESION_VENCIDA" }, { status: 401, headers: SIN_CACHE });

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

const esOrigenAceptado = (req: NextRequest) =>
  origenAceptado({
    metodo: req.method,
    origen: req.headers.get("origin"),
    host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
    permitidos: ORIGENES_PERMITIDOS,
  });

/**
 * Latido del navegador: hubo actividad de la persona. Lo responde el proxy con la
 * instancia que marca la actividad en el token; al no haber una ruta detrás, ninguna
 * otra respuesta lo pisa con un token viejo.
 */
const proxyLatido = authLatido(async (req) => {
  if (!esOrigenAceptado(req)) {
    return Response.json({ error: "Origen no permitido", codigo: "ORIGEN_NO_PERMITIDO" }, { status: 403, headers: SIN_CACHE });
  }
  return req.auth ? new Response(null, { status: 204, headers: SIN_CACHE }) : sesionTerminada();
});

const proxyNormal = auth(async (req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;

  // Credenciales en la dirección: el login enviado como formulario HTML, sin
  // JavaScript, deja `/login?email=…&password=…`. Esa petición ya llegó, pero la
  // dirección no se queda en la barra ni en lo que se abra después desde el
  // historial o un marcador. El login no lee ninguno de los dos parámetros.
  if (pathname === "/login" && (req.nextUrl.searchParams.has("password") || req.nextUrl.searchParams.has("email"))) {
    const limpia = new URL(req.url);
    limpia.searchParams.delete("password");
    limpia.searchParams.delete("email");
    return Response.redirect(limpia, 303);
  }

  // CSRF: un navegador ajeno no puede provocar escrituras. Ver lib/auth/origen.ts.
  if (pathname.startsWith("/api") && !esOrigenAceptado(req)) {
    return Response.json(
      { error: "Origen no permitido", codigo: "ORIGEN_NO_PERMITIDO" },
      { status: 403, headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  }

  // El latido sólo existe como POST (ver `proxyLatido`).
  if (pathname === RUTA_LATIDO) return Response.json({ error: "Método no permitido" }, { status: 405, headers: SIN_CACHE });

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
    if (pathname.startsWith("/api")) return sesionTerminada();
    // Si traía cookie de sesión, la sesión terminó (inactividad o 8 horas): el login lo
    // dice, y después de entrar se vuelve a la misma página.
    const destino = new URL("/login", req.url);
    if (req.cookies.getAll().some((c) => c.name.includes("authjs.session-token"))) destino.searchParams.set("motivo", "sesion");
    if (req.method === "GET" && pathname !== "/dashboard") destino.searchParams.set("volver", pathname + req.nextUrl.search);
    return Response.redirect(destino);
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

/** El proxy: el latido por su instancia, todo lo demás por la normal. */
export default function proxy(req: NextRequest, evento: unknown) {
  const manejar = req.method === "POST" && req.nextUrl.pathname === RUTA_LATIDO ? proxyLatido : proxyNormal;
  return manejar(req, evento as never);
}

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
