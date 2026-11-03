"use client";

/**
 * Lo que comparten el alta y la edición de un empleado. El formulario va en dos
 * pestañas y una pestaña oculta no enseña sus errores: por eso cada una lleva la
 * cuenta de los suyos, y al intentar guardar se abre la que tiene el primero.
 */

import type { FieldErrors, FieldValues } from "react-hook-form";

export const fieldClass =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "block text-sm font-medium text-gray-700 mb-1";
const errorClass = "text-xs text-red-700 mt-0.5";

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block">
        <span className={labelClass}>{label}</span>
        {children}
      </label>
      {hint && !error && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

export type PestanaFicha = "personal" | "laboral";

const PERSONALES = new Set([
  "primerNombre", "segundoNombre", "primerApellido", "segundoApellido", "fechaNacimiento", "genero", "estadoCivil",
  "nacionalidad", "identidad", "rtn", "ihssNro", "rapNro", "telefonoPersonal", "emailPersonal", "emailCorporativo",
  "contactoEmergencia", "telefonoEmergencia", "direccion",
]);

const pestanaDe = (campo: string): PestanaFicha => (PERSONALES.has(campo) ? "personal" : "laboral");

/** Cuántos errores hay en cada pestaña. */
export function erroresPorPestana<T extends FieldValues>(errores: FieldErrors<T>): Record<PestanaFicha, number> {
  const cuenta: Record<PestanaFicha, number> = { personal: 0, laboral: 0 };
  for (const campo of Object.keys(errores)) cuenta[pestanaDe(campo)]++;
  return cuenta;
}

/**
 * Dónde debe ir la persona: el primer campo con error, leyendo el formulario en orden.
 * Devuelve `null` si no hay errores.
 */
export function primerError<T extends FieldValues>(errores: FieldErrors<T>): { campo: string; pestana: PestanaFicha } | null {
  const campos = Object.keys(errores);
  const campo = campos.find((c) => pestanaDe(c) === "personal") ?? campos[0];
  return campo ? { campo, pestana: pestanaDe(campo) } : null;
}

export function PestanasFicha({
  tab,
  onCambiar,
  errores,
}: {
  tab: PestanaFicha;
  onCambiar: (t: PestanaFicha) => void;
  errores: Record<PestanaFicha, number>;
}) {
  const pestanas: Array<{ id: PestanaFicha; texto: string }> = [
    { id: "personal", texto: "Datos personales" },
    { id: "laboral", texto: "Datos laborales" },
  ];
  return (
    <div className="flex gap-1 border-b border-gray-200">
      {pestanas.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onCambiar(p.id)}
          aria-current={tab === p.id ? "true" : undefined}
          className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === p.id ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          {p.texto}
          {errores[p.id] > 0 && (
            <span className="rounded-full bg-red-100 px-1.5 text-xs font-semibold text-red-800">
              {errores[p.id]}
              <span className="sr-only"> con error</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Lo que dice el formulario cuando no se pudo guardar. */
export function ResumenErrores({ errores }: { errores: Record<PestanaFicha, number> }) {
  const total = errores.personal + errores.laboral;
  if (total === 0) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {total === 1 ? "Hay 1 dato por corregir" : `Hay ${total} datos por corregir`}: están marcados en rojo
      {errores.personal > 0 && errores.laboral > 0 ? ", en las dos pestañas." : "."}
    </p>
  );
}
