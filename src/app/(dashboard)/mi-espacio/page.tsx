import { auth } from "@/lib/auth";
import { puede } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { nombreCompleto } from "@/lib/utils";
import { calcularVacacionesDevengadas } from "@/lib/payroll/calculos-hn";
import MiEspacioClient from "@/components/employees/MiEspacioClient";
import PageHeader from "@/components/ui/PageHeader";

export default async function MiEspacioPage() {
  const session = await auth();
  const empleadoId = session?.user?.empleadoId as string | null;
  const puedeAprobar = puede(session?.user, "asistencia.aprobar_permisos");

  if (!empleadoId) {
    // Aprobar no depende de tener empleado: RRHH suele trabajar con una cuenta sin ficha.
    if (puedeAprobar) {
      return (
        <MiEspacioClient
          soloAprobaciones
          nombre=""
          puesto=""
          diasDevengados={0}
          diasDisponibles={0}
          diasTomados={0}
          puedeAprobar
        />
      );
    }
    return (
      <div className="space-y-6">
        <PageHeader title="Mi espacio" />
        <div className="max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Esta cuenta no está vinculada a un empleado, así que aquí no hay boletas ni solicitudes
          que mostrar. Un administrador puede vincularla en Usuarios.
        </div>
      </div>
    );
  }

  const [empleado, saldo] = await Promise.all([
    prisma.empleado.findUnique({
      where: { id: empleadoId },
      include: { puesto: { select: { nombre: true } }, departamento: { select: { nombre: true } }, foto: { select: { updatedAt: true } } },
    }),
    prisma.saldoVacaciones.findUnique({ where: { empleadoId } }),
  ]);

  // Saldo de vacaciones en vivo: devengado (Art. 346) menos días ya tomados.
  const diasDevengados = empleado ? calcularVacacionesDevengadas(empleado.fechaIngreso) : 0;
  const diasTomados = saldo ? Number(saldo.diasTomados) : 0;
  const diasDisponibles = Math.round((diasDevengados - diasTomados) * 100) / 100;

  return (
    <MiEspacioClient
      nombre={empleado ? nombreCompleto(empleado) : "Empleado"}
      empleadoId={empleado?.id}
      fotoVersion={empleado?.foto?.updatedAt.getTime() ?? null}
      puesto={empleado?.puesto?.nombre ?? empleado?.departamento?.nombre ?? ""}
      diasDevengados={diasDevengados}
      diasDisponibles={diasDisponibles}
      diasTomados={diasTomados}
      puedeAprobar={puedeAprobar}
    />
  );
}
