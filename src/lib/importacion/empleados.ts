/**
 * Validación y aplicación de una importación de empleados.
 *
 * DOS FASES, SIEMPRE. `validar()` no escribe nada: produce un informe con las
 * filas normalizadas y las incidencias por número de línea. `aplicar()` toma ese
 * resultado ya revisado y lo escribe dentro de una transacción. Escribir en el
 * mismo paso en que se valida deja a medias los archivos con errores en la fila
 * 200, y en una nómina eso significa medio departamento actualizado y medio no.
 *
 * SÓLO SE ACTUALIZA LO QUE VIENE EN EL ARCHIVO. Un CSV con `codigo` y
 * `salario_base` cambia el salario y deja el resto intacto; no interpreta las
 * columnas ausentes como "vaciar". Es lo que permite preparar archivos pequeños
 * para un cambio concreto en vez de tener que exportar el expediente entero.
 *
 * EL SALARIO DEJA RASTRO. Cambiarlo por aquí genera la misma fila de
 * `HistorialSalario` que al editarlo por pantalla. Sin eso, la importación sería
 * el agujero por donde se escapa el historial salarial de toda la plantilla.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { EstadoEmpleado, TipoContrato, TipoPlanilla } from "@prisma/client";
import { redondear, money } from "@/lib/payroll/money";
import { formatDate } from "@/lib/utils";
import { parsearCsv, mapearColumnas, type CsvParseado } from "./csv";
import { COLUMNAS_EMPLEADO, clavesEsperadas } from "./columnas";
import * as v from "./valores";
import { creariaCiclo } from "@/lib/organizacion/jerarquia";
import type {
  Incidencia,
  FilaPrevisualizada,
  ModoImportacion,
  AccionFila,
} from "./tipos";

/** Tope de salario aceptado por fila. Ataja el error de tecleo que multiplica por mil. */
const SALARIO_MAXIMO = 5_000_000;

/** Edad mínima para trabajar en Honduras con autorización (Código de la Niñez, art. 120). */
const EDAD_MINIMA = 14;

/**
 * Fila ya validada, lista para escribirse.
 *
 * Se guarda serializada en `LoteImportacion.filas`, así que todos sus campos son
 * primitivos: las fechas viajan como ISO y los importes como texto, no como
 * `Date` ni `Decimal`, que no sobreviven a un viaje por JSON.
 */
export interface FilaEmpleado {
  linea: number;
  accion: Exclude<AccionFila, "OMITIR">;
  empleadoId?: string;
  codigo?: string;
  /** Campos presentes en el archivo, ya normalizados. Ausente = no se toca. */
  datos: Record<string, string | number | boolean | null>;
  /** Se resuelve en la aplicación, cuando ya existen los empleados del propio archivo. */
  supervisorCodigo?: string;
  /** Para la fila de historial salarial. Sólo si el salario cambia. */
  salarioAnterior?: string;
  cambios: string[];
  referencia: string;
}

export interface ResultadoValidacion {
  filas: FilaEmpleado[];
  incidencias: Incidencia[];
  previsualizacion: FilaPrevisualizada[];
  columnasDesconocidas: string[];
  totalOmitir: number;
}

/** Catálogos necesarios para resolver las referencias por nombre o código. */
export interface CatalogosEmpleados {
  /** clave: código o nombre normalizado → id de sucursal */
  sucursales: Map<string, string>;
  /** clave: `${sucursalId}|${nombre normalizado}` → id de departamento */
  departamentos: Map<string, string>;
  /** clave: `${departamentoId}|${nombre normalizado}` → id de puesto */
  puestos: Map<string, string>;
  /** código → empleado existente */
  porCodigo: Map<string, EmpleadoExistente>;
  /** identidad normalizada → código, para detectar duplicados */
  porIdentidad: Map<string, string>;
  /** código normalizado → id de centro de costo */
  centrosCosto: Map<string, string>;
  /** Salario mínimo vigente, para avisar. `null` si no está configurado. */
  salarioMinimo: number | null;
}

/**
 * Registro tal como está hoy en la base, con TODOS los campos que el archivo
 * puede traer.
 *
 * Se cargan todos —y no sólo la clave— porque la vista previa tiene que decir
 * qué cambia DE VERDAD. Comparando sólo el salario, un archivo exportado y
 * reimportado sin tocar declaraba dieciséis campos modificados: la pantalla que
 * existe para dar confianza antes de escribir se volvía ruido.
 */
export interface EmpleadoExistente {
  id: string;
  codigo: string;
  primerNombre: string;
  segundoNombre: string | null;
  primerApellido: string;
  segundoApellido: string | null;
  sucursalId: string;
  departamentoId: string;
  puestoId: string | null;
  supervisorId: string | null;
  salarioBase: string;
  identidad: string | null;
  rtn: string | null;
  ihssNro: string | null;
  rapNro: string | null;
  genero: string;
  estadoCivil: string | null;
  nacionalidad: string;
  telefonoPersonal: string | null;
  telefonoEmergencia: string | null;
  contactoEmergencia: string | null;
  direccion: string | null;
  banco: string | null;
  cuentaBancaria: string | null;
  estado: string;
  tipoContrato: string;
  tipoPlanilla: string;
  fechaNacimiento: string;
  fechaIngreso: string;
  fechaSalida: string | null;
  centroCostoId: string | null;
  emailCorporativo: string | null;
  extension: string | null;
}

