"use client";

/**
 * Cierre de sesión por inactividad, del lado del navegador (la regla y la parte del
 * servidor están en `lib/auth/inactividad.ts`).
 *
 * · Actividad = teclado, ratón, toques, rueda o desplazamiento. Se comparte entre
 *   pestañas por localStorage: trabajar en una mantiene abiertas las demás, y cerrar
 *   en una cierra todas.
 * · Mientras hay actividad, un latido por minuto le dice al servidor que la persona
 *   sigue ahí. Una consulta automática no cuenta.
 * · Un minuto antes avisa, con cuenta regresiva y «Seguir trabajando» (WCAG 2.2.1).
 * · Al cumplirse, tapa la pantalla de inmediato, deja constancia en la auditoría,
 *   cierra la sesión y lleva al login, que después vuelve a la misma página.
 * · Se mide con la hora del reloj y no con los ticks del temporizador: con la pestaña
 *   oculta o el equipo suspendido el navegador frena los temporizadores, y al volver se
 *   cierra en el acto si ya pasó el tiempo.
 * · Si el latido responde 401, la sesión ya terminó en el servidor (o se cerró en otro
 *   lado): se va al login en lugar de dejar una pantalla que ya no puede guardar nada.
 */

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { LATIDO_MS, RUTA_CIERRE, RUTA_LATIDO, anticipoAvisoMs, textoMinutos } from "@/lib/auth/inactividad";

const CLAVE_ACTIVIDAD = "nominahn.sesion.actividad";
const CLAVE_LATIDO = "nominahn.sesion.latido";
const CLAVE_CERRADA = "nominahn.sesion.cerrada";
/** Una pestaña empezó a cerrar: las demás esperan su aviso en vez de cerrar (y auditar) otra vez. */
const CLAVE_CERRANDO = "nominahn.sesion.cerrando";

const EVENTOS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

