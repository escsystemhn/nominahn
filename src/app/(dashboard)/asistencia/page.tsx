import { prisma } from "@/lib/prisma";
import { formatDate, hoyHN, fechaCalendario } from "@/lib/utils";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import AsistenciaClient from "@/components/attendance/AsistenciaClient";
import PageHeader from "@/components/ui/PageHeader";

export const metadata = { title: "Asistencia" };

export default async function AsistenciaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; sucursalId?: string }>;
}) {
  await requerirPermisoPagina("asistencia.ver");

  const sp = await searchParams;
  // Por defecto, HOY EN HONDURAS. `toISOString()` daba el día en UTC: pasadas
  // las 18:00 hora local ya apuntaba al día siguiente.
  const fecha = sp.fecha ? fechaCalendario(sp.fecha) : hoyHN();
  // El cliente necesita el AAAA-MM-DD para el input type=date.
  const fechaStr = fecha.toISOString().split("T")[0];

  const [marcajes, empleados, sucursales] = await Promise.all([
    prisma.marcaje.findMany({
      where: {
        fecha,
        ...(sp.sucursalId
          ? { empleado: { sucursalId: sp.sucursalId } }
          : {}),
      },
      include: {
        empleado: {
          select: {
            id: true,
            codigo: true,
            primerNombre: true,
            segundoNombre: true,
            primerApellido: true,
            segundoApellido: true,
            sucursal: { select: { nombre: true } },
            departamento: { select: { nombre: true } },
          },
        },
      },
      orderBy: { empleado: { primerApellido: "asc" } },
    }).then((rows) =>
      // Todos los Decimal, no sólo los que se muestran: el `...m` arrastra el
      // resto y un Decimal de Prisma no puede cruzar a un Client Component
      // («Only plain objects can be passed…»). El mismo fallo que tuvo
      // `topeMinimo` en deducciones.
      rows.map((m) => ({
        ...m,
        horasNormales: Number(m.horasNormales),
        horasExtra: Number(m.horasExtra),
        horasExtraDiurna: Number(m.horasExtraDiurna),
        horasExtraMixta: Number(m.horasExtraMixta),
        horasExtraNocturna: Number(m.horasExtraNocturna),
        horasFeriado: Number(m.horasFeriado),
      }))
    ),
    prisma.empleado.findMany({
      where: {
        estado: "ACTIVO",
        ...(sp.sucursalId ? { sucursalId: sp.sucursalId } : {}),
      },
      select: { id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true },
      orderBy: { primerApellido: "asc" },
    }),
    prisma.sucursal.findMany({ select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
  ]);

  const presentes = marcajes.filter((m) => !m.esAusencia).length;
  const ausentes = marcajes.filter((m) => m.esAusencia).length;
  const horasExtraTotal = marcajes.reduce((s, m) => s + Number(m.horasExtra), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Control de asistencia"
        description={`Marcajes del ${formatDate(fecha)}: entradas, salidas, almuerzo y horas extra.`}
      />

      {/* Resumen del día: una franja con divisores, sin semáforo de colores. */}
      <section aria-label="Resumen del día">
        <div className="grid grid-cols-3 divide-x divide-gray-200 border-b border-gray-200">
          {[
            { label: "Presentes", value: presentes, detalle: "con marcaje registrado" },
            { label: "Ausentes", value: ausentes, detalle: "sin marcaje ni permiso" },
            { label: "Horas extra", value: horasExtraTotal.toFixed(1), detalle: "en total, todas las jornadas" },
          ].map((s) => (
            <div key={s.label} className="px-5 py-4 first:pl-0 lg:px-6 lg:first:pl-0">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className="tnum mt-1 text-2xl font-semibold leading-none text-gray-900">{s.value}</p>
              <p className="mt-1.5 text-xs text-gray-500">{s.detalle}</p>
            </div>
          ))}
        </div>
      </section>

      <AsistenciaClient
        marcajes={marcajes}
        empleados={empleados}
        sucursales={sucursales}
        fecha={fechaStr}
        sucursalId={sp.sucursalId ?? ""}
      />
    </div>
  );
}
