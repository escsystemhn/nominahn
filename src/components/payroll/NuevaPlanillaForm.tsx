"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  empresas: Array<{ id: string; nombre: string }>;
  sucursales: Array<{ id: string; nombre: string; empresaId: string }>;
  /** Vacío si el administrador no habilitó el nivel División. */
  divisiones: Array<{ id: string; nombre: string; sucursalId: string }>;
  departamentos: Array<{ id: string; nombre: string; sucursalId: string; divisionId: string | null }>;
  conDivisiones: boolean;
}

const tiposPlanilla = [
  { value: "MENSUAL", label: "Mensual", desc: "1 pago por mes, 30 días" },
  { value: "QUINCENAL", label: "Quincenal", desc: "2 pagos por mes, 15 días c/u" },
  { value: "SEMANAL", label: "Semanal", desc: "4 pagos por mes, 7 días c/u" },
];

export default function NuevaPlanillaForm({ empresas, sucursales, divisiones, departamentos, conDivisiones }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    tipo: "MENSUAL",
    empresaId: empresas[0]?.id ?? "",
    sucursalId: "",
    divisionId: "",
    departamentoId: "",
    fechaInicio: "",
    fechaFin: "",
  });

  function setField(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Alcance en cascada: al cambiar un nivel se limpian los de abajo, que
  // podrían ya no pertenecerle.
  const sucursalesEmpresa = sucursales.filter((s) => s.empresaId === form.empresaId);
  const divisionesSucursal = divisiones.filter((v) => v.sucursalId === form.sucursalId);
  const departamentosVisibles = departamentos.filter((d) =>
    d.sucursalId === form.sucursalId && (!form.divisionId || d.divisionId === form.divisionId)
  );

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
    <form onSubmit={handleSubmit} className="panel space-y-5 p-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</div>
      )}

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">Tipo de planilla</label>
        <div className="grid grid-cols-3 gap-3">
          {tiposPlanilla.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setField("tipo", t.value)}
              className={`rounded-lg border-2 p-3 text-left transition-colors ${
                form.tipo === t.value ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <p className="text-sm font-medium">{t.label}</p>
              <p className="mt-0.5 text-xs text-gray-500">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="pl-empresa" className="mb-1 block text-sm font-medium text-gray-700">Empresa</label>
        <select
          id="pl-empresa"
          value={form.empresaId}
          onChange={(e) => setForm((f) => ({ ...f, empresaId: e.target.value, sucursalId: "", divisionId: "", departamentoId: "" }))}
          required
          className="input"
        >
          {empresas.map((emp) => <option key={emp.id} value={emp.id}>{emp.nombre}</option>)}
        </select>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-gray-700">Alcance</legend>
        <p className="text-xs text-gray-500">
          Vacío en un nivel = todo el nivel de arriba. Nadie puede quedar en dos planillas vigentes que cubran las mismas fechas.
        </p>
        <div className={`grid gap-3 ${conDivisiones ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <div>
            <label htmlFor="pl-sucursal" className="mb-1 block text-xs font-medium text-gray-700">Sucursal</label>
            <select
              id="pl-sucursal"
              value={form.sucursalId}
              onChange={(e) => setForm((f) => ({ ...f, sucursalId: e.target.value, divisionId: "", departamentoId: "" }))}
              className="input"
            >
              <option value="">Todas las sucursales</option>
              {sucursalesEmpresa.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          {conDivisiones && (
            <div>
              <label htmlFor="pl-division" className="mb-1 block text-xs font-medium text-gray-700">División</label>
              <select
                id="pl-division"
                value={form.divisionId}
                disabled={!form.sucursalId || divisionesSucursal.length === 0}
                onChange={(e) => setForm((f) => ({ ...f, divisionId: e.target.value, departamentoId: "" }))}
                className="input"
              >
                <option value="">{form.sucursalId && divisionesSucursal.length === 0 ? "Sin divisiones" : "Todas las divisiones"}</option>
                {divisionesSucursal.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="pl-depto" className="mb-1 block text-xs font-medium text-gray-700">Departamento</label>
            <select
              id="pl-depto"
              value={form.departamentoId}
              disabled={!form.sucursalId}
              onChange={(e) => setField("departamentoId", e.target.value)}
              className="input"
            >
              <option value="">Todos los departamentos</option>
              {departamentosVisibles.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </div>
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="pl-inicio" className="mb-1 block text-sm font-medium text-gray-700">Fecha inicio</label>
          <input
            id="pl-inicio"
            type="date"
            value={form.fechaInicio}
            onChange={(e) => {
              setField("fechaInicio", e.target.value);
              autoFechas(form.tipo, e.target.value);
            }}
            required
            className="input"
          />
        </div>
        <div>
          <label htmlFor="pl-fin" className="mb-1 block text-sm font-medium text-gray-700">Fecha fin</label>
          <input id="pl-fin" type="date" value={form.fechaFin} onChange={(e) => setField("fechaFin", e.target.value)} required className="input" />
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="mb-1 font-medium">¿Qué se calculará automáticamente?</p>
        <ul className="space-y-0.5 text-xs">
          <li>• Salario base proporcional según días trabajados</li>
          <li>• Horas extra del período (desde marcajes biométricos)</li>
          <li>• IHSS, RAP, AFP e ISR progresivo, con los parámetros de ley configurados</li>
          <li>• Impuesto Vecinal, descuento por ausencias (doble)</li>
          <li>• Préstamos, cooperativa y otras deducciones activas</li>
          <li>• Provisiones: 13vo, 14vo, Vacaciones</li>
          <li>• Aportaciones patronales: IHSS, RAP, INFOP y Fondo de Reserva Laboral</li>
        </ul>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={() => router.back()} className="btn btn-secondary flex-1">Cancelar</button>
        <button type="submit" disabled={loading} className="btn btn-primary flex-1">
          {loading ? "Calculando planilla…" : "Calcular planilla"}
        </button>
      </div>
    </form>
  );
}
