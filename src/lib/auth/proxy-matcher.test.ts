/**
 * El matcher de `src/proxy.ts` decide qué peticiones pasan por la comprobación
 * de sesión. Es una sola expresión regular, y equivocarse en ella no rompe nada
 * de forma visible: o deja pasar lo que debía proteger, o bloquea lo que debía
 * servir.
 *
 * Ya ocurrió lo segundo. El matcher excluía `public`, creyendo que así dejaba
 * fuera los archivos estáticos — pero los de `public/` se sirven desde la RAÍZ
 * (`/logo.png`), no bajo `/public/logo.png`. La petición entraba al middleware y
 * salía redirigida al login. Quedó latente mientras la aplicación sólo usaba SVG
 * en línea, y apareció al añadir el logo: el optimizador de imágenes de Next
 * pide el archivo con una petición propia SIN cookie de sesión, recibía el HTML
 * del login y devolvía 400 «isn't a valid image» en TODAS las páginas.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/** Se lee del fuente para que el test no pueda quedar probando una copia vieja. */
function matcherDelProxy(): RegExp {
  const fuente = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf-8");
  const m = fuente.match(/matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) throw new Error("No se encontró el matcher en src/proxy.ts");
  // El patrón viaja dentro de una cadena TS: hay que deshacer el escapado.
  return new RegExp("^" + JSON.parse(`"${m[1]}"`) + "$");
}

/** ¿Esta ruta pasa por la comprobación de sesión? */
function pasaPorElMiddleware(ruta: string): boolean {
  return matcherDelProxy().test(ruta);
}

describe("matcher del proxy de autenticación", () => {
  it("protege las páginas de la aplicación", () => {
    for (const ruta of ["/dashboard", "/empleados", "/planillas", "/biometrico", "/mi-cuenta"]) {
      expect(pasaPorElMiddleware(ruta), ruta).toBe(true);
    }
  });

  it("protege las rutas API", () => {
    for (const ruta of ["/api/empleados", "/api/planillas", "/api/biometrico/eventos"]) {
      expect(pasaPorElMiddleware(ruta), ruta).toBe(true);
    }
  });

  it("deja pasar los archivos estáticos de public/, que se sirven desde la raíz", () => {
    // Éste es el caso que estaba roto: sin la exención, el optimizador de
    // imágenes recibe el HTML del login en vez del PNG.
    for (const ruta of [
      "/logo-escsystem.png",
      "/logo-escsystem-blanco.png",
      "/logo-escsystem-icono.png",
      "/next.svg",
      "/favicon.ico",
    ]) {
      expect(pasaPorElMiddleware(ruta), ruta).toBe(false);
    }
  });

  it("NO extiende la exención a rutas con subcarpetas aunque acaben en extensión estática", () => {
    // `/api/uploads/<archivo>` sirve documentos privados —contratos, boletas— y
    // tiene que seguir pasando por la comprobación. Un patrón de extensión sin
    // anclar (`.*\.png$` en vez de `[^/]+\.png$`) los habría dejado al aire.
    for (const ruta of [
      "/api/uploads/contrato.pdf",
      "/api/uploads/boleta.png",
      "/api/uploads/foto.jpg",
      "/api/documentos/identidad.png",
    ]) {
      expect(pasaPorElMiddleware(ruta), ruta).toBe(true);
    }
  });

  it("deja pasar los internos de Next", () => {
    expect(pasaPorElMiddleware("/_next/static/chunks/main.js")).toBe(false);
    expect(pasaPorElMiddleware("/_next/image")).toBe(false);
  });

  it("ya no menciona 'public', que nunca excluyó nada", () => {
    const fuente = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf-8");
    const matcher = fuente.match(/matcher:\s*\[[\s\S]*?\]/)?.[0] ?? "";
    expect(matcher).not.toMatch(/\|public[|)]/);
  });
});

describe("rutas públicas del proxy", () => {
  /**
   * Los crons los llama una tarea programada SIN sesión. Mientras /api/cron no
   * estuvo entre las rutas públicas, el proxy respondía 302 hacia el login y
   * ningún cron (SAP, relojes, campañas de evaluación) llegó a ejecutarse fuera
   * de una prueba con la cookie puesta. Lo encontró la prueba del instalador.
   */
  it("deja llegar los crons a su ruta, que se protege con x-cron-secret", () => {
    const fuente = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf-8");
    const lista = fuente.match(/const publicPrefixes = \[([\s\S]*?)\]/)?.[1] ?? "";
    expect(lista).toContain('"/api/cron/"');
  });
});
