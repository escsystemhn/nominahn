"use client";

import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import EstadoVacio from "@/components/ui/EstadoVacio";

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
    <div className="relative h-2 overflow-hidden rounded-full bg-gray-200">
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
    <div className="space-y-6">
      <PageHeader
        title="Análisis de brechas de competencias"
        description="Comparación del nivel actual con el nivel requerido por puesto."
        actions={
          <select
            aria-label="Puesto"
            value={puestoIdActual}
            onChange={(e) => router.push(`?puestoId=${e.target.value}`)}
            className="input w-64"
          >
            <option value="">Seleccionar puesto…</option>
            {puestos.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        }
      />

      {!puestoIdActual && (
        <div className="panel">
          <EstadoVacio titulo="Todavía no hay un puesto elegido." detalle="Seleccione un puesto para ver el análisis de brechas de competencias." />
        </div>
      )}

      {puestoIdActual && datos.length === 0 && (
        <div className="panel">
          <EstadoVacio titulo="No hay datos para este puesto." detalle="Ningún empleado activo del puesto tiene evaluaciones finalizadas, o el puesto no tiene competencias asignadas." />
        </div>
      )}

      {datos.length > 0 && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
          {/* Brechas críticas */}
          {topBrechas.length > 0 && (
            <div className="xl:col-span-1">
              <div className="panel p-5">
                <h3 className="mb-3 text-sm font-semibold text-gray-800">Brechas más críticas</h3>
                <div className="space-y-3">
                  {topBrechas.map((b) => (
                    <div key={b.id}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="max-w-[120px] truncate text-gray-700">{b.nombre}</span>
                        <span className="tnum font-semibold text-gray-900">−{b.promedio.toFixed(1)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-red-100">
                        <div
                          className="h-full rounded-full bg-red-500"
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
            <div className="panel overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      {datos[0].competencias.map((c) => (
                        <th key={c.competenciaId} className="max-w-[80px] text-center">
                          {c.nombre}
                        </th>
                      ))}
                      <th className="text-center">Brecha total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.map(({ empleado, competencias }) => {
                      const brechaTotal = competencias.reduce((acc, c) => acc + Math.max(0, c.brecha), 0);
                      return (
                        <tr key={empleado.id}>
                          <td>
                            <a href={`/empleados/${empleado.id}`} className="block font-medium text-blue-700 hover:underline">
                              {empleado.nombre}
                            </a>
                            <span className="text-xs text-gray-500">{empleado.codigo}</span>
                          </td>
                          {competencias.map((comp) => (
                            <td key={comp.competenciaId} className="min-w-[80px]">
                              <div className="mb-1 text-center">
                                <span
                                  className={`text-xs font-semibold ${
                                    comp.brecha <= 0 ? "text-emerald-700" : comp.brecha === 1 ? "text-yellow-700" : "text-red-600"
                                  }`}
                                >
                                  {comp.nivelActual === 0 ? "Sin evaluar" : NIVEL_LABEL[comp.nivelActual]}
                                </span>
                              </div>
                              <NivelBar actual={comp.nivelActual} requerido={comp.nivelRequerido} />
                              {comp.brecha > 0 && (
                                <p className="mt-1 text-center text-xs text-red-700">−{comp.brecha}</p>
                              )}
                            </td>
                          ))}
                          <td className="text-center">
                            <span
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                                brechaTotal === 0
                                  ? "bg-emerald-100 text-emerald-700"
                                  : brechaTotal <= 2
                                  ? "bg-yellow-100 text-yellow-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {brechaTotal === 0 ? "0" : `−${brechaTotal}`}
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
        </div>
      )}
    </div>
  );
}
