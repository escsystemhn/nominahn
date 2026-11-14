/**
 * Catálogo de tipos de deducción por plantilla: crear y actualizar muchos a la vez,
 * por ejemplo al instalar un cliente que trae quince descuentos distintos.
 *
 * Clave: el código. Los de ley y la retención fija de ISR no se tocan por aquí. Se
 * avisa de lo que tiene efecto sobre lo ya asignado: cambiar la categoría cambia el
 * tope legal con que se cobra; desactivar no deja de cobrar lo asignado.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { hoyHN } from "@/lib/utils";
import { CATEGORIAS, etiquetaCategoria, leerCategoria, type CategoriaDeduccion } from "@/lib/deducciones/tipos";
import { MOTIVO_SISTEMA, claveNombreTipo, esTipoDelSistema, leerCodigo, leerDescripcion, leerMontoHabitual, leerNombre } from "@/lib/deducciones/tipos-bd";
import { parsearCsv, mapearColumnas } from "./csv";
import { COLUMNAS_TIPO_DEDUCCION, clavesEsperadas } from "./columnas";
import * as v from "./valores";
import type { FilaPrevisualizada, Incidencia, ModoImportacion } from "./tipos";

export const CLASE_TIPO_DEDUCCION = "TIPO_DEDUCCION";

/** Valores de la lista desplegable de la plantilla. */
export const LISTAS_TIPO_DEDUCCION = {
  categoria: CATEGORIAS.map((c) => c.etiqueta),
  activo: ["Sí", "No"],
};

export interface TipoExistente {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  montoFijo: string | null;
  descripcion: string | null;
  activo: boolean;
  esLegal: boolean;
  /** Empleados que lo tienen asignado y vigente. */
  asignadas: number;
}

export interface FilaTipo {
  clase: typeof CLASE_TIPO_DEDUCCION;
  linea: number;
  accion: "CREAR" | "ACTUALIZAR";
  id?: string;
  datos: { codigo: string; nombre: string; tipo: CategoriaDeduccion; montoFijo: string | null; descripcion: string | null; activo: boolean };
  referencia: string;
  cambios: string[];
}

export interface ResultadoValidacionTipos {
  filas: FilaTipo[];
  incidencias: Incidencia[];
  previsualizacion: FilaPrevisualizada[];
  columnasDesconocidas: string[];
  totalOmitir: number;
}

