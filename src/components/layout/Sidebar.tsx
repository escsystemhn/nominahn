"use client";

import { useMemo, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { tieneAlguno, type Permiso } from "@/lib/auth/permisos";

interface NavItem {
  href: string;
  label: string;
  icon?: React.ReactNode;
  /**
   * Permisos que dan acceso a este módulo. Basta con UNO. Sin la propiedad, el
   * enlace es para toda cuenta con sesión (Inicio, Mi Espacio, el portal).
   */
  permisos?: readonly Permiso[];
}

interface NavSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
}

type NavEntry = NavItem | NavSection;

const esSeccion = (entry: NavEntry): entry is NavSection => "items" in entry;

// ─── Store de secciones abiertas/cerradas ─────────────────────────────────────
// Vive en localStorage para que la elección del usuario sobreviva a las recargas
// y se sincronice entre pestañas. Se expone como store externo porque el valor
// no existe durante el render del servidor.
const STORAGE_KEY = "nominahn.sidebar.secciones";
const SIN_SECCIONES = "{}";

const suscriptores = new Set<() => void>();
let memoria = SIN_SECCIONES; // Respaldo cuando localStorage no está disponible.

function leerSecciones() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? memoria;
  } catch {
    return memoria;
  }
}

function escribirSecciones(valor: Record<string, boolean>) {
  memoria = JSON.stringify(valor);
  try {
    localStorage.setItem(STORAGE_KEY, memoria);
  } catch {
    // Sin persistencia, el menú sigue funcionando durante la sesión.
  }
  suscriptores.forEach((notificar) => notificar());
}

function suscribirSecciones(notificar: () => void) {
  suscriptores.add(notificar);
  window.addEventListener("storage", notificar);
  return () => {
    suscriptores.delete(notificar);
    window.removeEventListener("storage", notificar);
  };
}

const IconUsers = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
const IconClock = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const IconMoney = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);
const IconHome = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
);
const IconGlobe = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
  </svg>
);
const IconDoc = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);
const IconCog = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
const IconUser = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);
const IconTalento = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);
const IconEscudo = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
  </svg>
);
const IconChevron = ({ abierta }: { abierta: boolean }) => (
  <svg
    className={cn("w-4 h-4 ml-auto shrink-0 transition-transform", abierta && "rotate-90")}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
  </svg>
);

// Agrupado por ciclo de vida del empleado: lo de uso diario queda plano arriba,
// lo periódico en secciones y lo administrativo al final.
const navItems: NavEntry[] = [
  { href: "/dashboard", label: "Inicio", icon: <IconHome /> },
  { href: "/mi-espacio", label: "Mi espacio", icon: <IconUser /> },
  {
    id: "personal",
    label: "Personal",
    icon: <IconUsers />,
    items: [
      {
        href: "/empleados",
        label: "Empleados",
        permisos: ["empleados.ver"],
      },
      {
        href: "/organigrama",
        label: "Organigrama",
        permisos: ["organizacion.ver"],
      },
      {
        href: "/documentos",
        label: "Documentos",
        permisos: ["documentos.emitir", "documentos.plantillas"],
      },
      {
        href: "/dotaciones",
        label: "Dotaciones",
        permisos: ["talento.dotaciones"],
      },
    ],
  },
  {
    id: "tiempo",
    label: "Tiempo y asistencia",
    icon: <IconClock />,
    items: [
      {
        href: "/asistencia",
        label: "Asistencia",
        permisos: ["asistencia.ver", "asistencia.gestionar"],
      },
      {
        href: "/biometrico",
        label: "Reloj biométrico",
        permisos: ["asistencia.biometrico"],
      },
      {
        href: "/turnos",
        label: "Horarios y turnos",
        permisos: ["asistencia.turnos", "asistencia.ver"],
      },
      {
        href: "/incapacidades",
        label: "Incapacidades",
        permisos: ["asistencia.incapacidades"],
      },
    ],
  },
  {
    id: "nomina",
    label: "Nómina",
    icon: <IconMoney />,
    items: [
      {
        href: "/planillas",
        label: "Planillas",
        permisos: ["planillas.ver"],
      },
      {
        href: "/deducciones",
        label: "Deducciones",
        permisos: ["deducciones.ver"],
      },
      {
        href: "/prestaciones",
        label: "Prestaciones",
        permisos: ["prestaciones.ver"],
      },
      {
        href: "/centros-costo",
        label: "Centros de costo",
        permisos: ["organizacion.centros_costo"],
      },
      {
        href: "/plan-cuentas",
        label: "Plan de cuentas",
        permisos: ["planillas.plan_cuentas", "planillas.contabilidad"],
      },
      {
        href: "/plan-cuentas/configuracion",
        label: "Configuración contable",
        permisos: ["planillas.plan_cuentas", "planillas.contabilidad"],
      },
    ],
  },
  {
    id: "talento",
    label: "Gestión de talento",
    icon: <IconTalento />,
    items: [
      {
        href: "/reclutamiento",
        label: "Reclutamiento",
        permisos: ["talento.reclutamiento"],
      },
      {
        href: "/talento/competencias",
        label: "Competencias",
        permisos: ["talento.competencias"],
      },
      {
        href: "/evaluaciones",
        label: "Evaluaciones",
        permisos: ["talento.evaluaciones_ver", "talento.evaluaciones_gestionar"],
      },
      {
        href: "/evaluaciones/nine-box",
        label: "Matriz nine-box",
        permisos: ["talento.evaluaciones_ver"],
      },
      {
        href: "/evaluaciones/skill-gap",
        label: "Análisis de brechas",
        permisos: ["talento.evaluaciones_ver"],
      },
      {
        href: "/capacitaciones",
        label: "Capacitación",
        permisos: ["talento.capacitaciones"],
      },
    ],
  },
  {
    id: "comunicacion",
    label: "Comunicación",
    icon: <IconGlobe />,
    items: [
      { href: "/portal", label: "Portal del empleado" },
      { href: "/politicas", label: "Políticas" },
    ],
  },
  {
    href: "/reportes",
    label: "Reportes",
    icon: <IconDoc />,
    permisos: ["reportes.ver"],
  },
  {
    id: "seguridad",
    label: "Usuarios",
    icon: <IconEscudo />,
    items: [
      {
        href: "/usuarios",
        label: "Usuarios",
        permisos: ["seguridad.usuarios_ver", "seguridad.usuarios_gestionar"],
      },
      { href: "/usuarios/perfiles", label: "Perfiles de acceso", permisos: ["seguridad.perfiles"] },
    ],
  },
  {
    href: "/configuracion",
    label: "Configuración",
    icon: <IconCog />,
    permisos: ["configuracion.ver", "configuracion.editar"],
  },
];

