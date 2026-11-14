"use client";

/**
 * Configuración → Estructura: el logo de una sucursal.
 *
 * Se muestra sobre blanco y dentro de un membrete porque así se va a ver: elegir un
 * logo mirándolo sobre el fondo de la pantalla escondía los que se pierden en papel.
 */

import { useEffect, useRef, useState } from "react";
import { useAvisos } from "@/components/ui/Avisos";
import { Modal } from "@/components/ui/ModalForm";
import { ajustarACaja, logoEsPequeno, LOGO_CAJA_ALTO, LOGO_CAJA_ANCHO } from "@/lib/organizacion/logo";
import { prepararLogo, type LogoPreparado } from "@/lib/organizacion/logo-navegador";

export const urlLogoSucursal = (id: string, version: number) => `/api/configuracion/sucursales/${id}/logo?v=${version}`;

interface Props {
  sucursal: { id: string; nombre: string; logoVersion: number | null };
  empresaNombre: string | null;
  empresaRtn: string | null;
  onCerrar: () => void;
  onListo: () => void;
}

export default function LogoSucursalForm({ sucursal, empresaNombre, empresaRtn, onCerrar, onListo }: Props) {
  const { confirmar } = useAvisos();
  const selector = useRef<HTMLInputElement>(null);
  const [nuevo, setNuevo] = useState<(LogoPreparado & { url: string }) | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  // La vista previa ocupa memoria mientras exista su dirección.
  const urlNueva = nuevo?.url;
  useEffect(() => () => { if (urlNueva) URL.revokeObjectURL(urlNueva); }, [urlNueva]);

  async function elegir(archivo: File | undefined) {
    if (!archivo) return;
    setError(null);
    setPreparando(true);
    try {
      const logo = await prepararLogo(archivo);
      setNuevo({ ...logo, url: URL.createObjectURL(logo.png) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo preparar la imagen.");
    } finally {
      setPreparando(false);
    }
  }

  async function guardar() {
    if (!nuevo) return;
    setGuardando(true);
    setError(null);
    const r = await fetch(`/api/configuracion/sucursales/${sucursal.id}/logo`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: nuevo.png })
      .catch(() => null);
    setGuardando(false);
    if (r?.ok) return onListo();
    const d = await r?.json().catch(() => ({}));
    setError(d?.error ?? "No se pudo guardar el logo. Intente de nuevo.");
  }

  async function quitar() {
    if (!(await confirmar({
      titulo: `¿Quitar el logo de ${sucursal.nombre}?`,
      detalle: "Sus comprobantes y documentos, también los de períodos anteriores, mostrarán sólo el nombre de la empresa.",
      accion: "Quitar logo",
      peligro: true,
    }))) return;
    setError(null);
    const r = await fetch(`/api/configuracion/sucursales/${sucursal.id}/logo`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) return onListo();
    setError("No se pudo quitar el logo. Intente de nuevo.");
  }

  const urlVista = nuevo?.url ?? (sucursal.logoVersion ? urlLogoSucursal(sucursal.id, sucursal.logoVersion) : null);
  const medidas = nuevo ? ajustarACaja(nuevo.ancho, nuevo.alto, LOGO_CAJA_ANCHO, LOGO_CAJA_ALTO) : null;
  const cargando = preparando || guardando;

  return (
    <Modal titulo={`Logo de ${sucursal.nombre}`} error={error} cargando={cargando} puedeGuardar={!!nuevo} textoGuardar="Guardar logo" onCerrar={onCerrar} onGuardar={guardar}>
      <div
        className={`rounded-md border bg-white p-4 ${arrastrando ? "border-blue-600 outline-2 outline-blue-600" : "border-gray-300"}`}
        data-prueba="vista-logo"
        onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastrando(false); void elegir(e.dataTransfer.files[0]); }}
      >
        {urlVista
          // eslint-disable-next-line @next/next/no-img-element -- vista previa local o imagen privada: el optimizador de Next no aplica.
          ? <img src={urlVista} alt="Vista previa del logo" width={medidas?.ancho} height={medidas?.alto} style={{ maxWidth: LOGO_CAJA_ANCHO, maxHeight: LOGO_CAJA_ALTO }} className="mb-3 block" />
          : <p className="mb-3 text-sm text-gray-500">Sin logo: el comprobante muestra sólo el texto de abajo.</p>}
        {empresaNombre && <p className="text-sm font-semibold text-gray-900">{empresaNombre}</p>}
        {empresaRtn && <p className="text-xs text-gray-500">RTN {empresaRtn}</p>}
        <p className="text-xs text-gray-500">Sucursal {sucursal.nombre}</p>
      </div>
      <p className="text-xs text-gray-500">Así se verá en el membrete de los comprobantes, constancias, contratos y finiquitos de esta sucursal.</p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-secondary btn-sm" disabled={cargando} onClick={() => selector.current?.click()}>
          {preparando ? "Preparando…" : urlVista ? "Elegir otra imagen" : "Elegir imagen"}
        </button>
        {sucursal.logoVersion && !nuevo && (
          <button type="button" className="btn btn-ghost btn-sm text-red-700" disabled={cargando} onClick={quitar}>Quitar logo</button>
        )}
        <input
          ref={selector}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          aria-label="Imagen del logo"
          onChange={(e) => { void elegir(e.target.files?.[0]); e.target.value = ""; }}
        />
      </div>
      <p className="text-xs text-gray-500">PNG, JPG o WebP, hasta 10 MB; también puede arrastrarla al recuadro. Al guardarla se quita el margen vacío y se ajusta el tamaño.</p>
      {nuevo && logoEsPequeno(nuevo.ancho, nuevo.alto) && (
        <p className="text-sm text-amber-700" role="status">Esta imagen es pequeña ({nuevo.ancho} × {nuevo.alto} píxeles) y puede salir borrosa al imprimir. Si tiene una versión más grande, úsela.</p>
      )}
    </Modal>
  );
}
