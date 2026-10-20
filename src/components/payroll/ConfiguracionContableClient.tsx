"use client";

/**
 * Configuración contable: a qué cuenta del catálogo va cada concepto de la
 * planilla, agrupado por lo que el contador HACE (sueldos, aportes, retenciones,
 * préstamos, provisiones, neto) y con un ejemplo del asiento con las cuentas que
 * tiene asignadas en ese momento. Cada elección se guarda al instante.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import { SECCIONES_MAPEO, ETIQUETA_TIPO } from "@/lib/payroll/catalogo-contable";
import type { ConceptoMapeado, CuentaResumen } from "@/lib/payroll/plan-cuentas";

interface Props {
  conceptos: ConceptoMapeado[];
  cuentas: CuentaResumen[];
  puedeEditar: boolean;
}

/**
 * Buscador de cuenta. Escribir NO guarda: sólo se confirma al elegir una
 * opción o al quitar, para no borrar el mapeo mientras se busca.
 */
function BuscadorCuenta({
  opciones,
  valor,
  onChange,
  disabled,
}: {
  opciones: CuentaResumen[];
  valor: CuentaResumen | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const etiqueta = valor ? `${valor.codigo} ${valor.nombre}` : "";
  const needle = q.trim().toLowerCase();
  const filtradas = needle ? opciones.filter((c) => c.codigo.toLowerCase().includes(needle) || c.nombre.toLowerCase().includes(needle)) : opciones;

  return (
    <div className="relative flex items-center gap-1.5">
      <input
        className="input"
        value={abierto ? q : etiqueta}
        disabled={disabled}
        onChange={(e) => {
          setQ(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => {
          setQ("");
          setAbierto(true);
        }}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        placeholder="Sin asignar: buscar cuenta"
        aria-label="Cuenta"
      />
      {valor && !disabled && (
        <button type="button" title="Quitar cuenta asignada" onMouseDown={() => onChange(null)} className="btn btn-ghost btn-sm shrink-0">
          Quitar
        </button>
      )}
      {abierto && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {filtradas.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500">Ninguna cuenta del tipo esperado coincide.</div>
          ) : (
            filtradas.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={() => {
                  onChange(c.id);
                  setAbierto(false);
                }}
                className="flex w-full items-baseline gap-2 border-b border-gray-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-blue-50"
              >
                <span className="shrink-0 font-mono text-xs text-gray-500">{c.codigo}</span>
                <span className="flex-1 truncate text-gray-800">{c.nombre}</span>
                <span className="shrink-0 text-[11px] text-gray-400">{ETIQUETA_TIPO[c.tipo]}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ConfiguracionContableClient({ conceptos: inicial, cuentas, puedeEditar }: Props) {
  const [conceptos, setConceptos] = useState(inicial);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});

  const porClave = useMemo(() => new Map(conceptos.map((c) => [c.clave, c])), [conceptos]);
  const sinAsignar = conceptos.filter((c) => !c.cuenta);
  const etiquetaDe = (clave: string) => {
    const c = porClave.get(clave as ConceptoMapeado["clave"]);
    return c?.cuenta ? `${c.cuenta.codigo} ${c.cuenta.nombre}` : "(sin asignar)";
  };

  async function guardar(clave: string, cuerpo: { cuentaId: string | null } | { restablecer: true }) {
    setGuardando(clave);
    setErrores((e) => ({ ...e, [clave]: "" }));
    try {
      const res = await fetch("/api/plan-cuentas/mapeo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clave, ...cuerpo }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "No se pudo guardar.");
      setConceptos((prev) => prev.map((c) => (c.clave === clave ? d.concepto : c)));
    } catch (e) {
      setErrores((er) => ({ ...er, [clave]: e instanceof Error ? e.message : "No se pudo guardar." }));
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuración contable"
        description="A qué cuenta del catálogo va cada concepto de la planilla. Con esto la partida contable de cada planilla sale sola, con el catálogo de la empresa."
        actions={
          <Link href="/plan-cuentas" className="btn btn-secondary">
            Plan de cuentas
          </Link>
        }
      />

      {sinAsignar.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">{sinAsignar.length} concepto(s) sin cuenta.</span> Mientras tanto la partida usa la cuenta de ejemplo de
          cada concepto; asigne la de su catálogo para que el asiento salga con sus códigos.
        </div>
      ) : (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Todos los conceptos tienen cuenta asignada ({conceptos.length} de {conceptos.length}).
        </div>
      )}

      <nav className="flex flex-wrap gap-2" aria-label="Secciones">
        {SECCIONES_MAPEO.map((s) => {
          const faltan = s.claves.filter((k) => !porClave.get(k.clave)?.cuenta).length;
          return (
            <a
              key={s.id}
              href={`#cfg-${s.id}`}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs",
                faltan ? "border-amber-300 bg-amber-50 text-amber-900" : "border-gray-200 text-gray-600 hover:bg-gray-100"
              )}
            >
              {s.titulo}
              {faltan ? ` (${faltan} sin asignar)` : ""}
            </a>
          );
        })}
      </nav>

      <div className="space-y-6">
        {SECCIONES_MAPEO.map((seccion) => (
          <section key={seccion.id} id={`cfg-${seccion.id}`} className="panel scroll-mt-4 p-5">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900">{seccion.titulo}</h2>
              <p className="text-sm text-gray-500">{seccion.ayuda}</p>
            </div>

            <div className="mb-4 space-y-1 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-900">
              <p className="font-semibold">Así se contabiliza</p>
              {seccion.ejemplo(etiquetaDe).map((linea) => (
                <p key={linea}>{linea}</p>
              ))}
            </div>

            <div className="divide-y divide-gray-100">
              {seccion.claves.map((item) => {
                const c = porClave.get(item.clave)!;
                const falta = !c.cuenta;
                const opciones = cuentas.filter((x) => c.tiposPermitidos.includes(x.tipo));
                const puedeRestaurar = Boolean(c.porOmision.cuentaId) && c.cuenta?.id !== c.porOmision.cuentaId;
                return (
                  <div key={item.clave} className={cn("grid gap-3 py-4 md:grid-cols-5", falta && "-mx-2 rounded-lg bg-amber-50/60 px-2")}>
                    <div className="md:col-span-2">
                      <p className="text-sm font-medium text-gray-900">
                        {item.etiqueta}
                        {falta && <span className="ml-2 text-xs font-normal text-amber-700">sin asignar</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">{item.detalle}</p>
                      <p className="mt-1 text-[11px] text-gray-400">
                        Cuenta de {c.tiposPermitidos.map((t) => ETIQUETA_TIPO[t].toLowerCase()).join(" o ")}. Predeterminada {c.porOmision.codigo}.
                      </p>
                    </div>
                    <div className="md:col-span-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <BuscadorCuenta opciones={opciones} valor={c.cuenta} disabled={!puedeEditar} onChange={(id) => guardar(item.clave, { cuentaId: id })} />
                        </div>
                        {puedeEditar && puedeRestaurar && (
                          <button type="button" onClick={() => guardar(item.clave, { restablecer: true })} className="btn btn-ghost btn-sm shrink-0" title={`Volver a la cuenta predeterminada ${c.porOmision.codigo}`}>
                            Restaurar
                          </button>
                        )}
                      </div>
                      {guardando === item.clave && <p className="mt-1 text-xs text-gray-500">Guardando</p>}
                      {errores[item.clave] && <p className="mt-1 text-xs text-red-700">{errores[item.clave]}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
