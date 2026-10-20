import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede, puedeAlguno } from "@/lib/auth/guard";
import ConfiguracionClient from "@/components/config/ConfiguracionClient";

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
  const [empresa, sucursales, departamentos, salarioMinimo, configs] = !puedeVer
    ? [null, [], [], null, []] as const
    : await Promise.all([
    prisma.empresa.findFirst(),
    prisma.sucursal.findMany({ orderBy: { nombre: "asc" } }),
    prisma.departamento.findMany({ include: { sucursal: { select: { nombre: true } } }, orderBy: { nombre: "asc" } }),
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
      departamentos={[...departamentos]}
      salarioMinimo={salarioMinimoSerial}
      configs={[...configs]}
      puedeVer={puedeVer}
      puedeCorreo={puedeCorreo}
      puedeParametros={puedeParametros}
      puedeSap={puedeSap}
      puedeBanco={puedeBanco}
    />
  );
}
