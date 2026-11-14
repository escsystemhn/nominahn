import type { NextAuthConfig } from "next-auth";
import { vencidaPorInactividad } from "./inactividad";

/**
 * Duración de la sesión: 8 horas sin actividad, una jornada.
 *
 * next-auth trae 30 días por omisión, y con `strategy: "jwt"` una cookie robada
 * valía todo ese tiempo: la revalidación contra la base sólo la corta si la
 * cuenta se desactiva. El token se renueva al usarse, así que quien trabaja no
 * nota nada; el que se olvidó la sesión abierta en otro equipo, sí.
 *
 * Además, el cierre por inactividad (minutos configurables, ver `inactividad.ts`)
 * corta antes: esas 8 horas son el techo.
 *
 * Va aquí y no en config.ts porque el proxy también firma el token: si cada
 * lado tuviera su duración, el proxy lo reescribiría con la suya.
 */
export const SESION = { strategy: "jwt", maxAge: 8 * 60 * 60 } as const satisfies NextAuthConfig["session"];

/**
 * Config del proxy, sin Prisma ni bcrypt (Edge runtime).
 *
 * `esLatido`: la petición es el latido del navegador, la ÚNICA que cuenta como
 * actividad. El proxy la responde él mismo (ver proxy.ts), así que el token que
 * firma aquí, con la actividad al día, es el único que vuelve al navegador.
 */
export function configMiddleware(esLatido: boolean): NextAuthConfig {
  return {
    providers: [],
    pages: { signIn: "/login", error: "/login" },
    session: SESION,
    callbacks: {
      /**
       * Inactividad: pasado el límite el token se descarta y la cookie se borra, aunque
       * la pestaña siga abierta. Un token anterior a esta regla empieza a contar ahora.
       */
      async jwt({ token }) {
        const ahora = Date.now();
        if (typeof token.actividadEn !== "number") {
          token.actividadEn = ahora;
          return token;
        }
        if (vencidaPorInactividad(token, ahora)) return null;
        if (esLatido) token.actividadEn = ahora;
        return token;
      },
      /**
       * Copia al `session` del middleware lo ÚNICO que este necesita decidir:
       * si la cuenta arrastra una contraseña temporal.
       *
       * Sin este callback, `req.auth.user` sólo trae nombre, correo e imagen —el
       * mapeo por omisión de next-auth—, y el middleware no podría distinguir una
       * cuenta bloqueada de una normal. Los permisos NO se copian a propósito: el
       * middleware no autoriza, sólo separa lo público de lo privado; quien decide
       * el acceso es la guardia de cada ruta.
       */
      async session({ session, token }) {
        if (session.user) session.user.debeCambiarPassword = token.debeCambiarPassword === true;
        return session;
      },
    },
  };
}

/** La config del proxy para cualquier petición que no es el latido. */
export const middlewareAuthConfig: NextAuthConfig = configMiddleware(false);
