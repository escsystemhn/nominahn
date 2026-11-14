import { prisma } from "@/lib/prisma";
import DeduccionesClient from "@/components/payroll/DeduccionesClient";
import SolicitudesPrestamoPanel from "@/components/payroll/SolicitudesPrestamoPanel";
import AnticiposPrestacionPanel from "@/components/payroll/AnticiposPrestacionPanel";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { conAlcance, filtroPorEmpleado } from "@/lib/auth/alcance";
import { cuotaDelPeriodo, esMontoDelPeriodo } from "@/lib/payroll/deducciones";
import { ESTADOS_QUE_COBRAN } from "@/lib/payroll/elegibles";
import { aNumero } from "@/lib/payroll/money";
import { rangoPeriodo, type TipoPlanillaPeriodo } from "@/lib/payroll/periodos-planilla";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import { hoyHN } from "@/lib/utils";

const dia = (d: Date) => d.toISOString().slice(0, 10);

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
  montoFijoEmpleador: object | null;
  porcentajeEmpleador: object | null;
  topeMaximo: object | null;
  topeMinimo: object | null;
}>(t: T) {
  return {
    ...t,
    porcentaje: t.porcentaje !== null ? Number(t.porcentaje) : null,
    montoFijo: t.montoFijo !== null ? Number(t.montoFijo) : null,
    // Le pasó lo mismo que a `topeMinimo` (2026-11-11): IHSS e IVM con monto patronal guardado ensuciaban la consola.
    montoFijoEmpleador: t.montoFijoEmpleador !== null ? Number(t.montoFijoEmpleador) : null,
    porcentajeEmpleador: t.porcentajeEmpleador !== null ? Number(t.porcentajeEmpleador) : null,
    topeMaximo: t.topeMaximo !== null ? Number(t.topeMaximo) : null,
    topeMinimo: t.topeMinimo !== null ? Number(t.topeMinimo) : null,
  };
}

export default async function DeduccionesPage() {
  const usuario = await requerirPermisoPagina("deducciones.ver");

  const [tipos, deduccionesEmpleados, conJerarquia] = await Promise.all([
    prisma.tipoDeduccionConfig.findMany({ orderBy: { nombre: "asc" } }),
    prisma.deduccionEmpleado.findMany({
      // Las vigentes: un monto de una quincena pasada ya no se descuenta y sólo estorbaría.
      where: { activo: true, AND: [filtroPorEmpleado(usuario), { OR: [{ fechaFin: null }, { fechaFin: { gte: hoyHN() } }] }] },
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
    jerarquiaNominaHabilitada(prisma),
  ]);

  const empleados = await prisma.empleado.findMany({
    where: conAlcance({ estado: { in: [...ESTADOS_QUE_COBRAN] } }, usuario),
    select: { id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, tipoPlanilla: true },
    orderBy: { primerApellido: "asc" },
  });

  // El tipo de planilla de la mayoría: con él arrancan exportar e importar por período.
  const cuantos = new Map<TipoPlanillaPeriodo, number>();
  for (const e of empleados) cuantos.set(e.tipoPlanilla, (cuantos.get(e.tipoPlanilla) ?? 0) + 1);
  const tipoPlanilla = [...cuantos].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "QUINCENAL";

  const tiposSerializados = tipos.map(serializeTipo);
  const deduccionesSerializadas = deduccionesEmpleados.map((d) => ({
    ...d,
    monto: Number(d.monto),
    saldo: d.saldo !== null ? Number(d.saldo) : null,
    cuotaPeriodo: aNumero(cuotaDelPeriodo(d)),
    soloPeriodo: esMontoDelPeriodo(d) && d.fechaFin ? rangoPeriodo(dia(d.fechaInicio), dia(d.fechaFin)) : null,
    tipoDeduccion: serializeTipo(d.tipoDeduccion),
  }));

  return (
    <DeduccionesClient
      tipos={tiposSerializados}
      deduccionesEmpleados={deduccionesSerializadas}
      empleados={empleados.map((e) => ({ id: e.id, codigo: e.codigo, primerNombre: e.primerNombre, segundoNombre: e.segundoNombre, primerApellido: e.primerApellido, segundoApellido: e.segundoApellido }))}
      // El archivo por empleado son montos salariales: además del permiso de exportar, el de datos personales.
      puedeExportar={puede(usuario, "deducciones.exportar") && puede(usuario, "empleados.pii")}
      puedeImportar={puede(usuario, "deducciones.importar")}
      puedeAsignar={puede(usuario, "deducciones.asignar")}
      puedeConfigurar={puede(usuario, "deducciones.configurar")}
      puedeExportarTipos={puede(usuario, "deducciones.exportar") || puede(usuario, "deducciones.configurar")}
      etiquetaSucursal={etiquetasNiveles(conJerarquia).sucursal}
      tipoPlanilla={tipoPlanilla}
      // Con clave: al refrescar tras importar, React lo veía como hijo de una lista sin «key» (2026-11-11).
      solicitudes={puede(usuario, "deducciones.asignar") ? <SolicitudesPrestamoPanel key="solicitudes" /> : null}
      // Negociación de prestaciones y adelantos de décimos: se pagan aparte y se rebajan de
      // la cesantía o del décimo. Los registra quien genera prestaciones.
      anticipos={
        <AnticiposPrestacionPanel
          key="anticipos"
          empleados={empleados.map((e) => ({ id: e.id, codigo: e.codigo, primerNombre: e.primerNombre, segundoNombre: e.segundoNombre, primerApellido: e.primerApellido, segundoApellido: e.segundoApellido }))}
          puedeRegistrar={puede(usuario, "prestaciones.generar")}
        />
      }
    />
  );
}
