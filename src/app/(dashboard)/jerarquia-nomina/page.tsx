import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { conAlcance, filtroSucursales } from "@/lib/auth/alcance";
import { jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import ExportarEstructura from "@/components/organizacion/ExportarEstructura";
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
            detalle="Se activa en Configuración → Organización → Estructura organizacional."
            accion={puede(usuario, "configuracion.editar") ? <Link href="/configuracion?seccion=estructura" className="btn btn-primary">Ir a la estructura</Link> : undefined}
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

  // Con la jerarquía encendida, el nivel División también lo está (ver `aplicarCambioOpciones`).
  let exportar: React.ReactNode = null;
  if (puede(usuario, "empleados.exportar")) {
    const niveles = etiquetasNiveles(true);
    const grupos = await prisma.sucursal.findMany({ where: filtroSucursales(usuario), select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
    const divisiones = await prisma.division.findMany({
      where: { sucursalId: { in: grupos.map((g) => g.id) } },
      select: { id: true, nombre: true, sucursalId: true },
      orderBy: { nombre: "asc" },
    });
    exportar = (
      <ExportarEstructura
        grupos={grupos}
        divisiones={divisiones}
        etiquetas={{
          sucursal: niveles.sucursal, todasSucursales: niveles.todasSucursales, sucursales: niveles.sucursales,
          division: niveles.division, todasDivisiones: niveles.todasDivisiones, divisiones: niveles.divisiones,
        }}
      />
    );
  }

  return <JerarquiaNominaClient frecuencias={frecuencias} conSalarios={conSalarios} exportar={exportar} />;
}