/**
 * Valor actual de cada columna, expresado igual que lo produce el `guardar` de
 * `aplicar`, para poder compararlos como texto. Las fechas viajan en ISO por las
 * dos vías, y por eso comparan sin sorpresas de zona horaria.
 */
const VALOR_ACTUAL: Record<string, (e: EmpleadoExistente) => string | null> = {
  primer_nombre: (e) => e.primerNombre,
  segundo_nombre: (e) => e.segundoNombre,
  primer_apellido: (e) => e.primerApellido,
  segundo_apellido: (e) => e.segundoApellido,
  rtn: (e) => e.rtn,
  ihss_nro: (e) => e.ihssNro,
  rap_nro: (e) => e.rapNro,
  genero: (e) => e.genero,
  estado_civil: (e) => e.estadoCivil,
  nacionalidad: (e) => e.nacionalidad,
  telefono_personal: (e) => e.telefonoPersonal,
  telefono_emergencia: (e) => e.telefonoEmergencia,
  contacto_emergencia: (e) => e.contactoEmergencia,
  direccion: (e) => e.direccion,
  banco: (e) => e.banco,
  cuenta_bancaria: (e) => e.cuentaBancaria,
  estado: (e) => e.estado,
  tipo_contrato: (e) => e.tipoContrato,
  tipo_planilla: (e) => e.tipoPlanilla,
  fecha_nacimiento: (e) => e.fechaNacimiento,
  fecha_ingreso: (e) => e.fechaIngreso,
  fecha_salida: (e) => e.fechaSalida,
  email_corporativo: (e) => e.emailCorporativo,
  extension: (e) => e.extension,
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

/** Carga los catálogos de una sola vez. Sin esto la validación haría N consultas por fila. */
export async function cargarCatalogos(db: PrismaClient): Promise<CatalogosEmpleados> {
  const [sucursales, departamentos, puestos, empleados, centros, salarioMinimo] = await Promise.all([
    db.sucursal.findMany({ select: { id: true, codigo: true, nombre: true } }),
    db.departamento.findMany({ select: { id: true, nombre: true, sucursalId: true } }),
    db.puesto.findMany({ select: { id: true, nombre: true, departamentoId: true } }),
    // Se traen los campos completos: es lo que permite comparar y mostrar sólo
    // los cambios reales en la vista previa.
    db.empleado.findMany({
      select: {
        id: true, codigo: true,
        primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
        sucursalId: true, departamentoId: true, puestoId: true, supervisorId: true,
        salarioBase: true, identidad: true, rtn: true, ihssNro: true, rapNro: true,
        genero: true, estadoCivil: true, nacionalidad: true,
        telefonoPersonal: true, telefonoEmergencia: true, contactoEmergencia: true,
        direccion: true, banco: true, cuentaBancaria: true,
        estado: true, tipoContrato: true, tipoPlanilla: true,
        fechaNacimiento: true, fechaIngreso: true, fechaSalida: true,
        centroCostoId: true, emailCorporativo: true, extension: true,
      },
    }),
    db.centroCosto.findMany({ where: { activo: true }, select: { id: true, codigo: true, nombre: true } }),
    db.salarioMinimo.findFirst({ where: { activo: true }, orderBy: { anio: "desc" } }),
  ]);

  const mapaSucursales = new Map<string, string>();
  for (const s of sucursales) {
    // Se indexa por código Y por nombre: el archivo puede traer cualquiera de los
    // dos, y obligar al código convierte una carga inicial en un ejercicio de
    // transcripción.
    mapaSucursales.set(norm(s.codigo), s.id);
    if (!mapaSucursales.has(norm(s.nombre))) mapaSucursales.set(norm(s.nombre), s.id);
  }

  const mapaDepartamentos = new Map<string, string>();
  for (const d of departamentos) mapaDepartamentos.set(`${d.sucursalId}|${norm(d.nombre)}`, d.id);

  const mapaPuestos = new Map<string, string>();
  for (const p of puestos) mapaPuestos.set(`${p.departamentoId}|${norm(p.nombre)}`, p.id);

  const porCodigo = new Map<string, EmpleadoExistente>();
  const porIdentidad = new Map<string, string>();
  for (const e of empleados) {
    const registro: EmpleadoExistente = {
      ...e,
      salarioBase: e.salarioBase.toString(),
      fechaNacimiento: e.fechaNacimiento.toISOString(),
      fechaIngreso: e.fechaIngreso.toISOString(),
      fechaSalida: e.fechaSalida ? e.fechaSalida.toISOString() : null,
    };
    porCodigo.set(norm(e.codigo), registro);
    if (e.identidad) porIdentidad.set(e.identidad.replace(/[\s-]/g, ""), e.codigo);
  }

  const mapaCentros = new Map<string, string>();
  for (const c of centros) {
    mapaCentros.set(norm(c.codigo), c.id);
    if (!mapaCentros.has(norm(c.nombre))) mapaCentros.set(norm(c.nombre), c.id);
  }

  return {
    sucursales: mapaSucursales,
    departamentos: mapaDepartamentos,
    puestos: mapaPuestos,
    porCodigo,
    porIdentidad,
    centrosCosto: mapaCentros,
    salarioMinimo: salarioMinimo ? Number(salarioMinimo.monto) : null,
  };
}

/**
 * Comprobación de alcance: qué empleados puede tocar quien importa.
 *
 * Hacen falta las DOS formas. Al actualizar se comprueba contra el empleado que
 * ya existe; al dar de alta no hay empleado todavía, así que se comprueba contra
 * la sucursal de DESTINO. Sin la segunda, alguien con alcance de una sucursal
 * podría crear personal en otra simplemente escribiendo su código en el CSV
 * —y colarse así en una plantilla que no le corresponde.
 */
export interface ComprobadorAlcance {
  (empleado: { id: string; sucursalId: string; departamentoId: string }): boolean;
  /** ¿Puede dar de alta en esta sucursal? */
  sucursal: (sucursalId: string) => boolean;
}

export function validar(
  texto: string,
  catalogos: CatalogosEmpleados,
  modo: ModoImportacion,
  alcanza: ComprobadorAlcance
): ResultadoValidacion {
  const csv: CsvParseado = parsearCsv(texto);
  const incidencias: Incidencia[] = [];
  const filas: FilaEmpleado[] = [];
  const previsualizacion: FilaPrevisualizada[] = [];
  let totalOmitir = 0;

  if (csv.cabeceras.length === 0) {
    incidencias.push({ linea: 1, severidad: "ERROR", mensaje: "El archivo está vacío." });
    return { filas, incidencias, previsualizacion, columnasDesconocidas: [], totalOmitir };
  }

  const { indices, desconocidas } = mapearColumnas(csv.cabeceras, clavesEsperadas(COLUMNAS_EMPLEADO));

  // Una cabecera mal escrita ("Salaio Base") pasaría desapercibida y la columna
  // simplemente no se aplicaría: el usuario vería "actualizado" sin que su
  // cambio se haya guardado. Se avisa por cada una.
  for (const desconocida of desconocidas) {
    incidencias.push({
      linea: 1,
      columna: desconocida,
      severidad: "AVISO",
      mensaje: `Columna no reconocida; se ignorará. Revise que el nombre coincida con la plantilla.`,
    });
  }

  const tiene = (clave: string) => indices[clave] !== undefined;
  const celda = (fila: string[], clave: string) =>
    tiene(clave) ? fila[indices[clave]] : undefined;

  // Duplicados DENTRO del archivo. Sin esto, dos filas con el mismo código se
  // aplican una tras otra y gana la última, en silencio.
  const codigosVistos = new Map<string, number>();
  const identidadesVistas = new Map<string, number>();

  for (const { linea, celdas } of csv.filas) {
    const errores: Incidencia[] = [];
    const avisos: Incidencia[] = [];
    const anota = (columna: string | undefined, mensaje: string, severidad: "ERROR" | "AVISO" = "ERROR") =>
      (severidad === "ERROR" ? errores : avisos).push({ linea, columna, severidad, mensaje });

    const codigoBruto = celda(celdas, "codigo");
    const codigo = codigoBruto?.trim() ?? "";
    const existente = codigo ? catalogos.porCodigo.get(norm(codigo)) : undefined;

    // ─── Qué se hará con la fila ────────────────────────────────────────────
    let accion: Exclude<AccionFila, "OMITIR">;
    if (existente) {
      if (modo === "CREAR") {
        totalOmitir++;
        previsualizacion.push({
          linea,
          accion: "OMITIR",
          referencia: codigo,
          cambios: ["Ya existe y el modo es sólo alta."],
        });
        continue;
      }
      accion = "ACTUALIZAR";
    } else {
      if (modo === "ACTUALIZAR") {
        totalOmitir++;
        previsualizacion.push({
          linea,
          accion: "OMITIR",
          referencia: codigo || "(sin código)",
          cambios: ["No existe y el modo es sólo actualización."],
        });
        continue;
      }
      if (codigo) {
        // Un código que no existe en una alta se respeta tal cual: permite
        // conservar la numeración de un sistema anterior en la carga inicial.
        anota("Codigo", `El código ${codigo} no existe; se dará de alta con ese código.`, "AVISO");
      }
      accion = "CREAR";
    }

    // ─── Alcance ────────────────────────────────────────────────────────────
    // En las actualizaciones se mide contra el empleado existente; en las altas,
    // contra la sucursal de destino (más abajo, cuando ya está resuelta).
    if (existente && !alcanza(existente)) {
      anota(undefined, "Este empleado está fuera de su alcance de datos.");
    }

    // ─── Duplicados dentro del archivo ──────────────────────────────────────
    if (codigo) {
      const previa = codigosVistos.get(norm(codigo));
      if (previa !== undefined) {
        anota("Codigo", `El código ${codigo} ya aparece en la línea ${previa}.`);
      } else {
        codigosVistos.set(norm(codigo), linea);
      }
    }

    const datos: FilaEmpleado["datos"] = {};
    const cambios: string[] = [];

    /**
     * Aplica una columna: valida, compara con lo que ya hay y sólo la incluye si
     * cambia algo. Así la vista previa dice qué se va a modificar de verdad y
     * una actualización sin cambios no genera escritura ni entrada de auditoría.
     */
    const aplicar = <T>(
      clave: string,
      etiqueta: string,
      parsear: (bruto: string | undefined) => v.Resultado<T>,
      guardar: (valor: T) => string | number | boolean | null,
      opciones?: { requeridoEnAlta?: boolean }
    ) => {
      if (!tiene(clave)) {
        if (accion === "CREAR" && opciones?.requeridoEnAlta) {
          anota(etiqueta, `Falta la columna "${etiqueta}", obligatoria para dar de alta.`);
        }
        return;
      }
      const bruto = celda(celdas, clave);
      if (v.vacia(bruto)) {
        if (accion === "CREAR" && opciones?.requeridoEnAlta) {
          anota(etiqueta, "Es obligatorio al dar de alta.");
        }
        // Vacío en una actualización = "no tocar". Vaciar un campo a propósito se
        // hace por pantalla: no hay forma de distinguir en un CSV una celda que
        // se dejó en blanco por descuido de una que se quiere borrar.
        return;
      }
      const r = parsear(bruto);
      if (!r.ok) {
        anota(etiqueta, r.error);
        return;
      }
      const guardado = guardar(r.valor);
      // Si coincide con lo guardado, no es un cambio: ni se escribe ni se anuncia.
      const actual = existente ? VALOR_ACTUAL[clave]?.(existente) : undefined;
      if (actual !== undefined && String(guardado ?? "") === String(actual ?? "")) return;

      datos[clave] = guardado;
      if (accion === "ACTUALIZAR") cambios.push(etiqueta);
    };

    // ─── Identidad: única en toda la plantilla ──────────────────────────────
    const identidadBruta = celda(celdas, "identidad");
    /**
     * Un valor IDÉNTICO al que ya está guardado no se revalida.
     *
     * POR QUÉ: el formato de identidad hondureña son 13 dígitos, pero en la base
     * puede haber registros antiguos que no lo cumplen —cargados antes de que
     * existiera esta comprobación, o migrados de otro sistema—. Sin esta
     * excepción, reimportar un archivo recién exportado fallaría en filas que
     * nadie ha tocado, y el par exportar/importar dejaría de ser de ida y vuelta.
     *
     * La validación sigue aplicándose a todo lo que CAMBIA, que es donde importa:
     * los datos malos existentes no se propagan, pero tampoco bloquean el resto
     * del archivo.
     */
    const identidadSinCambio =
      !v.vacia(identidadBruta) &&
      !!existente?.identidad &&
      identidadBruta!.replace(/[\s-]/g, "") === existente.identidad.replace(/[\s-]/g, "");

    if (identidadSinCambio) {
      // Nada que validar ni que escribir.
    } else if (tiene("identidad") && !v.vacia(identidadBruta)) {
      const r = v.identidad(identidadBruta);
      if (!r.ok) {
        anota("Identidad", r.error);
      } else {
        const duplicadaEnArchivo = identidadesVistas.get(r.valor);
        if (duplicadaEnArchivo !== undefined) {
          anota("Identidad", `Esta identidad ya aparece en la línea ${duplicadaEnArchivo}.`);
        } else {
          identidadesVistas.set(r.valor, linea);
        }
        const duenoEnBase = catalogos.porIdentidad.get(r.valor);
        if (duenoEnBase && norm(duenoEnBase) !== norm(codigo)) {
          anota("Identidad", `Esta identidad ya pertenece al empleado ${duenoEnBase}.`);
        } else if (r.valor !== (existente?.identidad ?? null)) {
          datos.identidad = r.valor;
          if (accion === "ACTUALIZAR") cambios.push("Identidad");
        }
      }
    } else if (accion === "CREAR" && tiene("identidad")) {
      anota("Identidad", "Sin número de identidad no se podrá emitir la planilla.", "AVISO");
    }

    // ─── Texto ──────────────────────────────────────────────────────────────
    aplicar("primer_nombre", "Primer Nombre", (b) => v.texto(b, 60), (x) => x, { requeridoEnAlta: true });
    aplicar("segundo_nombre", "Segundo Nombre", (b) => v.texto(b, 60), (x) => x);
    aplicar("primer_apellido", "Primer Apellido", (b) => v.texto(b, 60), (x) => x, { requeridoEnAlta: true });
    aplicar("segundo_apellido", "Segundo Apellido", (b) => v.texto(b, 60), (x) => x);
    // Mismo criterio de ida y vuelta que la identidad: un RTN que no cambia no
    // se revalida, para que un registro antiguo fuera de formato no bloquee un
    // archivo en el que esa columna ni siquiera se tocó.
    const rtnBruto = celda(celdas, "rtn");
    const existenteRtn = existente?.rtn ?? null;
    const rtnSinCambio =
      !v.vacia(rtnBruto) &&
      !!existenteRtn &&
      rtnBruto!.replace(/[\s-]/g, "") === existenteRtn.replace(/[\s-]/g, "");
    if (!rtnSinCambio) aplicar("rtn", "RTN", v.rtn, (x) => x);
    aplicar("ihss_nro", "No. IHSS", (b) => v.texto(b, 30), (x) => x);
    aplicar("rap_nro", "No. RAP", (b) => v.texto(b, 30), (x) => x);
    aplicar("estado_civil", "Estado Civil", (b) => v.texto(b, 30), (x) => x);
    aplicar("nacionalidad", "Nacionalidad", (b) => v.texto(b, 40), (x) => x);
    aplicar("telefono_personal", "Telefono", (b) => v.texto(b, 30), (x) => x);
    aplicar("telefono_emergencia", "Telefono Emergencia", (b) => v.texto(b, 30), (x) => x);
    aplicar("contacto_emergencia", "Contacto Emergencia", (b) => v.texto(b, 100), (x) => x);
    aplicar("direccion", "Direccion", (b) => v.texto(b, 300), (x) => x);
    aplicar("banco", "Banco", (b) => v.texto(b, 60), (x) => x);
    aplicar("email_corporativo", "Correo Corporativo", v.correo, (x) => x);
    aplicar("extension", "Extension", (b) => v.texto(b, 10), (x) => x);
    aplicar("cuenta_bancaria", "Cuenta Bancaria", (b) => v.texto(b, 40), (x) => x);
    aplicar("genero", "Genero", (b) => v.enumerado(b, ["M", "F"] as const), (x) => x, {
      requeridoEnAlta: true,
    });

    // ─── Fechas ─────────────────────────────────────────────────────────────
    aplicar("fecha_nacimiento", "Fecha Nacimiento", v.fecha, (d) => d.toISOString(), {
      requeridoEnAlta: true,
    });
    aplicar("fecha_ingreso", "Fecha Ingreso", v.fecha, (d) => d.toISOString(), {
      requeridoEnAlta: true,
    });
    aplicar("fecha_salida", "Fecha Salida", v.fecha, (d) => d.toISOString());

    // ─── Enumerados ─────────────────────────────────────────────────────────
    aplicar("estado", "Estado", (b) => v.enumerado(b, Object.values(EstadoEmpleado)), (x) => x);
    aplicar("tipo_contrato", "Tipo Contrato", (b) => v.enumerado(b, Object.values(TipoContrato)), (x) => x, {
      requeridoEnAlta: true,
    });
    aplicar("tipo_planilla", "Tipo Planilla", (b) => v.enumerado(b, Object.values(TipoPlanilla)), (x) => x, {
      requeridoEnAlta: true,
    });

    // ─── Salario ────────────────────────────────────────────────────────────
    let salarioAnterior: string | undefined;
    if (tiene("salario_base") && !v.vacia(celda(celdas, "salario_base"))) {
      const r = v.decimal(celda(celdas, "salario_base"), { min: 1, max: SALARIO_MAXIMO });
      if (!r.ok) {
        anota("Salario Base", r.error);
      } else {
        const nuevo = r.valor;
        const anterior = existente ? money(existente.salarioBase) : null;
        if (!anterior || !nuevo.equals(anterior)) {
          datos.salario_base = nuevo.toFixed(2);
          if (existente) {
            salarioAnterior = anterior!.toFixed(2);
            cambios.push(
              `Salario ${anterior!.toFixed(2)} → ${nuevo.toFixed(2)}`
            );
          }
        }
        if (catalogos.salarioMinimo !== null && nuevo.lessThan(catalogos.salarioMinimo)) {
          anota(
            "Salario Base",
            `Está por debajo del salario mínimo vigente (${catalogos.salarioMinimo.toFixed(2)}).`,
            "AVISO"
          );
        }
      }
    } else if (accion === "CREAR") {
      anota("Salario Base", "Es obligatorio al dar de alta.");
    }

    // ─── Sucursal, departamento y puesto ────────────────────────────────────
    // Se resuelven en cadena: el departamento cuelga de la sucursal y el puesto
    // del departamento, así que un cambio de sucursal obliga a reevaluar ambos.
    const sucursalBruta = celda(celdas, "sucursal");
    let sucursalId: string | undefined = existente?.sucursalId;
    if (tiene("sucursal") && !v.vacia(sucursalBruta)) {
      const encontrada = catalogos.sucursales.get(norm(sucursalBruta!));
      if (!encontrada) {
        anota("Sucursal", `No existe una sucursal con código o nombre "${sucursalBruta}".`);
        sucursalId = undefined;
      } else if (!alcanza.sucursal(encontrada)) {
        // Mover a alguien a una sucursal fuera de su alcance equivale a sacarlo
        // de su vista, y dar de alta allí, a poblar una plantilla ajena.
        anota("Sucursal", `La sucursal "${sucursalBruta}" está fuera de su alcance de datos.`);
        sucursalId = undefined;
      } else {
        if (encontrada !== existente?.sucursalId) {
          datos.sucursal = encontrada;
          if (accion === "ACTUALIZAR") cambios.push("Sucursal");
        }
        sucursalId = encontrada;
      }
    } else if (accion === "CREAR") {
      anota("Sucursal", "Es obligatoria al dar de alta.");
    }

    const deptoBruto = celda(celdas, "departamento");
    let departamentoId: string | undefined = existente?.departamentoId;
    if (tiene("departamento") && !v.vacia(deptoBruto)) {
      if (!sucursalId) {
        // Sin sucursal válida no se puede resolver; el error de sucursal ya está
        // anotado y repetirlo aquí sólo ensucia el informe.
        departamentoId = undefined;
      } else {
        const encontrado = catalogos.departamentos.get(`${sucursalId}|${norm(deptoBruto!)}`);
        if (!encontrado) {
          anota("Departamento", `La sucursal indicada no tiene un departamento llamado "${deptoBruto}".`);
          departamentoId = undefined;
        } else {
          if (encontrado !== existente?.departamentoId) {
            datos.departamento = encontrado;
            if (accion === "ACTUALIZAR") cambios.push("Departamento");
          }
          departamentoId = encontrado;
        }
      }
    } else if (accion === "CREAR") {
      anota("Departamento", "Es obligatorio al dar de alta.");
    }

    const puestoBruto = celda(celdas, "puesto");
    if (tiene("puesto") && !v.vacia(puestoBruto)) {
      if (departamentoId) {
        const encontrado = catalogos.puestos.get(`${departamentoId}|${norm(puestoBruto!)}`);
        if (!encontrado) {
          anota("Puesto", `El departamento indicado no tiene un puesto llamado "${puestoBruto}".`);
        } else if (encontrado !== existente?.puestoId) {
          datos.puesto = encontrado;
          if (accion === "ACTUALIZAR") cambios.push("Puesto");
        }
      }
    }

    const centroBruto = celda(celdas, "centro_costo");
    if (tiene("centro_costo") && !v.vacia(centroBruto)) {
      const encontrado = catalogos.centrosCosto.get(norm(centroBruto!));
      if (!encontrado) {
        anota("Centro Costo", `No existe un centro de costo activo con código o nombre "${centroBruto}".`);
      } else if (encontrado !== existente?.centroCostoId) {
        datos.centro_costo = encontrado;
        if (accion === "ACTUALIZAR") cambios.push("Centro de costo");
      }
    }

    // El supervisor se guarda por código y se resuelve al aplicar: puede ser un
    // empleado que se da de alta en este mismo archivo, unas líneas más abajo.
    const supervisorBruto = celda(celdas, "supervisor_codigo");
    let supervisorCodigo: string | undefined;
    if (tiene("supervisor_codigo") && !v.vacia(supervisorBruto)) {
      supervisorCodigo = supervisorBruto!.trim();
      if (norm(supervisorCodigo) === norm(codigo)) {
        anota("Codigo Supervisor", "Un empleado no puede ser su propio supervisor.");
      }
      // Sólo es un cambio si apunta a otra persona.
      const supervisorActual = existente?.supervisorId
        ? catalogos.porCodigo.get(norm(supervisorCodigo))?.id === existente.supervisorId
        : false;
      if (accion === "ACTUALIZAR" && !supervisorActual) cambios.push("Supervisor");
    }

    // ─── Coherencia entre campos ────────────────────────────────────────────
    /**
     * Se compara el valor EFECTIVO tras el cambio: el del archivo si viene, y si
     * no, el que ya está guardado.
     *
     * Mirando sólo `datos` —que contiene únicamente lo que cambia— un archivo que
     * traiga la fecha de salida sin la de ingreso no se contrastaría contra nada,
     * y una salida anterior al ingreso entraría sin que nadie la viera.
     */
    const efectiva = (clave: string, guardada: string | null | undefined) => {
      const nueva = datos[clave];
      const valor = nueva !== undefined ? String(nueva) : guardada;
      return valor ? new Date(valor) : null;
    };
    const nacimiento = efectiva("fecha_nacimiento", existente?.fechaNacimiento);
    const ingreso = efectiva("fecha_ingreso", existente?.fechaIngreso);
    const salida = efectiva("fecha_salida", existente?.fechaSalida);

    if (nacimiento && ingreso) {
      const edad = (ingreso.getTime() - nacimiento.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (edad < EDAD_MINIMA) {
        anota("Fecha Ingreso", `Al ingresar tendría ${Math.floor(edad)} años, por debajo del mínimo legal.`);
      } else if (edad > 80) {
        anota("Fecha Nacimiento", "La fecha de nacimiento parece equivocada (más de 80 años al ingresar).", "AVISO");
      }
    }
    if (ingreso && ingreso.getTime() > Date.now()) {
      anota("Fecha Ingreso", "Es una fecha futura.", "AVISO");
    }
    if (salida && ingreso && salida < ingreso) {
      anota("Fecha Salida", "Es anterior a la fecha de ingreso.");
    }
    const estadoEfectivo = datos.estado !== undefined ? String(datos.estado) : existente?.estado;
    if (estadoEfectivo === "INACTIVO" && !salida) {
      anota("Estado", "Un empleado inactivo debería tener fecha de salida.", "AVISO");
    }

    incidencias.push(...errores, ...avisos);

    if (errores.length > 0) continue;

    // Una actualización que no cambia nada no llega a escribirse, pero sí se
    // muestra: quien sube el archivo debe ver que su fila se leyó bien.
    if (accion === "ACTUALIZAR" && cambios.length === 0) {
      totalOmitir++;
      previsualizacion.push({
        linea,
        accion: "OMITIR",
        referencia: `${codigo} · ${existente!.primerNombre} ${existente!.primerApellido}`,
        cambios: ["Sin cambios respecto a lo registrado."],
      });
      continue;
    }

    const referencia =
      accion === "ACTUALIZAR"
        ? `${codigo} · ${existente!.primerNombre} ${existente!.primerApellido}`
        : `${codigo || "(nuevo)"} · ${datos.primer_nombre ?? ""} ${datos.primer_apellido ?? ""}`.trim();

    filas.push({
      linea,
      accion,
      empleadoId: existente?.id,
      codigo: codigo || undefined,
      datos,
      supervisorCodigo,
      salarioAnterior,
      cambios,
      referencia,
    });

    previsualizacion.push({ linea, accion, referencia, cambios });
  }

  return { filas, incidencias, previsualizacion, columnasDesconocidas: desconocidas, totalOmitir };
}

// ─── APLICACIÓN ───────────────────────────────────────────────────────────────

export interface ResultadoAplicacion {
  creados: number;
  actualizados: number;
  /** Ids afectados, para la auditoría. */
  ids: string[];
}

/** Traduce las claves del CSV a los campos del modelo. */
function aDatosPrisma(datos: FilaEmpleado["datos"]) {
  const d: Record<string, unknown> = {};
  const texto = (k: string, campo: string) => {
    if (datos[k] !== undefined) d[campo] = datos[k];
  };

  texto("primer_nombre", "primerNombre");
  texto("segundo_nombre", "segundoNombre");
  texto("primer_apellido", "primerApellido");
  texto("segundo_apellido", "segundoApellido");
  texto("identidad", "identidad");
  texto("rtn", "rtn");
  texto("ihss_nro", "ihssNro");
  texto("rap_nro", "rapNro");
  texto("genero", "genero");
  texto("estado_civil", "estadoCivil");
  texto("nacionalidad", "nacionalidad");
  texto("telefono_personal", "telefonoPersonal");
  texto("telefono_emergencia", "telefonoEmergencia");
  texto("contacto_emergencia", "contactoEmergencia");
  texto("direccion", "direccion");
  texto("banco", "banco");
  texto("email_corporativo", "emailCorporativo");
  texto("extension", "extension");
  texto("cuenta_bancaria", "cuentaBancaria");
  texto("estado", "estado");
  texto("tipo_contrato", "tipoContrato");
  texto("tipo_planilla", "tipoPlanilla");

  for (const [k, campo] of [
    ["fecha_nacimiento", "fechaNacimiento"],
    ["fecha_ingreso", "fechaIngreso"],
    ["fecha_salida", "fechaSalida"],
  ] as const) {
    if (datos[k] !== undefined) d[campo] = new Date(String(datos[k]));
  }

  if (datos.sucursal !== undefined) d.sucursalId = datos.sucursal;
  if (datos.departamento !== undefined) d.departamentoId = datos.departamento;
  if (datos.puesto !== undefined) d.puestoId = datos.puesto;
  if (datos.centro_costo !== undefined) d.centroCostoId = datos.centro_costo;

  // Los tres salarios se derivan del base con aritmética exacta, igual que en
  // POST /api/empleados: `salarioBase / 30 / 8` en float deja residuo binario en
  // una columna Decimal(12,2).
  if (datos.salario_base !== undefined) {
    const base = redondear(String(datos.salario_base));
    d.salarioBase = base;
    d.salarioDiario = redondear(base.div(30));
    d.salarioHora = redondear(base.div(30).div(8));
  }

  return d;
}

/**
 * Escribe las filas validadas.
 *
 * Se ejecuta dentro de una transacción provista por quien llama, para que un
 * fallo a mitad no deje el archivo aplicado por la mitad.
 */
export async function aplicar(
  tx: Prisma.TransactionClient,
  filas: FilaEmpleado[],
  usuario: { id?: string; email?: string | null }
): Promise<ResultadoAplicacion> {
  let creados = 0;
  let actualizados = 0;
  const ids: string[] = [];
  /** Código → id, incluidos los que se crean en este mismo lote. */
  const codigoAId = new Map<string, string>();

  // Correlativo de código. Se calcula una vez y se incrementa en memoria: contar
  // dentro del bucle daría el mismo número a dos altas de la misma transacción.
  let correlativo = await tx.empleado.count();

  for (const fila of filas) {
    const datos = aDatosPrisma(fila.datos);

    if (fila.accion === "CREAR") {
      let codigo = fila.codigo;
      if (!codigo) {
        do {
          correlativo++;
          codigo = `EMP-${String(correlativo).padStart(4, "0")}`;
        } while (await tx.empleado.findUnique({ where: { codigo }, select: { id: true } }));
      }

      const creado = await tx.empleado.create({
        data: { ...(datos as Prisma.EmpleadoCreateInput), codigo },
      });
      creados++;
      ids.push(creado.id);
      codigoAId.set(norm(codigo), creado.id);

      // Mismo rastro que el alta por pantalla: el historial salarial arranca en
      // el ingreso, no en el momento de la importación.
      await tx.historialSalario.create({
        data: {
          empleadoId: creado.id,
          salarioAnterior: 0,
          salarioNuevo: creado.salarioBase,
          fechaCambio: creado.fechaIngreso,
          motivo: "Salario inicial al ingreso (importación CSV)",
          usuarioId: usuario.id,
          usuarioEmail: usuario.email ?? undefined,
        },
      });
    } else {
      const id = fila.empleadoId!;
      await tx.empleado.update({ where: { id }, data: datos as Prisma.EmpleadoUpdateInput });
      actualizados++;
      ids.push(id);
      if (fila.codigo) codigoAId.set(norm(fila.codigo), id);

      if (fila.salarioAnterior !== undefined && fila.datos.salario_base !== undefined) {
        await tx.historialSalario.create({
          data: {
            empleadoId: id,
            salarioAnterior: redondear(fila.salarioAnterior),
            salarioNuevo: redondear(String(fila.datos.salario_base)),
            fechaCambio: new Date(),
            motivo: "Ajuste por importación CSV",
            usuarioId: usuario.id,
            usuarioEmail: usuario.email ?? undefined,
          },
        });
      }
    }
  }

  // ─── Supervisores, en una segunda pasada ──────────────────────────────────
  // Se resuelven al final porque un supervisor puede darse de alta en este mismo
  // archivo, en una línea posterior a la de su subordinado.
  //
  // CICLOS: un archivo puede pedir A→B y B→A sin que ninguna fila, por separado,
  // parezca sospechosa. La validación por fila sólo ve su propia línea, así que
  // la comprobación tiene que hacerse aquí, con la jerarquía COMPLETA delante y
  // actualizándola a medida que se aplica cada asignación.
  const plantilla = await tx.empleado.findMany({ select: { id: true, supervisorId: true } });
  const padreDe = new Map<string, string | null>(plantilla.map((e) => [e.id, e.supervisorId]));

  for (const fila of filas) {
    if (!fila.supervisorCodigo) continue;
    const empleadoId = fila.empleadoId ?? (fila.codigo ? codigoAId.get(norm(fila.codigo)) : undefined);
    if (!empleadoId) continue;

    let supervisorId = codigoAId.get(norm(fila.supervisorCodigo));
    if (!supervisorId) {
      const encontrado = await tx.empleado.findFirst({
        where: { codigo: { equals: fila.supervisorCodigo, mode: "insensitive" } },
        select: { id: true },
      });
      supervisorId = encontrado?.id;
    }
    if (!supervisorId || supervisorId === empleadoId) continue;

    if (creariaCiclo(padreDe, empleadoId, supervisorId)) {
      // Se aborta el lote entero: aplicar media jerarquía dejaría un organigrama
      // a medio construir que nadie sabría interpretar. La transacción revierte.
      throw new ErrorCicloJerarquia(fila.linea, fila.codigo ?? empleadoId, fila.supervisorCodigo);
    }

    await tx.empleado.update({ where: { id: empleadoId }, data: { supervisorId } });
    padreDe.set(empleadoId, supervisorId);
  }

  return { creados, actualizados, ids };
}

/**
 * El archivo pedía una jerarquía circular.
 *
 * Lleva la línea y los códigos implicados porque el usuario tiene que poder ir
 * al archivo y corregirlo; un "error al importar" a secas obligaría a revisar
 * las trescientas filas a mano.
 */
export class ErrorCicloJerarquia extends Error {
  constructor(
    readonly linea: number,
    readonly codigoEmpleado: string,
    readonly codigoSupervisor: string
  ) {
    super(
      `Línea ${linea}: asignar a ${codigoSupervisor} como jefe de ${codigoEmpleado} cierra un ciclo en la jerarquía. ` +
        `Revise la columna "Codigo Supervisor": alguien de la cadena de mando de ${codigoEmpleado} lo tiene a él como jefe.`
    );
    this.name = "ErrorCicloJerarquia";
  }
}

/** Descripción legible de un lote, para el correo o el resumen final. */
export function resumen(filas: FilaEmpleado[]): string {
  const crear = filas.filter((f) => f.accion === "CREAR").length;
  const actualizar = filas.length - crear;
  return `${crear} alta(s) y ${actualizar} actualización(es)`;
}

export { formatDate };
