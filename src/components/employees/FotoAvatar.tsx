/**
 * Foto del empleado, redonda, o sus iniciales si no tiene. Sin estado: sirve igual en una
 * página del servidor que en un componente del navegador.
 */

import { iniciales } from "@/lib/utils";
import { urlFoto } from "@/lib/empleados/foto";

const TAMANOS = {
  xs: "h-7 w-7 text-[10px]",
  sm: "h-9 w-9 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-20 w-20 text-xl",
  xl: "h-28 w-28 text-2xl",
} as const;

export default function FotoAvatar({ empleadoId, version, nombre, tamano = "sm", className = "" }: {
  empleadoId: string;
  /** Marca de la foto (updatedAt); null o undefined = no tiene. */
  version?: Date | number | null;
  nombre: string;
  tamano?: keyof typeof TAMANOS;
  className?: string;
}) {
  const clase = `${TAMANOS[tamano]} shrink-0 rounded-full ${className}`;
  if (version === null || version === undefined) {
    return (
      <span className={`${clase} inline-flex items-center justify-center bg-blue-100 font-semibold text-blue-800`} aria-hidden="true" data-foto-iniciales>
        {iniciales(nombre)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- imagen privada, servida tras la sesión: el optimizador de Next no aplica.
    <img src={urlFoto(empleadoId, version)} alt={`Foto de ${nombre}`} loading="lazy" className={`${clase} bg-gray-100 object-cover`} data-foto-empleado />
  );
}
