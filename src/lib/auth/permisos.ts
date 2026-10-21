/**
 * Catálogo de permisos de acceso.
 *
 * POR QUÉ EXISTE: la autorización vivía en dos sitios a la vez. Por un lado
 * `guard.ts`, con listas de roles con nombre (`ROLES_NOMINA`, `ROLES_PII`); por
 * otro, decenas de `["SUPER_ADMIN", "ADMIN_RRHH"].includes(role)` escritos a
 * mano dentro de cada ruta. Con siete roles fijos en un enum, cualquier matiz
 * ("este contador sí puede aprobar, pero no pagar") obligaba a inventar un rol
 * nuevo y a repasar los dos sitios.
 *
 * Aquí el permiso es el dato y el rol pasa a ser sólo un atajo: un PerfilAcceso
 * agrupa códigos `modulo.accion` y el usuario recibe el perfil.
 *
 * CÓMO SE MIGRA SIN ROMPER NADA: `PERMISOS_POR_ROL` reproduce exactamente lo que
 * cada rol podía hacer antes de esta refactorización. Un usuario sin perfil
 * asignado resuelve sus permisos por ahí, así que el sistema se comporta igual
 * que siempre hasta que alguien crea un perfil a medida.
 *
 * El catálogo es una CONSTANTE DEL CÓDIGO, no una tabla: los permisos existen
 * porque hay una ruta que los comprueba, y una fila en la base no puede inventar
 * una comprobación. El tipo `Permiso` se deriva del catálogo, de modo que un
 * código mal escrito falla al compilar y no en producción.
 */

import type { UserRole } from "@prisma/client";

/** Concede todo. Sólo para el perfil de sistema del super administrador. */
export const COMODIN = "*";

export interface DefinicionPermiso {
  readonly codigo: string;
  readonly etiqueta: string;
  readonly descripcion: string;
  /**
   * Marca las acciones que mueven dinero, exponen datos personales fuera del
   * sistema o alteran registros en masa. La pantalla de perfiles las resalta
   * para que otorgarlas sea una decisión consciente.
   */
  readonly sensible?: boolean;
}

export interface ModuloPermisos {
  readonly modulo: string;
  readonly etiqueta: string;
  readonly descripcion: string;
  readonly permisos: readonly DefinicionPermiso[];
}

