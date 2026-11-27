/**
 * Buscar UN empleado para elegirlo, escribiendo (pedido de Edbin, 2026-11-27): reemplaza los
 * <select> que cargaban a todos los empleados en documentos, dotaciones, marcajes,
 * incapacidades, evaluaciones, deducciones, liquidaciones… Ver `BuscadorEmpleado`.
 *
 *   GET ?para=<contexto>&q=<texto>  → { total, empleados } (hasta 20), lo escrito en nombre
 *                                     (cualquier orden, sin tildes) o código
 *   GET ?para=<contexto>&id=<id>    → ese empleado, para mostrar el que ya estaba elegido
 *                                     (aunque hoy no pase el filtro de estado del contexto)
 *
 * CADA CONTEXTO PIDE EL MISMO PERMISO Y APLICA EL MISMO FILTRO QUE LA LISTA QUE REEMPLAZA:
 * las API que reciben el empleado elegido sólo revisan el alcance, no el estado, así que el
 * filtro de estado vive aquí. Con `alcance`, sólo los empleados del alcance de datos de quien
 * busca (`conAlcance`). La identidad sólo cuenta para buscar con `empleados.pii`; la foto
 * sólo se da con `empleados.ver` (sin él, la imagen saldría rota).
 */

import { NextRequest, NextResponse } from "next/server";
import type { EstadoEmpleado, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso, puede, type Usuario } from "@/lib/auth/guard";
import { conAlcance } from "@/lib/auth/alcance";
import type { Permiso } from "@/lib/auth/permisos";
import { filtroBusquedaEmpleados } from "@/lib/empleados/busqueda";
import { vistaDePlan } from "@/lib/horarios/alcance";
import { ESTADOS_QUE_COBRAN } from "@/lib/payroll/elegibles";
import { nombreCompleto } from "@/lib/utils";

/** Lo que cabe de un vistazo; si hay más, la pantalla pide afinar la búsqueda. */
const MAXIMO = 20;

type Filtro = Prisma.EmpleadoWhereInput;
interface Contexto {
  /** Basta uno: los mismos que ya pedían la pantalla y la API que recibe al empleado. */
  permisos: Permiso[];
  /** Con el alcance de datos de quien busca. */
  alcance: boolean;
  /** Qué empleados se ofrecen. Puede responder un error (por ejemplo, un plan que no existe). */
  filtro: (p: URLSearchParams, usuario: Usuario) => Promise<Filtro | NextResponse> | Filtro;
  /** Datos de más que la pantalla usa al elegir. */
  extras?: "sexo" | "ingresoYSalario";
}

const estados = (lista: readonly EstadoEmpleado[]): Filtro => ({ estado: { in: [...lista] } });
const sinInactivos: Filtro = { estado: { not: "INACTIVO" } };
const activos: Filtro = { estado: "ACTIVO" };
/** Excluir a uno (el empleado que se edita no puede ser su propio supervisor). */
const sinEl = (p: URLSearchParams): Filtro => (p.get("excluir") ? { id: { not: p.get("excluir")! } } : {});

