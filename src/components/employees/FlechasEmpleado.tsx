"use client";

/**
 * ‹ 12 de 77 › — pasar al empleado anterior o siguiente de la lista, en el orden y con los
 * filtros con que se veía (ver lib/empleados/lista.ts). En Editar, con cambios sin guardar,
 * pregunta antes de salir.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";

export interface DestinoFlecha {
  href: string;
  nombre: string;
}

interface Props {
  anterior: DestinoFlecha | null;
  siguiente: DestinoFlecha | null;
  posicion: number;
  total: number;
  /** Hay cambios sin guardar: se pide confirmación antes de salir. */
  hayCambios?: boolean;
}

const BOTON = "btn btn-secondary h-9 w-9 justify-center p-0 text-lg leading-none";

export default function FlechasEmpleado({ anterior, siguiente, posicion, total, hayCambios = false }: Props) {
  const router = useRouter();
  const { confirmar } = useAvisos();

  const flecha = (d: DestinoFlecha | null, simbolo: string, cual: "anterior" | "siguiente") => {
    const etiqueta = cual === "anterior" ? "Empleado anterior" : "Empleado siguiente";
    if (!d) {
      return (
        <span className={`${BOTON} cursor-not-allowed opacity-40`} aria-disabled="true" aria-label={`${etiqueta}: no hay`} title={`No hay ${cual === "anterior" ? "anterior" : "siguiente"}`}>
          {simbolo}
        </span>
      );
    }
    return (
      <Link
        href={d.href}
        className={BOTON}
        aria-label={`${etiqueta}: ${d.nombre}`}
        title={`${cual === "anterior" ? "Anterior" : "Siguiente"}: ${d.nombre}`}
        data-flecha={cual}
        onClick={async (e) => {
          if (!hayCambios) return;
          e.preventDefault();
          if (await confirmar({ titulo: "¿Salir sin guardar?", detalle: "Hay cambios sin guardar en este empleado.", accion: "Salir sin guardar", peligro: true })) {
            router.push(d.href);
          }
        }}
      >
        {simbolo}
      </Link>
    );
  };

  return (
    <nav aria-label="Otros empleados de la lista" className="flex items-center gap-1.5" data-flechas-empleado>
      {flecha(anterior, "‹", "anterior")}
      <span className="tnum min-w-16 text-center text-xs text-gray-500">{posicion} de {total}</span>
      {flecha(siguiente, "›", "siguiente")}
    </nav>
  );
}
