import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Armazon from "@/components/layout/Armazon";
import AvisoEvaluacion from "@/components/licencia/AvisoEvaluacion";
import { estadoLicencia } from "@/lib/licencia/estado";
import { ORDEN_EMPRESA_PRINCIPAL } from "@/lib/empresa";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  /**
   * Con una contraseña temporal no se dibuja el menú.
   *
   * El middleware ya devuelve cualquier otra ruta a /mi-cuenta, así que un menú
   * completo sólo ofrecería enlaces que rebotan. Se deja únicamente lo que la
   * persona puede hacer: cambiar su contraseña o cerrar sesión.
   */
  const bloqueado = session.user?.debeCambiarPassword === true;

  // La barra superior nombra a la empresa cuyos libros se están viendo.
  const empresa = await prisma.empresa.findFirst({ select: { nombre: true }, orderBy: ORDEN_EMPRESA_PRINCIPAL });

  // Edición instalable: del día 25 al 30 de la evaluación se avisa en cada pantalla.
  const licencia = await estadoLicencia();
  const aviso = licencia.modo === "evaluacion" && licencia.evaluacion.mostrarAviso ? licencia.evaluacion : null;

  return (
    <Armazon
      permisos={session.user?.permisos ?? []}
      conEmpleado={!!session.user?.empleadoId}
      user={session.user}
      empresa={empresa?.nombre}
      bloqueado={bloqueado}
      avisos={
        <>
          {aviso && <AvisoEvaluacion evaluacion={aviso} />}
          {bloqueado && (
            <div className="shrink-0 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:px-6">
              <span className="font-semibold">Acceso en pausa.</span> Su contraseña es temporal y la
              fijó otra persona. Elija una propia aquí abajo para entrar al sistema.
            </div>
          )}
        </>
      }
    >
      {children}
    </Armazon>
  );
}
