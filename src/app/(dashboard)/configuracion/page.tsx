import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede, puedeAlguno } from "@/lib/auth/guard";
import ConfiguracionClient from "@/components/config/ConfiguracionClient";
import { divisionesHabilitadas, jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import { ORDEN_EMPRESA_PRINCIPAL } from "@/lib/empresa";
import { leerMinutosInactividad } from "@/lib/auth/inactividad-bd";

export default async function ConfiguracionPage() {
  const usuario = await requerirPermisoPagina([
    "configuracion.ver", "configuracion.editar", "configuracion.correo", "configuracion.parametros", "configuracion.sap",
    "seguridad.usuarios_gestionar", "configuracion.respaldos",
  ]);
  const puedeRespaldos = puede(usuario, "configuracion.respaldos");
  const puedeSeguridad = puede(usuario, "seguridad.usuarios_gestionar");
  const minutosInactividad = puedeSeguridad ? await leerMinutosInactividad(prisma) : 0;
  const puedeVer = puedeAlguno(usuario, ["configuracion.ver", "configuracion.editar"]);
  const puedeCorreo = puede(usuario, "configuracion.correo");
  const puedeParametros = puede(usuario, "configuracion.parametros");
  const puedeSap = puede(usuario, "configuracion.sap");
  const puedeBanco = puede(usuario, "configuracion.editar");

  // Quien entra sólo por el correo saliente o los parámetros de ley no recibe los datos de la empresa:
  // se consultan únicamente si los puede ver.
  const [empresa, sucursales, divisiones, departamentos, puestos, divisionesActivas, jerarquiaActiva, salarioMinimo, configs] = !puedeVer
    ? [null, [], [], [], [], false, false, null, []] as const
    : await Promise.all([
    prisma.empresa.findFirst({ orderBy: ORDEN_EMPRESA_PRINCIPAL }),
    prisma.sucursal.findMany({ orderBy: { nombre: "asc" }, include: { logo: { select: { updatedAt: true } } } }),
    prisma.division.findMany({
      select: { id: true, nombre: true, codigo: true, rtn: true, activa: true, sucursalId: true, _count: { select: { departamentos: true, planillas: true, detallesPlanilla: true } } },
      orderBy: [{ sucursal: { nombre: "asc" } }, { nombre: "asc" }],
    }),
    prisma.departamento.findMany({
      select: { id: true, nombre: true, codigo: true, activo: true, sucursalId: true, divisionId: true, _count: { select: { empleados: true } } },
      orderBy: { nombre: "asc" },
    }),
    prisma.puesto.findMany({
      select: {
        id: true, nombre: true, descripcion: true, salarioMinimo: true, salarioMaximo: true, activo: true, departamentoId: true,
        _count: { select: { empleados: true, puestosCompetencia: true, coberturas: true } },
      },
      orderBy: { nombre: "asc" },
    }),
    divisionesHabilitadas(prisma),
    jerarquiaNominaHabilitada(prisma),
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
      sucursales={sucursales.map(({ logo, ...s }) => ({ ...s, logoVersion: logo?.updatedAt.getTime() ?? null }))}
      divisiones={divisiones.map(({ _count, ...v }) => ({ ...v, departamentos: _count.departamentos, conPlanillas: _count.planillas + _count.detallesPlanilla > 0 }))}
      departamentos={departamentos.map(({ _count, ...d }) => ({ ...d, empleados: _count.empleados }))}
      puestos={puestos.map(({ _count, salarioMinimo: minimo, salarioMaximo: maximo, ...p }) => ({
        ...p,
        salarioMinimo: Number(minimo),
        salarioMaximo: Number(maximo),
        empleados: _count.empleados,
        competencias: _count.puestosCompetencia,
        coberturas: _count.coberturas,
      }))}
      divisionesHabilitadas={divisionesActivas}
      jerarquiaHabilitada={jerarquiaActiva}
      salarioMinimo={salarioMinimoSerial}
      configs={[...configs]}
      puedeVer={puedeVer}
      puedeEditar={puede(usuario, "configuracion.editar")}
      puedeEditarEmpresa={puede(usuario, "configuracion.empresa")}
      puedeCorreo={puedeCorreo}
      puedeParametros={puedeParametros}
      puedeSap={puedeSap}
      puedeBanco={puedeBanco}
      puedeSeguridad={puedeSeguridad}
      puedeRespaldos={puedeRespaldos}
      minutosInactividad={minutosInactividad}
    />
  );
}
