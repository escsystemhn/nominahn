import { cn } from "@/lib/utils";

/**
 * Estados en palabras, no en el nombre del enum.
 *
 * `PAGADA` y `VACACIONES` son identificadores de base de datos; la persona que
 * revisa una planilla lee «Pagada» y «De vacaciones». El color va en un punto
 * y no en un fondo de píldora: en una tabla con treinta filas los fondos
 * pastel compiten con los datos.
 */
export type Tono = "neutro" | "marca" | "ok" | "aviso" | "error";

const ESTADOS: Record<string, { label: string; tono: Tono }> = {
  // Empleado
  ACTIVO: { label: "Activo", tono: "ok" },
  INACTIVO: { label: "Inactivo", tono: "neutro" },
  SUSPENDIDO: { label: "Suspendido", tono: "error" },
  VACACIONES: { label: "De vacaciones", tono: "marca" },
  PERMISO: { label: "Con permiso", tono: "aviso" },
  // Planilla
  BORRADOR: { label: "Borrador", tono: "neutro" },
  CALCULADA: { label: "Calculada", tono: "marca" },
  APROBADA: { label: "Aprobada", tono: "aviso" },
  PAGADA: { label: "Pagada", tono: "ok" },
  ANULADA: { label: "Anulada", tono: "error" },
  // Permiso / solicitud
  PENDIENTE: { label: "Pendiente", tono: "aviso" },
  APROBADO: { label: "Aprobado", tono: "ok" },
  RECHAZADO: { label: "Rechazado", tono: "error" },
  RECHAZADA: { label: "Rechazada", tono: "error" },
  CANCELADA: { label: "Cancelada", tono: "neutro" },
  // Plan de horarios
  PUBLICADO: { label: "Publicado", tono: "ok" },
  ARCHIVADO: { label: "Archivado", tono: "neutro" },
  // Tipo de planilla
  MENSUAL: { label: "Mensual", tono: "neutro" },
  QUINCENAL: { label: "Quincenal", tono: "neutro" },
  SEMANAL: { label: "Semanal", tono: "neutro" },
};

const PUNTO: Record<Tono, string> = {
  neutro: "bg-gray-400",
  marca: "bg-blue-500",
  ok: "bg-green-600",
  aviso: "bg-amber-500",
  error: "bg-red-600",
};

/** Texto legible para un estado, reutilizable fuera del badge. */
export function etiquetaEstado(valor: string): string {
  return ESTADOS[valor]?.label ?? valor.charAt(0) + valor.slice(1).toLowerCase();
}

/**
 * `tono` corrige el color cuando el mismo estado significa otra cosa en otro
 * contexto: una planilla «Aprobada» aún no se paga (aviso); una solicitud
 * «Aprobada» ya está resuelta a favor (ok).
 */
export default function EstadoBadge({ valor, className, tono: tonoForzado }: { valor: string; className?: string; tono?: Tono }) {
  const def = ESTADOS[valor];
  const tono = tonoForzado ?? def?.tono ?? "neutro";
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-gray-700", className)}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PUNTO[tono])} />
      {etiquetaEstado(valor)}
    </span>
  );
}
