/**
 * Validación de entrada para las rutas API.
 *
 * Antes, la mayoría de rutas hacían `const { x } = await req.json()` y usaban los
 * campos sin comprobar nada. `parseFloat(undefined)` es `NaN`, y un `NaN` escrito
 * como salario o como monto de deducción corrompe datos en silencio (p. ej. el
 * aumento colectivo podía poner `NaN` en el salario de los 200 empleados a la vez).
 *
 * `parsearBody` centraliza el patrón: parsea, valida contra un esquema Zod y, si
 * algo falla, devuelve un 400 con el detalle por campo. Las primitivas de abajo
 * (`zMonto`, `zPorcentaje`, `zFecha`, …) codifican las reglas que impedían esos
 * `NaN`/fechas inválidas y están cubiertas por tests.
 */

import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";

export type ResultadoBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

/**
 * Parsea y valida el cuerpo JSON de una petición.
 * En caso de error devuelve un `response` 400 listo para retornar.
 */
export async function parsearBody<T>(req: Request, schema: ZodType<T>): Promise<ResultadoBody<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Cuerpo JSON inválido" }, { status: 400 }) };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Datos inválidos", detalles: z.flattenError(parsed.error).fieldErrors },
        { status: 400 }
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

// ─── PRIMITIVAS REUTILIZABLES ─────────────────────────────────────────────────

/** Identificador (cuid de Prisma). No vacío. */
export const zId = z.string().trim().min(1, "requerido");

/**
 * Identificador OPCIONAL que llega de un `<select>` con una opción «Todas»: «»,
 * `null` y no mandarlo valen lo mismo. Sale siempre como `string | null`.
 * Existe porque `zId.optional().nullable()` rechazaba el «» de esos selects con
 * un 400 (así fallaba «Nueva planilla» con «Todas las sucursales»).
 */
export const zIdOpcional = z.preprocess(
  (v) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v),
  z.string().trim().min(1).nullable()
);

/**
 * Convierte a número para validar. CLAVE: vacío/null/undefined → `NaN`, no `0`.
 * `z.coerce.number("")` daría 0 y colaría un campo faltante como cero; aquí un
 * campo faltante falla la validación en vez de convertirse en dinero silencioso.
 */
function aNumero(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim() !== "") return Number(raw);
  return NaN; // "", null, undefined, objetos → NaN → falla el refine de abajo
}

const numeroFinito = (msg: string) =>
  z.preprocess(aNumero, z.number().refine(Number.isFinite, msg));

/**
 * Importe monetario. Acepta número o string numérico (el frontend manda strings
 * desde los inputs), pero RECHAZA vacío, `NaN` e infinito — que es justo lo que
 * `parseFloat` dejaba pasar. No negativo por defecto.
 */
export const zMonto = numeroFinito("monto inválido").refine((n) => n >= 0, "no puede ser negativo");

/** Importe estrictamente positivo (para montos que no tienen sentido en cero). */
export const zMontoPositivo = numeroFinito("monto inválido").refine((n) => n > 0, "debe ser mayor que cero");

/** Porcentaje 0–100 (aumentos, tasas expresadas en puntos porcentuales). */
export const zPorcentaje = numeroFinito("porcentaje inválido").refine(
  (n) => n >= 0 && n <= 100,
  "fuera de rango 0–100"
);

/** Fracción 0–1 (tasas guardadas como 0.025 = 2.5%, p. ej. IHSS/RAP). */
export const zFraccion = numeroFinito("valor inválido").refine((n) => n >= 0 && n <= 1, "fuera de rango 0–1");

/** Fecha. Coacciona ISO string → Date y rechaza fechas inválidas. */
export const zFecha = z.coerce.date({ error: "fecha inválida" });

/**
 * Monto OPCIONAL Y BORRABLE para columnas anulables (p. ej. el IHSS fijo de un
 * empleado). Vacío o `null` → `null`, que borra el valor; si viene, debe ser un
 * monto válido. Sin el paso de "" a `null`, `zMonto` lo convertiría en `NaN` y
 * el formulario no tendría forma de volver al cálculo normal.
 */
export const zMontoAnulable = z
  .preprocess((v) => (v === "" ? null : v), z.union([z.null(), zMonto]))
  .optional();

/**
 * Correo OPCIONAL Y BORRABLE. Vacío → `null`; si viene, se valida y se guarda en
 * minúsculas, porque un comprobante enviado a una dirección mal escrita no
 * rebota en pantalla: simplemente no llega.
 */
export const zCorreoOpcional = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.union([z.null(), z.string().trim().toLowerCase().email("correo inválido").max(255)])
  )
  .optional();

/** Entero no negativo (cuotas, días, etc.). */
export const zEnteroNoNeg = numeroFinito("número inválido")
  .refine((n) => Number.isInteger(n), "debe ser entero")
  .refine((n) => n >= 0, "no puede ser negativo");
