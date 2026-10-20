"use client";

import { useState } from "react";

interface Empleado {
  id: string;
  nombre: string;
  codigo: string;
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
  { label: "Alto Potencial", color: "bg-green-100 border-green-300", dot: "bg-green-500" },
  { label: "Estrella", color: "bg-emerald-100 border-emerald-400", dot: "bg-emerald-600" },
  // fila media
  { label: "Dilema", color: "bg-orange-50 border-orange-200", dot: "bg-orange-400" },
  { label: "Núcleo Sólido", color: "bg-blue-100 border-blue-300", dot: "bg-blue-500" },
  { label: "Alto Rendimiento", color: "bg-blue-200 border-blue-400", dot: "bg-blue-700" },
  // fila inferior (bajo potencial)
  { label: "Bajo Impacto", color: "bg-red-50 border-red-200", dot: "bg-red-400" },
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
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nine-Box Grid</h1>
          <p className="text-sm text-gray-500 mt-0.5">Potencial vs Desempeño — {datos.length} empleados</p>
        </div>
        <input
          type="text"
          placeholder="Buscar empleado..."
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Cuadrícula 3×3 */}
        <div className="xl:col-span-2">
          {/* Eje Y label */}
          <div className="flex items-center gap-2 mb-2">
            <div className="flex flex-col items-center justify-center w-6 h-full">
              <span className="text-xs text-gray-400 -rotate-90 whitespace-nowrap">← POTENCIAL →</span>
            </div>
            <div className="flex-1">
              {/* Cabecera eje X */}
              <div className="grid grid-cols-3 gap-1 mb-1">
                {["Bajo Desempeño", "Desempeño Medio", "Alto Desempeño"].map((l) => (
                  <div key={l} className="text-center text-xs text-gray-400 font-medium">{l}</div>
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
                          className={`border rounded-xl p-3 min-h-[120px] ${cuad.color}`}
                        >
                          <p className="text-xs font-semibold text-gray-700 mb-2">{cuad.label}</p>
                          <div className="flex flex-wrap gap-1">
                            {empleadosCuad.map((emp) => (
                              <button
                                key={emp.id}
                                onClick={() => setSeleccionado(emp)}
                                title={emp.nombre}
                                className={`w-6 h-6 rounded-full ${cuad.dot} text-white text-xs font-bold flex items-center justify-center hover:scale-110 transition-transform`}
                              >
                                {emp.nombre.charAt(0)}
                              </button>
                            ))}
                          </div>
                          {empleadosCuad.length === 0 && (
                            <p className="text-xs text-gray-400 mt-1">—</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {/* Eje X */}
              <div className="text-center text-xs text-gray-400 mt-2">← DESEMPEÑO →</div>
            </div>
          </div>
        </div>

        {/* Panel lateral */}
        <div className="space-y-4">
          {seleccionado ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">{seleccionado.nombre}</h3>
                <button
                  onClick={() => setSeleccionado(null)}
                  className="text-gray-400 hover:text-gray-600"
                >✕</button>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Código</dt>
                  <dd className="font-medium">{seleccionado.codigo}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Puesto</dt>
                  <dd className="font-medium text-right max-w-[160px]">{seleccionado.puesto || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Departamento</dt>
                  <dd className="font-medium">{seleccionado.departamento || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Desempeño</dt>
                  <dd className="font-bold text-blue-700">{seleccionado.desempeno}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Potencial</dt>
                  <dd className="font-bold text-emerald-600">{seleccionado.potencial}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Calificación</dt>
                  <dd className="font-bold">{seleccionado.calificacion.toFixed(1)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Cuadrante</dt>
                  <dd className="font-medium text-purple-700">
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
                className="mt-4 block text-center py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium rounded-lg transition-colors"
              >
                Ver ficha del empleado
              </a>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center text-sm text-gray-400">
              Haz clic en un empleado para ver su detalle
            </div>
          )}

          {/* Leyenda de cuadrantes */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-semibold text-gray-800 mb-3 text-sm">Leyenda</h3>
            <div className="space-y-1">
              {CUADRANTES.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-xs">
                  <span className={`w-3 h-3 rounded-full ${c.dot}`}></span>
                  <span className="text-gray-600">{c.label}</span>
                  <span className="text-gray-400 ml-auto">
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
