import { prisma } from "@/lib/prisma";
import { conAlcance, filtroPorEmpleado, filtroSucursales } from "@/lib/auth/alcance";
import { formatDate, hoyHN, fechaCalendario } from "@/lib/utils";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import AsistenciaClient from "@/components/attendance/AsistenciaClient";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import BarraDatos from "@/components/importacion/BarraDatos";
import PageHeader from "@/components/ui/PageHeader";
import FranjaCifras from "@/components/ui/FranjaCifras";
import Link from "next/link";

export const metadata = { title: "Asistencia" };

export default async function AsistenciaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; sucursalId?: string }>;
}) {
  const usuario = await requerirPermisoPagina("asistencia.ver");

  const sp = await searchParams;
  // Por defecto, HOY EN HONDURAS. `toISOString()` daba el día en UTC: pasadas
  // las 18:00 hora local ya apuntaba al día siguiente.
  const fecha = sp.fecha ? fechaCalendario(sp.fecha) : hoyHN();
  // El cliente necesita el AAAA-MM-DD para el input type=date.
  const fechaStr = fecha.toISOString().split("T")[0];

  const [marcajes, empleados, sucursales, jerarquia] = await Promise.all([
    prisma.marcaje.findMany({
      where: {
        fecha,
        AND: [sp.sucursalId ? { empleado: { sucursalId: sp.sucursalId } } : {}, filtroPorEmpleado(usuario)],
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
      where: conAlcance({ estado: "ACTIVO", ...(sp.sucursalId ? { sucursalId: sp.sucursalId } : {}) }, usuario),
      select: { id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true },
      orderBy: { primerApellido: "asc" },
    }),
    prisma.sucursal.findMany({ where: filtroSucursales(usuario), select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    jerarquiaNominaHabilitada(prisma),
  ]);

  const presentes = marcajes.filter((m) => !m.esAusencia).length;
  const ausentes = marcajes.filter((m) => m.esAusencia).length;
  const horasExtraTotal = marcajes.reduce((s, m) => s + Number(m.horasExtra), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Control de asistencia"
        description={`Marcajes del ${formatDate(fecha)}: entradas, salidas, almuerzo y horas extra.`}
        actions={
          <div className="flex flex-wrap gap-2">
          {puede(usuario, "asistencia.gestionar") && (
            <Link href={`/asistencia/carga-rapida?fecha=${fechaStr}${sp.sucursalId ? `&sucursalId=${sp.sucursalId}` : ""}`} className="btn btn-secondary">
              Carga rápida
            </Link>
          )}
          <BarraDatos
            recurso="horas-extra"
            puedeExportar={puede(usuario, "asistencia.ver")}
            puedeImportar={puede(usuario, "asistencia.gestionar")}
            filtros={{ fecha: fechaStr, sucursalId: sp.sucursalId }}
            notaExportar="Se exportan las horas extra de todo el mes de la fecha elegida."
            tituloImportacion="Importar horas"
            ayudaImportacion="Cada fila es un empleado y un día, identificado por su código o su DNI: las horas normales, las extra según su recargo (25 %, 50 %, 75 % o 100 %) o la ausencia. Ponga sólo las cantidades: el sistema calcula el costo. Antes de aplicar verá cada fila con sus errores. Cada fila reemplaza las horas de ese día, así que subir el mismo archivo otra vez no las duplica."
          />
          </div>
        }
      />

      <FranjaCifras
        etiqueta="Resumen del día"
        cifras={[
          { label: "Presentes", valor: presentes, detalle: "con marcaje registrado" },
          { label: "Ausentes", valor: ausentes, detalle: "sin marcaje ni permiso" },
          { label: "Horas extra", valor: horasExtraTotal.toFixed(1), detalle: "en total, todas las jornadas" },
        ]}
      />

      <AsistenciaClient
        marcajes={marcajes}
        empleados={empleados}
        sucursales={sucursales}
        fecha={fechaStr}
        sucursalId={sp.sucursalId ?? ""}
        niveles={etiquetasNiveles(jerarquia)}
      />
    </div>
  );
}
