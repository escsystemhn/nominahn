import { prisma } from "@/lib/prisma";
import DeduccionesClient from "@/components/payroll/DeduccionesClient";
import SolicitudesPrestamoPanel from "@/components/payroll/SolicitudesPrestamoPanel";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";

// Genérica a propósito: en runtime `...t` conserva todos los campos, pero con un
// parámetro no genérico (y su índice `[key: string]: unknown`) TypeScript perdía
// id/nombre/codigo/tipo del tipo de retorno, y eso obligaba a castear a `any` al
// pasar el resultado al componente cliente.
// OJO al añadir un campo Decimal a TipoDeduccionConfig: hay que convertirlo
// AQUÍ también. El `...t` lo arrastra tal cual, y un Decimal de Prisma no es un
// objeto plano, así que React avisa «Only plain objects can be passed to Client
// Components» y el valor llega inservible al cliente. Le pasó a `topeMinimo`,
// que quedó fuera de esta lista y ensuciaba la consola en cada carga.
function serializeTipo<T extends {
  porcentaje: object | null;
  montoFijo: object | null;
  porcentajeEmpleador: object | null;
  topeMaximo: object | null;
  topeMinimo: object | null;
}>(t: T) {
  return {
    ...t,
    porcentaje: t.porcentaje !== null ? Number(t.porcentaje) : null,
    montoFijo: t.montoFijo !== null ? Number(t.montoFijo) : null,
    porcentajeEmpleador: t.porcentajeEmpleador !== null ? Number(t.porcentajeEmpleador) : null,
    topeMaximo: t.topeMaximo !== null ? Number(t.topeMaximo) : null,
    topeMinimo: t.topeMinimo !== null ? Number(t.topeMinimo) : null,
  };
}

export default async function DeduccionesPage() {
  const usuario = await requerirPermisoPagina("deducciones.ver");

  const [tipos, deduccionesEmpleados] = await Promise.all([
    prisma.tipoDeduccionConfig.findMany({ orderBy: { nombre: "asc" } }),
    prisma.deduccionEmpleado.findMany({
      where: { activo: true },
      include: {
        empleado: {
          select: {
            id: true,
            codigo: true,
            primerNombre: true,
            primerApellido: true,
            sucursal: { select: { nombre: true } },
          },
        },
        tipoDeduccion: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const empleados = await prisma.empleado.findMany({
    where: { estado: "ACTIVO" },
    select: { id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true },
    orderBy: { primerApellido: "asc" },
  });

  const tiposSerializados = tipos.map(serializeTipo);
  const deduccionesSerializadas = deduccionesEmpleados.map((d) => ({
    ...d,
    monto: Number(d.monto),
    saldo: d.saldo !== null ? Number(d.saldo) : null,
    tipoDeduccion: serializeTipo(d.tipoDeduccion),
  }));

  return (
    <div className="space-y-6">
      {puede(usuario, "deducciones.asignar") && <SolicitudesPrestamoPanel />}
      <DeduccionesClient
        tipos={tiposSerializados}
        deduccionesEmpleados={deduccionesSerializadas}
        empleados={empleados}
        puedeExportar={puede(usuario, "deducciones.exportar")}
        puedeImportar={puede(usuario, "deducciones.importar")}
      />
    </div>
  );
}
