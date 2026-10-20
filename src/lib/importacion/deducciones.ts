/**
 * Validación y aplicación de una importación de deducciones de empleado.
 *
 * Una deducción descuenta del salario de un trabajador, y el Código del Trabajo
 * (art. 371) exige causa vigente para cada una. Eso marca tres decisiones de
 * este módulo:
 *
 * 1. CLAVE NATURAL empleado + tipo + fecha de inicio. Reimportar el mismo
 *    archivo actualiza las mismas filas en vez de duplicar el descuento. Sin
 *    ella, subir dos veces el archivo cobra dos veces.
 *
 * 2. NO SE TOCA UN MONTO YA AMORTIZADO. En cuanto una planilla cobró una cuota,
 *    `saldo` y `cuotasPagadas` dejan de derivarse del monto; cambiarlo desde un
 *    CSV descuadraría el saldo en silencio. Esa corrección se hace por pantalla.
 *
 * 3. SE AVISA DE LO QUE HUELE MAL: una deducción que arranca dentro de un
 *    período ya pagado, o un segundo descuento activo del mismo tipo.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { money } from "@/lib/payroll/money";
import { formatDate } from "@/lib/utils";
import { parsearCsv, mapearColumnas } from "./csv";
import { COLUMNAS_DEDUCCION, clavesEsperadas } from "./columnas";
import * as v from "./valores";
import type { Incidencia, FilaPrevisualizada, ModoImportacion, AccionFila } from "./tipos";

/** Tope por deducción. Ataja el tecleo que multiplica por mil (ver `normalizarNumero`). */
const MONTO_MAXIMO = 5_000_000;

export interface FilaDeduccion {
  linea: number;
  accion: Exclude<AccionFila, "OMITIR">;
  /** Presente al actualizar. */
  deduccionId?: string;
  empleadoId: string;
  tipoDeduccionId: string;
  monto: string;
  cuotasMeses: number | null;
  fechaInicio: string;
  fechaFin: string | null;
  activo: boolean;
  observacion: string | null;
  /** `true` en altas: el saldo arranca igual al monto. */
  inicializaSaldo: boolean;
  cambios: string[];
  referencia: string;
}

export interface ResultadoValidacion {
  filas: FilaDeduccion[];
  incidencias: Incidencia[];
  previsualizacion: FilaPrevisualizada[];
  columnasDesconocidas: string[];
  totalOmitir: number;
}

export interface EmpleadoRef {
  id: string;
  codigo: string;
  nombre: string;
  sucursalId: string;
  departamentoId: string;
  /** Fin del último período de planilla APROBADA o PAGADA. */
  ultimoPeriodoCerrado: Date | null;
}

export interface DeduccionExistente {
  id: string;
  empleadoId: string;
  tipoDeduccionId: string;
  fechaInicio: string; // ISO, clave natural
  monto: string;
  cuotasMeses: number | null;
  cuotasPagadas: number;
  fechaFin: string | null;
  activo: boolean;
  observacion: string | null;
}

export interface CatalogosDeducciones {
  /** código de empleado normalizado → empleado */
  empleados: Map<string, EmpleadoRef>;
  /** código de tipo normalizado → { id, nombre, activo, esLegal } */
  tipos: Map<string, { id: string; nombre: string; activo: boolean; esLegal: boolean }>;
  /** `${empleadoId}|${tipoId}|${fechaInicio ISO}` → deducción, para la clave natural */
  porClaveNatural: Map<string, DeduccionExistente>;
  /** `${empleadoId}|${tipoId}` → deducciones activas, para detectar doble cobro */
  activasPorTipo: Map<string, DeduccionExistente[]>;
}

