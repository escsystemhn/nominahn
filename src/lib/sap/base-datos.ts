/**
 * Conexión de SÓLO LECTURA a la base de datos de SAP Business One (SQL Server).
 *
 * Para qué sirve aquí:
 *   · Probar que la base de la empresa existe, es de SAP y es la que se cree
 *     (nombre de la empresa, moneda local, versión de B1).
 *   · Listar las empresas del servidor (SBO-COMMON.dbo.SRGC) para elegir la
 *     base sin teclearla.
 *
 * Lo que NO hace nunca: escribir. Los asientos van por el Service Layer, que
 * es la única vía que SAP soporta para crear documentos; escribir por SQL deja
 * la instalación fuera de soporte. Aquí sólo hay consultas fijas, sin texto
 * del usuario dentro del SQL (los nombres de base se citan y validan).
 *
 * Mismo criterio que SAP_EstCta: un usuario de SQL Server con permisos de
 * lectura basta, y si el usuario puede escribir se avisa.
 */

import sql from "mssql";

export interface ConfigBaseDatosSap {
  servidor: string;
  puerto: number;
  instancia: string | null;
  usuario: string;
  password: string;
  cifrar: boolean;
  confiarCertificado: boolean;
}

export interface ResultadoPruebaBd {
  servidor: string;
  versionSql: string;
  login: string;
  baseDatos: string;
  esBaseSap: boolean;
  empresa: string | null;
  moneda: string | null;
  versionB1: string | null;
  puedeEscribir: boolean;
  avisos: string[];
  ms: number;
}

export interface EmpresaSap {
  baseDatos: string;
  nombre: string;
  version: string | null;
}

/** Un nombre de base de SQL Server razonable: letras, dígitos, _ - . y espacio. */
export function nombreBaseValido(nombre: string): boolean {
  return /^[A-Za-z0-9_\-. ]{1,128}$/.test(nombre) && nombre.trim() === nombre;
}

/** Identificador citado para T-SQL: [nombre] con ] duplicado. */
export function citar(nombre: string): string {
  return `[${nombre.replace(/]/g, "]]")}]`;
}

/** Configuración del driver `mssql`. Tiempos cortos: es una prueba desde una pantalla. */
export function configDriver(cfg: ConfigBaseDatosSap, baseDatos: string): sql.config {
  const config: sql.config = {
    server: cfg.servidor,
    port: cfg.puerto || 1433,
    user: cfg.usuario,
    password: cfg.password,
    database: baseDatos,
    connectionTimeout: 15_000,
    requestTimeout: 20_000,
    pool: { max: 1, min: 0, idleTimeoutMillis: 1_000 },
    options: {
      encrypt: cfg.cifrar,
      trustServerCertificate: cfg.confiarCertificado,
      enableArithAbort: true,
      appName: "NominaHN",
      // Declara la intención: en un grupo de disponibilidad va a una réplica de lectura.
      readOnlyIntent: true,
    },
  };
  // Con instancia nombrada el puerto lo resuelve el SQL Browser.
  if (cfg.instancia) {
    config.options = { ...config.options, instanceName: cfg.instancia };
    delete config.port;
  }
  return config;
}

async function conPool<T>(cfg: ConfigBaseDatosSap, baseDatos: string, fn: (pool: sql.ConnectionPool) => Promise<T>): Promise<T> {
  const pool = new sql.ConnectionPool(configDriver(cfg, baseDatos));
  // Sin manejador, un error del pool termina como excepción no capturada.
  pool.on("error", () => undefined);
  try {
    await pool.connect();
    return await fn(pool);
  } finally {
    await pool.close().catch(() => undefined);
  }
}

interface FilaSonda {
  db: string;
  version: string;
  login: string;
  tieneOADM: number;
  tieneOACT: number;
  tieneOJDT: number;
  tieneCINF: number;
  insertar: number | null;
  actualizar: number | null;
  borrar: number | null;
  alterar: number | null;
}

const SONDA = `
SELECT DB_NAME() AS db,
       @@VERSION AS version,
       SUSER_SNAME() AS login,
       CASE WHEN OBJECT_ID('dbo.OADM', 'U') IS NULL THEN 0 ELSE 1 END AS tieneOADM,
       CASE WHEN OBJECT_ID('dbo.OACT', 'U') IS NULL THEN 0 ELSE 1 END AS tieneOACT,
       CASE WHEN OBJECT_ID('dbo.OJDT', 'U') IS NULL THEN 0 ELSE 1 END AS tieneOJDT,
       CASE WHEN OBJECT_ID('dbo.CINF', 'U') IS NULL THEN 0 ELSE 1 END AS tieneCINF,
       HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') AS insertar,
       HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS actualizar,
       HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE') AS borrar,
       HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER') AS alterar`;

