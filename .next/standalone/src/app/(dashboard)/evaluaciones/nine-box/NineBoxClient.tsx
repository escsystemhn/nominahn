"use client";

import { useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import FotoAvatar from "@/components/employees/FotoAvatar";

interface Empleado {
  id: string;
  nombre: string;
  codigo: string;
  fotoVersion: number | null;
  puesto: string;
  departamento: string;
  desempeno: number; // 0–100 → eje X
  potencial: number; // 0–100 → eje Y
  calificacion: number;
  periodo: string;
}

interface Props {
  datos: Empleado[];
}

// Etiquetas de los 9 cuadrantes (fila 3→1 del eje Y, columna 1→3 del eje X)
const CUADRANTES = [
  // fila superior (alto potencial)
  { label: "Enigma", color: "bg-yellow-100 border-yellow-300", dot: "bg-yellow-500" },
  { label: "Alto potencial", color: "bg-green-100 border-green-300", dot: "bg-green-500" },
  { label: "Estrella", color: "bg-emerald-100 border-emerald-400", dot: "bg-emerald-600" },
  // fila media
  { label: "Dilema", color: "bg-orange-50 border-orange-200", dot: "bg-orange-400" },
  { label: "Núcleo sólido", color: "bg-blue-100 border-blue-300", dot: "bg-blue-500" },
  { label: "Alto rendimiento", color: "bg-blue-200 border-blue-400", dot: "bg-blue-700" },
  // fila inferior (bajo potencial)
  { label: "Bajo impacto", color: "bg-red-50 border-red-200", dot: "bg-red-400" },
  { label: "Efectivo", color: "bg-gray-100 border-gray-300", dot: "bg-gray-500" },
  { label: "Confiable", color: "bg-teal-100 border-teal-300", dot: "bg-teal-500" },
];

function getCuadrante(desempeno: number, potencial: number): number {
  const col = desempeno < 34 ? 0 : desempeno < 67 ? 1 : 2;
  const fila = potencial < 34 ? 2 : potencial < 67 ? 1 : 0; // fila 0 = alto
  return fila * 3 + col;
}

export default function NineBoxClient({ datos }: Props) {
  const [seleccionado, setSeleccionado] = useState<Empleado | null>(null);
  const [filtro, setFiltro] = useState("");

  const filtrados = datos.filter(
    (e) =>
      !filtro ||
      e.nombre.toLowerCase().includes(filtro.toLowerCase()) ||
      e.departamento.toLowerCase().includes(filtro.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Matriz nine-box"
        description={`Potencial frente a desempeño, ${datos.length} empleados.`}
        actions={
          <input
            type="text"
            aria-label="Buscar empleado"
            placeholder="Buscar empleado…"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="input w-56"
          />
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Cuadrícula 3×3 */}
        <div className="xl:col-span-2">
          {/* Eje Y label */}
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-full w-6 flex-col items-center justify-center">
              <span className="-rotate-90 whitespace-nowrap text-xs text-gray-500">Potencial</span>
            </div>
            <div className="flex-1">
              {/* Cabecera eje X */}
              <div className="mb-1 grid grid-cols-3 gap-1">
                {["Bajo desempeño", "Desempeño medio", "Alto desempeño"].map((l) => (
                  <div key={l} className="text-center text-xs font-medium text-gray-500">{l}</div>
                ))}
              </div>
              {/* 3 filas de 3 celdas */}
              <div className="space-y-1">
                {[0, 1, 2].map((fila) => (
                  <div key={fila} className="grid grid-cols-3 gap-1">
                    {[0, 1, 2].map((col) => {
                      const idx = fila * 3 + col;
                      const cuad = CUADRANTES[idx];
                      const empleadosCuad = filtrados.filter(
                        (e) => getCuadrante(e.desempeno, e.potencial) === idx
                      );
                      return (
                        <div
                          key={col}
                          className={`min-h-[120px] rounded-xl border p-3 ${cuad.color}`}
                        >
                          <p className="mb-2 text-xs font-semibold text-gray-700">{cuad.label}</p>
                          <div className="flex flex-wrap gap-1">
                            {empleadosCuad.map((emp) => (
                              <button
                                key={emp.id}
                                onClick={() => setSeleccionado(emp)}
                                title={emp.nombre}
                                aria-label={emp.nombre}
                                className={`flex h-6 w-6 items-center justify-center overflow-hidden rounded-full ${cuad.dot} text-xs font-bold text-white transition-transform hover:scale-110`}
                              >
                                {emp.fotoVersion !== null
                                  ? <FotoAvatar empleadoId={emp.id} version={emp.fotoVersion} nombre={emp.nombre} tamano="xs" className="h-6 w-6" />
                                  : emp.nombre.charAt(0)}
                              </button>
                            ))}
                          </div>
                          {empleadosCuad.length === 0 && (
                            <p className="mt-1 text-xs text-gray-500">—</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {/* Eje X */}
              <div className="mt-2 text-center text-xs text-gray-500">Desempeño</div>
            </div>
          </div>
        </div>

        {/* Panel lateral */}
        <div className="space-y-4">
          {seleccionado ? (
            <div className="panel p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold text-gray-900">
                  <FotoAvatar empleadoId={seleccionado.id} version={seleccionado.fotoVersion} nombre={seleccionado.nombre} tamano="md" />
                  {seleccionado.nombre}
                </h2>
                <button
                  onClick={() => setSeleccionado(null)}
                  className="btn btn-ghost btn-sm"
                >Cerrar</button>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Código</dt>
                  <dd className="font-medium">{seleccionado.codigo}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Puesto</dt>
                  <dd className="max-w-[160px] text-right font-medium">{seleccionado.puesto || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Departamento</dt>
                  <dd className="font-medium">{seleccionado.departamento || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Desempeño</dt>
                  <dd className="tnum font-semibold text-gray-900">{seleccionado.desempeno}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Potencial</dt>
                  <dd className="tnum font-semibold text-gray-900">{seleccionado.potencial}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Calificación</dt>
                  <dd className="tnum font-semibold text-gray-900">{seleccionado.calificacion.toFixed(1)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Cuadrante</dt>
                  <dd className="font-medium text-gray-900">
                    {CUADRANTES[getCuadrante(seleccionado.desempeno, seleccionado.potencial)]?.label}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Período</dt>
                  <dd>{seleccionado.periodo}</dd>
                </div>
              </dl>
              <a
                href={`/empleados/${seleccionado.id}`}
                className="btn btn-secondary mt-4 w-full"
              >
                Ver ficha del empleado
              </a>
            </div>
          ) : (
            <div className="panel p-5 text-center text-sm text-gray-500">
              Haga clic en un empleado para ver su detalle.
            </div>
          )}

          {/* Leyenda de cuadrantes */}
          <div className="panel p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-800">Leyenda</h2>
            <div className="space-y-1">
              {CUADRANTES.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-xs">
                  <span className={`h-3 w-3 rounded-full ${c.dot}`}></span>
                  <span className="text-gray-600">{c.label}</span>
                  <span className="tnum ml-auto text-gray-500">
                    {filtrados.filter((e) => CUADRANTES[getCuadrante(e.desempeno, e.potencial)].label === c.label).length}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