const CONTEXTOS: Record<string, Contexto> = {
  // Marcaje manual (Asistencia): activos, de la sucursal que se está viendo si hay filtro.
  asistencia: {
    permisos: ["asistencia.ver", "asistencia.gestionar"], alcance: true,
    filtro: (p) => ({ ...activos, ...(p.get("sucursalId") ? { sucursalId: p.get("sucursalId")! } : {}) }),
  },
  incapacidades: { permisos: ["asistencia.incapacidades"], alcance: true, filtro: () => sinInactivos, extras: "sexo" },
  // PIN en cuarentena y filtro de marcaciones del reloj.
  biometrico: { permisos: ["asistencia.biometrico"], alcance: true, filtro: () => activos },
  // Traer personal de fuera de un plan de horarios: con puesto, de otras sucursales, ya ingresado.
  traslado: {
    permisos: ["asistencia.turnos", "asistencia.ver"], alcance: true,
    filtro: async (p, usuario) => {
      const planId = p.get("planId") ?? "";
      const plan = planId ? await prisma.planHorario.findUnique({ where: { id: planId }, select: { hasta: true, sucursalesIds: true } }) : null;
      if (!plan || (await vistaDePlan(prisma, usuario, planId)).acceso === "ninguno") {
        return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
      }
      return { estado: { notIn: ["INACTIVO", "SUSPENDIDO"] }, puestoId: { not: null }, sucursalId: { notIn: plan.sucursalesIds }, fechaIngreso: { lte: plan.hasta } };
    },
  },
  evaluaciones: { permisos: ["talento.evaluaciones_gestionar"], alcance: true, filtro: () => activos },
  // Inscribir en una capacitación: sin los ya inscritos.
  capacitaciones: {
    permisos: ["talento.capacitaciones_gestionar"], alcance: true,
    filtro: (p) => ({ ...activos, ...(p.get("capacitacionId") ? { capacitaciones: { none: { capacitacionId: p.get("capacitacionId")! } } } : {}) }),
  },
  // Emitir documentos: también a los dados de baja (constancias de trabajo).
  documentos: { permisos: ["documentos.emitir", "documentos.plantillas"], alcance: true, filtro: () => ({}) },
  // Probar una plantilla: los que no están de baja.
  "documentos-prueba": { permisos: ["documentos.emitir", "documentos.plantillas"], alcance: true, filtro: () => sinInactivos },
  dotaciones: { permisos: ["talento.dotaciones_gestionar"], alcance: true, filtro: () => activos },
  deducciones: { permisos: ["deducciones.asignar"], alcance: true, filtro: () => estados(ESTADOS_QUE_COBRAN) },
  anticipos: { permisos: ["prestaciones.generar"], alcance: true, filtro: () => estados(ESTADOS_QUE_COBRAN) },
  liquidaciones: {
    permisos: ["prestaciones.generar"], alcance: true,
    filtro: () => estados(["ACTIVO", "VACACIONES", "PERMISO", "SUSPENDIDO"]), extras: "ingresoYSalario",
  },
  // Supervisor en la ficha: activos de toda la empresa, menos el propio empleado (como la lista de antes).
  supervisor: { permisos: ["empleados.editar"], alcance: false, filtro: (p) => ({ ...activos, ...sinEl(p) }) },
  // Nuevo jefe en el organigrama: los que no están de baja, de su alcance, menos el propio.
  organigrama: { permisos: ["organizacion.reasignar"], alcance: true, filtro: (p) => ({ ...sinInactivos, ...sinEl(p) }) },
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  const ctx = CONTEXTOS[p.get("para") ?? ""];
  if (!ctx) return NextResponse.json({ error: "Indique para qué se busca el empleado." }, { status: 400 });
  const g = await requerirPermiso(ctx.permisos);
  if (!g.ok) return g.response;

  const id = (p.get("id") ?? "").trim();
  const q = (p.get("q") ?? "").trim().slice(0, 100);
  // Con un id, sólo ese y sin el filtro de estado: es el que ya estaba elegido (puede haberse dado de baja).
  let base: Filtro;
  if (id) {
    base = { id };
  } else {
    const f = await ctx.filtro(p, g.usuario);
    if (f instanceof NextResponse) return f;
    base = { AND: [f, await filtroBusquedaEmpleados(prisma, q, { conIdentidad: puede(g.usuario, "empleados.pii") })] };
  }
  const where = ctx.alcance ? conAlcance(base, g.usuario) : base;
  const veFotos = puede(g.usuario, "empleados.ver");

  const [total, filas] = await Promise.all([
    prisma.empleado.count({ where }),
    prisma.empleado.findMany({
      where,
      select: {
        id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
        emailCorporativo: true, estado: true, genero: true, fechaIngreso: true, salarioBase: true,
        puesto: { select: { nombre: true } },
        departamento: { select: { nombre: true, division: { select: { nombre: true } } } },
        sucursal: { select: { nombre: true } },
        foto: { select: { updatedAt: true } },
      },
      orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }, { id: "asc" }],
      take: MAXIMO,
    }),
  ]);

  return NextResponse.json({
    total,
    empleados: filas.map((e) => ({
      id: e.id,
      codigo: e.codigo,
      nombre: nombreCompleto(e),
      puesto: e.puesto?.nombre ?? null,
      departamento: e.departamento.nombre,
      // Con la jerarquía, la «sucursal» es la división del departamento; si no hay, la sucursal.
      lugar: e.departamento.division?.nombre ?? e.sucursal.nombre,
      correo: e.emailCorporativo,
      foto: veFotos ? (e.foto?.updatedAt.getTime() ?? null) : null,
      ...(e.estado === "INACTIVO" ? { inactivo: true } : {}),
      ...(ctx.extras === "sexo" ? { femenino: /^f/i.test(e.genero ?? "") } : {}),
      ...(ctx.extras === "ingresoYSalario" ? { fechaIngreso: ymd(e.fechaIngreso), salarioBase: Number(e.salarioBase) } : {}),
    })),
  });
}
