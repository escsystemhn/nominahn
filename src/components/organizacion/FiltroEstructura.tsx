"use client";

/**
 * Selectores en cascada Sucursal → División → Departamento para un formulario
 * GET (envían `sucursalId`, `divisionId` y `departamentoId`). Al cambiar un
 * nivel se limpian los de abajo. La División sólo aparece si el administrador
 * habilitó ese nivel.
 */

import { useState } from "react";

export interface OpcionesEstructura {
  conDivisiones: boolean;
  sucursales: Array<{ id: string; nombre: string }>;
  divisiones: Array<{ id: string; nombre: string; sucursalId: string }>;
  departamentos: Array<{ id: string; nombre: string; sucursalId: string; divisionId: string | null }>;
}

export default function FiltroEstructura({
  conDivisiones, sucursales, divisiones, departamentos, inicial,
}: OpcionesEstructura & { inicial: { sucursalId?: string; divisionId?: string; departamentoId?: string } }) {
  const [v, setV] = useState({
    sucursalId: inicial.sucursalId ?? "",
    divisionId: conDivisiones ? inicial.divisionId ?? "" : "",
    departamentoId: inicial.departamentoId ?? "",
  });
  const nombreSucursal = (id: string) => sucursales.find((s) => s.id === id)?.nombre ?? "";
  const divs = divisiones.filter((d) => !v.sucursalId || d.sucursalId === v.sucursalId);
  const deps = departamentos.filter((d) => (!v.sucursalId || d.sucursalId === v.sucursalId) && (!v.divisionId || d.divisionId === v.divisionId));
  // Sin sucursal elegida, el nombre solo no distingue dos «Administración».
  const conContexto = (nombre: string, sucursalId: string) => (v.sucursalId ? nombre : `${nombre} (${nombreSucursal(sucursalId)})`);

  return (
    <>
      <select name="sucursalId" aria-label="Sucursal" className="input w-auto" value={v.sucursalId}
        onChange={(e) => setV({ sucursalId: e.target.value, divisionId: "", departamentoId: "" })}>
        <option value="">Todas las sucursales</option>
        {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </select>
      {conDivisiones && (
        <select name="divisionId" aria-label="División" className="input w-auto" value={v.divisionId}
          onChange={(e) => setV({ ...v, divisionId: e.target.value, departamentoId: "" })}>
          <option value="">Todas las divisiones</option>
          {divs.map((d) => <option key={d.id} value={d.id}>{conContexto(d.nombre, d.sucursalId)}</option>)}
        </select>
      )}
      <select name="departamentoId" aria-label="Departamento" className="input w-auto" value={v.departamentoId}
        onChange={(e) => setV({ ...v, departamentoId: e.target.value })}>
        <option value="">Todos los departamentos</option>
        {deps.map((d) => <option key={d.id} value={d.id}>{conContexto(d.nombre, d.sucursalId)}</option>)}
      </select>
    </>
  );
}
