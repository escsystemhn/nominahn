import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import AvisoEvaluacion from "@/components/licencia/AvisoEvaluacion";
import { estadoLicencia } from "@/lib/licencia/estado";

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
  const empresa = await prisma.empresa.findFirst({ select: { nombre: true } });

  // Edición instalable: del día 25 al 30 de la evaluación se avisa en cada pantalla.
  const licencia = await estadoLicencia();
  const aviso = licencia.modo === "evaluacion" && licencia.evaluacion.mostrarAviso ? licencia.evaluacion : null;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* El menú se filtra por PERMISO, no por rol: es lo que hace que un perfil
          a medida cambie de verdad lo que la persona ve. El filtrado sigue
          siendo cosmético —quien escriba la URL choca con la guardia de la
          página—, pero ahora coincide con lo que la guardia va a decidir. */}
      {!bloqueado && <Sidebar permisos={session.user?.permisos ?? []} />}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar user={session.user} empresa={empresa?.nombre} />
        {aviso && <AvisoEvaluacion evaluacion={aviso} />}
        {bloqueado && (
          <div className="shrink-0 border-b border-amber-300 bg-amber-50 px-6 py-3 text-sm text-amber-900">
            <span className="font-semibold">Acceso en pausa.</span> Su contraseña es temporal y la
            fijó otra persona. Elija una propia aquí abajo para entrar al sistema.
          </div>
        )}
        <main className="flex-1 overflow-y-auto px-6 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