function leerNumero(clave: string): number {
  try {
    const n = Number(localStorage.getItem(clave));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function escribir(clave: string, valor: number) {
  try {
    localStorage.setItem(clave, String(valor));
  } catch {
    // Sin almacenamiento, cada pestaña lleva su propia cuenta.
  }
}

const aquí = () => window.location.pathname + window.location.search;
const alLogin = (motivo: "inactividad" | "sesion") =>
  window.location.replace(`/login?${new URLSearchParams({ motivo, volver: aquí() })}`);

export default function CierreInactividad({ minutos }: { minutos: number }) {
  const limiteMs = minutos * 60_000;
  const [restante, setRestante] = useState<number | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const actividad = useRef(0);
  const latido = useRef(0);
  const cerrado = useRef(false);
  const limite = useRef(limiteMs);
  const boton = useRef<HTMLButtonElement>(null);
  // Las acciones viven dentro del efecto; los botones del aviso las llaman por aquí.
  const acciones = useRef<{ cerrar: () => void; seguir: () => void }>({ cerrar: () => {}, seguir: () => {} });

  useEffect(() => {
    limite.current = limiteMs;
  }, [limiteMs]);

  useEffect(() => {
    const ahora = Date.now();
    // Abrir o recargar la página es actividad.
    actividad.current = Math.max(ahora, leerNumero(CLAVE_ACTIVIDAD));
    escribir(CLAVE_ACTIVIDAD, actividad.current);
    latido.current = leerNumero(CLAVE_LATIDO);
    let ultimaEscritura = ahora;

    const registrar = () => {
      const t = Date.now();
      actividad.current = t;
      // Un movimiento continuo no escribe en localStorage a cada píxel.
      if (t - ultimaEscritura > 2_000) {
        ultimaEscritura = t;
        escribir(CLAVE_ACTIVIDAD, t);
      }
    };
    let ultimoMovimiento = 0;
    const alMover = () => {
      const t = Date.now();
      if (t - ultimoMovimiento > 1_000) { ultimoMovimiento = t; registrar(); }
    };

    const cerrar = async () => {
      if (cerrado.current) return;
      cerrado.current = true;
      setCerrando(true); // tapa la pantalla antes de cualquier espera de red
      const t = Date.now();
      if (t - leerNumero(CLAVE_CERRANDO) < 10_000) {
        // Otra pestaña ya está cerrando la sesión: llegará su aviso (`alGuardar`). Por si no llega, se va igual.
        window.setTimeout(() => alLogin("inactividad"), 6_000);
        return;
      }
      escribir(CLAVE_CERRANDO, t);
      const tope = (p: Promise<unknown>) => Promise.race([p, new Promise((r) => setTimeout(r, 2_500))]);
      await tope(fetch(RUTA_CIERRE, {
        method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
        body: JSON.stringify({ minutos: limite.current / 60_000, pagina: aquí() }),
      }).catch(() => undefined));
      await tope(signOut({ redirect: false }).catch(() => undefined));
      // Recién ahora se avisa a las demás pestañas: si fueran al login con la sesión todavía
      // abierta, el proxy las devolvería al inicio y quedarían abiertas.
      escribir(CLAVE_CERRADA, Date.now());
      alLogin("inactividad");
    };

    const enviarLatido = async () => {
      const t = Date.now();
      latido.current = t;
      escribir(CLAVE_LATIDO, t);
      try {
        const r = await fetch(RUTA_LATIDO, { method: "POST", cache: "no-store", keepalive: true });
        if (r.status === 401 && !cerrado.current) {
          cerrado.current = true;
          setCerrando(true);
          alLogin("sesion");
        }
      } catch {
        // Sin red: el próximo latido lo vuelve a intentar.
      }
    };

    const revisar = () => {
      if (cerrado.current) return;
      const t = Date.now();
      // Lo que se hizo en otra pestaña también cuenta.
      actividad.current = Math.max(actividad.current, leerNumero(CLAVE_ACTIVIDAD));
      latido.current = Math.max(latido.current, leerNumero(CLAVE_LATIDO));
      const quieto = t - actividad.current;
      if (quieto >= limite.current) {
        void cerrar();
        return;
      }
      if (actividad.current > latido.current && t - latido.current >= LATIDO_MS) void enviarLatido();
      const aviso = anticipoAvisoMs(limite.current);
      setRestante(quieto >= limite.current - aviso ? Math.ceil((limite.current - quieto) / 1000) : null);
    };

    const alGuardar = (e: StorageEvent) => {
      // Otra pestaña cerró la sesión (ya sin cookie): ésta también se va, sin volver a auditar.
      if (e.key === CLAVE_CERRADA && e.newValue) {
        cerrado.current = true;
        setCerrando(true);
        alLogin("inactividad");
      }
    };
    const alVolver = () => {
      if (document.visibilityState === "visible") revisar();
    };

    acciones.current = {
      cerrar: () => void cerrar(),
      // «Seguir trabajando»: actividad y latido en el acto, sin esperar al minuto.
      seguir: () => { registrar(); escribir(CLAVE_ACTIVIDAD, actividad.current); void enviarLatido(); revisar(); },
    };

    for (const ev of EVENTOS) window.addEventListener(ev, registrar, { capture: true, passive: true });
    window.addEventListener("pointermove", alMover, { capture: true, passive: true });
    window.addEventListener("storage", alGuardar);
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", revisar);
    const intervalo = window.setInterval(revisar, 1_000);
    const primera = window.setTimeout(revisar, 0);

    return () => {
      window.clearTimeout(primera);
      for (const ev of EVENTOS) window.removeEventListener(ev, registrar, { capture: true });
      window.removeEventListener("pointermove", alMover, { capture: true });
      window.removeEventListener("storage", alGuardar);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", revisar);
      window.clearInterval(intervalo);
    };
  }, []);

  const avisando = restante !== null && !cerrando;
  useEffect(() => {
    if (avisando) boton.current?.focus();
  }, [avisando]);

  if (cerrando) {
    // Tapa todo: lo que había en pantalla no debe quedar a la vista mientras se cierra.
    return (
      <div className="fixed inset-0 z-100 flex items-center justify-center bg-gray-950 text-sm text-white/80" role="status" data-cierre-inactividad>
        Cerrando la sesión…
      </div>
    );
  }
  if (!avisando) return null;

  const mm = Math.floor(restante / 60), ss = String(restante % 60).padStart(2, "0");
  return (
    <div className="fixed inset-0 z-90 flex items-center justify-center bg-black/50 p-4" data-aviso-inactividad>
      <div role="alertdialog" aria-modal="true" aria-labelledby="inactividad-titulo" aria-describedby="inactividad-texto" className="panel w-full max-w-sm space-y-3 p-5 shadow-xl">
        <h2 id="inactividad-titulo" className="text-base font-semibold text-gray-900">¿Sigue ahí?</h2>
        <p id="inactividad-texto" className="text-sm text-gray-600">
          Por seguridad, la sesión se cierra después de {textoMinutos(minutos)} sin uso. Se cerrará en{" "}
          <span className="tnum font-semibold text-gray-900" aria-live="polite">{mm}:{ss}</span>. Lo que no haya guardado se perderá.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={() => acciones.current.cerrar()}>
            Cerrar sesión ahora
          </button>
          <button ref={boton} type="button" className="btn btn-primary" onClick={() => acciones.current.seguir()}>Seguir trabajando</button>
        </div>
      </div>
    </div>
  );
}
