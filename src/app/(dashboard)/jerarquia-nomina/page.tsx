import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { conAlcance } from "@/lib/auth/alcance";
import { jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import { construirJerarquiaNomina } from "@/lib/organizacion/jerarquia-nomina";
import { nombreCompleto } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import EstadoVacio from "@/components/ui/EstadoVacio";
import JerarquiaNominaClient from "@/components/organizacion/JerarquiaNominaClient";

export default async function JerarquiaNominaPage() {
  const usuario = await requerirPermisoPagina("empleados.ver");

  if (!(await jerarquiaNominaHabilitada(prisma))) {
    return (
      <div className="space-y-6">
        <PageHeader title="Jerarquía de nómina" />
        <div className="panel">
          <EstadoVacio
            titulo="La jerarquía de nómina no está activada."
            detalle="Se activa en Configuración, en la pestaña Estructura organizacional."
            accion={puede(usuario, "configuracion.editar") ? <Link href="/configuracion" className="btn btn-primary">Ir a Configuración</Link> : undefined}
          />
        </div>
      </div>
    );
  }

  const conSalarios = puede(usuario, "empleados.pii");
  const empleados = await prisma.empleado.findMany({
    where: conAlcance({ estado: { not: "INACTIVO" } }, usuario),
    select: {
      id: true,
      codigo: true,
      primerNombre: true,
      segundoNombre: true,
      primerApellido: true,
      segundoApellido: true,
      estado: true,
      tipoPlanilla: true,
      salarioBase: true,
      puesto: { select: { nombre: true } },
      sucursal: { select: { id: true, nombre: true, descripcion: true } },
      departamento: { select: { id: true, nombre: true, division: { select: { id: true, nombre: true, rtn: true } } } },
    },
  });

  const frecuencias = construirJerarquiaNomina(
    empleados.map((e) => ({
      id: e.id,
      codigo: e.codigo,
      nombre: nombreCompleto(e),
      puesto: e.puesto?.nombre ?? null,
      estado: e.estado,
      tipoPlanilla: e.tipoPlanilla,
      salarioBase: e.salarioBase,
      grupo: e.sucursal,
      empresa: e.departamento.division,
      departamento: { id: e.departamento.id, nombre: e.departamento.nombre },
    })),
    conSalarios
  );

  return <JerarquiaNominaClient frecuencias={frecuencias} conSalarios={conSalarios} />;
}
