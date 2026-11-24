import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { conAlcance, filtroPorEmpleado, filtroSucursales } from "@/lib/auth/alcance";
import { filtroEventos, filtroDispositivos } from "@/lib/biometrico/alcance";
import BiometricoClient from "@/components/biometrico/BiometricoClient";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";

export default async function BiometricoPage() {
  const usuario = await requerirPermisoPagina("asistencia.biometrico");

  const [dispositivos, sucursales, cuarentena, empleados, asignados, jerarquia] = await Promise.all([
    prisma.dispositivoBiometrico.findMany({
      where: filtroDispositivos(usuario),
      // Explícito y no la fila entera: incluye `passwordCifrado`, y una
      // credencial de un terminal de control de acceso no baja al navegador.
      select: {
        id: true, nombre: true, marca: true, ip: true, puerto: true, usuario: true,
        sucursalId: true, activo: true, ultimaSync: true, createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.sucursal.findMany({
      where: { AND: [{ activa: true }, filtroSucursales(usuario)] },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    }),
    // PIN que el reloj reportó sin dueño. Un PIN puede acumular cientos de
    // marcas: al operador le sirve el conteo, no la lista.
    prisma.marcajeEvento.groupBy({
      by: ["dispositivoId", "pin"],
      where: { AND: [{ estado: "CUARENTENA" }, filtroEventos(usuario)] },
      _count: { _all: true },
      _min: { ocurridoEn: true },
      _max: { ocurridoEn: true },
    }),
    prisma.empleado.findMany({
      where: conAlcance({ estado: "ACTIVO" }, usuario),
      select: { id: true, codigo: true, primerNombre: true, primerApellido: true },
      orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
    }),
    prisma.empleadoPin.findMany({
      where: filtroPorEmpleado(usuario),
      select: {
        pin: true,
        dispositivoId: true,
        empleado: { select: { id: true, codigo: true, primerNombre: true, primerApellido: true } },
      },
      orderBy: { pin: "asc" },
    }),
    jerarquiaNominaHabilitada(prisma),
  ]);

  return (
    <BiometricoClient
      dispositivos={dispositivos.map((d) => ({
        ...d,
        ultimaSync: d.ultimaSync?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
      }))}
      sucursales={sucursales}
      cuarentena={cuarentena
        .map((c) => ({
          dispositivoId: c.dispositivoId,
          pin: c.pin,
          marcas: c._count._all,
          primera: c._min.ocurridoEn?.toISOString() ?? null,
          ultima: c._max.ocurridoEn?.toISOString() ?? null,
        }))
        .sort((a, b) => b.marcas - a.marcas)}
      empleados={empleados.map((e) => ({
        id: e.id,
        etiqueta: `${e.codigo} — ${e.primerNombre} ${e.primerApellido}`,
      }))}
      asignados={asignados.map((a) => ({
        pin: a.pin,
        dispositivoId: a.dispositivoId,
        empleado: `${a.empleado.codigo} — ${a.empleado.primerNombre} ${a.empleado.primerApellido}`,
      }))}
      niveles={etiquetasNiveles(jerarquia)}
    />
  );
}
