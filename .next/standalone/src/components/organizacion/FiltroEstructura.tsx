"use client";

/**
 * Selectores en cascada Sucursal → División → Departamento para un formulario
 * GET (envían `sucursalId`, `divisionId` y `departamentoId`). Al cambiar un
 * nivel se limpian los de abajo. La División sólo aparece si el administrador
 * habilitó ese nivel. Con la jerarquía de nómina, los niveles se llaman Grupo y Empresa.
 */

import { useState } from "react";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";

export interface OpcionesEstructura {
  conDivisiones: boolean;
  jerarquia: boolean;
  sucursales: Array<{ id: string; nombre: string }>;
  divisiones: Array<{ id: string; nombre: string; sucursalId: string }>;
  departamentos: Array<{ id: string; nombre: string; sucursalId: string; divisionId: string | null }>;
}

export default function FiltroEstructura({
  conDivisiones, jerarquia, sucursales, divisiones, departamentos, inicial,
}: OpcionesEstructura & { inicial: { sucursalId?: string; divisionId?: string; departamentoId?: string } }) {
  const niveles = etiquetasNiveles(jerarquia);
  const desdeUrl = {
    sucursalId: inicial.sucursalId ?? "",
    divisionId: conDivisiones ? inicial.divisionId ?? "" : "",
    departamentoId: inicial.departamentoId ?? "",
  };
  const [v, setV] = useState(desdeUrl);
  // Sin volver a montar la pantalla, «Quitar filtros» sólo llega por aquí.
  const claveUrl = JSON.stringify(desdeUrl);
  const [claveVista, setClaveVista] = useState(claveUrl);
  if (claveUrl !== claveVista) {
    setClaveVista(claveUrl);
    setV(desdeUrl);
  }
  const nombreSucursal = (id: string) => sucursales.find((s) => s.id === id)?.nombre ?? "";
  const divs = divisiones.filter((d) => !v.sucursalId || d.sucursalId === v.sucursalId);
  const deps = departamentos.filter((d) => (!v.sucursalId || d.sucursalId === v.sucursalId) && (!v.divisionId || d.divisionId === v.divisionId));
  // Sin sucursal elegida, el nombre solo no distingue dos «Administración».
  const conContexto = (nombre: string, sucursalId: string) => (v.sucursalId ? nombre : `${nombre} (${nombreSucursal(sucursalId)})`);

  return (
    <>
      <select name="sucursalId" aria-label={niveles.sucursal} className="input w-auto" value={v.sucursalId}
        onChange={(e) => setV({ sucursalId: e.target.value, divisionId: "", departamentoId: "" })}>
        <option value="">{niveles.todasSucursales}</option>
        {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </select>
      {conDivisiones && (
        <select name="divisionId" aria-label={niveles.division} className="input w-auto" value={v.divisionId}
          onChange={(e) => setV({ ...v, divisionId: e.target.value, departamentoId: "" })}>
          <option value="">{niveles.todasDivisiones}</option>
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