export const CATALOGO = [
  {
    modulo: "empleados",
    etiqueta: "Empleados",
    descripcion: "Expediente del personal y estructura organizacional",
    permisos: [
      {
        codigo: "empleados.ver",
        etiqueta: "Ver directorio",
        descripcion: "Consultar quién es quién, su puesto, departamento y sucursal.",
      },
      {
        codigo: "empleados.pii",
        etiqueta: "Ver datos personales y salariales",
        descripcion:
          "Identidad, RTN, dirección, teléfono, salario y cuenta bancaria. Sin este permiso el directorio se entrega sin esas columnas.",
        sensible: true,
      },
      {
        codigo: "empleados.salud",
        etiqueta: "Ficha médica",
        descripcion: "Ver y editar tipo de sangre, alergias, enfermedades y medicamentos. Es dato de salud: aparte de los datos personales.",
        sensible: true,
      },
      {
        codigo: "empleados.crear",
        etiqueta: "Dar de alta",
        descripcion: "Registrar empleados nuevos.",
      },
      {
        codigo: "empleados.editar",
        etiqueta: "Editar expediente",
        descripcion: "Modificar datos del empleado, incluido su salario base.",
        sensible: true,
      },
      {
        codigo: "empleados.exportar",
        etiqueta: "Exportar a CSV",
        descripcion:
          "Descargar la plantilla como archivo. Las columnas sensibles sólo salen si además tiene el permiso de datos personales.",
        sensible: true,
      },
      {
        codigo: "empleados.importar",
        etiqueta: "Importar desde CSV",
        descripcion: "Alta y actualización masiva de empleados desde un archivo.",
        sensible: true,
      },
      {
        codigo: "empleados.eliminar",
        etiqueta: "Eliminar expediente",
        descripcion:
          "Borrar un empleado sin historial de nómina. Lo normal es darlo de baja cambiando su estado, no eliminarlo.",
        sensible: true,
      },
    ],
  },
  {
    modulo: "deducciones",
    etiqueta: "Deducciones",
    descripcion: "Tipos de deducción y deducciones asignadas a cada empleado",
    permisos: [
      {
        codigo: "deducciones.ver",
        etiqueta: "Consultar",
        descripcion: "Ver tipos de deducción y las asignadas a los empleados.",
      },
      {
        codigo: "deducciones.configurar",
        etiqueta: "Configurar tipos",
        descripcion:
          "Crear y editar tipos de deducción. Un tipo legal (IHSS, RAP, INFOP) altera el cálculo de toda la plantilla.",
        sensible: true,
      },
      {
        codigo: "deducciones.asignar",
        etiqueta: "Asignar a empleados",
        descripcion: "Imponer o retirar una deducción concreta a un trabajador.",
        sensible: true,
      },
      {
        codigo: "deducciones.exportar",
        etiqueta: "Exportar a CSV",
        descripcion: "Descargar las deducciones vigentes como archivo.",
      },
      {
        codigo: "deducciones.importar",
        etiqueta: "Importar desde CSV",
        descripcion: "Asignación masiva de deducciones desde un archivo.",
        sensible: true,
      },
    ],
  },
  {
    modulo: "planillas",
    etiqueta: "Planillas",
    descripcion: "Cálculo, aprobación y pago de la nómina",
    permisos: [
      { codigo: "planillas.ver", etiqueta: "Consultar", descripcion: "Ver planillas y su detalle por empleado." },
      { codigo: "planillas.calcular", etiqueta: "Crear y calcular", descripcion: "Generar una planilla y recalcularla mientras esté en borrador." },
      { codigo: "planillas.aprobar", etiqueta: "Aprobar", descripcion: "Dar por buena una planilla calculada.", sensible: true },
      { codigo: "planillas.pagar", etiqueta: "Marcar como pagada", descripcion: "Registrar el pago de una planilla aprobada.", sensible: true },
      { codigo: "planillas.anular", etiqueta: "Anular", descripcion: "Dejar sin efecto una planilla en borrador o calculada.", sensible: true },
      {
        codigo: "planillas.reabrir",
        etiqueta: "Reabrir una planilla aprobada",
        descripcion:
          "Devolver a cálculo o anular una planilla ya APROBADA. Acto excepcional: exige justificación escrita.",
        sensible: true,
      },
      {
        codigo: "planillas.anular_pagada",
        etiqueta: "Anular una planilla PAGADA",
        descripcion:
          "Revierte un desembolso ya ejecutado. Es la acción más delicada del sistema y exige justificación escrita.",
        sensible: true,
      },
      { codigo: "planillas.boletas", etiqueta: "Enviar boletas", descripcion: "Enviar por correo las boletas de pago a los empleados." },
      { codigo: "planillas.contabilidad", etiqueta: "Partida contable", descripcion: "Generar y descargar la partida contable." },
      {
        codigo: "planillas.plan_cuentas",
        etiqueta: "Configurar el plan de cuentas",
        descripcion:
          "Remapear los códigos y nombres de las cuentas de nómina al catálogo contable de la empresa. Cambia cómo sale el asiento en TODAS las planillas.",
        sensible: true,
      },
      {
        codigo: "planillas.sap_enviar",
        etiqueta: "Enviar asientos a SAP",
        descripcion:
          "Enviar, reintentar o revertir en SAP Business One el asiento contable de una planilla cerrada. Lo que llega a SAP queda contabilizado.",
        sensible: true,
      },
    ],
  },
  {
    modulo: "prestaciones",
    etiqueta: "Décimos y liquidaciones",
    descripcion: "Décimo tercer y catorceavo mes, y liquidaciones finales",
    permisos: [
      { codigo: "prestaciones.ver", etiqueta: "Consultar", descripcion: "Ver décimos y liquidaciones calculadas." },
      { codigo: "prestaciones.generar", etiqueta: "Generar", descripcion: "Calcular décimos y liquidaciones finales.", sensible: true },
      { codigo: "prestaciones.salarios", etiqueta: "Aumento colectivo", descripcion: "Aplicar un aumento salarial a un grupo de empleados de una vez.", sensible: true },
      // Misma separación de funciones que la planilla: RRHH aprueba, Contabilidad paga.
      { codigo: "prestaciones.aprobar", etiqueta: "Aprobar liquidaciones", descripcion: "Dar por buena una liquidación final calculada, o anularla antes del pago.", sensible: true },
      { codigo: "prestaciones.pagar", etiqueta: "Registrar el pago", descripcion: "Marcar como pagadas las liquidaciones aprobadas y los décimos calculados.", sensible: true },
      { codigo: "prestaciones.anular_pagada", etiqueta: "Anular una liquidación pagada", descripcion: "Revierte un desembolso ya ejecutado. Por omisión sólo el super administrador.", sensible: true },
    ],
  },
  {
    modulo: "asistencia",
    etiqueta: "Tiempo y asistencia",
    descripcion: "Marcajes, permisos laborales y reloj biométrico",
    permisos: [
      { codigo: "asistencia.ver", etiqueta: "Consultar marcajes", descripcion: "Ver entradas, salidas y ausencias." },
      { codigo: "asistencia.gestionar", etiqueta: "Registrar y corregir", descripcion: "Crear o ajustar marcajes manualmente." },
      { codigo: "asistencia.aprobar_permisos", etiqueta: "Aprobar permisos", descripcion: "Aprobar o rechazar solicitudes de vacaciones y permisos." },
      { codigo: "asistencia.biometrico", etiqueta: "Reloj biométrico", descripcion: "Administrar dispositivos y lanzar sincronizaciones." },
      { codigo: "asistencia.turnos", etiqueta: "Horarios y turnos", descripcion: "Definir turnos y asignarlos. Cambia desde qué hora se paga la hora extra.", sensible: true },
      { codigo: "asistencia.incapacidades", etiqueta: "Incapacidades", descripcion: "Registrar certificados de incapacidad del IHSS. Afectan el salario de la planilla.", sensible: true },
    ],
  },
  {
    modulo: "documentos",
    etiqueta: "Documentos y constancias",
    descripcion: "Constancias, contratos y cartas generados desde plantilla",
    permisos: [
      { codigo: "documentos.emitir", etiqueta: "Emitir documentos", descripcion: "Generar constancias de trabajo y de salario, contratos y cartas de cualquier empleado.", sensible: true },
      { codigo: "documentos.plantillas", etiqueta: "Editar plantillas", descripcion: "Cambiar el texto de las plantillas y el firmante. Afecta a todo documento que se emita después.", sensible: true },
    ],
  },
  {
    modulo: "talento",
    etiqueta: "Gestión de talento",
    descripcion: "Evaluaciones, competencias, capacitación, reclutamiento y dotaciones",
    permisos: [
      { codigo: "talento.evaluaciones_ver", etiqueta: "Ver evaluaciones", descripcion: "Consultar evaluaciones, nine-box y brechas de competencia." },
      { codigo: "talento.evaluaciones_gestionar", etiqueta: "Gestionar evaluaciones", descripcion: "Crear campañas, lanzar evaluaciones y asignar participantes." },
      {
        codigo: "talento.evaluaciones_cerrar",
        etiqueta: "Cerrar y cancelar evaluaciones",
        descripcion:
          "Finalizar o cancelar una evaluación, y enviarla en nombre de otro evaluador. Al finalizar se consolida la calificación, de la que depende el bono.",
        sensible: true,
      },
      { codigo: "talento.competencias", etiqueta: "Competencias", descripcion: "Definir competencias y asociarlas a puestos." },
      { codigo: "talento.capacitaciones", etiqueta: "Ver capacitaciones", descripcion: "Consultar el plan de capacitación y sus participantes." },
      { codigo: "talento.capacitaciones_gestionar", etiqueta: "Gestionar capacitaciones", descripcion: "Programar capacitaciones, inscribir y registrar resultados." },
      { codigo: "talento.reclutamiento", etiqueta: "Ver reclutamiento", descripcion: "Consultar vacantes y candidatos." },
      { codigo: "talento.reclutamiento_gestionar", etiqueta: "Gestionar reclutamiento", descripcion: "Publicar vacantes y mover candidatos entre etapas." },
      { codigo: "talento.dotaciones", etiqueta: "Ver dotaciones", descripcion: "Consultar artículos y lo entregado a cada empleado." },
      { codigo: "talento.dotaciones_gestionar", etiqueta: "Gestionar dotaciones", descripcion: "Dar de alta artículos y registrar entregas y devoluciones." },
    ],
  },
  {
    modulo: "organizacion",
    etiqueta: "Estructura organizacional",
    descripcion: "Organigrama, línea de reporte y centros de costo",
    permisos: [
      {
        codigo: "organizacion.ver",
        etiqueta: "Ver el organigrama",
        descripcion: "Consultar la estructura, la línea de reporte y el tamaño de cada equipo.",
      },
      {
        codigo: "organizacion.reasignar",
        etiqueta: "Cambiar la línea de reporte",
        descripcion:
          "Asignar o cambiar el jefe directo de un empleado. Decide quién aprueba sus permisos y quién lo evalúa.",
        sensible: true,
      },
      {
        codigo: "organizacion.centros_costo",
        etiqueta: "Gestionar centros de costo",
        descripcion:
          "Crear centros de costo y asignarlos a departamentos o empleados. Determina cómo se reparte el gasto de nómina en la contabilidad.",
        sensible: true,
      },
    ],
  },
  {
    modulo: "comunicacion",
    etiqueta: "Comunicación",
    descripcion: "Portal del empleado, anuncios y políticas internas",
    permisos: [
      { codigo: "comunicacion.publicar", etiqueta: "Publicar en el portal", descripcion: "Crear anuncios y publicaciones del portal." },
      { codigo: "comunicacion.politicas", etiqueta: "Gestionar políticas", descripcion: "Publicar políticas internas y sus versiones." },
    ],
  },
  {
    modulo: "reportes",
    etiqueta: "Reportes",
    descripcion: "Reportes descargables de personal y nómina",
    permisos: [
      { codigo: "reportes.ver", etiqueta: "Generar reportes", descripcion: "Consultar y descargar los reportes del sistema.", sensible: true },
    ],
  },
  {
    modulo: "configuracion",
    etiqueta: "Configuración",
    descripcion: "Empresa, sucursales, departamentos y parámetros del sistema",
    permisos: [
      { codigo: "configuracion.ver", etiqueta: "Consultar", descripcion: "Ver la configuración de la empresa y sus parámetros." },
      { codigo: "configuracion.editar", etiqueta: "Editar", descripcion: "Modificar sucursales, departamentos, divisiones y salario mínimo.", sensible: true },
      // Nombre y RTN de la empresa salen en boletas, constancias, contratos y el
      // archivo del banco: un cambio equivocado se imprime en todo. Por omisión
      // sólo SUPER_ADMIN (comodín); a nadie más salvo que un perfil lo conceda.
      { codigo: "configuracion.empresa", etiqueta: "Datos de la empresa", descripcion: "Modificar el nombre, el RTN, la dirección, el teléfono y el correo de la empresa.", sensible: true },
      // Aparte de `configuracion.editar` a propósito: quien controla el servidor
      // de correo puede enviar mensajes a nombre de la empresa. Por omisión sólo
      // lo tiene SUPER_ADMIN (comodín); a nadie más salvo que un perfil lo conceda.
      { codigo: "configuracion.correo", etiqueta: "Correo saliente", descripcion: "Configurar el servidor SMTP con el que se envían los comprobantes de pago.", sensible: true },
      // Cambia lo que se descuenta a TODA la plantilla en la siguiente planilla.
      // Por omisión sólo SUPER_ADMIN (comodín), igual que el correo saliente.
      { codigo: "configuracion.parametros", etiqueta: "Parámetros de ley", descripcion: "Editar IHSS, IVM, RAP e INFOP (porcentaje o monto fijo) y las tablas de ISR e impuesto vecinal.", sensible: true },
      // Credenciales del Service Layer y qué se contabiliza en SAP. Por omisión
      // sólo SUPER_ADMIN (comodín), como el correo y los parámetros.
      { codigo: "configuracion.sap", etiqueta: "SAP Business One", descripcion: "Conexión con el Service Layer de SAP B1, mapeo de cuentas y centros de costo, y momento de envío de los asientos.", sensible: true },
    ],
  },
  {
    modulo: "seguridad",
    etiqueta: "Usuarios y seguridad",
    descripcion: "Cuentas de acceso, perfiles de permisos y auditoría",
    permisos: [
      { codigo: "seguridad.usuarios_ver", etiqueta: "Ver usuarios", descripcion: "Consultar las cuentas de acceso y su perfil." },
      {
        codigo: "seguridad.usuarios_gestionar",
        etiqueta: "Gestionar usuarios",
        descripcion: "Crear cuentas, activarlas o desactivarlas y asignarles perfil.",
        sensible: true,
      },
      {
        codigo: "seguridad.usuarios_password",
        etiqueta: "Restablecer contraseñas",
        descripcion: "Fijar una contraseña temporal a otro usuario.",
        sensible: true,
      },
      {
        codigo: "seguridad.perfiles",
        etiqueta: "Gestionar perfiles",
        descripcion: "Crear y editar perfiles de acceso y sus permisos. Quien tiene esto decide lo que pueden hacer los demás.",
        sensible: true,
      },
      { codigo: "seguridad.auditoria", etiqueta: "Ver auditoría", descripcion: "Consultar el registro de acciones del sistema." },
    ],
  },
] as const satisfies readonly ModuloPermisos[];

