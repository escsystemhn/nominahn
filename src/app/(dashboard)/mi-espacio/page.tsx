import { auth } from "@/lib/auth";
import { puede } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { nombreCompleto } from "@/lib/utils";
import { calcularVacacionesDevengadas } from "@/lib/payroll/calculos-hn";
import MiEspacioClient from "@/components/employees/MiEspacioClient";

export default async function MiEspacioPage() {
  const session = await auth();
  const empleadoId = session?.user?.empleadoId as string | null;

  if (!empleadoId) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-bold text-gray-900">Mi espacio</h1>
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Su usuario no está vinculado a un expediente de empleado, por lo que no hay
          información de autoservicio disponible. Contacte a Recursos Humanos.
        </div>
      </div>
    );
  }

  const [empleado, saldo] = await Promise.all([
    prisma.empleado.findUnique({
      where: { id: empleadoId },
      include: { puesto: { select: { nombre: true } }, departamento: { select: { nombre: true } } },
    }),
    prisma.saldoVacaciones.findUnique({ where: { empleadoId } }),
  ]);

  const puedeAprobar = puede(session?.user, "asistencia.aprobar_permisos");

  // Saldo de vacaciones en vivo: devengado (Art. 346) menos días ya tomados.
  const diasDevengados = empleado ? calcularVacacionesDevengadas(empleado.fechaIngreso) : 0;
  const diasTomados = saldo ? Number(saldo.diasTomados) : 0;
  const diasDisponibles = Math.round((diasDevengados - diasTomados) * 100) / 100;

  return (
    <MiEspacioClient
      nombre={empleado ? nombreCompleto(empleado) : "Empleado"}
      puesto={empleado?.puesto?.nombre ?? empleado?.departamento?.nombre ?? ""}
      diasDevengados={diasDevengados}
      diasDisponibles={diasDisponibles}
      diasTomados={diasTomados}
      puedeAprobar={puedeAprobar}
    />
  );
}