const norm = (s: string) => s.trim().toLowerCase();
const dia = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export async function cargarCatalogos(db: PrismaClient): Promise<CatalogosDeducciones> {
  const [empleados, tipos, deducciones, cerradas] = await Promise.all([
    db.empleado.findMany({
      select: {
        id: true, codigo: true, primerNombre: true, primerApellido: true,
        sucursalId: true, departamentoId: true,
      },
    }),
    db.tipoDeduccionConfig.findMany({
      select: { id: true, codigo: true, nombre: true, activo: true, esLegal: true },
    }),
    db.deduccionEmpleado.findMany({
      select: {
        id: true, empleadoId: true, tipoDeduccionId: true, fechaInicio: true, monto: true,
        cuotasMeses: true, cuotasPagadas: true, fechaFin: true, activo: true, observacion: true,
      },
    }),
    // Último período ya cerrado por empleado: si una deducción arranca antes de
    // esa fecha, o llega tarde o es un error de tecleo. En ambos casos conviene
    // que quien importa lo vea antes de confirmar.
    db.planillaDetalle.findMany({
      where: { planilla: { estado: { in: ["APROBADA", "PAGADA"] } } },
      select: { empleadoId: true, planilla: { select: { fechaFin: true } } },
    }),
  ]);

  const ultimoCierre = new Map<string, Date>();
  for (const d of cerradas) {
    const actual = ultimoCierre.get(d.empleadoId);
    if (!actual || d.planilla.fechaFin > actual) ultimoCierre.set(d.empleadoId, d.planilla.fechaFin);
  }

  const mapaEmpleados = new Map<string, EmpleadoRef>();
  for (const e of empleados) {
    mapaEmpleados.set(norm(e.codigo), {
      id: e.id,
      codigo: e.codigo,
      nombre: `${e.primerNombre} ${e.primerApellido}`,
      sucursalId: e.sucursalId,
      departamentoId: e.departamentoId,
      ultimoPeriodoCerrado: ultimoCierre.get(e.id) ?? null,
    });
  }

  const mapaTipos = new Map<string, { id: string; nombre: string; activo: boolean; esLegal: boolean }>();
  for (const t of tipos) {
    mapaTipos.set(norm(t.codigo), { id: t.id, nombre: t.nombre, activo: t.activo, esLegal: t.esLegal });
  }

  const porClaveNatural = new Map<string, DeduccionExistente>();
  const activasPorTipo = new Map<string, DeduccionExistente[]>();
  for (const d of deducciones) {
    const registro: DeduccionExistente = {
      id: d.id,
      empleadoId: d.empleadoId,
      tipoDeduccionId: d.tipoDeduccionId,
      fechaInicio: dia(d.fechaInicio),
      monto: d.monto.toString(),
      cuotasMeses: d.cuotasMeses,
      cuotasPagadas: d.cuotasPagadas,
      fechaFin: d.fechaFin ? dia(d.fechaFin) : null,
      activo: d.activo,
      observacion: d.observacion,
    };
    porClaveNatural.set(`${d.empleadoId}|${d.tipoDeduccionId}|${registro.fechaInicio}`, registro);
    if (d.activo) {
      const clave = `${d.empleadoId}|${d.tipoDeduccionId}`;
      const lista = activasPorTipo.get(clave) ?? [];
      lista.push(registro);
      activasPorTipo.set(clave, lista);
    }
  }

  return { empleados: mapaEmpleados, tipos: mapaTipos, porClaveNatural, activasPorTipo };
}

export type ComprobadorAlcance = (e: {
  id: string;
  sucursalId: string;
  departamentoId: string;
}) => boolean;

