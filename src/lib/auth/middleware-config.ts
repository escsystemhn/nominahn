import type { NextAuthConfig } from "next-auth";

/**
 * Duración de la sesión: 8 horas sin actividad, una jornada.
 *
 * next-auth trae 30 días por omisión, y con `strategy: "jwt"` una cookie robada
 * valía todo ese tiempo: la revalidación contra la base sólo la corta si la
 * cuenta se desactiva. El token se renueva al usarse, así que quien trabaja no
 * nota nada; el que se olvidó la sesión abierta en otro equipo, sí.
 *
 * Va aquí y no en config.ts porque el proxy también firma el token: si cada
 * lado tuviera su duración, el proxy lo reescribiría con la suya.
 */
export const SESION = { strategy: "jwt", maxAge: 8 * 60 * 60 } as const satisfies NextAuthConfig["session"];

// Config sin Prisma ni bcrypt — compatible con Edge runtime (middleware)
export const middlewareAuthConfig: NextAuthConfig = {
  providers: [],
  pages: { signIn: "/login", error: "/login" },
  session: SESION,
  callbacks: {
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
