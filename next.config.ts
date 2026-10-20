import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Cabeceras de seguridad de toda la aplicación.
 *
 * Las descargas individuales ya traían `nosniff`, CSP y `no-store`, lo que
 * mostraba que el criterio existía — pero no había ninguna política global: ni
 * HSTS, ni protección contra encuadre, ni control de referente. Una aplicación
 * que maneja RTN, identidad, salarios y cuentas bancarias las necesita en todas
 * sus respuestas, no sólo en los archivos.
 */
/**
 * Política de contenido para toda la aplicación.
 *
 * Sin nonces a propósito: un nonce obliga a renderizar cada página por petición
 * y a reescribir el proxy, y Next mete scripts en línea que entonces habría que
 * firmar uno por uno. Con `'unsafe-inline'` la CSP no frena un script inyectado
 * en la página, pero sí lo que ese script puede hacer después: no puede cargar
 * código de otro dominio, ni mandar datos fuera (`connect-src 'self'`), ni
 * desviar un formulario, ni encuadrar la app. `'unsafe-eval'` sólo en
 * desarrollo, donde React lo usa para reconstruir las pilas de error.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const cabecerasSeguridad = [
  { key: "Content-Security-Policy", value: csp },
  // Nada de esta aplicación debe cargarse dentro de un iframe ajeno: cierra el
  // clickjacking sobre las acciones de aprobar y pagar planilla.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No filtrar la ruta completa (que lleva ids de empleado y planilla) al salir
  // hacia otro origen.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Dos años, subdominios incluidos: los datos de nómina no viajan en claro.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

/**
 * Edición instalable (instalador de Windows con evaluación de 30 días).
 *
 * La compila `instalador/construir.ps1` con G360_EDICION=instalable. Cambia dos
 * cosas, y sólo en esa compilación:
 *   · `output: "standalone"`: Next copia en .next/standalone sólo los archivos
 *     que el servidor usa, y el instalador lo lleva sin `npm install`.
 *   · el bloque `env` FIJA en el código compilado la edición y las claves
 *     públicas de SDL (ver src/lib/licencia/edicion.ts): en el equipo del
 *     cliente no se cambian editando un archivo de configuración.
 * Sin la variable, `next dev`, `next build` y el VPS quedan exactamente igual.
 */
const edicionInstalable = process.env.G360_EDICION === "instalable";
const version = (JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string }).version;

/**
 * Seenode (scripts/compilar-produccion.mjs) también compila en standalone: el
 * plan Basic tiene 750 MB de disco y node_modules completo pasa de 900 MB. El
 * servidor standalone ocupa una fracción de eso y arranca con menos memoria.
 */
const salidaStandalone = edicionInstalable || process.env.SALIDA_STANDALONE === "1";

/**
 * Compilación y servidor para 512 MB de RAM (scripts/compilar-produccion.mjs).
 *
 * Sin estos ajustes `next build` se quedaba más de diez minutos pegado al
 * límite en un contenedor de 512 MB:
 *   · `cpus: 1`: Next calcula sus workers con los núcleos de la MÁQUINA, no
 *     con los del contenedor, y cada worker es un Node con su propia memoria.
 *   · `ignoreBuildErrors`: el chequeo de tipos dentro del build es lo más
 *     pesado. No se pierde: `npx tsc --noEmit` va antes de cada push
 *     (README-DEPLOY.md) y un error de tipos no llega a compilarse aquí.
 *   · `preloadEntriesOnStart: false`: el servidor carga cada ruta al pedirla y
 *     no todas al arrancar; el pico inicial baja y la memoria sólo crece con
 *     las pantallas que de verdad se usan.
 */
const compilacionLigera = process.env.COMPILACION_LIGERA === "1";

const nextConfig: NextConfig = {
  ...(salidaStandalone ? { output: "standalone" as const } : {}),
  ...(compilacionLigera
    ? {
        typescript: { ignoreBuildErrors: true },
        experimental: { cpus: 1, preloadEntriesOnStart: false, webpackMemoryOptimizations: true },
      }
    : {}),
  // No anunciar el framework en cada respuesta.
  poweredByHeader: false,
  env: {
    G360_EDICION: edicionInstalable ? "instalable" : "",
    G360_VERSION: version,
    G360_SDL_URL: edicionInstalable ? process.env.G360_SDL_URL ?? "" : "",
    G360_SDL_PRODUCTO: process.env.G360_SDL_PRODUCTO ?? "NOMI",
    G360_SDL_CLAVES: edicionInstalable ? process.env.G360_SDL_CLAVES ?? "{}" : "{}",
  },

  // pdfmake y exceljs leen archivos propios (fuentes, plantillas) en tiempo de
  // ejecucion: se cargan desde node_modules, no empaquetados.
  serverExternalPackages: ["pg", "@prisma/adapter-pg", "prisma", "@prisma/client", "pdfmake", "exceljs", "mssql", "tedious"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: cabecerasSeguridad,
      },
      {
        // Las respuestas de la API llevan salarios, identidades y cuentas
        // bancarias: no deben quedar en ninguna caché intermedia.
        source: "/api/:path*",
        headers: [
          ...cabecerasSeguridad,
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
