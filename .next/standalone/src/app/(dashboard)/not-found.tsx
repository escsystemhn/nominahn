import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";

export const metadata = { title: "No encontrado" };

/** Un registro que ya no existe, o un enlace viejo, dentro de la aplicación. */
export default function NoEncontradoEnPantalla() {
  return (
    <PageHeader
      title="No encontramos lo que busca"
      description="El enlace es antiguo o el registro ya no existe."
      actions={
        <Link href="/dashboard" className="btn btn-primary">
          Ir al inicio
        </Link>
      }
    />
  );
}
