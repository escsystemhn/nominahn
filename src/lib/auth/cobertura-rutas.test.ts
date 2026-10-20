/**
 * Barrido de cobertura: NINGUNA ruta API sin autorización.
 *
 * POR QUÉ EXISTE. La aplicación llegó a tener 37 rutas que no pasaban por el
 * guardia central; varias comprobaban el rol a mano y alguna sólo miraba que
 * existiera sesión. El problema de fondo no era ninguna ruta concreta: era que
 * añadir una ruta nueva sin autorización no rompía nada y nadie se enteraba.
 *
 * Este test recorre el árbol de rutas y falla si aparece un `route.ts` sin
 * guardia. Es deliberadamente tonto —busca nombres de función en el fuente— y
 * eso es justo lo que lo hace útil: no puede quedarse desactualizado respecto a
 * una ruta que todavía no existe.
 *
 * Las excepciones se declaran aquí, con su motivo. Añadir una es un cambio
 * visible en el diff, que es exactamente la conversación que debe provocar.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

const RAIZ_API = join(process.cwd(), "src", "app", "api");

/** Formas válidas de autorizar una ruta. */
const GUARDIAS = [
  "requerirPermiso(",
  "requerirSesion(",
];

/**
 * Rutas que legítimamente no llevan guardia de sesión, con el motivo por el que
 * no la llevan y lo que las protege en su lugar.
 */
const EXCEPCIONES: Record<string, string> = {
  "auth/[...nextauth]/route.ts":
    "Es el propio manejador de NextAuth: es lo que crea la sesión, no puede exigirla.",
  "cron/evaluaciones/route.ts":
    "La invoca un cron externo sin usuario. Se protege con el encabezado x-cron-secret.",
  "cron/biometrico/route.ts":
    "La invoca un cron externo sin usuario para sondear los relojes de la LAN. Se protege con el encabezado x-cron-secret.",
  "cron/sap/route.ts":
    "La invoca un cron externo sin usuario para reintentar los asientos pendientes hacia SAP B1. Se protege con el encabezado x-cron-secret.",
  "evaluar/[token]/route.ts":
    "Enlace de evaluación para quien no tiene cuenta. Se protege con el token de un solo uso del participante.",
  "empleos/[id]/postular/route.ts":
    "Postulación del portal público de empleo, para quien no tiene cuenta. Sólo acepta vacantes abiertas, publicadas y no internas; se protege con límite por IP, campo trampa, tamaño máximo y firma PDF del currículo.",
  "estado/route.ts":
    "Estado del servicio para la pantalla de inicio de sesion: solo dice si la base responde y el nombre de la empresa, que va impreso en cada boleta. No expone nada mas.",
};

function rutasApi(dir: string): string[] {
  const encontradas: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const completa = join(dir, entrada);
    if (statSync(completa).isDirectory()) {
      encontradas.push(...rutasApi(completa));
    } else if (entrada === "route.ts") {
      encontradas.push(completa);
    }
  }
  return encontradas;
}

const RUTAS = rutasApi(RAIZ_API).map((ruta) => ({
  relativa: relative(RAIZ_API, ruta).split(sep).join("/"),
  fuente: readFileSync(ruta, "utf-8"),
}));

describe("cobertura de autorización en las rutas API", () => {
  it("encuentra rutas que analizar", () => {
    // Si el árbol cambia de sitio, este test dejaría de comprobar nada y pasaría
    // en verde. Mejor que falle.
    expect(RUTAS.length).toBeGreaterThan(30);
  });

  it("toda ruta pasa por una guardia, salvo las excepciones declaradas", () => {
    const desprotegidas = RUTAS.filter(
      ({ relativa, fuente }) =>
        !EXCEPCIONES[relativa] && !GUARDIAS.some((guardia) => fuente.includes(guardia))
    ).map((r) => r.relativa);

    expect(
      desprotegidas,
      `Rutas sin autorización:\n  ${desprotegidas.join("\n  ")}\n` +
        "Use requerirPermiso() —o requerirSesion() si es un recurso propio del usuario—, " +
        "o declárela en EXCEPCIONES con su motivo."
    ).toEqual([]);
  });

  it("no quedan excepciones apuntando a rutas que ya no existen", () => {
    const existentes = new Set(RUTAS.map((r) => r.relativa));
    for (const ruta of Object.keys(EXCEPCIONES)) {
      expect(existentes.has(ruta), `La excepción "${ruta}" ya no corresponde a ninguna ruta`).toBe(true);
    }
  });

  /**
   * La migración retiró `requerirRol` y las listas de roles. Que no vuelvan es
   * lo que impide que la autorización se parta otra vez en dos criterios.
   */
  it("ninguna ruta comprueba roles a mano", () => {
    const conRoles = RUTAS.filter(({ fuente }) =>
      /\[\s*"(SUPER_ADMIN|ADMIN_RRHH|CONTADOR|GERENTE|SUPERVISOR|AUDITOR)"/.test(fuente) ||
      /requerirRol\(/.test(fuente)
    ).map((r) => r.relativa);

    expect(
      conRoles,
      `Estas rutas deciden por rol en vez de por permiso:\n  ${conRoles.join("\n  ")}`
    ).toEqual([]);
  });
});
