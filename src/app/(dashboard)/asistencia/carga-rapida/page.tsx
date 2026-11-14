import { prisma } from "@/lib/prisma";
import { conAlcance, filtroSucursales } from "@/lib/auth/alcance";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { fechaCalendario, hoyHN, TZ_HN } from "@/lib/utils";
import CargaRapidaClient, { type FilaCarga } from "@/components/attendance/CargaRapidaClient";

export const metadata = { title: "Carga rápida de horas" };

/** "HH:MM" en hora de Honduras (las marcas se guardan como instante UTC). */
const hhmm = (d: Date | null) =>
  d ? d.toLocaleTimeString("en-GB", { timeZone: TZ_HN, hour: "2-digit", minute: "2-digit", hour12: false }) : "";

export default async function CargaRapidaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; sucursalId?: string; departamentoId?: string }>;
}) {
  const usuario = await requerirPermisoPagina("asistencia.gestionar");
  const sp = await searchParams;
  const fecha = sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? fechaCalendario(sp.fecha) : hoyHN();
  const fechaStr = fecha.toISOString().slice(0, 10);

  const sucursales = await prisma.sucursal.findMany({
    where: { AND: [filtroSucursales(usuario), { activa: true }] },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });
  // Sin sucursal elegida se abre la primera: una carga de toda la empresa en una sola
  // tabla no es «rápida» para nadie.
  const sucursalId = sp.sucursalId && sucursales.some((s) => s.id === sp.sucursalId) ? sp.sucursalId : (sucursales[0]?.id ?? "");

  const [departamentos, empleados] = await Promise.all([
    prisma.departamento.findMany({
      where: { sucursalId, activo: true, empleados: { some: conAlcance({ estado: "ACTIVO" }, usuario) } },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    }),
    prisma.empleado.findMany({
      where: conAlcance(
        {
          estado: "ACTIVO",
          sucursalId,
          fechaIngreso: { lte: fecha },
          ...(sp.departamentoId ? { departamentoId: sp.departamentoId } : {}),
        },
        usuario
      ),
      select: {
        id: true,
        codigo: true,
        primerNombre: true,
        primerApellido: true,
        departamento: { select: { nombre: true } },
        marcajes: {
          where: { fecha },
          select: {
            horaEntrada: true, horaSalida: true, minutosDescanso: true, esAusencia: true, observacion: true,
            horasNormales: true, horasExtra: true, horasFeriado: true, fuente: true,
          },
        },
      },
      orderBy: [{ departamento: { nombre: "asc" } }, { primerApellido: "asc" }],
    }),
  ]);

  const filas: FilaCarga[] = empleados.map((e) => {
    const m = e.marcajes[0];
    return {
      empleadoId: e.id,
      codigo: e.codigo,
      nombre: `${e.primerNombre} ${e.primerApellido}`,
      departamento: e.departamento.nombre,
      entrada: hhmm(m?.horaEntrada ?? null),
      salida: hhmm(m?.horaSalida ?? null),
      // Sin marcaje, en blanco: se aplica el almuerzo del turno.
      almuerzo: m && m.horaEntrada ? String(m.minutosDescanso) : "",
      ausente: m?.esAusencia ?? false,
      observacion: m?.observacion ?? "",
      horasNormales: m ? Number(m.horasNormales) : null,
      horasExtra: m ? Number(m.horasExtra) + Number(m.horasFeriado) : null,
      fuente: m?.fuente ?? null,
    };
  });

  return (
    <CargaRapidaClient
      // Con clave: al cambiar de día o de filtro, la tabla vuelve a empezar con lo guardado.
      key={`${fechaStr}|${sucursalId}|${sp.departamentoId ?? ""}`}
      fecha={fechaStr}
      hoy={hoyHN().toISOString().slice(0, 10)}
      sucursalId={sucursalId}
      departamentoId={sp.departamentoId ?? ""}
      sucursales={sucursales}
      departamentos={departamentos}
      filas={filas}
    />
  );
}