/**
 * Unión de todos los códigos válidos, derivada del catálogo. Es lo que hace que
 * `requerirPermiso(["empleados.editr"])` no compile.
 */
export type Permiso = (typeof CATALOGO)[number]["permisos"][number]["codigo"];

/** Todos los códigos, en orden de catálogo. */
export const TODOS_LOS_PERMISOS: readonly Permiso[] = CATALOGO.flatMap((m) =>
  m.permisos.map((p) => p.codigo)
);

const SET_PERMISOS = new Set<string>(TODOS_LOS_PERMISOS);

/** ¿El código corresponde a un permiso del catálogo? Filtra basura al guardar un perfil. */
export function esPermisoValido(codigo: string): codigo is Permiso {
  return SET_PERMISOS.has(codigo);
}

/** Definición completa de un permiso, para pintarlo en la interfaz. */
export function definicion(codigo: string): DefinicionPermiso | undefined {
  for (const modulo of CATALOGO) {
    const encontrado = modulo.permisos.find((p) => p.codigo === codigo);
    if (encontrado) return encontrado;
  }
  return undefined;
}

/**
 * ¿La lista concedida cubre el permiso pedido?
 *
 * Reconoce dos comodines: `*` (todo) y `modulo.*` (todo un módulo). Existen para
 * que el perfil de super administrador no haya que ampliarlo cada vez que se
 * añade un permiso nuevo — que es exactamente el fallo por el que un sistema de
 * permisos acaba desactualizado y la gente termina otorgando de más.
 */
