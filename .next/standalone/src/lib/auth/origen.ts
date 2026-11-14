/**
 * Defensa contra CSRF en las rutas API que escriben.
 *
 * POR QUÉ HACE FALTA. La cookie de sesión es `SameSite=Lax`, y eso frena las
 * peticiones de OTRO SITIO, pero no las del mismo sitio. En Seenode la app vive
 * en `<nombre>.seenode.app`, y `seenode.app` no está en la Public Suffix List
 * (onrender.com o herokuapp.com sí): para el navegador, la app de cualquier otro
 * cliente de Seenode es «el mismo sitio» y su POST llega con nuestra cookie. Lo
 * mismo pasa con cualquier subdominio hermano de un dominio propio.
 *
 * QUÉ HACE. Un navegador manda siempre `Origin` en un POST/PUT/PATCH/DELETE. Si
 * viene y no es este mismo servidor (o uno declarado en ORIGENES_PERMITIDOS), se
 * rechaza. Si NO viene, no es un navegador —un cron con curl, por ejemplo— y
 * decide la guardia de siempre: sesión o `x-cron-secret`.
 *
 * No es CORS: la aplicación no emite cabeceras `Access-Control-*`, así que
 * ningún otro origen puede leer sus respuestas. Esto cierra la otra mitad, que
 * es impedir que las provoque.
 */

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Orígenes extra aceptados: el de AUTH_URL y los de ORIGENES_PERMITIDOS
 * (separados por comas). Lo que no sea una URL se ignora: env.ts ya lo rechaza
 * al arrancar, aquí sólo se evita que un valor raro tumbe cada petición.
 */
export function origenesPermitidos(lista: string | undefined, authUrl: string | undefined): Set<string> {
  const permitidos = new Set<string>();
  for (const valor of [authUrl, ...(lista ?? "").split(",")]) {
    const limpio = valor?.trim();
    if (!limpio) continue;
    try {
      permitidos.add(new URL(limpio).origin);
    } catch {
      // ignorado a propósito
    }
  }
  return permitidos;
}

export interface PeticionOrigen {
  metodo: string;
  /** Encabezado `Origin` tal cual llegó, o null si no vino. */
  origen: string | null;
  /** `x-forwarded-host` o, si no hay proxy, `host`. */
  host: string | null;
  permitidos: Set<string>;
}

export function origenAceptado({ metodo, origen, host, permitidos }: PeticionOrigen): boolean {
  if (METODOS_SEGUROS.has(metodo.toUpperCase())) return true;
  if (origen === null) return true;
  // `Origin: null` lo mandan los iframes con sandbox y las redirecciones
  // entre sitios: nunca es la propia aplicación.
  if (origen === "null") return false;

  let url: URL;
  try {
    url = new URL(origen);
  } catch {
    return false;
  }
  if (permitidos.has(url.origin)) return true;
  return host !== null && url.host === host.trim().toLowerCase();
}