export function validar(
  texto: string,
  catalogos: CatalogosDeducciones,
  modo: ModoImportacion,
  alcanza: ComprobadorAlcance
): ResultadoValidacion {
  const csv = parsearCsv(texto);
  const incidencias: Incidencia[] = [];
  const filas: FilaDeduccion[] = [];
  const previsualizacion: FilaPrevisualizada[] = [];
  let totalOmitir = 0;

  if (csv.cabeceras.length === 0) {
    incidencias.push({ linea: 1, severidad: "ERROR", mensaje: "El archivo está vacío." });
    return { filas, incidencias, previsualizacion, columnasDesconocidas: [], totalOmitir };
  }

  const { indices, desconocidas } = mapearColumnas(csv.cabeceras, clavesEsperadas(COLUMNAS_DEDUCCION));
  for (const desconocida of desconocidas) {
    incidencias.push({
      linea: 1,
      columna: desconocida,
      severidad: "AVISO",
      mensaje: "Columna no reconocida; se ignorará.",
    });
  }

  const tiene = (clave: string) => indices[clave] !== undefined;
  const celda = (fila: string[], clave: string) => (tiene(clave) ? fila[indices[clave]] : undefined);

  for (const clave of ["empleado_codigo", "tipo_deduccion_codigo", "monto", "fecha_inicio"]) {
    if (!tiene(clave)) {
      incidencias.push({
        linea: 1,
        severidad: "ERROR",
        mensaje: `Falta la columna obligatoria "${clave}". Descargue la plantilla para ver el formato.`,
      });
    }
  }
  if (incidencias.some((i) => i.severidad === "ERROR")) {
    return { filas, incidencias, previsualizacion, columnasDesconocidas: desconocidas, totalOmitir };
  }

  /** Claves naturales ya vistas en ESTE archivo, para no aplicar dos filas a la misma deducción. */
  const vistas = new Map<string, number>();

  for (const { linea, celdas } of csv.filas) {
    const errores: Incidencia[] = [];
    const avisos: Incidencia[] = [];
    const anota = (columna: string | undefined, mensaje: string, sev: "ERROR" | "AVISO" = "ERROR") =>
      (sev === "ERROR" ? errores : avisos).push({ linea, columna, severidad: sev, mensaje });

    // ─── Empleado ───────────────────────────────────────────────────────────
    const codigoEmpleado = (celda(celdas, "empleado_codigo") ?? "").trim();
    const empleado = codigoEmpleado ? catalogos.empleados.get(norm(codigoEmpleado)) : undefined;
    if (!codigoEmpleado) {
      anota("Codigo Empleado", "Es obligatorio.");
    } else if (!empleado) {
      anota("Codigo Empleado", `No existe un empleado con código "${codigoEmpleado}".`);
    } else if (!alcanza(empleado)) {
      anota("Codigo Empleado", "Este empleado está fuera de su alcance de datos.");
    }

    // ─── Tipo de deducción ──────────────────────────────────────────────────
    const codigoTipo = (celda(celdas, "tipo_deduccion_codigo") ?? "").trim();
    const tipo = codigoTipo ? catalogos.tipos.get(norm(codigoTipo)) : undefined;
    if (!codigoTipo) {
      anota("Codigo Deduccion", "Es obligatorio.");
    } else if (!tipo) {
      anota("Codigo Deduccion", `No existe un tipo de deducción con código "${codigoTipo}".`);
    } else if (!tipo.activo) {
      anota("Codigo Deduccion", `El tipo "${tipo.nombre}" está desactivado.`);
    } else if (tipo.esLegal) {
      // IHSS, RAP e INFOP los calcula el motor de nómina a partir de su
      // configuración; asignarlos como deducción individual los cobraría dos veces.
      anota(
        "Codigo Deduccion",
        `"${tipo.nombre}" es una deducción legal: la calcula la planilla automáticamente y no debe asignarse por empleado.`
      );
    }

    // ─── Importe ────────────────────────────────────────────────────────────
    const rMonto = v.decimal(celda(celdas, "monto"), { min: 0.01, max: MONTO_MAXIMO });
    if (!rMonto.ok) anota("Monto", rMonto.error);

    // ─── Fechas ─────────────────────────────────────────────────────────────
    const rInicio = v.fecha(celda(celdas, "fecha_inicio"));
    if (!rInicio.ok) anota("Fecha Inicio", rInicio.error);

    let fechaFin: Date | null = null;
    if (tiene("fecha_fin") && !v.vacia(celda(celdas, "fecha_fin"))) {
      const r = v.fecha(celda(celdas, "fecha_fin"));
      if (!r.ok) anota("Fecha Fin", r.error);
      else fechaFin = r.valor;
    }
    if (fechaFin && rInicio.ok && fechaFin < rInicio.valor) {
      anota("Fecha Fin", "Es anterior a la fecha de inicio.");
    }

    // ─── Cuotas y resto ─────────────────────────────────────────────────────
    let cuotasMeses: number | null = null;
    if (tiene("cuotas_meses") && !v.vacia(celda(celdas, "cuotas_meses"))) {
      const r = v.entero(celda(celdas, "cuotas_meses"), { min: 1, max: 600 });
      if (!r.ok) anota("Cuotas", r.error);
      else cuotasMeses = r.valor;
    }

    let activo = true;
    if (tiene("activo") && !v.vacia(celda(celdas, "activo"))) {
      const r = v.booleano(celda(celdas, "activo"), true);
      if (!r.ok) anota("Activa", r.error);
      else activo = r.valor;
    }

    let observacion: string | null = null;
    if (tiene("observacion") && !v.vacia(celda(celdas, "observacion"))) {
      const r = v.texto(celda(celdas, "observacion"), 500);
      if (!r.ok) anota("Observacion", r.error);
      else observacion = r.valor || null;
    }

    // Sin empleado, tipo, monto o fecha no hay nada que decidir.
    if (!empleado || !tipo || !rMonto.ok || !rInicio.ok) {
      incidencias.push(...errores, ...avisos);
      continue;
    }

    const inicioISO = dia(rInicio.valor);
    const claveNatural = `${empleado.id}|${tipo.id}|${inicioISO}`;
    const referencia = `${empleado.codigo} · ${empleado.nombre} · ${tipo.nombre}`;

    const duplicadaEnArchivo = vistas.get(claveNatural);
    if (duplicadaEnArchivo !== undefined) {
      anota(
        undefined,
        `Ya hay una fila para este empleado, tipo y fecha en la línea ${duplicadaEnArchivo}.`
      );
    } else {
      vistas.set(claveNatural, linea);
    }

    const existente = catalogos.porClaveNatural.get(claveNatural);
    const cambios: string[] = [];
    let accion: Exclude<AccionFila, "OMITIR">;

    if (existente) {
      if (modo === "CREAR") {
        totalOmitir++;
        incidencias.push(...avisos);
        previsualizacion.push({
          linea, accion: "OMITIR", referencia,
          cambios: ["Ya existe y el modo es sólo alta."],
        });
        continue;
      }
      accion = "ACTUALIZAR";

      const montoNuevo = rMonto.valor;
      const montoCambia = !montoNuevo.equals(money(existente.monto));

      // La regla que protege el saldo: en cuanto una planilla cobró una cuota,
      // `saldo` ya no se deduce del monto y reescribirlo desde un CSV dejaría el
      // pendiente descuadrado sin que nada lo delate.
      if (montoCambia && existente.cuotasPagadas > 0) {
        anota(
          "Monto",
          `Esta deducción ya tiene ${existente.cuotasPagadas} cuota(s) cobrada(s): el monto no puede cambiarse por importación. Ajústelo desde la pantalla de deducciones.`
        );
      } else if (montoCambia) {
        cambios.push(`Monto ${money(existente.monto).toFixed(2)} → ${montoNuevo.toFixed(2)}`);
      }

      if (cuotasMeses !== existente.cuotasMeses) cambios.push("Cuotas");
      if ((fechaFin ? dia(fechaFin) : null) !== existente.fechaFin) cambios.push("Fecha Fin");
      if (activo !== existente.activo) cambios.push(activo ? "Reactivar" : "Desactivar");
      if (observacion !== existente.observacion) cambios.push("Observación");
    } else {
      if (modo === "ACTUALIZAR") {
        totalOmitir++;
        incidencias.push(...avisos);
        previsualizacion.push({
          linea, accion: "OMITIR", referencia,
          cambios: ["No existe y el modo es sólo actualización."],
        });
        continue;
      }
      accion = "CREAR";

      // Otro descuento activo del mismo tipo con otra fecha: puede ser legítimo
      // (un segundo préstamo) o un doble cobro. No se bloquea, se advierte.
      const otras = catalogos.activasPorTipo.get(`${empleado.id}|${tipo.id}`) ?? [];
      if (otras.length > 0 && activo) {
        anota(
          undefined,
          `Este empleado ya tiene ${otras.length} deducción(es) activa(s) de tipo "${tipo.nombre}". Se sumarán en la planilla.`,
          "AVISO"
        );
      }

      if (empleado.ultimoPeriodoCerrado && rInicio.valor <= empleado.ultimoPeriodoCerrado) {
        anota(
          "Fecha Inicio",
          `Arranca dentro de un período ya cerrado (última planilla pagada hasta ${formatDate(empleado.ultimoPeriodoCerrado)}). Se cobrará en la próxima planilla.`,
          "AVISO"
        );
      }
    }

    incidencias.push(...errores, ...avisos);
    if (errores.length > 0) continue;

    if (accion === "ACTUALIZAR" && cambios.length === 0) {
      totalOmitir++;
      previsualizacion.push({
        linea, accion: "OMITIR", referencia,
        cambios: ["Sin cambios respecto a lo registrado."],
      });
      continue;
    }

    filas.push({
      linea,
      accion,
      deduccionId: existente?.id,
      empleadoId: empleado.id,
      tipoDeduccionId: tipo.id,
      monto: rMonto.valor.toFixed(2),
      cuotasMeses,
      fechaInicio: rInicio.valor.toISOString(),
      fechaFin: fechaFin ? fechaFin.toISOString() : null,
      activo,
      observacion,
      inicializaSaldo: accion === "CREAR",
      cambios,
      referencia,
    });

    previsualizacion.push({ linea, accion, referencia, cambios });
  }

  return { filas, incidencias, previsualizacion, columnasDesconocidas: desconocidas, totalOmitir };
}

