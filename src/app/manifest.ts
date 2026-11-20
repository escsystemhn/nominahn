/**
 * Para instalar Gestión360 Nómina en el celular o la tableta: «Agregar a la pantalla
 * de inicio» la abre con su ícono y a pantalla completa, sin la barra del navegador.
 *
 * Sin service worker a propósito: no se guarda nada de la nómina en el teléfono, que
 * puede ser compartido o perderse. La aplicación sigue necesitando conexión.
 */

import type { MetadataRoute } from "next";
import { PRODUCTO } from "@/lib/marca";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCTO,
    short_name: "Gestión360",
    description: "Nómina, asistencia y talento humano para empresas en Honduras.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    lang: "es-HN",
    // Blanco como la barra superior: así la barra del sistema se funde con ella.
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    icons: [
      { src: "/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Con margen de sobra: Android lo recorta en círculo o en cuadro redondeado.
      { src: "/icono-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
