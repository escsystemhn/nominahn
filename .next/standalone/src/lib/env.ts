/**
 * Validación de la configuración de entorno.
 *
 * POR QUÉ: si faltaba `AUTH_SECRET` o `DATABASE_URL`, la aplicación arrancaba
 * igual y fallaba más tarde, en la primera petición de un usuario real.
 * `prisma.ts` usaba `process.env.DATABASE_URL!` — esa aserción de no-nulo
 * silenciaba exactamente el caso que debería detener el despliegue.
 *
 * Aquí falla al ARRANCAR, con el detalle de qué falta y por qué importa.
 */

import { z } from "zod";

/**
 * `.env.example` trae `SMTP_USER=""`: una variable vacía debe contar como no
 * definida, no como un valor inválido que detiene el arranque en producción.
 */
const vacioEsIndefinido = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), s);

const esquema = z.object({
  DATABASE_URL: z.string().min(1, "requerida: cadena de conexión a PostgreSQL"),

  // next-auth v5 lee AUTH_SECRET y, por compatibilidad, NEXTAUTH_SECRET.
  NEXTAUTH_SECRET: z
    .string()
    .min(32, "debe tener al menos 32 caracteres — genera uno con crypto.randomBytes(32)"),

  // AUTH_URL fija el origen de los callbacks Y habilita trustHost. Sin ella, en
  // producción @auth/core deja trustHost en false y TODAS las rutas /api/auth
  // responden 500 (UntrustedHost).
  AUTH_URL: z.string().url("debe ser la URL pública real de la aplicación"),

  // Las fechas de planilla dependen de esto: ver la doctrina en lib/utils.ts.
  TZ: z.literal("America/Tegucigalpa", {
    error: 'debe ser "America/Tegucigalpa": las fechas de planilla dependen de ello',
  }),

  // OPCIONALES: el correo saliente se configura ahora en Configuración → Correo
  // saliente (tabla ConfiguracionCorreo). Estas variables quedan como respaldo
  // para las instalaciones que ya las usan; exigirlas impediría arrancar a quien
  // configure el correo desde la pantalla.
  SMTP_HOST: vacioEsIndefinido(z.string().min(1).optional()),
  SMTP_PORT: vacioEsIndefinido(z.coerce.number().int().positive().optional()),
  SMTP_USER: vacioEsIndefinido(z.string().min(1).optional()),
  SMTP_PASS: vacioEsIndefinido(z.string().min(1).optional()),
  SMTP_FROM: vacioEsIndefinido(z.string().min(1).optional()),

  // Se consumía en /api/cron/evaluaciones sin estar declarado. Funcionaba por
  // accidente (`null !== undefined` bloqueaba), pero un valor vacío lo habría
  // abierto de par en par.
  CRON_SECRET: z.string().min(24, "requerido y no adivinable: protege el endpoint de cron"),

  UPLOAD_DIR: z.string().min(1),
  MAX_FILE_SIZE: z.coerce.number().int().positive(),

  // Cifra las contraseñas guardadas en la base (correo saliente, SAP, relojes).
  // Sin ella la app arranca, pero esas pantallas fallan al guardar: en producción
  // se exige más abajo. BIOMETRICO_KEY es su nombre anterior.
  CIFRADO_KEY: vacioEsIndefinido(z.string().min(32, "debe tener al menos 32 caracteres").optional()),
  BIOMETRICO_KEY: vacioEsIndefinido(z.string().min(32, "debe tener al menos 32 caracteres").optional()),

  // Orígenes extra a los que se permite escribir en la API (ver lib/auth/origen.ts).
  // El de AUTH_URL ya está incluido; aquí van, separados por comas, p. ej. un
  // dominio propio mientras convive con el de Seenode.
  ORIGENES_PERMITIDOS: vacioEsIndefinido(
    z
      .string()
      .refine(
        (v) => v.split(",").map((s) => s.trim()).filter(Boolean).every((s) => URL.canParse(s)),
        "debe ser una lista de URL separadas por comas, p. ej. https://nomina.miempresa.hn"
      )
      .optional()
  ),
}).superRefine((e, ctx) => {
  if (process.env.NODE_ENV === "production" && !e.CIFRADO_KEY && !e.BIOMETRICO_KEY) {
    ctx.addIssue({
      code: "custom",
      path: ["CIFRADO_KEY"],
      message: "requerida en producción: sin ella no se pueden guardar las contraseñas de correo ni de SAP",
    });
  }
});

export type Entorno = z.infer<typeof esquema>;

/**
 * Valida el entorno y devuelve los valores tipados.
 *
 * En desarrollo avisa pero deja seguir, para no bloquear a quien acaba de clonar
 * el repositorio. En producción lanza: un despliegue mal configurado debe
 * detenerse antes de atender la primera petición, no a mitad de una planilla.
 */
export function validarEntorno(): Entorno | null {
  const parsed = esquema.safeParse(process.env);

  if (parsed.success) return parsed.data;

  const detalle = Object.entries(z.flattenError(parsed.error).fieldErrors)
    .map(([clave, errores]) => `  · ${clave}: ${errores?.join(", ")}`)
    .join("\n");
  const mensaje = `Configuración de entorno inválida:\n${detalle}\n\nRevisa .env.local contra .env.example.`;

  if (process.env.NODE_ENV === "production") throw new Error(mensaje);

  console.warn(`[env] ${mensaje}`);
  return null;
}

export const env = validarEntorno();
