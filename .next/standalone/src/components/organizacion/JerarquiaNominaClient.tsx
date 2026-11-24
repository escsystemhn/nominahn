"use client";

/**
 * Jerarquía de nómina: árbol a la izquierda y, a la derecha, el personal de la
 * rama elegida. Quincenal y mensual se conmutan al instante porque cada árbol ya
 * viene construido; la rama elegida y las abiertas se conservan al cambiar.
 *
 * El árbol sigue el patrón de teclado de WAI-ARIA: un solo elemento tabulable y
 * flechas para moverse, abrir y cerrar.
 */

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";
import FranjaCifras from "@/components/ui/FranjaCifras";
import { cn, formatCurrency } from "@/lib/utils";
import type { FrecuenciaNomina, NivelNomina, NodoNomina, PersonaNomina } from "@/lib/organizacion/jerarquia-nomina";

const ETIQUETA_NIVEL: Record<NivelNomina, string> = {
  FRECUENCIA: "Toda la nómina",
  GRUPO: "Grupo",
  EMPRESA: "Sucursal",
  DEPARTAMENTO: "Departamento",
};

interface Visible {
  nodo: NodoNomina;
  nivel: number;
  padre: string | null;
  posicion: number;
  hermanos: number;
}

function aplanar(raiz: NodoNomina, abiertos: ReadonlySet<string>): Visible[] {
  const salida: Visible[] = [];
  const visitar = (nodo: NodoNomina, nivel: number, padre: string | null, posicion: number, hermanos: number) => {
    salida.push({ nodo, nivel, padre, posicion, hermanos });
    if (abiertos.has(nodo.clave)) nodo.hijos.forEach((h, i) => visitar(h, nivel + 1, nodo.clave, i + 1, nodo.hijos.length));
  };
  visitar(raiz, 1, null, 1, 1);
  return salida;
}

/** Cada nodo con los nombres de sus ancestros. */
function indexar(raiz: NodoNomina): Map<string, { nodo: NodoNomina; ruta: string[] }> {
  const indice = new Map<string, { nodo: NodoNomina; ruta: string[] }>();
  const visitar = (nodo: NodoNomina, ruta: string[]) => {
    indice.set(nodo.clave, { nodo, ruta });
    nodo.hijos.forEach((h) => visitar(h, [...ruta, nodo.nombre]));
  };
  visitar(raiz, []);
  return indice;
}

type FilaPersona = PersonaNomina & { departamento: string; claveDepartamento: string };

function personasDe(nodo: NodoNomina): FilaPersona[] {
  if (nodo.nivel === "DEPARTAMENTO") return nodo.personas.map((p) => ({ ...p, departamento: nodo.nombre, claveDepartamento: nodo.clave }));
  return nodo.hijos.flatMap(personasDe);
}

const clavesConHijos = (nodo: NodoNomina): string[] =>
  nodo.hijos.length ? [nodo.clave, ...nodo.hijos.flatMap(clavesConHijos)] : [];