export function tienePermiso(concedidos: readonly string[] | undefined, pedido: string): boolean {
  if (!concedidos || concedidos.length === 0) return false;
  if (concedidos.includes(COMODIN)) return true;
  if (concedidos.includes(pedido)) return true;
  const modulo = pedido.split(".")[0];
  return concedidos.includes(`${modulo}.${COMODIN}`);
}

/** ¿Cubre TODOS los pedidos? Para acciones que exigen varios permisos a la vez. */
export function tieneTodos(concedidos: readonly string[] | undefined, pedidos: readonly string[]): boolean {
  return pedidos.every((p) => tienePermiso(concedidos, p));
}

/** ¿Cubre AL MENOS UNO? Es el criterio para dar acceso a una pantalla. */
export function tieneAlguno(concedidos: readonly string[] | undefined, pedidos: readonly string[]): boolean {
  return pedidos.some((p) => tienePermiso(concedidos, p));
}

/** Expande comodines a la lista concreta de permisos. Para mostrar y para comparar. */
export function expandir(concedidos: readonly string[] | undefined): Permiso[] {
  if (!concedidos?.length) return [];
  if (concedidos.includes(COMODIN)) return [...TODOS_LOS_PERMISOS];
  return TODOS_LOS_PERMISOS.filter((p) => tienePermiso(concedidos, p));
}