export default function Sidebar({ permisos }: { permisos: readonly string[] }) {
  const pathname = usePathname();
  const guardadas = useSyncExternalStore(
    suscribirSecciones,
    leerSecciones,
    () => SIN_SECCIONES
  );

  const abiertas = useMemo<Record<string, boolean>>(() => {
    try {
      const parsed = JSON.parse(guardadas);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }, [guardadas]);

  const alternar = (id: string, abierta: boolean) =>
    escribirSecciones({ ...abiertas, [id]: !abierta });

  // Sin permisos declarados, el enlace es para toda cuenta con sesión.
  const permitido = (item: NavItem) => !item.permisos || tieneAlguno(permisos, item.permisos);

  // Una sección se muestra solo si el rol puede ver al menos uno de sus módulos.
  const visible = navItems.reduce<NavEntry[]>((acc, entry) => {
    if (esSeccion(entry)) {
      const items = entry.items.filter(permitido);
      if (items.length) acc.push({ ...entry, items });
    } else if (permitido(entry)) {
      acc.push(entry);
    }
    return acc;
  }, []);

  const hrefs = visible.flatMap((entry) =>
    esSeccion(entry) ? entry.items.map((i) => i.href) : [entry.href]
  );

  // Gana el prefijo más largo, para que /evaluaciones no quede activo en /evaluaciones/nine-box.
  const esActivo = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === href ||
        (pathname.startsWith(href + "/") &&
          !hrefs.some(
            (other) =>
              other !== href &&
              other.length > href.length &&
              pathname.startsWith(other)
          ));

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col bg-blue-900 text-white">
      {/* Marca: el logo de ESC System encabeza la aplicación. Variante de texto
          blanco porque el fondo es la tinta de la marca. */}
      <div className="px-5 pb-5 pt-6">
        <Link href="/dashboard" className="inline-block rounded-md focus-visible:outline-offset-4" title="Inicio">
          <Image
            src="/logo-escsystem-blanco.png"
            alt="ESC System Consultorías"
            width={512}
            height={189}
            priority
            className="h-12 w-auto"
          />
        </Link>
      </div>

      <nav aria-label="Menú principal" className="flex-1 space-y-px overflow-y-auto px-3 pb-4">
        {visible.map((entry) => {
          if (esSeccion(entry)) {
            const conActivo = entry.items.some((item) => esActivo(item.href));
            const abierta = abiertas[entry.id] ?? conActivo;
            const panelId = `nav-seccion-${entry.id}`;
            return (
              <div key={entry.id}>
                <button
                  type="button"
                  onClick={() => alternar(entry.id, abierta)}
                  aria-expanded={abierta}
                  aria-controls={panelId}
                  className={cn(
                    "flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm transition-colors",
                    conActivo && !abierta
                      ? "bg-white/10 text-white"
                      : "text-white/70 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <span className="text-white/60">{entry.icon}</span>
                  <span className="text-left font-medium">{entry.label}</span>
                  <IconChevron abierta={abierta} />
                </button>
                <div
                  id={panelId}
                  hidden={!abierta}
                  className="my-1 ml-[22px] space-y-px border-l border-white/10 pl-2"
                >
                  {entry.items.map((item) => {
                    const active = esActivo(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "relative flex h-8 items-center rounded-md px-3 text-sm transition-colors",
                          active
                            ? "bg-white/10 font-medium text-white before:absolute before:-left-[9px] before:top-1.5 before:h-5 before:w-0.5 before:rounded-full before:bg-blue-500"
                            : "text-white/60 hover:bg-white/5 hover:text-white"
                        )}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          }

          const active = esActivo(entry.href);
          return (
            <Link
              key={entry.href}
              href={entry.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-white/10 text-white before:absolute before:-left-3 before:top-2 before:h-5 before:w-0.5 before:rounded-full before:bg-blue-500"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              )}
            >
              <span className={cn(active ? "text-blue-400" : "text-white/60")}>{entry.icon}</span>
              {entry.label}
            </Link>
          );
        })}
      </nav>

      {/* Pie: producto y versión; la consultora ya encabeza la barra. */}
      <div className="border-t border-white/10 px-5 py-4 text-xs leading-5">
        <p className="font-medium text-white/80">NominaHN 1.0</p>
        <a
          href="https://esc-systemhn.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/45 transition-colors hover:text-white/80"
        >
          esc-systemhn.com
        </a>
      </div>
    </aside>
  );
}