export interface ResultadoAplicacion {
  creados: number;
  actualizados: number;
  ids: string[];
}

export async function aplicar(
  tx: Prisma.TransactionClient,
  filas: FilaDeduccion[]
): Promise<ResultadoAplicacion> {
  let creados = 0;
  let actualizados = 0;
  const ids: string[] = [];

  for (const fila of filas) {
    if (fila.accion === "CREAR") {
      const creada = await tx.deduccionEmpleado.create({
        data: {
          empleadoId: fila.empleadoId,
          tipoDeduccionId: fila.tipoDeduccionId,
          monto: fila.monto,
          // Igual que POST /api/empleados/[id]/deducciones: el saldo arranca en
          // el monto total y lo va reduciendo cada amortización de planilla.
          saldo: fila.monto,
          cuotasMeses: fila.cuotasMeses,
          fechaInicio: new Date(fila.fechaInicio),
          fechaFin: fila.fechaFin ? new Date(fila.fechaFin) : null,
          activo: fila.activo,
          observacion: fila.observacion,
        },
      });
      creados++;
      ids.push(creada.id);
    } else {
      const datos: Prisma.DeduccionEmpleadoUpdateInput = {
        cuotasMeses: fila.cuotasMeses,
        fechaFin: fila.fechaFin ? new Date(fila.fechaFin) : null,
        activo: fila.activo,
        observacion: fila.observacion,
      };
      // El monto sólo se toca cuando la validación lo permitió (sin cuotas
      // cobradas), y entonces el saldo vuelve a partir del total.
      if (fila.cambios.some((c) => c.startsWith("Monto"))) {
        datos.monto = fila.monto;
        datos.saldo = fila.monto;
      }
      await tx.deduccionEmpleado.update({ where: { id: fila.deduccionId! }, data: datos });
      actualizados++;
      ids.push(fila.deduccionId!);
    }
  }

  return { creados, actualizados, ids };
}
