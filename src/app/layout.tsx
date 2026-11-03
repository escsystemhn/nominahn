import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AvisosProvider } from "@/components/ui/Avisos";
import { PRODUCTO } from "@/lib/marca";

/**
 * IBM Plex: una sola familia para toda la interfaz, con cifras tabulares para
 * que los montos de una planilla queden alineados. La mono sólo viste códigos
 * (EMP-0001, RTN) y se carga en dos pesos.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: PRODUCTO,
    template: `%s | ${PRODUCTO}`,
  },
  description: "Gestión de nómina y talento humano para empresas en Honduras, por ESC System Consultorías.",
  applicationName: PRODUCTO,
  icons: {
    icon: "/gestion360-icono.png",
    apple: "/gestion360-icono.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${plexSans.variable} ${plexMono.variable} h-full`}>
      <body className="h-full bg-gray-50 font-sans">
        <AvisosProvider>{children}</AvisosProvider>
      </body>
    </html>
  );
}
