"use client";

/**
 * Inicio de sesión con la misma estructura que el de Gestión360: una «tapa»
 * en la tinta de la marca con el producto, los avisos del calendario laboral,
 * el consejo del día, las novedades de la versión y el contacto de soporte; y
 * una hoja sobre el papel con el formulario. En pantalla angosta el orden es
 * marca, formulario y después la tapa: entrar sigue siendo lo primero.
 *
 * Todo lo que muestra la tapa es público (ver lib/inicio-sesion.ts).
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { cn } from "@/lib/utils";
import {
  VERSION,
  SOPORTE,
  NOVEDADES,
  consejoDelDia,
  avisosDelCalendario,
} from "@/lib/inicio-sesion";

const schema = z.object({
  email: z.string().email("Escriba un correo válido"),
  password: z.string().min(6, "La contraseña tiene al menos 6 caracteres"),
});
type FormData = z.infer<typeof schema>;

type EstadoServicio = "cargando" | "ok" | "base" | "servidor" | null;

const ESTADOS: Record<Exclude<EstadoServicio, null>, { punto: string; texto: string }> = {
  cargando: { punto: "bg-white/40", texto: "Comprobando el servicio…" },
  ok: { punto: "bg-green-400", texto: "Todos los servicios operando" },
  base: { punto: "bg-red-400", texto: "La base de datos no responde. Avise a soporte." },
  servidor: { punto: "bg-red-400", texto: "Sin conexión con el servidor. Revise la red o avise a soporte." },
};

const VISIBLES = 3;

// ─── Iconos (trazo fino, como los del menú) ───────────────────────────────────
const svg = "h-4 w-4 shrink-0";
const IconoAviso = ({ className }: { className?: string }) => (
  <svg className={cn(svg, className)} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
);
const IconoIdea = ({ className }: { className?: string }) => (
  <svg className={cn(svg, className)} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 18h6m-5 3h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3Z" />
  </svg>
);
const IconoInfo = ({ className }: { className?: string }) => (
  <svg className={cn(svg, className)} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path strokeLinecap="round" d="M12 16v-4m0-4h.01" />
  </svg>
);
const IconoOjo = ({ abierto }: { abierto: boolean }) => (
  <svg className={svg} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
    {abierto ? (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ) : (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.2A10.3 10.3 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 4.2M6.6 6.6C3.9 8.5 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1" />
      </>
    )}
  </svg>
);
const IconoChat = () => (
  <svg className={svg} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z" />
  </svg>
);
const IconoCorreo = () => (
  <svg className={svg} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m3 7 9 6 9-6" />
  </svg>
);

/** «Pulse [Mi espacio]» → el nombre de la pantalla, destacado. */
function ConPantallas({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/\[([^\]]+)\]/).map((parte, i) =>
        i % 2 ? (
          <span key={i} className="font-medium text-white">
            {parte}
          </span>
        ) : (
          parte
        )
      )}
    </>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-[13px] font-semibold text-white/50">{titulo}</h2>
      {children}
    </section>
  );
}

