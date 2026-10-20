/**
 * Plantillas de documentos: variables, resolución del texto y plantillas por
 * omisión. PURO: recibe los datos ya cargados y devuelve texto.
 *
 * Una variable sin dato (identidad vacía, sin dirección) no se inventa: se deja
 * una línea para llenar a mano y se informa como faltante, para que quien emite
 * decida si completa el expediente antes.
 */

import { enteroALetras, montoALetras } from "./numero-letras";

export const LINEA_VACIA = "__________";

export interface VariableDoc {
  clave: string;
  etiqueta: string;
}

/** Catálogo que ve quien edita una plantilla. */
export const VARIABLES: { grupo: string; variables: VariableDoc[] }[] = [
  {
    grupo: "Empleado",
    variables: [
      { clave: "empleado.nombreCompleto", etiqueta: "Nombre completo" },
      { clave: "empleado.tratamiento", etiqueta: "«el señor» o «la señora»" },
      { clave: "empleado.identificadoA", etiqueta: "«identificado» o «identificada»" },
      { clave: "empleado.identidad", etiqueta: "Número de identidad" },
      { clave: "empleado.rtn", etiqueta: "RTN" },
      { clave: "empleado.codigo", etiqueta: "Código de empleado" },
      { clave: "empleado.puesto", etiqueta: "Puesto" },
      { clave: "empleado.departamento", etiqueta: "Departamento" },
      { clave: "empleado.sucursal", etiqueta: "Sucursal" },
      { clave: "empleado.fechaIngreso", etiqueta: "Fecha de ingreso (en palabras)" },
      { clave: "empleado.antiguedad", etiqueta: "Antigüedad" },
      { clave: "empleado.tipoContrato", etiqueta: "Tipo de contrato" },
      { clave: "empleado.salarioMensual", etiqueta: "Salario mensual" },
      { clave: "empleado.salarioMensualLetras", etiqueta: "Salario mensual en letras" },
      { clave: "empleado.edad", etiqueta: "Edad" },
      { clave: "empleado.sexo", etiqueta: "Sexo" },
      { clave: "empleado.estadoCivil", etiqueta: "Estado civil" },
      { clave: "empleado.nacionalidad", etiqueta: "Nacionalidad" },
      { clave: "empleado.direccion", etiqueta: "Domicilio" },
    ],
  },
  {
    grupo: "Contrato",
    variables: [
      { clave: "contrato.fechaInicio", etiqueta: "Fecha de inicio" },
      { clave: "contrato.jornada", etiqueta: "Jornada" },
      { clave: "contrato.horario", etiqueta: "Horario" },
      { clave: "contrato.lugar", etiqueta: "Lugar de trabajo" },
      { clave: "contrato.formaPago", etiqueta: "Periodicidad del pago" },
      { clave: "contrato.medioPago", etiqueta: "Medio de pago" },
    ],
  },
  {
    grupo: "Empresa y firma",
    variables: [
      { clave: "empresa.nombre", etiqueta: "Razón social" },
      { clave: "empresa.rtn", etiqueta: "RTN de la empresa" },
      { clave: "empresa.direccion", etiqueta: "Dirección de la empresa" },
      { clave: "empresa.telefono", etiqueta: "Teléfono de la empresa" },
      { clave: "firmante.nombre", etiqueta: "Nombre del firmante" },
      { clave: "firmante.cargo", etiqueta: "Cargo del firmante" },
      { clave: "firmante.identidad", etiqueta: "Identidad del firmante" },
    ],
  },
  {
    grupo: "Documento",
    variables: [
      { clave: "destinatario", etiqueta: "A quién va dirigido" },
      { clave: "documento.ciudad", etiqueta: "Ciudad" },
      { clave: "documento.fecha", etiqueta: "Fecha de hoy" },
      { clave: "documento.fechaEnLetras", etiqueta: "«a los quince días del mes de…»" },
    ],
  },
];

