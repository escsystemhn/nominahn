import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

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
    default: "NominaHN",
    template: "%s | NominaHN",
  },
  description: "Gestión de nómina y talento humano para empresas en Honduras, por ESC System Consultorías.",
  applicationName: "NominaHN",
  icons: {
    icon: "/logo-escsystem-icono.png",
    apple: "/logo-escsystem-icono.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${plexSans.variable} ${plexMono.variable} h-full`}>
      <body className="h-full bg-gray-50 font-sans">{children}</body>
    </html>
  );
}
