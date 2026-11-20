/**
 * Lee de la base lo que necesita `tablaEstructura`, con el ALCANCE del usuario: quien sólo
 * alcanza sus sucursales exporta sus sucursales. Lo usan «Exportar estructura» en
 * Empleados y en Jerarquía de nómina, y el reporte del mismo nombre.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { conAlcance, filtroSucursales, type UsuarioConAlcance } from "@/lib/auth/alcance";
import { etiquetaEstado } from "@/components/ui/EstadoBadge";
import { formatCurrency, formatDate, nombreCompleto } from "@/lib/utils";
import { divisionesHabilitadas, jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { tablaEstructura, type DetalleEstructura, type TablaEstructura } from "./estructura-organizacional";

export interface PedidoEstructura {
  detalle: DetalleEstructura;
  /** Un solo grupo (el modelo `Sucursal`); vacío = todos los del alcance. */
  sucursalId?: string | null;
  /** Una sola sucursal de la jerarquía (el modelo `Division`). */
  divisionId?: string | null;
  /** Un solo departamento (el filtro de Reportes). */
  departamentoId?: string | null;
  /** Contar también a los dados de baja (INACTIVO). */
  incluirInactivos?: boolean;
  /** Identidad y salario en el detalle de empleados. */
  vePII: boolean;
}

export async function cargarTablaEstructura(
  db: PrismaClient,
  usuario: UsuarioConAlcance,
  pedido: PedidoEstructura,
): Promise<TablaEstructura & { filtros: string[] }> {
  const [conDivisiones, conJerarquia] = await Promise.all([divisionesHabilitadas(db), jerarquiaNominaHabilitada(db)]);
  const niveles = etiquetasNiveles(conJerarquia);
  const divisionId = conDivisiones ? pedido.divisionId || null : null;

  const grupos = await db.sucursal.findMany({
    where: { AND: [filtroSucursales(usuario), pedido.sucursalId ? { id: pedido.sucursalId } : {}] },
    select: { id: true, nombre: true, codigo: true, rtn: true, activa: true },
  });
  const idsGrupo = grupos.map((g) => g.id);

  const [divisiones, departamentos] = await Promise.all([
    conDivisiones
      ? db.division.findMany({
          where: { sucursalId: { in: idsGrupo }, ...(divisionId ? { id: divisionId } : {}) },
          select: { id: true, nombre: true, codigo: true, rtn: true, sucursalId: true, activa: true },
        })
      : Promise.resolve([]),
    db.departamento.findMany({
      where: { sucursalId: { in: idsGrupo }, ...(divisionId ? { divisionId } : {}), ...(pedido.departamentoId ? { id: pedido.departamentoId } : {}) },
      select: { id: true, nombre: true, codigo: true, sucursalId: true, divisionId: true, activo: true },
    }),
  ]);
  const idsDepto = departamentos.map((d) => d.id);

  const filtroPersonas: Prisma.EmpleadoWhereInput = {
    AND: [{ departamentoId: { in: idsDepto } }, pedido.incluirInactivos ? {} : { estado: { not: "INACTIVO" } }],
  };
  const conDetalle = pedido.detalle === "empleados";
  const [puestos, empleados] = await Promise.all([
    db.puesto.findMany({ where: { departamentoId: { in: idsDepto } }, select: { id: true, nombre: true, departamentoId: true, activo: true } }),
    db.empleado.findMany({
      where: conAlcance(filtroPersonas, usuario),
      select: {
        codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
        departamentoId: true, puestoId: true, tipoPlanilla: true, fechaIngreso: true, estado: true,
        identidad: conDetalle && pedido.vePII, salarioBase: conDetalle && pedido.vePII,
      },
      take: 20_000,
    }),
  ]);

  const tabla = tablaEstructura(
    {
      grupos: grupos.map((g) => ({ id: g.id, nombre: g.nombre, codigo: g.codigo, rtn: g.rtn, activo: g.activa })),
      divisiones: divisiones.map((v) => ({ id: v.id, nombre: v.nombre, codigo: v.codigo, rtn: v.rtn, sucursalId: v.sucursalId, activo: v.activa })),
      departamentos,
      puestos,
      empleados: empleados.map((e) => ({
        codigo: e.codigo,
        nombre: nombreCompleto(e),
        departamentoId: e.departamentoId,
        puestoId: e.puestoId,
        frecuencia: etiquetaEstado(e.tipoPlanilla),
        ingreso: formatDate(e.fechaIngreso),
        estado: etiquetaEstado(e.estado),
        identidad: e.identidad ?? null,
        salario: e.salarioBase != null ? formatCurrency(Number(e.salarioBase)) : undefined,
      })),
    },
    { detalle: pedido.detalle, niveles, conDivisiones, vePII: pedido.vePII },
  );

  const filtros = [
    pedido.sucursalId ? `${niveles.sucursal}: ${grupos[0]?.nombre ?? "—"}` : niveles.todasSucursales,
    divisionId ? `${niveles.division}: ${divisiones[0]?.nombre ?? "—"}` : "",
    pedido.detalle === "departamentos" ? "Hasta departamentos" : pedido.detalle === "puestos" ? "Con los puestos" : "Con los empleados",
    pedido.incluirInactivos ? "Incluye a los dados de baja" : "Sin los dados de baja",
  ].filter(Boolean);
  return { ...tabla, filtros };
}
