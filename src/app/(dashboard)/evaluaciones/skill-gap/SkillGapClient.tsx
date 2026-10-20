"use client";

import { useRouter } from "next/navigation";

interface Brecha {
  competenciaId: string;
  nombre: string;
  nivelRequerido: number;
  nivelActual: number;
  brecha: number;
}

interface EmpleadoBrechas {
  empleado: { id: string; nombre: string; codigo: string };
  competencias: Brecha[];
}

interface Props {
  puestos: { id: string; nombre: string }[];
  puestoIdActual: string;
  datos: EmpleadoBrechas[];
}

const NIVEL_LABEL = ["—", "Inicial", "Básico", "Intermedio", "Avanzado", "Experto"];

function NivelBar({ actual, requerido }: { actual: number; requerido: number }) {
  const pctActual = (actual / 5) * 100;
  const pctReq = (requerido / 5) * 100;
  const brecha = requerido - actual;
  const color = brecha <= 0 ? "bg-emerald-500" : brecha === 1 ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
      <div className={`absolute left-0 top-0 h-full rounded-full ${color}`} style={{ width: `${pctActual}%` }} />
      {/* Marca del nivel requerido */}
      <div
        className="absolute top-0 h-full w-0.5 bg-gray-700"
        style={{ left: `${pctReq}%` }}
        title={`Requerido: ${NIVEL_LABEL[requerido]}`}
      />
    </div>
  );
}

export default function SkillGapClient({ puestos, puestoIdActual, datos }: Props) {
  const router = useRouter();

  // Identificar las competencias más críticas (mayor brecha promedio)
  const brechaPromPorComp = new Map<string, { nombre: string; total: number; count: number }>();
  for (const emp of datos) {
    for (const comp of emp.competencias) {
      const prev = brechaPromPorComp.get(comp.competenciaId) ?? { nombre: comp.nombre, total: 0, count: 0 };
      brechaPromPorComp.set(comp.competenciaId, { nombre: comp.nombre, total: prev.total + comp.brecha, count: prev.count + 1 });
    }
  }
  const topBrechas = Array.from(brechaPromPorComp.entries())
    .map(([id, v]) => ({ id, nombre: v.nombre, promedio: v.total / v.count }))
    .filter((b) => b.promedio > 0)
    .sort((a, b) => b.promedio - a.promedio)
    .slice(0, 5);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Análisis de brechas de competencias</h1>
          <p className="text-sm text-gray-500 mt-0.5">Comparación nivel actual vs nivel requerido por puesto</p>
        </div>
        <select
          value={puestoIdActual}
          onChange={(e) => router.push(`?puestoId=${e.target.value}`)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="">Seleccionar puesto...</option>
          {puestos.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      </div>

      {!puestoIdActual && (
        <div className="bg-blue-50 text-blue-700 rounded-xl p-6 text-center text-sm">
          Selecciona un puesto para ver el análisis de brechas de competencias.
        </div>
      )}

      {puestoIdActual && datos.length === 0 && (
        <div className="bg-gray-50 text-gray-500 rounded-xl p-6 text-center text-sm">
          No hay empleados activos en este puesto con evaluaciones disponibles.
        </div>
      )}

      {datos.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Brechas críticas */}
          {topBrechas.length > 0 && (
            <div className="xl:col-span-1">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="font-semibold text-gray-800 mb-3 text-sm">Brechas más críticas</h3>
                <div className="space-y-3">
                  {topBrechas.map((b) => (
                    <div key={b.id}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-700 truncate max-w-[120px]">{b.nombre}</span>
                        <span className="font-bold text-red-600">-{b.promedio.toFixed(1)}</span>
                      </div>
                      <div className="h-1.5 bg-red-100 rounded-full">
                        <div
                          className="h-full bg-red-500 rounded-full"
                          style={{ width: `${Math.min((b.promedio / 5) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tabla de empleados */}
          <div className={topBrechas.length > 0 ? "xl:col-span-3" : "xl:col-span-4"}>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Empleado</th>
                    {datos[0].competencias.map((c) => (
                      <th key={c.competenciaId} className="px-2 py-3 text-center font-medium text-gray-600 text-xs max-w-[80px]">
                        {c.nombre}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Brecha total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {datos.map(({ empleado, competencias }) => {
                    const brechaTotal = competencias.reduce((acc, c) => acc + Math.max(0, c.brecha), 0);
                    return (
                      <tr key={empleado.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <a href={`/empleados/${empleado.id}`} className="font-medium text-blue-700 hover:underline block">
                            {empleado.nombre}
                          </a>
                          <span className="text-xs text-gray-400">{empleado.codigo}</span>
                        </td>
                        {competencias.map((comp) => (
                          <td key={comp.competenciaId} className="px-2 py-3 min-w-[80px]">
                            <div className="text-center mb-1">
                              <span
                                className={`text-xs font-semibold ${
                                  comp.brecha <= 0 ? "text-emerald-600" : comp.brecha === 1 ? "text-yellow-600" : "text-red-600"
                                }`}
                              >
                                {comp.nivelActual === 0 ? "N/E" : NIVEL_LABEL[comp.nivelActual]}
                              </span>
                            </div>
                            <NivelBar actual={comp.nivelActual} requerido={comp.nivelRequerido} />
                            {comp.brecha > 0 && (
                              <p className="text-xs text-center text-red-500 mt-1">−{comp.brecha}</p>
                            )}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                              brechaTotal === 0
                                ? "bg-emerald-100 text-emerald-700"
                                : brechaTotal <= 2
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {brechaTotal === 0 ? "✓" : `-${brechaTotal}`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
