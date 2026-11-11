/**
 * Exportación de empleados a CSV.
 *
 * TRES REGLAS QUE NO SE PUEDEN RELAJAR:
 *
 * 1. LAS MISMAS COLUMNAS QUE LA PANTALLA. `GET /api/empleados` distingue el
 *    directorio del expediente: sin `empleados.pii` no devuelve identidad, RTN,
 *    salario, dirección ni cuenta bancaria. Una exportación que ignorara esa
 *    distinción sería la vía cómoda para sacar en un archivo justo lo que la
 *    interfaz oculta.
 *
 * 2. EL MISMO ALCANCE. Quien sólo alcanza su sucursal exporta su sucursal.
 *
 * 3. QUEDA RASTRO. Un archivo con la plantilla completa sale del sistema y ya no
 *    vuelve; hay que poder decir quién lo descargó, cuándo, cuántas filas y si
 *    llevaba datos personales.
 *
 * La pantalla manda por POST los empleados marcados (en una URL no caben cientos
 * de ids). Sin ninguno marcado, el archivo sale sólo con los encabezados.
 */

import { NextRequest, NextResponse } from "next/server";
import { filtroBusquedaEmpleados } from "@/lib/empleados/busqueda";
import { Prisma, EstadoEmpleado } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso, puede, type Usuario } from "@/lib/auth/guard";
import { conAlcance } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { generarCsv, cabecerasDescarga, delimitadorPedido, type Delimitador } from "@/lib/importacion/csv";
import { cabecerasXlsx, plantillaXlsx } from "@/lib/importacion/xlsx";
import {
  COLUMNAS_EMPLEADO,
  columnasVisibles,
  etiquetas,
  filaEjemplo,
} from "@/lib/importacion/columnas";
import { formatDate, nombreCompleto } from "@/lib/utils";

/**
 * Tope de filas por descarga. No es una restricción de negocio sino de memoria:
 * el CSV se construye entero antes de enviarse. Con más empleados que esto, hay
 * que pasar a respuesta en streaming.
 */
const MAX_FILAS = 20_000;

const schemaSeleccion = z.object({
  ids: z.array(zId).max(MAX_FILAS),
  delimitador: z.string().nullable().optional(),
  formato: z.enum(["csv", "xlsx"]).optional(),
});

async function responderExportacion(
  req: NextRequest,
  usuario: Usuario,
  where: Prisma.EmpleadoWhereInput,
  salida: { delimitador: Delimitador; excel?: boolean },
  filtrosAuditoria: Record<string, unknown>,
  archivo: string
) {
  const vePII = puede(usuario, "empleados.pii");
  const columnas = columnasVisibles(COLUMNAS_EMPLEADO, vePII);

  const total = await prisma.empleado.count({ where });
  if (total > MAX_FILAS) {
    return NextResponse.json(
      {
        error: `La selección tiene ${total} empleados y el máximo por archivo es ${MAX_FILAS}. Filtre por sucursal o departamento.`,
      },
      { status: 413 }
    );
  }

  const empleados = await prisma.empleado.findMany({
    where,
    include: {
      sucursal: { select: { codigo: true, nombre: true } },
      departamento: { select: { nombre: true, division: { select: { nombre: true } } } },
      puesto: { select: { nombre: true } },
      supervisor: { select: { codigo: true } },
      centroCosto: { select: { codigo: true } },
    },
    orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
  });

  // Cada columna sabe extraer su propio valor. El mapa se recorre en el orden de
  // `columnas`, de modo que quitar una columna sensible no descuadra el resto.
  const valorDe: Record<string, (e: (typeof empleados)[number]) => string> = {
    codigo: (e) => e.codigo,
    primer_nombre: (e) => e.primerNombre,
    segundo_nombre: (e) => e.segundoNombre ?? "",
    primer_apellido: (e) => e.primerApellido,
    segundo_apellido: (e) => e.segundoApellido ?? "",
    identidad: (e) => e.identidad ?? "",
    rtn: (e) => e.rtn ?? "",
    ihss_nro: (e) => e.ihssNro ?? "",
    rap_nro: (e) => e.rapNro ?? "",
    fecha_nacimiento: (e) => formatDate(e.fechaNacimiento),
    genero: (e) => e.genero,
    estado_civil: (e) => e.estadoCivil ?? "",
    nacionalidad: (e) => e.nacionalidad,
    telefono_personal: (e) => e.telefonoPersonal ?? "",
    contacto_emergencia: (e) => e.contactoEmergencia ?? "",
    telefono_emergencia: (e) => e.telefonoEmergencia ?? "",
    direccion: (e) => e.direccion ?? "",
    fecha_ingreso: (e) => formatDate(e.fechaIngreso),
    fecha_salida: (e) => (e.fechaSalida ? formatDate(e.fechaSalida) : ""),
    estado: (e) => e.estado,
    tipo_contrato: (e) => e.tipoContrato,
    tipo_planilla: (e) => e.tipoPlanilla,
    // Sin formato de moneda: "L 15,000.00" volvería a entrar como texto que hay
    // que desmontar. El importe se escribe crudo, con punto decimal.
    salario_base: (e) => e.salarioBase.toFixed(2),
    banco: (e) => e.banco ?? "",
    cuenta_bancaria: (e) => e.cuentaBancaria ?? "",
    sucursal: (e) => e.sucursal.codigo,
    division: (e) => e.departamento.division?.nombre ?? "",
    departamento: (e) => e.departamento.nombre,
    puesto: (e) => e.puesto?.nombre ?? "",
    supervisor_codigo: (e) => e.supervisor?.codigo ?? "",
    centro_costo: (e) => e.centroCosto?.codigo ?? "",
    email_corporativo: (e) => e.emailCorporativo ?? "",
    extension: (e) => e.extension ?? "",
  };

  const filas = empleados.map((e) => columnas.map((c) => valorDe[c.clave]?.(e) ?? ""));

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "EXPORT",
    tabla: "Empleado",
    // No hay un registro concreto: el sujeto de la acción es el conjunto.
    registroId: `export:${filas.length}`,
    usuarioId: usuario.id,
    usuarioEmail: usuario.email ?? undefined,
    valorNuevo: {
      filas: filas.length,
      // El dato clave de la auditoría: si el archivo llevaba identidades,
      // salarios y cuentas bancarias, o sólo el directorio.
      incluyePII: vePII && filas.length > 0,
      columnas: columnas.length,
      formato: salida.excel ? "xlsx" : "csv",
      filtros: filtrosAuditoria,
      alcance: usuario.alcance ?? "TODO",
    },
    ip,
    userAgent,
  });

  if (salida.excel) {
    return new NextResponse(new Uint8Array(await plantillaXlsx(columnas, filas)), { headers: cabecerasXlsx(`${archivo}.xlsx`) });
  }
  return new NextResponse(generarCsv(etiquetas(columnas), filas, salida.delimitador), { headers: cabecerasDescarga(`${archivo}.csv`) });
}