/** Del resultado de la sonda al informe para la pantalla. Puro, para probarlo. */
export function interpretarSonda(
  fila: FilaSonda,
  empresa: { CompnyName?: string | null; MainCurncy?: string | null } | null,
  versionB1: string | null,
  cfg: Pick<ConfigBaseDatosSap, "servidor" | "puerto" | "instancia">,
  ms: number
): ResultadoPruebaBd {
  const esBaseSap = fila.tieneOADM === 1 && fila.tieneOACT === 1 && fila.tieneOJDT === 1;
  const puedeEscribir = [fila.insertar, fila.actualizar, fila.borrar, fila.alterar].some((v) => v === 1);
  const avisos: string[] = [];
  if (!esBaseSap) avisos.push(`La base ${fila.db} no tiene las tablas de SAP Business One (OADM, OACT, OJDT). Revise el nombre de la base de la empresa.`);
  if (puedeEscribir) avisos.push(`El usuario ${fila.login} puede escribir en la base. Basta uno de sólo lectura (db_datareader): esta aplicación nunca escribe ahí.`);
  const moneda = empresa?.MainCurncy?.trim() || null;
  if (moneda && !["L", "HNL", "LPS", "LEMPIRA"].includes(moneda.toUpperCase())) {
    avisos.push(`La moneda local de la empresa en SAP es ${moneda}; la nómina se calcula en lempiras.`);
  }
  return {
    servidor: cfg.instancia ? `${cfg.servidor}\\${cfg.instancia}` : `${cfg.servidor}:${cfg.puerto}`,
    versionSql: String(fila.version ?? "").split("\n")[0].trim(),
    login: fila.login,
    baseDatos: fila.db,
    esBaseSap,
    empresa: empresa?.CompnyName?.trim() || null,
    moneda,
    versionB1,
    puedeEscribir,
    avisos,
    ms,
  };
}

/**
 * SQL Server responde «Login failed» igual si la contraseña es mala que si la
 * base no existe o el usuario no tiene acceso a ella, y el driver no conserva
 * el detalle (4060 frente a 18456). Se distingue entrando a `master` con las
 * mismas credenciales: si entra, la contraseña está bien y el problema es la
 * base; ahí mismo se ve si existe y si el usuario tiene acceso.
 */
async function diagnosticarLogin(cfg: ConfigBaseDatosSap, baseDatos: string, original: ErrorBaseDatos): Promise<ErrorBaseDatos> {
  if (original.codigo !== "LOGIN" || baseDatos.toLowerCase() === "master") return original;
  const destino = cfg.instancia ? `${cfg.servidor}\\${cfg.instancia}` : `${cfg.servidor}:${cfg.puerto}`;
  try {
    const fila = await conPool(cfg, "master", async (pool) =>
      (await pool.request().input("n", sql.NVarChar(128), baseDatos).query("SELECT DB_ID(@n) AS id, HAS_DBACCESS(@n) AS acceso")).recordset[0]
    );
    if (fila?.id === null || fila?.id === undefined) {
      return new ErrorBaseDatos("BASE", `La base ${baseDatos} no existe en ${destino}.`, original.detalle);
    }
    return new ErrorBaseDatos("PERMISO", `El usuario ${cfg.usuario} entra a ${destino}, pero no tiene acceso a la base ${baseDatos}.`, original.detalle);
  } catch {
    return original;
  }
}

/** Conecta a la base de la empresa, comprueba que es de SAP y lee sus datos básicos. */
export async function probarBaseDatos(cfg: ConfigBaseDatosSap, companyDb: string): Promise<ResultadoPruebaBd> {
  if (!nombreBaseValido(companyDb)) throw new ErrorBaseDatos("NOMBRE", `El nombre de base «${companyDb}» no es válido.`);
  const inicio = Date.now();
  try {
    return await conPool(cfg, companyDb, async (pool) => {
      const fila = (await pool.request().query<FilaSonda>(SONDA)).recordset[0];
      let empresa: { CompnyName?: string | null; MainCurncy?: string | null } | null = null;
      let versionB1: string | null = null;
      if (fila.tieneOADM === 1) {
        empresa = (await pool.request().query("SELECT TOP (1) CompnyName, MainCurncy FROM dbo.OADM")).recordset[0] ?? null;
      }
      if (fila.tieneCINF === 1) {
        const v = (await pool.request().query("SELECT TOP (1) CAST(Version AS nvarchar(20)) AS Version FROM dbo.CINF")).recordset[0];
        versionB1 = v?.Version ? String(v.Version) : null;
      }
      return interpretarSonda(fila, empresa, versionB1, cfg, Date.now() - inicio);
    });
  } catch (e) {
    throw await diagnosticarLogin(cfg, companyDb, traducirErrorSql(e, { ...cfg, baseDatos: companyDb }));
  }
}

/**
 * Empresas del servidor. Primero SBO-COMMON.dbo.SRGC, que es el registro de
 * SAP; si el usuario no tiene acceso a SBO-COMMON, las bases a las que sí
 * accede y que tienen OADM.
 */