export default function JerarquiaNominaClient({ frecuencias, conSalarios, exportar }: {
  frecuencias: FrecuenciaNomina[];
  conSalarios: boolean;
  /** «Exportar estructura», si la persona puede exportar. */
  exportar?: React.ReactNode;
}) {
  const [tipo, setTipo] = useState(() => (frecuencias.find((f) => f.raiz.cantidad > 0) ?? frecuencias[0]).tipo);
  const actual = frecuencias.find((f) => f.tipo === tipo) ?? frecuencias[0];
  const claveRaiz = actual.raiz.clave;

  const [elegida, setElegida] = useState(claveRaiz);
  const [foco, setFoco] = useState(claveRaiz);
  // De entrada se ven los grupos y sus empresas; los departamentos, al abrir.
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(
    () => new Set(frecuencias.flatMap((f) => [f.raiz.clave, ...f.raiz.hijos.map((g) => g.clave)]))
  );
  const filas = useRef(new Map<string, HTMLLIElement>());

  const indice = useMemo(() => indexar(actual.raiz), [actual]);
  const visibles = useMemo(() => aplanar(actual.raiz, abiertos), [actual, abiertos]);

  // Si la rama elegida no existe en esta frecuencia, se vuelve a toda la nómina.
  const seleccion = indice.get(elegida) ?? indice.get(claveRaiz)!;
  const nodo = seleccion.nodo;
  const personas = personasDe(nodo);
  const tabulable = visibles.some((v) => v.nodo.clave === foco)
    ? foco
    : visibles.some((v) => v.nodo.clave === nodo.clave) ? nodo.clave : claveRaiz;

  function alternar(clave: string, abrir: boolean) {
    setAbiertos((previos) => {
      const siguiente = new Set(previos);
      if (abrir) siguiente.add(clave);
      else siguiente.delete(clave);
      return siguiente;
    });
  }

  function elegir(n: NodoNomina) {
    setElegida(n.clave);
    setFoco(n.clave);
    if (n.hijos.length) alternar(n.clave, true);
  }

  function teclado(e: KeyboardEvent<HTMLLIElement>, v: Visible, i: number) {
    const irA = (clave: string | undefined) => {
      if (!clave) return;
      setFoco(clave);
      filas.current.get(clave)?.focus();
    };
    const abierto = abiertos.has(v.nodo.clave);
    const tieneHijos = v.nodo.hijos.length > 0;
    switch (e.key) {
      case "ArrowDown": irA(visibles[i + 1]?.nodo.clave); break;
      case "ArrowUp": irA(visibles[i - 1]?.nodo.clave); break;
      case "Home": irA(visibles[0].nodo.clave); break;
      case "End": irA(visibles[visibles.length - 1].nodo.clave); break;
      case "ArrowRight":
        if (tieneHijos && !abierto) alternar(v.nodo.clave, true);
        else if (tieneHijos) irA(v.nodo.hijos[0].clave);
        break;
      case "ArrowLeft":
        if (tieneHijos && abierto) alternar(v.nodo.clave, false);
        else irA(v.padre ?? undefined);
        break;
      case "Enter":
      case " ":
        elegir(v.nodo);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  const conVariosDepartamentos = nodo.nivel !== "DEPARTAMENTO";
  const cifras = [
    { label: "Empleados", valor: nodo.cantidad, destacada: true },
    ...(conSalarios && nodo.totalSalarios !== undefined ? [{ label: "Suma de salarios base", valor: formatCurrency(nodo.totalSalarios) }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jerarquía de nómina"
        description="Grupo, sucursal, departamento y empleados de cada nómina. Sólo aparecen las ramas con personal en la frecuencia elegida."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setAbiertos(new Set(frecuencias.flatMap((f) => clavesConHijos(f.raiz))))}>Desplegar todo</button>
            <button type="button" className="btn btn-secondary" onClick={() => setAbiertos(new Set(frecuencias.map((f) => f.raiz.clave)))}>Plegar todo</button>
            {exportar}
          </>
        }
      >
        <div role="group" aria-label="Frecuencia de la nómina" className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-gray-300 bg-white p-1">
          {frecuencias.map((f) => {
            const activa = f.tipo === tipo;
            return (
              <button
                key={f.tipo}
                type="button"
                aria-pressed={activa}
                onClick={() => setTipo(f.tipo)}
                className={cn("h-11 rounded-md px-4 text-sm font-medium transition-colors lg:h-9", activa ? "bg-blue-700 text-white" : "text-gray-700 hover:bg-gray-100")}
              >
                {f.etiqueta} <span className={cn("tnum ml-1 font-normal", activa ? "text-white/80" : "text-gray-500")}>{f.raiz.cantidad}</span>
              </button>
            );
          })}
        </div>
      </PageHeader>

      {actual.raiz.cantidad === 0 ? (
        <div className="panel">
          <EstadoVacio
            titulo={`No hay empleados en la ${actual.raiz.nombre.toLowerCase()}.`}
            detalle="La frecuencia se asigna en la ficha de cada empleado, en el tipo de planilla."
          />
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
          <div className="panel max-h-[45dvh] overflow-y-auto p-2 lg:max-h-[calc(100dvh-16rem)]">
            <ul role="tree" aria-label={`Estructura de la ${actual.raiz.nombre.toLowerCase()}`}>
              {visibles.map((v, i) => {
                const abierto = abiertos.has(v.nodo.clave);
                const tieneHijos = v.nodo.hijos.length > 0;
                const esElegida = v.nodo.clave === nodo.clave;
                return (
                  <li
                    key={v.nodo.clave}
                    ref={(el) => {
                      if (el) filas.current.set(v.nodo.clave, el);
                      else filas.current.delete(v.nodo.clave);
                    }}
                    role="treeitem"
                    aria-level={v.nivel}
                    aria-posinset={v.posicion}
                    aria-setsize={v.hermanos}
                    aria-expanded={tieneHijos ? abierto : undefined}
                    aria-selected={esElegida}
                    tabIndex={v.nodo.clave === tabulable ? 0 : -1}
                    onClick={() => elegir(v.nodo)}
                    onFocus={() => setFoco(v.nodo.clave)}
                    onKeyDown={(e) => teclado(e, v, i)}
                    style={{ paddingLeft: `${(v.nivel - 1) * 1.125 + 0.25}rem` }}
                    className={cn(
                      "flex h-11 cursor-pointer items-center gap-1 rounded-md pr-2 text-sm -outline-offset-2 lg:h-9",
                      esElegida ? "bg-blue-50 font-medium text-blue-900" : "text-gray-800 hover:bg-gray-50"
                    )}
                  >
                    {tieneHijos ? (
                      <span
                        aria-hidden="true"
                        onClick={(e) => { e.stopPropagation(); alternar(v.nodo.clave, !abierto); }}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-200 lg:h-7 lg:w-7"
                      >
                        <svg className={cn("h-3.5 w-3.5 transition-transform", abierto && "rotate-90")} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                        </svg>
                      </span>
                    ) : (
                      <span className="h-8 w-8 shrink-0 lg:h-7 lg:w-7" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 truncate" title={v.nodo.nombre}>{v.nodo.nombre}</span>
                    <span className="tnum shrink-0 text-xs text-gray-500">{v.nodo.cantidad}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <section className="panel min-w-0" aria-label={`Empleados de ${nodo.nombre}`}>
            <div className="border-b border-gray-200 px-5 pt-4">
              {seleccion.ruta.length > 0 && <p className="text-xs text-gray-500">{seleccion.ruta.join(" / ")}</p>}
              <h2 className="mt-1 text-lg font-semibold text-gray-900">{nodo.nombre}</h2>
              <p className="mt-0.5 text-sm text-gray-600">{ETIQUETA_NIVEL[nodo.nivel]}{nodo.detalle ? `. ${nodo.detalle}` : ""}</p>
              <div className="mt-2 [&>section>div]:border-b-0">
                <FranjaCifras cifras={cifras} etiqueta="Resumen de la selección" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base tabla-tarjetas">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Puesto</th>
                    {conVariosDepartamentos && <th>Departamento</th>}
                    {conSalarios && <th className="num">Salario base</th>}
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {personas.map((p) => (
                    <tr key={p.id}>
                      <td data-titulo>
                        <Link href={`/empleados/${p.id}`} className="font-medium text-gray-900 hover:text-blue-700">{p.nombre}</Link>
                        <span className="block font-mono text-xs text-gray-500">{p.codigo}</span>
                      </td>
                      <td data-etiqueta="Puesto">{p.puesto ?? "—"}</td>
                      {conVariosDepartamentos && <td data-etiqueta="Departamento">{p.departamento}</td>}
                      {conSalarios && <td data-etiqueta="Salario base" className="num">{p.salarioBase ? formatCurrency(p.salarioBase) : "—"}</td>}
                      <td data-etiqueta="Estado"><EstadoBadge valor={p.estado} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