export const CLAVES_VALIDAS = new Set(VARIABLES.flatMap((g) => g.variables.map((v) => v.clave)));

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Fecha de calendario (medianoche UTC) → «15 de octubre de 2026». */
export function fechaLarga(d: Date): string {
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/** «a los quince días del mes de octubre del año dos mil veintiséis». */
export function fechaEnLetras(d: Date): string {
  const dia = d.getUTCDate();
  const diaTxt = dia === 1 ? "al primer día" : `a los ${enteroALetras(dia, true).toLowerCase()} días`;
  return `${diaTxt} del mes de ${MESES[d.getUTCMonth()]} del año ${enteroALetras(d.getUTCFullYear()).toLowerCase()}`;
}

/** Años cumplidos entre dos fechas de calendario. */
export function aniosCumplidos(desde: Date, hasta: Date): number {
  let a = hasta.getUTCFullYear() - desde.getUTCFullYear();
  const m = hasta.getUTCMonth() - desde.getUTCMonth();
  if (m < 0 || (m === 0 && hasta.getUTCDate() < desde.getUTCDate())) a--;
  return Math.max(0, a);
}

/** «3 años y 2 meses», «8 meses», «menos de un mes». */
export function textoAntiguedad(desde: Date, hasta: Date): string {
  let meses = (hasta.getUTCFullYear() - desde.getUTCFullYear()) * 12 + (hasta.getUTCMonth() - desde.getUTCMonth());
  if (hasta.getUTCDate() < desde.getUTCDate()) meses--;
  meses = Math.max(0, meses);
  const anios = Math.floor(meses / 12);
  const resto = meses % 12;
  const partes: string[] = [];
  if (anios) partes.push(anios === 1 ? "1 año" : `${anios} años`);
  if (resto) partes.push(resto === 1 ? "1 mes" : `${resto} meses`);
  return partes.length ? partes.join(" y ") : "menos de un mes";
}

const esFemenino = (genero: string | null | undefined) => /^f/i.test((genero ?? "").trim());

const TIPO_CONTRATO_TEXTO: Record<string, string> = {
  INDEFINIDO: "tiempo indefinido",
  TEMPORAL: "tiempo determinado",
  PRUEBA: "período de prueba",
  SERVICIO: "servicios profesionales",
};

const FORMA_PAGO: Record<string, string> = { MENSUAL: "mensual", QUINCENAL: "quincenal", SEMANAL: "semanal" };

export interface DatosContexto {
  empleado: {
    primerNombre: string;
    segundoNombre?: string | null;
    primerApellido: string;
    segundoApellido?: string | null;
    identidad?: string | null;
    rtn?: string | null;
    codigo: string;
    genero?: string | null;
    estadoCivil?: string | null;
    nacionalidad?: string | null;
    direccion?: string | null;
    fechaNacimiento?: Date | null;
    fechaIngreso: Date;
    tipoContrato: string;
    tipoPlanilla: string;
    salarioBase: number;
    cuentaBancaria?: string | null;
    puesto?: string | null;
    departamento?: string | null;
    sucursal?: string | null;
    sucursalDireccion?: string | null;
  };
  contrato?: { fechaInicio?: Date | null; jornada?: string | null; horario?: string | null } | null;
  /** Texto del turno vigente, si hay: «Diurna, de lunes a viernes de 08:00 a 17:00». */
  turno?: { jornada: string; horario: string } | null;
  empresa: { nombre: string; rtn?: string | null; direccion?: string | null; telefono?: string | null };
  firmante: { nombre: string; cargo: string; identidad: string; ciudad: string };
  destinatario?: string | null;
  /** Fecha de emisión (calendario). */
  hoy: Date;
  /** Formato de moneda de la aplicación. */
  moneda: (n: number) => string;
}

/**
 * El expediente guarda «Hondureño» para todos; el contrato dice «de sexo
 * femenino, de nacionalidad hondureña». Sólo se cambia la -o/-a final de los
 * gentilicios que la tienen (hondureño, salvadoreño, guatemalteco); los que
 * terminan en -e (nicaragüense, costarricense) no varían.
 */
export function nacionalidadConcordada(nacionalidad: string | null | undefined, genero: string | null | undefined): string {
  const n = (nacionalidad ?? "").trim().toLowerCase();
  const g = (genero ?? "").trim();
  if (!n || n.includes(" ")) return n;
  if (/^f/i.test(g) && n.endsWith("o")) return n.slice(0, -1) + "a";
  if (/^m/i.test(g) && /(ñ|c|n)a$/.test(n)) return n.slice(0, -1) + "o";
  return n;
}

export function construirContexto(d: DatosContexto): Record<string, string> {
  const e = d.empleado;
  const fem = esFemenino(e.genero);
  const nombre = [e.primerNombre, e.segundoNombre, e.primerApellido, e.segundoApellido].filter(Boolean).join(" ");
  const sexo = (e.genero ?? "").trim();
  return {
    "empleado.nombreCompleto": nombre,
    "empleado.tratamiento": fem ? "la señora" : "el señor",
    "empleado.identificadoA": fem ? "identificada" : "identificado",
    "empleado.identidad": e.identidad ?? "",
    "empleado.rtn": e.rtn ?? "",
    "empleado.codigo": e.codigo,
    "empleado.puesto": e.puesto ?? "",
    "empleado.departamento": e.departamento ?? "",
    "empleado.sucursal": e.sucursal ?? "",
    "empleado.fechaIngreso": fechaLarga(e.fechaIngreso),
    "empleado.antiguedad": textoAntiguedad(e.fechaIngreso, d.hoy),
    "empleado.tipoContrato": TIPO_CONTRATO_TEXTO[e.tipoContrato] ?? e.tipoContrato.toLowerCase(),
    "empleado.salarioMensual": d.moneda(e.salarioBase),
    "empleado.salarioMensualLetras": montoALetras(e.salarioBase),
    "empleado.edad": e.fechaNacimiento ? String(aniosCumplidos(e.fechaNacimiento, d.hoy)) : "",
    "empleado.sexo": /^f/i.test(sexo) ? "femenino" : /^m/i.test(sexo) ? "masculino" : sexo.toLowerCase(),
    "empleado.estadoCivil": (e.estadoCivil ?? "").toLowerCase(),
    "empleado.nacionalidad": nacionalidadConcordada(e.nacionalidad, e.genero),
    "empleado.direccion": e.direccion ?? "",
    "contrato.fechaInicio": fechaLarga(d.contrato?.fechaInicio ?? e.fechaIngreso),
    "contrato.jornada": d.turno?.jornada || d.contrato?.jornada || "",
    "contrato.horario": d.turno?.horario || d.contrato?.horario || "",
    "contrato.lugar": [e.sucursal, e.sucursalDireccion].filter(Boolean).join(", "),
    "contrato.formaPago": FORMA_PAGO[e.tipoPlanilla] ?? e.tipoPlanilla.toLowerCase(),
    "contrato.medioPago": e.cuentaBancaria?.trim() ? "depósito en la cuenta bancaria del trabajador" : "efectivo o cheque",
    "empresa.nombre": d.empresa.nombre,
    "empresa.rtn": d.empresa.rtn ?? "",
    "empresa.direccion": d.empresa.direccion ?? "",
    "empresa.telefono": d.empresa.telefono ?? "",
    "firmante.nombre": d.firmante.nombre,
    "firmante.cargo": d.firmante.cargo,
    "firmante.identidad": d.firmante.identidad,
    destinatario: d.destinatario?.trim() || "A quien interese",
    "documento.ciudad": d.firmante.ciudad,
    "documento.fecha": fechaLarga(d.hoy),
    "documento.fechaEnLetras": fechaEnLetras(d.hoy),
  };
}

const RE_VARIABLE = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g;

export interface Resolucion {
  texto: string;
  /** Variables con dato vacío: quedaron como línea para llenar. */
  faltantes: string[];
  /** Variables que no existen en el catálogo (errores de escritura). */
  desconocidas: string[];
}

export function resolverPlantilla(texto: string, contexto: Record<string, string>): Resolucion {
  const faltantes = new Set<string>();
  const desconocidas = new Set<string>();
  const salida = texto.replace(RE_VARIABLE, (_, clave: string) => {
    if (!(clave in contexto)) {
      desconocidas.add(clave);
      return `{{${clave}}}`;
    }
    const v = contexto[clave];
    if (!v.trim()) {
      faltantes.add(clave);
      return LINEA_VACIA;
    }
    return v;
  });
  return { texto: salida, faltantes: [...faltantes], desconocidas: [...desconocidas] };
}

/** Variables usadas en un texto que no existen en el catálogo. */
export function variablesDesconocidas(texto: string): string[] {
  const out = new Set<string>();
  for (const m of texto.matchAll(RE_VARIABLE)) if (!CLAVES_VALIDAS.has(m[1])) out.add(m[1]);
  return [...out];
}

export function etiquetaVariable(clave: string): string {
  for (const g of VARIABLES) for (const v of g.variables) if (v.clave === clave) return v.etiqueta;
  return clave;
}

// ─── Plantillas por omisión ───────────────────────────────────────────────────

export interface PlantillaBase {
  codigo: string;
  nombre: string;
  tipo: "CONSTANCIA_TRABAJO" | "CONSTANCIA_SALARIO" | "CONTRATO" | "CARTA" | "OTRO";
  titulo: string;
  autoservicio: boolean;
  contenido: string;
}

const CIERRE_CONSTANCIA =
  "Y para los fines que al interesado convengan, se extiende la presente en la ciudad de {{documento.ciudad}}, {{documento.fechaEnLetras}}.";

/**
 * Modelos de partida. Su texto es un borrador razonable, no asesoría legal: el
 * contrato sigue los incisos del Art. 37 del Código del Trabajo, pero conviene
 * que el asesor laboral de cada empresa lo revise antes de usarlo.
 */
export const PLANTILLAS_POR_OMISION: PlantillaBase[] = [
  {
    codigo: "CONSTANCIA_TRABAJO",
    nombre: "Constancia de trabajo",
    tipo: "CONSTANCIA_TRABAJO",
    titulo: "Constancia de trabajo",
    autoservicio: true,
    contenido: [
      "{{destinatario}}:",
      "Por medio de la presente, **{{empresa.nombre}}**, con RTN {{empresa.rtn}}, hace constar que {{empleado.tratamiento}} **{{empleado.nombreCompleto}}**, {{empleado.identificadoA}} con documento nacional de identificación número {{empleado.identidad}}, labora en esta empresa desde el {{empleado.fechaIngreso}}, desempeñando el cargo de **{{empleado.puesto}}** en el departamento de {{empleado.departamento}}, con contrato por {{empleado.tipoContrato}}.",
      CIERRE_CONSTANCIA,
    ].join("\n\n"),
  },
  {
    codigo: "CONSTANCIA_SALARIO",
    nombre: "Constancia de trabajo y salario",
    tipo: "CONSTANCIA_SALARIO",
    titulo: "Constancia de trabajo y salario",
    autoservicio: true,
    contenido: [
      "{{destinatario}}:",
      "Por medio de la presente, **{{empresa.nombre}}**, con RTN {{empresa.rtn}}, hace constar que {{empleado.tratamiento}} **{{empleado.nombreCompleto}}**, {{empleado.identificadoA}} con documento nacional de identificación número {{empleado.identidad}}, labora en esta empresa desde el {{empleado.fechaIngreso}}, desempeñando el cargo de **{{empleado.puesto}}**, con contrato por {{empleado.tipoContrato}}, y devenga un salario mensual ordinario de **{{empleado.salarioMensual}}** ({{empleado.salarioMensualLetras}}), sujeto a las deducciones de ley.",
      CIERRE_CONSTANCIA,
    ].join("\n\n"),
  },
  {
    codigo: "CONTRATO_INDEFINIDO",
    nombre: "Contrato individual de trabajo por tiempo indefinido",
    tipo: "CONTRATO",
    titulo: "Contrato individual de trabajo",
    autoservicio: false,
    contenido: [
      "Nosotros, **{{firmante.nombre}}**, mayor de edad, con identidad número {{firmante.identidad}}, actuando en mi condición de {{firmante.cargo}} de **{{empresa.nombre}}**, con RTN {{empresa.rtn}} y domicilio en {{empresa.direccion}}, en adelante «EL PATRONO»; y **{{empleado.nombreCompleto}}**, de {{empleado.edad}} años de edad, de sexo {{empleado.sexo}}, estado civil {{empleado.estadoCivil}}, de nacionalidad {{empleado.nacionalidad}}, con identidad número {{empleado.identidad}} y domicilio en {{empleado.direccion}}, en adelante «EL TRABAJADOR», hemos convenido en celebrar el presente contrato individual de trabajo, que se regirá por el Código del Trabajo y por las cláusulas siguientes:",
      "**PRIMERA. Servicios.** EL TRABAJADOR se obliga a prestar sus servicios personales a EL PATRONO en el cargo de **{{empleado.puesto}}**, en el departamento de {{empleado.departamento}}, con las funciones propias de ese cargo y las que razonablemente le sean asignadas.",
      "**SEGUNDA. Duración.** El presente contrato es por tiempo indefinido. El trabajo se inicia el {{contrato.fechaInicio}}.",
      "**TERCERA. Lugar de prestación de los servicios.** Los servicios se prestarán en {{contrato.lugar}}.",
      "**CUARTA. Jornada.** La jornada de trabajo será {{contrato.jornada}}, con el horario {{contrato.horario}}.",
      "**QUINTA. Salario.** EL PATRONO pagará a EL TRABAJADOR un salario mensual de **{{empleado.salarioMensual}}** ({{empleado.salarioMensualLetras}}), en forma {{contrato.formaPago}}, mediante {{contrato.medioPago}}, con las deducciones que manda la ley.",
      "**SEXTA. Beneficios.** EL TRABAJADOR gozará de las prestaciones que establece la ley, entre ellas el décimo tercer y el décimo cuarto mes de salario, las vacaciones remuneradas y la afiliación a la seguridad social, y de los beneficios adicionales siguientes: __________.",
      "**SÉPTIMA. Disposiciones generales.** En lo no previsto en este contrato se aplicarán el Código del Trabajo, el reglamento interno de trabajo y, si lo hubiere, el contrato colectivo.",
      "En fe de lo cual firmamos el presente contrato en dos ejemplares de igual valor, en la ciudad de {{documento.ciudad}}, {{documento.fechaEnLetras}}.",
    ].join("\n\n"),
  },
];
