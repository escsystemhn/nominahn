"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  empresas: Array<{ id: string; nombre: string }>;
  sucursales: Array<{ id: string; nombre: string }>;
}

const tiposPlanilla = [
  { value: "MENSUAL", label: "Mensual", desc: "1 pago por mes, 30 días" },
  { value: "QUINCENAL", label: "Quincenal", desc: "2 pagos por mes, 15 días c/u" },
  { value: "SEMANAL", label: "Semanal", desc: "4 pagos por mes, 7 días c/u" },
];

export default function NuevaPlanillaForm({ empresas, sucursales }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    tipo: "MENSUAL",
    empresaId: empresas[0]?.id ?? "",
    sucursalId: "",
    fechaInicio: "",
    fechaFin: "",
  });

  function setField(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function autoFechas(tipo: string, inicio: string) {
    if (!inicio) return;
    const from = new Date(inicio);
    const to = new Date(from);
    if (tipo === "MENSUAL") {
      to.setMonth(to.getMonth() + 1);
      to.setDate(to.getDate() - 1);
    } else if (tipo === "QUINCENAL") {
      to.setDate(to.getDate() + 14);
    } else {
      to.setDate(to.getDate() + 6);
    }
    setForm((f) => ({ ...f, fechaFin: to.toISOString().split("T")[0] }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/planillas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al crear planilla");
      router.push(`/planillas/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear la planilla");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-5">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de Planilla</label>
        <div className="grid grid-cols-3 gap-3">
          {tiposPlanilla.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setField("tipo", t.value)}
              className={`p-3 border-2 rounded-lg text-left transition-colors ${
                form.tipo === t.value
                  ? "border-blue-600 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <p className="font-medium text-sm">{t.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Empresa</label>
        <select
          value={form.empresaId}
          onChange={(e) => setField("empresaId", e.target.value)}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {empresas.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.nombre}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Sucursal (opcional — vacío = todas)</label>
        <select
          value={form.sucursalId}
          onChange={(e) => setField("sucursalId", e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Todas las sucursales</option>
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Fecha Inicio</label>
          <input
            type="date"
            value={form.fechaInicio}
            onChange={(e) => {
              setField("fechaInicio", e.target.value);
              autoFechas(form.tipo, e.target.value);
            }}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Fecha Fin</label>
          <input
            type="date"
            value={form.fechaFin}
            onChange={(e) => setField("fechaFin", e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        <p className="font-medium mb-1">¿Qué se calculará automáticamente?</p>
        <ul className="space-y-0.5 text-xs">
          <li>• Salario base proporcional según días trabajados</li>
          <li>• Horas extra del período (desde marcajes biométricos)</li>
          <li>• IHSS 2.5%, RAP 1.5%, AFP, ISR progresivo</li>
          <li>• Impuesto Vecinal, descuento por ausencias (doble)</li>
          <li>• Préstamos, cooperativa y otras deducciones activas</li>
          <li>• Provisiones: 13vo, 14vo, Vacaciones</li>
          <li>• Aportaciones patronales: IHSS 5%, RAP 1.5%, INFOP 1%</li>
        </ul>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex-1 py-2.5 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-2.5 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 disabled:bg-blue-400"
        >
          {loading ? "Calculando planilla..." : "Calcular Planilla"}
        </button>
      </div>
    </form>
  );
}