// ─── COMPATIBILIDAD CON LOS ROLES EXISTENTES ─────────────────────────────────

/**
 * Lo que veían GERENTE, SUPERVISOR y AUDITOR en los módulos de talento: consulta
 * y nada más. La gestión estaba reservada a SUPER_ADMIN y ADMIN_RRHH, y por eso
 * los permisos `*_gestionar` NO entran aquí.
 */
const TALENTO_LECTURA = [
  "talento.evaluaciones_ver",
  "talento.capacitaciones",
  "talento.reclutamiento",
  "talento.dotaciones",
] as const;

/**
 * Traducción rol → permisos, calcada del comportamiento anterior.
 *
 * Cada línea corresponde a una comprobación que ya existía (las listas de
 * `guard.ts`, los `includes` de las rutas y el filtrado del menú lateral). Si
 * aquí se concede algo que antes el rol no podía hacer, esto deja de ser una
 * migración y pasa a ser un cambio de permisos silencioso; por eso se mantiene
 * conservador incluso donde el reparto original resulta discutible.
 *
 * Los permisos NUEVOS (exportar, importar, seguridad.*) no existían para ningún
 * rol: se conceden con criterio restrictivo y se ajustan creando perfiles.
 */
export const PERMISOS_POR_ROL: Record<UserRole, readonly string[]> = {
  // Único rol con comodín: es el administrador de la instalación.
  SUPER_ADMIN: [COMODIN],

  ADMIN_RRHH: [
    "empleados.ver", "empleados.pii", "empleados.crear", "empleados.editar",
    "empleados.exportar", "empleados.importar",
    "deducciones.ver", "deducciones.configurar", "deducciones.asignar",
    "deducciones.exportar", "deducciones.importar",
    // Autoriza el gasto (aprobar) y puede reabrir, pero NO ejecuta el desembolso:
    // es la separación de funciones que ya imponía la matriz de transiciones de
    // `lib/payroll/estado-planilla.ts`, no una restricción nueva.
    "planillas.ver", "planillas.calcular", "planillas.aprobar",
    "planillas.anular", "planillas.reabrir", "planillas.boletas", "planillas.contabilidad",
    "planillas.plan_cuentas", "planillas.sap_enviar",
    "prestaciones.ver", "prestaciones.generar", "prestaciones.salarios", "prestaciones.aprobar",
    "empleados.salud", "documentos.emitir", "documentos.plantillas",
    "asistencia.ver", "asistencia.gestionar", "asistencia.aprobar_permisos", "asistencia.biometrico",
    "asistencia.turnos", "asistencia.incapacidades",
    "talento.evaluaciones_ver", "talento.evaluaciones_gestionar",
    "talento.evaluaciones_cerrar", "talento.competencias",
    "talento.capacitaciones", "talento.capacitaciones_gestionar",
    "talento.reclutamiento", "talento.reclutamiento_gestionar",
    "talento.dotaciones", "talento.dotaciones_gestionar",
    "organizacion.ver", "organizacion.reasignar", "organizacion.centros_costo",
    "comunicacion.publicar", "comunicacion.politicas",
    "reportes.ver",
    "configuracion.ver", "configuracion.editar",
    "seguridad.auditoria",
  ],

  // Opera la nómina y ve datos personales, pero no toca el expediente ni el
  // talento: es justo lo que permitían ROLES_NOMINA + ROLES_PII.
  CONTADOR: [
    "empleados.ver", "empleados.pii", "empleados.exportar",
    "deducciones.ver", "deducciones.configurar", "deducciones.asignar", "deducciones.exportar",
    // Ejecuta el desembolso (pagar) pero NO aprueba lo que él mismo calcula, ni
    // reabre una planilla ya aprobada. Mismo criterio que la matriz de
    // transiciones de `lib/payroll/estado-planilla.ts`.
    "planillas.ver", "planillas.calcular", "planillas.pagar",
    "planillas.anular", "planillas.boletas", "planillas.contabilidad",
    "planillas.plan_cuentas", "planillas.sap_enviar",
    "prestaciones.ver", "prestaciones.generar", "prestaciones.pagar",
    // Los centros de costo son una dimensión CONTABLE: quien arma la partida
    // decide cómo se reparte el gasto. Pero no toca la línea de reporte.
    "organizacion.ver", "organizacion.centros_costo",
    "reportes.ver",
  ],

  // Lee la nómina sin poder operarla, y ve el directorio SIN datos personales
  // (GERENTE no estaba en ROLES_PII).
  GERENTE: [
    "empleados.ver",
    "deducciones.ver",
    "planillas.ver",
    "prestaciones.ver",
    "asistencia.ver",
    ...TALENTO_LECTURA,
    "talento.evaluaciones_gestionar",
    "organizacion.ver",
    "reportes.ver",
  ],

  SUPERVISOR: [
    "empleados.ver",
    "asistencia.ver", "asistencia.gestionar",
    ...TALENTO_LECTURA,
    "talento.evaluaciones_gestionar",
    "organizacion.ver",
  ],

  // Sólo lectura, pero con acceso a datos sensibles: es su función.
  AUDITOR: [
    "empleados.ver", "empleados.pii",
    "deducciones.ver",
    "planillas.ver",
    "prestaciones.ver",
    ...TALENTO_LECTURA,
    "organizacion.ver",
    "reportes.ver",
    "seguridad.auditoria",
  ],

  // Su acceso es /mi-espacio y el portal, que no pasan por el catálogo.
  EMPLEADO: [],
};