const lempiras = (m: string | null) => (m === null ? "—" : Number(m).toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function validarTipos(texto: string, existentes: readonly TipoExistente[], modo: ModoImportacion): ResultadoValidacionTipos {
  const r: ResultadoValidacionTipos = { filas: [], incidencias: [], previsualizacion: [], columnasDesconocidas: [], totalOmitir: 0 };
  const csv = parsearCsv(texto);
  if (csv.cabeceras.length === 0) {
    r.incidencias.push({ linea: 1, severidad: "ERROR", mensaje: "El archivo está vacío." });
    return r;
  }
  const ALIAS: Record<string, string[]> = { categoria: ["tipo"], monto_habitual: ["monto"], descripcion: ["descripción"] };
  const { indices, desconocidas } = mapearColumnas(csv.cabeceras, clavesEsperadas(COLUMNAS_TIPO_DEDUCCION).map((c) => ({ ...c, alias: ALIAS[c.clave] })));
  r.columnasDesconocidas = desconocidas;
  for (const c of desconocidas) r.incidencias.push({ linea: 1, columna: c, severidad: "AVISO", mensaje: "Columna no reconocida; se ignorará." });
  if (indices.codigo === undefined) {
    r.incidencias.push({ linea: 1, severidad: "ERROR", mensaje: "Falta la columna «Codigo». Descargue la plantilla para ver el formato." });
    return r;
  }
  const tiene = (k: string) => indices[k] !== undefined;
  const celda = (f: string[], k: string) => (tiene(k) ? f[indices[k]] : undefined);

  const porCodigo = new Map(existentes.map((t) => [t.codigo, t]));
  const porNombre = new Map(existentes.map((t) => [claveNombreTipo(t.nombre), t]));
  const codigosVistos = new Map<string, number>();
  const nombresVistos = new Map<string, number>();

  for (const { linea, celdas } of csv.filas) {
    const errores: Incidencia[] = [];
    const avisos: Incidencia[] = [];
    const anota = (columna: string | undefined, mensaje: string, sev: "ERROR" | "AVISO" = "ERROR") =>
      (sev === "ERROR" ? errores : avisos).push({ linea, columna, severidad: sev, mensaje });

    const rc = leerCodigo(celda(celdas, "codigo"));
    if (!rc.ok) { r.incidencias.push({ linea, columna: "Codigo", severidad: "ERROR", mensaje: rc.error }); continue; }
    const codigo = rc.valor;
    const existente = porCodigo.get(codigo);
    if (existente && esTipoDelSistema(existente)) { r.incidencias.push({ linea, columna: "Codigo", severidad: "ERROR", mensaje: `${codigo} ${MOTIVO_SISTEMA}` }); continue; }
    const repetido = codigosVistos.get(codigo);
    if (repetido !== undefined) { r.incidencias.push({ linea, columna: "Codigo", severidad: "ERROR", mensaje: `El código ${codigo} ya viene en la línea ${repetido}.` }); continue; }
    codigosVistos.set(codigo, linea);

    if (existente && modo === "CREAR") {
      r.totalOmitir++;
      r.previsualizacion.push({ linea, accion: "OMITIR", referencia: `${codigo}, ${existente.nombre}`, cambios: ["Ya existe y el modo es sólo alta."] });
      continue;
    }
    if (!existente && modo === "ACTUALIZAR") {
      r.totalOmitir++;
      r.previsualizacion.push({ linea, accion: "OMITIR", referencia: codigo, cambios: ["No existe y el modo es sólo actualización."] });
      continue;
    }

    // Nombre: obligatorio al crear; vacío al actualizar = sin cambio.
    let nombre = existente?.nombre ?? "";
    if (!v.vacia(celda(celdas, "nombre")) || !existente) {
      const rn = leerNombre(celda(celdas, "nombre"));
      if (!rn.ok) anota("Nombre", rn.error); else nombre = rn.valor;
    }
    if (nombre) {
      const otro = porNombre.get(claveNombreTipo(nombre));
      if (otro && otro.codigo !== codigo) anota("Nombre", `Ya hay un tipo llamado «${otro.nombre}» con el código ${otro.codigo}.`);
      const enArchivo = nombresVistos.get(claveNombreTipo(nombre));
      if (enArchivo !== undefined) anota("Nombre", `El nombre «${nombre}» ya viene en la línea ${enArchivo}.`);
      else nombresVistos.set(claveNombreTipo(nombre), linea);
    }

    let tipo = existente?.tipo as CategoriaDeduccion | undefined;
    if (!v.vacia(celda(celdas, "categoria")) || !existente) {
      const t = leerCategoria(celda(celdas, "categoria") ?? "");
      if (!t) anota("Categoria", v.vacia(celda(celdas, "categoria")) ? "Elija la categoría de la lista." : `«${celda(celdas, "categoria")}» no es una categoría. Use una de la lista: ${LISTAS_TIPO_DEDUCCION.categoria.join(", ")}.`);
      else tipo = t;
    }

    let montoFijo = existente?.montoFijo ?? null;
    if (tiene("monto_habitual")) {
      const m = leerMontoHabitual(celda(celdas, "monto_habitual")?.trim() ?? "");
      if (!m.ok) anota("Monto Habitual", m.error); else montoFijo = m.valor;
    }
    let descripcion = existente?.descripcion ?? null;
    if (tiene("descripcion")) {
      const d = leerDescripcion(celda(celdas, "descripcion"));
      if (!d.ok) anota("Descripcion", d.error); else descripcion = d.valor;
    }
    let activo = existente?.activo ?? true;
    if (!v.vacia(celda(celdas, "activo"))) {
      const a = v.booleano(celda(celdas, "activo"));
      if (!a.ok) anota("Activo", `«${celda(celdas, "activo")}»: escriba Sí o No.`); else activo = a.valor;
    }

    if (errores.length || !tipo || !nombre) { r.incidencias.push(...errores, ...avisos); continue; }

    const cambios: string[] = [];
    if (existente) {
      if (nombre !== existente.nombre) cambios.push(`Nombre: ${existente.nombre} → ${nombre}`);
      if (tipo !== existente.tipo) {
        cambios.push(`Categoría: ${etiquetaCategoria(existente.tipo)} → ${etiquetaCategoria(tipo)}`);
        if (existente.asignadas > 0) anota("Categoria", `${existente.asignadas} empleado(s) lo tienen asignado: desde la próxima planilla se les cobra con el tope de «${etiquetaCategoria(tipo)}».`, "AVISO");
      }
      if (montoFijo !== existente.montoFijo) cambios.push(`Monto habitual: ${lempiras(existente.montoFijo)} → ${lempiras(montoFijo)}`);
      if (descripcion !== existente.descripcion) cambios.push("Descripción");
      if (activo !== existente.activo) {
        cambios.push(activo ? "Reactivar" : "Desactivar");
        if (!activo && existente.asignadas > 0) anota("Activo", `${existente.asignadas} empleado(s) lo tienen asignado: se les sigue cobrando; ya no se ofrece para asignar ni sale en el archivo por empleado.`, "AVISO");
      }
      if (cambios.length === 0) {
        r.incidencias.push(...avisos);
        r.totalOmitir++;
        r.previsualizacion.push({ linea, accion: "OMITIR", referencia: `${codigo}, ${nombre}`, cambios: ["Sin cambios."] });
        continue;
      }
    } else {
      cambios.push(etiquetaCategoria(tipo));
      if (montoFijo) cambios.push(`monto habitual ${lempiras(montoFijo)}`);
      if (!activo) cambios.push("inactivo");
    }

    r.incidencias.push(...avisos);
    const accion = existente ? "ACTUALIZAR" : "CREAR";
    const referencia = `${codigo}, ${nombre}`;
    r.filas.push({ clase: CLASE_TIPO_DEDUCCION, linea, accion, id: existente?.id, datos: { codigo, nombre, tipo, montoFijo, descripcion, activo }, referencia, cambios });
    r.previsualizacion.push({ linea, accion, referencia, cambios });
  }
  return r;
}

export async function cargarTiposExistentes(db: PrismaClient): Promise<TipoExistente[]> {
  const [tipos, conteo] = await Promise.all([
    db.tipoDeduccionConfig.findMany({ orderBy: { nombre: "asc" } }),
    db.deduccionEmpleado.groupBy({
      by: ["tipoDeduccionId"],
      where: { activo: true, OR: [{ fechaFin: null }, { fechaFin: { gte: hoyHN() } }] },
      _count: { _all: true },
    }),
  ]);
  const asignadas = new Map(conteo.map((c) => [c.tipoDeduccionId, c._count._all]));
  return tipos.map((t) => ({
    id: t.id, codigo: t.codigo, nombre: t.nombre, tipo: t.tipo, montoFijo: t.montoFijo?.toFixed(2) ?? null,
    descripcion: t.descripcion, activo: t.activo, esLegal: t.esLegal, asignadas: asignadas.get(t.id) ?? 0,
  }));
}

export async function aplicarTipos(tx: Prisma.TransactionClient, filas: readonly FilaTipo[]): Promise<{ creados: number; actualizados: number; ids: string[] }> {
  let creados = 0, actualizados = 0;
  const ids: string[] = [];
  for (const f of filas) {
    const { codigo, ...resto } = f.datos;
    if (f.accion === "CREAR") {
      const t = await tx.tipoDeduccionConfig.create({
        data: { codigo, ...resto, esLegal: false, aplicaEmpleado: true, aplicaEmpleador: false },
        select: { id: true },
      });
      ids.push(t.id); creados++;
    } else {
      // Se vuelve a comprobar al escribir: entre revisar y confirmar alguien pudo marcarlo de ley.
      const n = await tx.tipoDeduccionConfig.updateMany({ where: { id: f.id, codigo, esLegal: false }, data: resto });
      if (n.count !== 1) throw new Error(`El tipo ${codigo} cambió mientras revisaba.`);
      ids.push(f.id!); actualizados++;
    }
  }
  return { creados, actualizados, ids };
}
