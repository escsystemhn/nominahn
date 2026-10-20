import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import BiometricoClient from "@/components/biometrico/BiometricoClient";

export default async function BiometricoPage() {
  await requerirPermisoPagina("asistencia.biometrico");

  const [dispositivos, sucursales, cuarentena, empleados, asignados] = await Promise.all([
    prisma.dispositivoBiometrico.findMany({
      // Explícito y no la fila entera: incluye `passwordCifrado`, y una
      // credencial de un terminal de control de acceso no baja al navegador.
      select: {
        id: true, nombre: true, marca: true, ip: true, puerto: true,
        sucursalId: true, activo: true, ultimaSync: true, createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.sucursal.findMany({
      where: { activa: true },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    }),
    // PIN que el reloj reportó sin dueño. Un PIN puede acumular cientos de
    // marcas: al operador le sirve el conteo, no la lista.
    prisma.marcajeEvento.groupBy({
      by: ["dispositivoId", "pin"],
      where: { estado: "CUARENTENA" },
      _count: { _all: true },
      _min: { ocurridoEn: true },
      _max: { ocurridoEn: true },
    }),
    prisma.empleado.findMany({
      where: { estado: "ACTIVO" },
      select: { id: true, codigo: true, primerNombre: true, primerApellido: true },
      orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
    }),
    prisma.empleadoPin.findMany({
      select: {
        pin: true,
        dispositivoId: true,
        empleado: { select: { id: true, codigo: true, primerNombre: true, primerApellido: true } },
      },
      orderBy: { pin: "asc" },
    }),
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
    />
  );
}