export async function listarEmpresas(cfg: ConfigBaseDatosSap): Promise<{ origen: "SBO-COMMON" | "SERVIDOR"; empresas: EmpresaSap[] }> {
  try {
    const empresas = await conPool(cfg, "SBO-COMMON", async (pool) => {
      const r = await pool.request().query("SELECT dbName, cmpName, versStr FROM dbo.SRGC ORDER BY cmpName");
      return r.recordset.map((f: { dbName: string; cmpName: string; versStr: string | null }) => ({
        baseDatos: String(f.dbName).trim(),
        nombre: String(f.cmpName ?? f.dbName).trim(),
        version: f.versStr ? String(f.versStr).trim() : null,
      }));
    });
    return { origen: "SBO-COMMON", empresas };
  } catch (e) {
    const err = await diagnosticarLogin(cfg, "SBO-COMMON", traducirErrorSql(e, { ...cfg, baseDatos: "SBO-COMMON" }));
    // Sin SBO-COMMON (o sin permiso) se intenta con lo que el usuario sí ve.
    if (err.codigo !== "BASE" && err.codigo !== "PERMISO") throw err;
  }
  try {
    const empresas = await conPool(cfg, "master", async (pool) => {
      const r = await pool.request().query(`
        SELECT name FROM sys.databases
         WHERE database_id > 4 AND state_desc = 'ONLINE' AND HAS_DBACCESS(name) = 1
           AND OBJECT_ID(QUOTENAME(name) + '.dbo.OADM', 'U') IS NOT NULL
         ORDER BY name`);
      return r.recordset.map((f: { name: string }) => ({ baseDatos: f.name, nombre: f.name, version: null }));
    });
    return { origen: "SERVIDOR", empresas };
  } catch (e) {
    throw traducirErrorSql(e, { ...cfg, baseDatos: "master" });
  }
}

// ─── Errores ──────────────────────────────────────────────────────────────────

export class ErrorBaseDatos extends Error {
  constructor(public codigo: "RED" | "LOGIN" | "BASE" | "PERMISO" | "INSTANCIA" | "TLS" | "NOMBRE" | "OTRO", mensaje: string, public detalle?: string) {
    super(mensaje);
    this.name = "ErrorBaseDatos";
  }
}

/** Errores de tedious/mssql → mensaje para quien configura. */
export function traducirErrorSql(e: unknown, ctx: { servidor: string; puerto: number; instancia: string | null; usuario: string; baseDatos: string }): ErrorBaseDatos {
  if (e instanceof ErrorBaseDatos) return e;
  const err = e as { code?: string; number?: number; message?: string; originalError?: { code?: string; number?: number; message?: string; info?: { number?: number; message?: string } } };
  const codigo = err?.code ?? err?.originalError?.code ?? "";
  const numero = err?.number ?? err?.originalError?.number ?? err?.originalError?.info?.number;
  const mensaje = err?.message ?? err?.originalError?.message ?? String(e);
  const destino = ctx.instancia ? `${ctx.servidor}\\${ctx.instancia}` : `${ctx.servidor}:${ctx.puerto}`;
  const detalle = `${codigo || "?"}${numero ? ` ${numero}` : ""}: ${mensaje}`;

  if (numero === 18456 || /login failed/i.test(mensaje)) {
    return new ErrorBaseDatos("LOGIN", `SQL Server rechazó el usuario ${ctx.usuario} o su contraseña en ${destino}.`, detalle);
  }
  if (numero === 4060 || /cannot open database/i.test(mensaje)) {
    return new ErrorBaseDatos("BASE", `La base ${ctx.baseDatos} no existe en ${destino} o el usuario ${ctx.usuario} no tiene acceso a ella.`, detalle);
  }
  if (numero === 229 || numero === 916 || /permission was denied|is not able to access the database/i.test(mensaje)) {
    return new ErrorBaseDatos("PERMISO", `El usuario ${ctx.usuario} no tiene permiso de lectura sobre ${ctx.baseDatos}.`, detalle);
  }
  if (codigo === "EINSTLOOKUP" || /instance/i.test(mensaje) && /lookup|browser/i.test(mensaje)) {
    return new ErrorBaseDatos("INSTANCIA", `No se encontró la instancia ${ctx.instancia ?? ""} en ${ctx.servidor}. Revise el nombre o que el servicio SQL Browser esté encendido.`, detalle);
  }
  if (/certificate|self[- ]signed|SSL|TLS/i.test(mensaje)) {
    return new ErrorBaseDatos("TLS", `El certificado de ${destino} no es de confianza. Marque «Confiar en el certificado del servidor» o instale la CA.`, detalle);
  }
  if (["ESOCKET", "ETIMEOUT", "ECONNCLOSED", "ECONNREFUSED", "ENOTFOUND"].includes(codigo) || /connect|ECONNREFUSED|ENOTFOUND|timeout/i.test(mensaje)) {
    return new ErrorBaseDatos("RED", `No se alcanza SQL Server en ${destino}. Revise servidor, puerto, firewall o VPN.`, detalle);
  }
  return new ErrorBaseDatos("OTRO", `SQL Server devolvió un error: ${mensaje}`, detalle);
}
