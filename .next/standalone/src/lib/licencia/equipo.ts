/**
 * Identidad del equipo: de qué computadora es una evaluación o una licencia.
 *
 * Se leen dos valores del registro de Windows con reg.exe:
 *   · MachineGuid (HKLM\SOFTWARE\Microsoft\Cryptography), único por instalación de Windows;
 *   · el UUID SMBIOS de la placa (HKLM\SYSTEM\HardwareConfig\LastConfig).
 *
 * Por qué el registro y no WMI (como MiDentalHN). `wmic` ya no viene en Windows 11
 * 24H2, y la alternativa —PowerShell + Get-CimInstance— tarda segundos y puede
 * fallar bajo la cuenta de servicio. Si UNA lectura falla y otra no, el código de
 * equipo cambia y la licencia deja de reconocer su computadora. El registro es
 * legible por cualquier cuenta y siempre devuelve lo mismo.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";

const ejecutar = promisify(execFile);

/** Donde el instalador deja el registro de la evaluación. La desinstalación no lo borra. */
export const RUTA_REGISTRO = "HKLM\\SOFTWARE\\ESC System\\Gestion360 Nomina";

// Ruta absoluta: no depender del PATH del servicio para un ejecutable del sistema.
const REG = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe");

export async function leerRegistro(clave: string, valor: string): Promise<string | null> {
  if (process.platform !== "win32") return null;
  try {
    const { stdout } = await ejecutar(REG, ["query", clave, "/v", valor], { windowsHide: true, timeout: 10_000 });
    const linea = stdout.split(/\r?\n/).find((l) => l.trim().startsWith(`${valor} `));
    const m = linea?.match(/REG_\w+\s+(.*)$/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

export interface IdentidadEquipo {
  machineGuid: string;
  /** Código que se le muestra al cliente y se envía a SDL: XXXX-XXXX-XXXX-XXXX. */
  codigo: string;
}

let enCurso: Promise<IdentidadEquipo> | null = null;

async function leerIdentidad(): Promise<IdentidadEquipo> {
  let machineGuid: string | null;
  let uuid: string | null = null;

  if (process.platform === "win32") {
    machineGuid = await leerRegistro("HKLM\\SOFTWARE\\Microsoft\\Cryptography", "MachineGuid");
    uuid = (await leerRegistro("HKLM\\SYSTEM\\HardwareConfig", "LastConfig"))?.replace(/[{}]/g, "") ?? null;
  } else {
    machineGuid = await readFile("/etc/machine-id", "utf8").then((s) => s.trim()).catch(() => null);
  }
  if (!machineGuid) throw new Error("No se pudo leer el MachineGuid del registro de Windows.");

  const semilla = `${machineGuid.toLowerCase()}|${(uuid ?? "").toLowerCase()}`;
  const hex = createHash("sha256").update(semilla).digest("hex").toUpperCase();
  return { machineGuid: machineGuid.toLowerCase(), codigo: hex.slice(0, 16).match(/.{4}/g)!.join("-") };
}

/** Se calcula una vez por proceso. Un fallo no se recuerda: el siguiente intento vuelve a leer. */
export function identidadEquipo(): Promise<IdentidadEquipo> {
  if (!enCurso) {
    enCurso = leerIdentidad().catch((e) => {
      enCurso = null;
      throw e;
    });
  }
  return enCurso;
}
