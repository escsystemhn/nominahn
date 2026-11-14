import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import CentrosCostoClient from "@/components/organizacion/CentrosCostoClient";
import { divisionesHabilitadas } from "@/lib/organizacion/estructura-bd";

export default async function CentrosCostoPage() {
  const usuario = await requerirPermisoPagina(["organizacion.centros_costo", "planillas.contabilidad"]);
  const conDivisiones = await divisionesHabilitadas(prisma);

  const [centros, departamentos, empleadosSinCentro] = await Promise.all([
    prisma.centroCosto.findMany({
      orderBy: [{ activo: "desc" }, { codigo: "asc" }],
      include: { _count: { select: { departamentos: true, empleados: true } } },
    }),
    prisma.departamento.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, centroCostoId: true, sucursal: { select: { nombre: true } }, division: { select: { nombre: true } } },
      orderBy: [{ sucursal: { nombre: "asc" } }, { nombre: "asc" }],
    }),
    /**
     * Empleados que no imputarían a ningún centro: ni propio, ni heredado del
     * departamento. Es el hueco que la partida mostraría como «Sin centro de
     * costo asignado», y conviene verlo antes de generar el asiento, no después.
     */
    prisma.empleado.count({
      where: {
        estado: "ACTIVO",
        centroCostoId: null,
        departamento: { centroCostoId: null },
      },
    }),
  ]);

  return (
    <CentrosCostoClient
      centros={centros.map((c) => ({
        id: c.id,
        codigo: c.codigo,
        nombre: c.nombre,
        descripcion: c.descripcion,
        cuentaGasto: c.cuentaGasto,
        activo: c.activo,
        departamentos: c._count.departamentos,
        empleados: c._count.empleados,
      }))}
      departamentos={departamentos.map((d) => ({
        id: d.id,
        nombre: d.nombre,
        // Con divisiones, «División, Sucursal»: distingue departamentos homónimos.
        sucursal: conDivisiones && d.division ? `${d.division.nombre}, ${d.sucursal.nombre}` : d.sucursal.nombre,
        centroCostoId: d.centroCostoId,
      }))}
      empleadosSinCentro={empleadosSinCentro}
      puedeGestionar={puede(usuario, "organizacion.centros_costo")}
    />
  );
}