/**
 * Permisos efectivos de un usuario.
 *
 * El perfil MANDA sobre el rol. Un perfil inactivo no concede nada: desactivarlo
 * debe cortar el acceso, no devolver a la gente a los permisos de su rol
 * antiguo — sería una degradación silenciosa hacia arriba o hacia abajo.
 */
export function permisosEfectivos(usuario: {
  role?: UserRole | null;
  perfil?: { permisos: string[]; activo: boolean } | null;
}): string[] {
  if (usuario.perfil) {
    return usuario.perfil.activo ? [...usuario.perfil.permisos] : [];
  }
  return [...(PERMISOS_POR_ROL[usuario.role ?? "EMPLEADO"] ?? [])];
}

/**
 * Permisos que este perfil NUNCA tuvo ocasión de decidir.
 *
 * EL PROBLEMA. Los perfiles no se refrescan al re-sembrar, para no revertir lo
 * que el administrador configuró. Pero entonces, cuando el catálogo gana un
 * permiso, los perfiles ya creados se quedan sin él y la función resulta
 * invisible —sin ningún error que lo delate— para todos salvo quien tenga
 * comodín.
 *
 * LA CLAVE ES `conocidos`: el catálogo que existía la última vez que se guardó
 * el perfil. Un permiso que NO estaba en él no pudo ser rechazado por nadie, así
 * que se añade si le corresponde por su línea base. Uno que SÍ estaba y no
 * figura en `actuales` es una decisión deliberada, y no se toca.
 *
 * Un primer intento comparaba por MÓDULO —«si no tiene ninguno de este módulo,
 * nunca lo vio»— y fallaba justo en el caso más común: un permiso nuevo dentro
 * de un módulo que el perfil ya conocía se quedaba fuera.
 *
 * `conocidos` vacío significa perfil anterior a esta comprobación: se completa
 * hasta su línea base una sola vez y a partir de ahí la comparación es exacta.
 */
export function permisosNoVistos(
  conocidos: readonly string[],
  actuales: readonly string[],
  baseline: readonly string[]
): string[] {
  // Con comodín no falta nada: ya concede todo lo que el catálogo tenga.
  if (actuales.includes(COMODIN)) return [];

  const yaVistos = new Set(conocidos);
  const yaTiene = new Set(actuales);

  return baseline.filter((p) => p !== COMODIN && !yaVistos.has(p) && !yaTiene.has(p));
}
