"use client";

/**
 * Menú y barra superior de todas las pantallas. Desde 1024 px el menú queda fijo a la
 * izquierda; por debajo se desliza sobre el contenido, para que en un celular la
 * pantalla sea de quien la está usando y no del menú.
 */

import { useEffect, useRef, useState } from "react";
import type { Session } from "next-auth";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

export default function Armazon({
  permisos,
  conEmpleado,
  jerarquiaNomina,
  user,
  empresa,
  bloqueado,
  avisos,
  children,
}: {
  permisos: readonly string[];
  /** Sin empleado vinculado, Mi espacio no tiene nada que mostrar. */
  conEmpleado: boolean;
  /** El administrador activó la jerarquía de nómina: su pantalla entra al menú. */
  jerarquiaNomina: boolean;
  user: Session["user"];
  empresa?: string | null;
  /** Con una contraseña temporal no se dibuja el menú: sólo puede cambiarla. */
  bloqueado: boolean;
  /** Avisos fijos bajo la barra: evaluación, contraseña temporal. */
  avisos?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const botonMenu = useRef<HTMLButtonElement>(null);
  const botonCerrar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierto) return;
    botonCerrar.current?.focus();
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setAbierto(false);
      botonMenu.current?.focus();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  const cerrar = () => {
    setAbierto(false);
    botonMenu.current?.focus();
  };

  return (
    <div className="flex h-dvh bg-gray-50">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-[80] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-gray-900 focus:shadow-lg"
      >
        Saltar al contenido
      </a>

      {/* El menú se filtra por PERMISO, no por rol: es lo que hace que un perfil
          a medida cambie de verdad lo que la persona ve. El filtrado sigue
          siendo cosmético —quien escriba la URL choca con la guardia de la
          página—, pero ahora coincide con lo que la guardia va a decidir. */}
      {!bloqueado && (
        <>
          {abierto && (
            <button type="button" aria-label="Cerrar menú" tabIndex={-1} onClick={cerrar} className="fixed inset-0 z-30 bg-blue-950/50 lg:hidden" />
          )}
          <Sidebar
            permisos={permisos}
            conEmpleado={conEmpleado}
            jerarquiaNomina={jerarquiaNomina}
            abierto={abierto}
            refCerrar={botonCerrar}
            onCerrar={cerrar}
            onNavegar={() => setAbierto(false)}
          />
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          user={user}
          empresa={empresa}
          conMenu={!bloqueado}
          menuAbierto={abierto}
          refMenu={botonMenu}
          onAbrirMenu={() => setAbierto(true)}
          permisos={permisos}
          conEmpleado={conEmpleado}
          jerarquiaNomina={jerarquiaNomina}
        />
        {avisos}
        {/* `relative`: lo posicionado dentro del contenido (p. ej. los textos `sr-only`
            de los encabezados de tabla) toma a <main> como referencia. Sin esto se
            posicionaba contra la ventana y, al final de una página larga, alargaba
            el documento: aparecía una segunda barra de desplazamiento y el menú
            lateral se cortaba al llegar abajo. */}
        <main id="contenido" tabIndex={-1} className="relative flex-1 overflow-y-auto px-4 py-5 focus:outline-none sm:px-6 sm:py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
