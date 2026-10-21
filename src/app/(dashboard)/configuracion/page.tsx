import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede, puedeAlguno } from "@/lib/auth/guard";
import ConfiguracionClient from "@/components/config/ConfiguracionClient";
import { divisionesHabilitadas } from "@/lib/organizacion/estructura-bd";
import { ORDEN_EMPRESA_PRINCIPAL } from "@/lib/empresa";

export default async function ConfiguracionPage() {
  const usuario = await requerirPermisoPagina([
    "configuracion.ver", "configuracion.editar", "configuracion.correo", "configuracion.parametros", "configuracion.sap",
  ]);
  const puedeVer = puedeAlguno(usuario, ["configuracion.ver", "configuracion.editar"]);
  const puedeCorreo = puede(usuario, "configuracion.correo");
  const puedeParametros = puede(usuario, "configuracion.parametros");
  const puedeSap = puede(usuario, "configuracion.sap");
  const puedeBanco = puede(usuario, "configuracion.editar");

  // Quien entra sólo por el correo saliente o los parámetros de ley no recibe los datos de la empresa:
  // se consultan únicamente si los puede ver.
  const [empresa, sucursales, divisiones, departamentos, divisionesActivas, salarioMinimo, configs] = !puedeVer
    ? [null, [], [], [], false, null, []] as const
    : await Promise.all([
    prisma.empresa.findFirst({ orderBy: ORDEN_EMPRESA_PRINCIPAL }),
    prisma.sucursal.findMany({ orderBy: { nombre: "asc" } }),
    prisma.division.findMany({
      select: { id: true, nombre: true, codigo: true, activa: true, sucursalId: true, _count: { select: { departamentos: true } } },
      orderBy: [{ sucursal: { nombre: "asc" } }, { nombre: "asc" }],
    }),
    prisma.departamento.findMany({
      select: { id: true, nombre: true, codigo: true, activo: true, sucursalId: true, divisionId: true, _count: { select: { empleados: true } } },
      orderBy: { nombre: "asc" },
    }),
    divisionesHabilitadas(prisma),
    prisma.salarioMinimo.findFirst({ where: { activo: true }, orderBy: { anio: "desc" } }),
    // Las claves SISTEMA_* (registro de la evaluación y activación de la licencia)
    // son firmas que el programa administra: no se muestran ni se editan aquí.
    prisma.configuracionSistema.findMany({
      where: { NOT: { clave: { startsWith: "SISTEMA_" } } },
      orderBy: { clave: "asc" },
    }),
  ]);

  const salarioMinimoSerial = salarioMinimo
    ? { ...salarioMinimo, monto: Number(salarioMinimo.monto) }
    : null;

  return (
    <ConfiguracionClient
      empresa={empresa}
      sucursales={[...sucursales]}
      divisiones={divisiones.map(({ _count, ...v }) => ({ ...v, departamentos: _count.departamentos }))}
      departamentos={departamentos.map(({ _count, ...d }) => ({ ...d, empleados: _count.empleados }))}
      divisionesHabilitadas={divisionesActivas}
      salarioMinimo={salarioMinimoSerial}
      configs={[...configs]}
      puedeVer={puedeVer}
      puedeEditar={puede(usuario, "configuracion.editar")}
      puedeEditarEmpresa={puede(usuario, "configuracion.empresa")}
      puedeCorreo={puedeCorreo}
      puedeParametros={puedeParametros}
      puedeSap={puedeSap}
      puedeBanco={puedeBanco}
    />
  );
}
