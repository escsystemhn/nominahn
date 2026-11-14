"use client";

/**
 * Crear o editar un tipo de deducción. Reemplaza la ventana anterior, que mandaba
 * `null` en los campos vacíos y nunca lograba crear nada, y que ofrecía «Es legal» y
 * porcentajes que la planilla no usa para estos tipos.
 *
 * Lo que importa para RRHH: el nombre, un código corto (se propone solo), la
 * CATEGORÍA con lo que significa para el tope legal, y un monto habitual opcional
 * que se propone al asignarlo. El código no se cambia después: viaja en los archivos.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import { CATEGORIAS, normalizarCodigo, sugerirCategoria, sugerirCodigo, type CategoriaDeduccion } from "@/lib/deducciones/tipos";
import { leerMonto } from "@/lib/formato/monto-texto";

export interface TipoEditable {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  montoFijo: number | null;
  descripcion: string | null;
  activo: boolean;
}

export default function TipoDeduccionModal({ tipo, codigosOcupados, onCerrar }: {
  /** `null` para uno nuevo. */
  tipo: TipoEditable | null;
  codigosOcupados: readonly string[];
  onCerrar: () => void;
}) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const nuevo = tipo === null;
  const ocupados = new Set(codigosOcupados);

  const [nombre, setNombre] = useState(tipo?.nombre ?? "");
  const [codigo, setCodigo] = useState(tipo?.codigo ?? "");
  const [codigoTocado, setCodigoTocado] = useState(false);
  const [categoria, setCategoria] = useState<string>(tipo?.tipo ?? "");
  const [categoriaTocada, setCategoriaTocada] = useState(false);
  const [monto, setMonto] = useState(tipo?.montoFijo ? tipo.montoFijo.toFixed(2) : "");
  const [descripcion, setDescripcion] = useState(tipo?.descripcion ?? "");
  const [activo, setActivo] = useState(tipo?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al escribir el nombre de uno nuevo se proponen código y categoría, mientras no los haya tocado.
  function cambiarNombre(v: string) {
    setNombre(v);
    if (!nuevo) return;
    if (!codigoTocado) setCodigo(v.trim() ? sugerirCodigo(v, ocupados) : "");
    if (!categoriaTocada && v.trim().length >= 3) setCategoria(sugerirCategoria(v));
  }

  const lecturaMonto = leerMonto(monto);
  const codigoFinal = normalizarCodigo(codigo);
  const ayuda = CATEGORIAS.find((c) => c.valor === categoria)?.ayuda;
  const falta = nombre.trim().length < 2 ? "Escriba el nombre."
    : nuevo && !codigoFinal ? "Escriba el código."
      : nuevo && ocupados.has(codigoFinal) ? `El código ${codigoFinal} ya existe.`
        : !categoria ? "Elija la categoría."
          : !lecturaMonto.ok ? `Monto habitual: ${lecturaMonto.error}.`
            : null;

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const cuerpo = { nombre, codigo: codigoFinal, tipo: categoria as CategoriaDeduccion, montoFijo: monto, descripcion, activo };
      const res = await fetch(nuevo ? "/api/deducciones" : `/api/deducciones/${tipo!.id}`, {
        method: nuevo ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "No se pudo guardar el tipo de deducción.");
      if (nuevo) avisar.exito(`Tipo «${nombre.trim()}» creado con el código ${codigoFinal}.`);
      else if (!activo && d.asignadas > 0) avisar.exito(`Guardado. ${d.asignadas} empleado(s) lo tienen asignado: se les sigue cobrando hasta que se quite en su deducción.`);
      else if (d.cambioCategoria && d.asignadas > 0) avisar.exito(`Guardado. A ${d.asignadas} empleado(s) se les cobra con el tope de la nueva categoría desde la próxima planilla.`);
      else avisar.exito("Tipo de deducción guardado.");
      router.refresh();
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el tipo de deducción.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={nuevo ? "Nuevo tipo de deducción" : "Editar tipo de deducción"}>
      <div className="panel max-h-full w-full max-w-lg space-y-4 overflow-y-auto p-5 shadow-xl">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{nuevo ? "Nuevo tipo de deducción" : `Editar «${tipo!.nombre}»`}</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Los de ley (IHSS, RAP, INFOP) y la retención fija de ISR se configuran en Parámetros de ley. Para crear muchos a la vez, use «Importar tipos».
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <label className="block text-sm" htmlFor="tipo-nombre">
            <span className="font-medium text-gray-800">Nombre</span>
            <input id="tipo-nombre" className="input mt-1" value={nombre} maxLength={80} placeholder="Ej: Cooperativa ELGA" onChange={(e) => cambiarNombre(e.target.value)} autoFocus />
          </label>
          <label className="block text-sm" htmlFor="tipo-codigo">
            <span className="font-medium text-gray-800">Código</span>
            <input id="tipo-codigo" className="input mt-1 font-mono uppercase" value={codigo} maxLength={30} disabled={!nuevo}
              onChange={(e) => { setCodigo(e.target.value.toUpperCase()); setCodigoTocado(true); }} />
            <span className="mt-1 block text-xs text-gray-500">{nuevo ? "Se propone solo. Es el que va en los archivos." : "No se cambia: viaja en los archivos."}</span>
          </label>
        </div>

        <label className="block text-sm" htmlFor="tipo-categoria">
          <span className="font-medium text-gray-800">Categoría</span>
          <select id="tipo-categoria" className="input mt-1" value={categoria} onChange={(e) => { setCategoria(e.target.value); setCategoriaTocada(true); }}>
            <option value="">Seleccione…</option>
            {CATEGORIAS.map((c) => <option key={c.valor} value={c.valor}>{c.etiqueta}</option>)}
          </select>
          {ayuda && <span className="mt-1 block text-xs text-gray-600" data-ayuda-categoria>{ayuda}</span>}
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm" htmlFor="tipo-monto">
            <span className="font-medium text-gray-800">Monto habitual <span className="font-normal text-gray-500">(opcional)</span></span>
            <input id="tipo-monto" className="input mt-1" inputMode="decimal" value={monto} placeholder="Ej: 1000.00" onChange={(e) => setMonto(e.target.value)} />
            <span className="mt-1 block text-xs text-gray-500">Se propone al asignarlo; se puede cambiar por empleado.</span>
          </label>
          {!nuevo && (
            <label className="flex items-start gap-2 pt-6 text-sm text-gray-800">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
              <span>Activo<span className="block text-xs text-gray-500">Inactivo: no se ofrece para asignar; lo ya asignado se sigue cobrando.</span></span>
            </label>
          )}
        </div>

        <label className="block text-sm" htmlFor="tipo-descripcion">
          <span className="font-medium text-gray-800">Descripción <span className="font-normal text-gray-500">(opcional)</span></span>
          <input id="tipo-descripcion" className="input mt-1" value={descripcion} maxLength={500} placeholder="Para qué es, a quién se le paga" onChange={(e) => setDescripcion(e.target.value)} />
        </label>

        {(error || (falta && nombre.trim())) && <p className={`text-sm ${error ? "text-red-700" : "text-gray-500"}`} role={error ? "alert" : undefined}>{error ?? falta}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={guardando || !!falta} onClick={() => void guardar()}>
            {guardando ? "Guardando…" : nuevo ? "Crear" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