function PanelInicio() {
  const [todas, setTodas] = useState(false);
  const hoy = new Date();
  const avisos = avisosDelCalendario(hoy);
  const novedades = NOVEDADES[VERSION] ?? [];
  const mostradas = todas ? novedades : novedades.slice(0, VISIBLES);

  return (
    <div className="space-y-7 lg:pb-6">
      <Seccion titulo="Avisos">
        {avisos.length === 0 ? (
          <p className="text-sm text-white/50">Sin avisos pendientes.</p>
        ) : (
          <ul className="space-y-2">
            {avisos.map((a) => (
              <li key={a.texto} className="flex gap-2.5 text-sm leading-snug text-white/75">
                <IconoAviso className={cn("mt-0.5", a.tono === "alerta" ? "text-red-300" : "text-amber-300")} />
                <span>{a.texto}</span>
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      <Seccion titulo="Consejo del día">
        <p className="flex max-w-md gap-2.5 text-sm leading-relaxed text-white/75">
          <IconoIdea className="mt-0.5 text-blue-400" />
          <span>
            <ConPantallas texto={consejoDelDia(hoy)} />
          </span>
        </p>
      </Seccion>

      {novedades.length > 0 && (
        <Seccion titulo={`Novedades de la versión ${VERSION}`}>
          <ul className="space-y-3">
            {mostradas.map((n) => (
              <li key={n.titulo} className="max-w-md">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-white">{n.titulo}</span>
                  <span className="whitespace-nowrap text-xs text-white/50">{n.modulo}</span>
                </div>
                <p className="mt-0.5 text-sm leading-snug text-white/75">{n.detalle}</p>
              </li>
            ))}
          </ul>
          {novedades.length > VISIBLES && (
            <button
              type="button"
              onClick={() => setTodas((v) => !v)}
              aria-expanded={todas}
              className="text-sm font-semibold text-blue-400 underline-offset-2 hover:underline"
            >
              {todas ? "Ver menos" : `Ver las ${novedades.length} novedades`}
            </button>
          )}
        </Seccion>
      )}
    </div>
  );
}

function PieSoporte({ estado, empresa }: { estado: EstadoServicio; empresa: string | null }) {
  const e = estado ? ESTADOS[estado] : null;
  const mensaje = `Hola, necesito ayuda con el sistema de nómina${empresa ? ` (${empresa})` : ""}.`;
  return (
    <div className="space-y-4 text-sm">
      {e && (
        <p role="status" className="flex items-center gap-2 text-white/75">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", e.punto)} aria-hidden="true" />
          {e.texto}
        </p>
      )}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-white/50">¿Necesita ayuda?</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          <a
            href={`${SOPORTE.whatsappUrl}?text=${encodeURIComponent(mensaje)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-semibold text-white hover:text-blue-400"
          >
            <IconoChat />
            WhatsApp {SOPORTE.whatsapp}
          </a>
          <a href={`mailto:${SOPORTE.correo}`} className="inline-flex items-center gap-1.5 text-white/75 hover:text-white">
            <IconoCorreo />
            {SOPORTE.correo}
          </a>
        </div>
      </div>
      <p className="text-xs text-white/50">Versión {VERSION}</p>
    </div>
  );
}

const INPUT = "input h-10";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mostrar, setMostrar] = useState(false);
  const [mayusculas, setMayusculas] = useState(false);
  const [fallos, setFallos] = useState(0);
  const [olvido, setOlvido] = useState(false);
  const [estado, setEstado] = useState<EstadoServicio>("cargando");
  const [empresa, setEmpresa] = useState<string | null>(null);

  // Estado del servicio: si la base no contesta, el login lo dice antes de que
  // alguien intente entrar. Sin respuesta, el problema es la red.
  useEffect(() => {
    let vivo = true;
    fetch("/api/estado", { cache: "no-store" })
      .then(async (r) => {
        if (!vivo) return;
        if (r.ok) {
          const d = await r.json();
          setEmpresa(typeof d.empresa === "string" ? d.empresa : null);
          setEstado("ok");
        } else {
          setEstado(r.status === 503 ? "base" : null);
        }
      })
      .catch(() => vivo && setEstado("servidor"));
    return () => {
      vivo = false;
    };
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit(data: FormData) {
    setLoading(true);
    setError("");
    const res = await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setFallos((n) => n + 1);
      setError("El correo o la contraseña no coinciden. Revise ambos e intente de nuevo.");
    } else {
      setFallos(0);
      router.push("/dashboard");
    }
  }

  const detectarMayusculas = (e: React.KeyboardEvent<HTMLInputElement>) =>
    setMayusculas(e.getModifierState("CapsLock"));

  const pistaTeclado = fallos >= 3;
  const pistaAdmin = fallos >= 5;

  return (
    <div className="grid min-h-screen grid-cols-1 bg-gray-50 lg:h-screen lg:grid-cols-[minmax(0,44%)_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)_auto]">
      {/* Tapa: la marca. */}
      <div className="bg-blue-900 px-6 py-8 text-white/75 sm:px-10 lg:col-start-1 lg:row-start-1 lg:px-14 lg:pb-8 lg:pt-12">
        {/* El logo de Gestión360 lleva fondo blanco: va sobre una placa de papel, como
            hace el propio Gestión360 con su marca en la tapa. */}
        <span className="inline-flex rounded-2xl bg-white p-2.5 shadow-sm lg:p-3">
          <Image
            src="/gestion360-logo.png"
            alt="Gestión360, ERP para pymes hondureñas"
            width={820}
            height={561}
            priority
            className="h-auto w-[9rem] sm:w-[10.5rem] lg:w-[13rem]"
          />
        </span>
        <h1 className="mt-4 max-w-md text-base leading-snug text-white/80 lg:mt-5 lg:text-xl">
          Nómina y talento humano para empresas en Honduras
        </h1>
      </div>

      {/* La hoja con el formulario. */}
      <div className="flex items-center justify-center p-4 sm:p-8 lg:col-start-2 lg:row-span-3 lg:row-start-1">
        <div className="w-full max-w-md">
          <div className="panel p-7">
            <h2 className="text-2xl font-semibold text-gray-900">Iniciar sesión</h2>
            <p className="mb-6 mt-1 text-sm text-gray-500">Use las credenciales asignadas por su administrador.</p>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-gray-800">
                  Correo electrónico
                </label>
                <input
                  {...register("email")}
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  className={INPUT}
                  placeholder="usuario@empresa.hn"
                  aria-invalid={errors.email ? true : undefined}
                />
                {errors.email && <p className="mt-1 text-xs text-red-700">{errors.email.message}</p>}
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-semibold text-gray-800">
                    Contraseña
                  </label>
                  <button
                    type="button"
                    onClick={() => setMostrar((v) => !v)}
                    className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    <IconoOjo abierto={!mostrar} />
                    {mostrar ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
                <input
                  {...register("password")}
                  id="password"
                  type={mostrar ? "text" : "password"}
                  autoComplete="current-password"
                  onKeyDown={detectarMayusculas}
                  onKeyUp={detectarMayusculas}
                  className={INPUT}
                  placeholder="Su contraseña"
                  aria-invalid={errors.password ? true : undefined}
                />
                {errors.password && <p className="mt-1 text-xs text-red-700">{errors.password.message}</p>}
                {mayusculas && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-700">
                    <IconoAviso className="h-3.5 w-3.5" />
                    Bloq Mayús activado: la contraseña distingue entre mayúsculas y minúsculas.
                  </p>
                )}
              </div>

              <div className="flex justify-end pt-0.5 text-sm">
                <button
                  type="button"
                  onClick={() => setOlvido((v) => !v)}
                  className="font-medium text-blue-600 hover:text-blue-700"
                >
                  ¿Olvidó su contraseña?
                </button>
              </div>

              {olvido && (
                <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                  <IconoInfo className="mt-0.5 h-3.5 w-3.5" />
                  Pida a quien administra el sistema que la restablezca desde Usuarios. Recibirá una contraseña
                  temporal que deberá cambiar al entrar.
                </div>
              )}

              {error && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {error}
                </div>
              )}

              {pistaTeclado && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                  <div className="flex items-start gap-2 text-amber-800">
                    <IconoAviso className="mt-0.5 text-amber-600" />
                    <div>
                      <p className="font-semibold">Verifique la configuración del teclado</p>
                      <ul className="mt-1.5 space-y-1 text-xs text-amber-700">
                        <li>Bloq Mayús debe estar desactivado al escribir la contraseña.</li>
                        <li>Si usa el teclado numérico, Bloq Núm tiene que estar activado.</li>
                        <li>Compruebe que el correo es el de su cuenta.</li>
                      </ul>
                    </div>
                  </div>
                  {pistaAdmin && (
                    <div className="mt-2.5 flex items-start gap-2 border-t border-amber-200 pt-2.5 text-xs text-amber-700">
                      <IconoInfo className="mt-0.5 h-3.5 w-3.5" />
                      <span>Si el problema persiste, pida al administrador del sistema que restablezca su contraseña.</span>
                    </div>
                  )}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn btn-primary mt-1 h-11 w-full text-base">
                {loading ? "Ingresando…" : "Entrar"}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Tapa: lo que cambia con el tiempo. En pantalla ancha sólo este bloque se desplaza. */}
      <div className="bg-blue-900 px-6 py-8 text-white/75 sm:px-10 lg:col-start-1 lg:row-start-2 lg:overflow-y-auto lg:px-14 lg:py-0">
        <PanelInicio />
        <div aria-hidden="true" className="pointer-events-none sticky bottom-0 -mt-8 hidden h-8 bg-gradient-to-t from-blue-900 to-transparent lg:block" />
      </div>

      {/* Tapa: estado y soporte. */}
      <div className="bg-blue-900 px-6 pb-8 text-white/75 sm:px-10 lg:col-start-1 lg:row-start-3 lg:px-14 lg:pb-10">
        <div className="border-t border-white/10 pt-5">
          <PieSoporte estado={estado} empresa={empresa} />
        </div>
      </div>
    </div>
  );
}