const archivoConFecha = () => `empleados_${new Date().toISOString().slice(0, 10)}`;

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("empleados.exportar");
  if (!g.ok) return g.response;

  const vePII = puede(g.usuario, "empleados.pii");
  const { searchParams } = new URL(req.url);
  const delimitador = delimitadorPedido(searchParams.get("delimitador"));

  // ─── Plantilla vacía ────────────────────────────────────────────────────────
  // Cabeceras y una fila de muestra. Es el punto de partida de una carga inicial
  // y, de paso, documenta el formato de fechas y enumerados sin abrir el manual.
  if (searchParams.get("plantilla") === "1") {
    const columnas = columnasVisibles(COLUMNAS_EMPLEADO, vePII);
    if (searchParams.get("formato") === "xlsx") {
      return new NextResponse(new Uint8Array(await plantillaXlsx(columnas)), { headers: cabecerasXlsx("plantilla_empleados.xlsx") });
    }
    const csv = generarCsv(etiquetas(columnas), [filaEjemplo(columnas)], delimitador);
    return new NextResponse(csv, { headers: cabecerasDescarga("plantilla_empleados.csv") });
  }

  // Mismos filtros que la pantalla, para que se exporte lo que se está viendo.
  const search = searchParams.get("search") ?? "";
  const sucursalId = searchParams.get("sucursalId");
  const departamentoId = searchParams.get("departamentoId");
  const estado = searchParams.get("estado");

  const filtros: Prisma.EmpleadoWhereInput = {
    AND: [
      await filtroBusquedaEmpleados(prisma, search, { conIdentidad: vePII }),
      sucursalId ? { sucursalId } : {},
      departamentoId ? { departamentoId } : {},
      estado ? { estado: estado as EstadoEmpleado } : {},
    ],
  };
  const where = conAlcance(filtros, g.usuario);

  // A quién se puede marcar: sólo lo necesario para reconocerlo, sin datos personales.
  if (searchParams.get("lista") === "1") {
    const empleados = await prisma.empleado.findMany({
      where,
      select: {
        id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
        sucursal: { select: { nombre: true } },
        departamento: { select: { nombre: true } },
      },
      orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
      take: MAX_FILAS,
    });
    // `filas` es el formato común de la ventana de exportar (ver ExportarSeleccion).
    return NextResponse.json({
      filas: empleados.map((e) => ({ id: e.id, titulo: nombreCompleto(e), detalle: `${e.codigo}, ${e.departamento.nombre}, ${e.sucursal.nombre}` })),
    });
  }

  return responderExportacion(req, g.usuario, where, { delimitador }, { search: search || undefined, sucursalId, departamentoId, estado }, archivoConFecha());
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("empleados.exportar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schemaSeleccion);
  if (!parsed.ok) return parsed.response;
  const { ids, delimitador, formato } = parsed.data;

  // Con AND el alcance manda: un id de otra sucursal simplemente no sale en el archivo.
  const where = conAlcance({ id: { in: ids } }, g.usuario);
  return responderExportacion(
    req,
    g.usuario,
    where,
    { delimitador: delimitadorPedido(delimitador ?? null), excel: formato === "xlsx" },
    { seleccionados: ids.length },
    ids.length ? archivoConFecha() : "plantilla_empleados_vacia"
  );
}
