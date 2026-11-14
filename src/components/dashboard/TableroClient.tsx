"use client";

/**
 * Tablero ejecutivo de Talento Humano: fuerza laboral, asistencia y desempeño, masa
 * salarial con su pasivo laboral, y los pagos del 13.º y 14.º con sus adelantos.
 * Los cálculos y sus definiciones están en lib/dashboard/indicadores.ts.
 *
 * Gráficos: color por identidad (azul y naranja, validados para daltonismo), barras
 * finas con el extremo redondeado, una leyenda cuando hay dos series, tooltip al pasar
 * el cursor y, para lo que se lee en cifras, una tabla.
 */
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import PageHeader from "@/components/ui/PageHeader";
import FranjaCifras from "@/components/ui/FranjaCifras";
import EstadoVacio from "@/components/ui/EstadoVacio";
import { formatCurrency } from "@/lib/utils";
import type { Tablero } from "@/lib/dashboard/indicadores-bd";

const SERIE_1 = "#2a78d6"; // azul
const SERIE_2 = "#eb6834"; // naranja
const REJILLA = "#e5e7eb";
const TINTA_SECUNDARIA = "#6b7280";

interface Props {
  sucursales: { id: string; nombre: string }[];
  departamentos: { id: string; nombre: string; sucursalId: string }[];
  inicial: { desde: string; hasta: string };
}

const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("es-HN", { maximumFractionDigits: 1 })} %`);
const compacto = (n: number) => `L ${new Intl.NumberFormat("es-HN", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

const ejes = { tick: { fontSize: 12, fill: TINTA_SECUNDARIA }, tickLine: false, axisLine: { stroke: REJILLA } } as const;
const tooltip = { cursor: { fill: "#f3f4f6" }, contentStyle: { fontSize: 12, borderRadius: 8, borderColor: REJILLA } } as const;

function Seccion({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
        {descripcion && <p className="text-xs text-gray-500">{descripcion}</p>}
      </div>
      {children}
    </section>
  );
}

function Grafico({ titulo, alto = 240, children }: { titulo: string; alto?: number; children: React.ReactElement }) {
  return (
    <div className="panel p-4">
      <p className="mb-2 text-sm font-medium text-gray-800">{titulo}</p>
      <div style={{ height: alto }}>
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

export default function TableroClient({ sucursales, departamentos, inicial }: Props) {
  const [filtro, setFiltro] = useState({ ...inicial, sucursalId: "", departamentoId: "" });
  const [datos, setDatos] = useState<Tablero | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const consulta = useMemo(() => {
    const q = new URLSearchParams({ desde: filtro.desde, hasta: filtro.hasta });
    if (filtro.sucursalId) q.set("sucursalId", filtro.sucursalId);
    if (filtro.departamentoId) q.set("departamentoId", filtro.departamentoId);
    return q.toString();
  }, [filtro]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargando(true);
      const r = await fetch(`/api/tablero?${consulta}`);
      const d = await r.json().catch(() => ({}));
      if (!vivo) return;
      if (r.ok) {
        setDatos(d);
        setError(null);
      } else setError(typeof d.error === "string" ? d.error : "No se pudo calcular el tablero.");
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [consulta]);

  const deptos = filtro.sucursalId ? departamentos.filter((d) => d.sucursalId === filtro.sucursalId) : departamentos;

  return (
    <div className="space-y-8" data-tablero>
      <PageHeader
        title="Tablero ejecutivo"
        description="Talento humano y nómina de un vistazo: personal, asistencia, desempeño, costo de la nómina y el pago de los décimos."
        actions={
          <div className="flex gap-2">
            <a className="btn btn-secondary" href={`/api/tablero?${consulta}&formato=xlsx`}>Excel</a>
            <a className="btn btn-secondary" href={`/api/tablero?${consulta}&formato=pdf`}>PDF</a>
          </div>
        }
      />

      <div className="panel flex flex-wrap items-end gap-3 p-4" role="group" aria-label="Filtros del tablero">
        <label className="text-sm">
          <span className="block font-medium text-gray-800">Desde</span>
          <input type="date" className="input mt-1 w-40!" value={filtro.desde} max={filtro.hasta} onChange={(e) => e.target.value && setFiltro({ ...filtro, desde: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="block font-medium text-gray-800">Hasta</span>
          <input type="date" className="input mt-1 w-40!" value={filtro.hasta} min={filtro.desde} onChange={(e) => e.target.value && setFiltro({ ...filtro, hasta: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="block font-medium text-gray-800">Sucursal</span>
          <select className="input mt-1 w-56!" value={filtro.sucursalId} onChange={(e) => setFiltro({ ...filtro, sucursalId: e.target.value, departamentoId: "" })}>
            <option value="">Todas</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-medium text-gray-800">Departamento</span>
          <select className="input mt-1 w-56!" value={filtro.departamentoId} onChange={(e) => setFiltro({ ...filtro, departamentoId: e.target.value })}>
            <option value="">Todos</option>
            {deptos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </label>
        {cargando && <span className="pb-2 text-sm text-gray-500" role="status">Calculando…</span>}
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!datos ? (
        !error && <p className="text-sm text-gray-500">Calculando…</p>
      ) : (
        <>
          {/* ─── Fuerza laboral ─────────────────────────────────────────────── */}
          <Seccion titulo="Fuerza laboral" descripcion="Activos al final del período. Rotación = bajas ÷ promedio de activos al inicio y al final.">
            <FranjaCifras
              etiqueta="Fuerza laboral"
              cifras={[
                { label: "Empleados activos", valor: datos.fuerza.activos, destacada: true },
                { label: "Altas", valor: datos.fuerza.altas, detalle: "ingresos del período" },
                { label: "Bajas", valor: datos.fuerza.bajas, detalle: "salidas del período" },
                { label: "Rotación", valor: pct(datos.fuerza.rotacion) },
              ]}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Barras horizontales: los nombres de sucursal son largos y no caben bajo el eje. */}
              <Grafico titulo="Activos por sucursal" alto={Math.max(200, datos.fuerza.porSucursal.length * 30 + 20)}>
                <BarChart data={datos.fuerza.porSucursal} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={REJILLA} />
                  <XAxis type="number" allowDecimals={false} {...ejes} />
                  <YAxis type="category" dataKey="nombre" {...ejes} width={150} interval={0} />
                  <Tooltip {...tooltip} formatter={(v) => [v, "Activos"]} />
                  <Bar dataKey="activos" name="Activos" fill={SERIE_1} radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </Grafico>
              <Grafico titulo="Altas y bajas por mes">
                <BarChart data={datos.fuerza.porMes.map((m) => ({ ...m, mes: nombreMes(m.mes) }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke={REJILLA} />
                  <XAxis dataKey="mes" {...ejes} />
                  <YAxis allowDecimals={false} {...ejes} axisLine={false} />
                  <Tooltip {...tooltip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="altas" name="Altas" fill={SERIE_1} radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="bajas" name="Bajas" fill={SERIE_2} radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </Grafico>
            </div>
            {datos.fuerza.porDepartamento.length > 0 && (
              <details className="panel p-4 text-sm">
                <summary className="cursor-pointer font-medium text-gray-800">Activos por departamento ({datos.fuerza.porDepartamento.length})</summary>
                <table className="table-base mt-2">
                  <thead><tr><th>Departamento</th><th className="num">Activos</th></tr></thead>
                  <tbody>{datos.fuerza.porDepartamento.map((d) => <tr key={d.nombre}><td>{d.nombre}</td><td className="num">{d.activos}</td></tr>)}</tbody>
                </table>
              </details>
            )}
          </Seccion>

          {/* ─── Asistencia y desempeño ─────────────────────────────────────── */}
          <Seccion
            titulo="Asistencia y desempeño"
            descripcion={`Puntualidad del ${datos.asistencia.puntualidadDesde.split("-").reverse().join("/")} al cierre: llegadas a tiempo sobre días con marca. Ausentismo: días de ausencia sobre días con registro.`}
          >
            <FranjaCifras
              etiqueta="Asistencia"
              cifras={[
                { label: "Puntualidad", valor: pct(datos.asistencia.puntualidad) },
                { label: "Ausentismo", valor: pct(datos.asistencia.ausentismo), detalle: `${datos.asistencia.ausencias} de ${datos.asistencia.diasConRegistro} días` },
                { label: "Horas extra", valor: pct(datos.asistencia.extraSobreOrdinarias), detalle: `${datos.asistencia.horasExtra.toLocaleString("es-HN")} h sobre ${datos.asistencia.horasOrdinarias.toLocaleString("es-HN")} h ordinarias` },
              ]}
            />
            <FranjaCifras
              etiqueta="Desempeño y capacitación"
              cifras={[
                { label: "Promedio de evaluaciones", valor: datos.desempeno.promedio === null ? "—" : `${datos.desempeno.promedio} de 100`, detalle: `${datos.desempeno.evaluaciones} finalizadas` },
                { label: "Asistencia a capacitaciones", valor: pct(datos.capacitacion.asistencia), detalle: `${datos.capacitacion.participantes} inscritos` },
                { label: "Aprobaron", valor: pct(datos.capacitacion.aprobados) },
                { label: "Material visto", valor: pct(datos.capacitacion.materialVisto) },
              ]}
            />
          </Seccion>

          {/* ─── Masa salarial ──────────────────────────────────────────────── */}
          <Seccion
            titulo="Masa salarial"
            descripcion={`Planillas confirmadas, aprobadas o pagadas que empiezan en el período. Costo = devengado + aportes patronales + provisiones. Se compara con el período anterior del mismo largo (${datos.masa.anterior.desde.split("-").reverse().join("/")} a ${datos.masa.anterior.hasta.split("-").reverse().join("/")}).`}
          >
            <FranjaCifras
              etiqueta="Costo de la nómina"
              cifras={[
                { label: "Costo del período", valor: formatCurrency(datos.masa.actual.costo), destacada: true },
                { label: "Período anterior", valor: formatCurrency(datos.masa.anterior.costo) },
                { label: "Variación", valor: pct(datos.masa.variacionCosto) },
                { label: "Neto pagado", valor: formatCurrency(datos.masa.actual.neto) },
              ]}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <Grafico titulo="Costo por componente: período anterior y actual">
                <BarChart
                  data={[
                    { c: "Devengado", anterior: datos.masa.anterior.bruto, actual: datos.masa.actual.bruto },
                    { c: "Aportes", anterior: datos.masa.anterior.aportes, actual: datos.masa.actual.aportes },
                    { c: "Provisiones", anterior: datos.masa.anterior.provisiones, actual: datos.masa.actual.provisiones },
                  ]}
                  margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                  barGap={2}
                >
                  <CartesianGrid vertical={false} stroke={REJILLA} />
                  <XAxis dataKey="c" {...ejes} />
                  <YAxis tickFormatter={compacto} {...ejes} axisLine={false} width={64} />
                  <Tooltip {...tooltip} formatter={(v) => formatCurrency(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="anterior" name="Período anterior" fill={SERIE_2} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="actual" name="Este período" fill={SERIE_1} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </Grafico>
              {datos.masa.actual.deducciones.length > 0 ? (
                <Grafico titulo="Deducciones del período" alto={Math.max(160, datos.masa.actual.deducciones.length * 30)}>
                  <BarChart data={datos.masa.actual.deducciones} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke={REJILLA} />
                    <XAxis type="number" tickFormatter={compacto} {...ejes} />
                    <YAxis type="category" dataKey="concepto" {...ejes} width={110} />
                    <Tooltip {...tooltip} formatter={(v) => [formatCurrency(Number(v)), "Deducido"]} />
                    <Bar dataKey="monto" name="Deducido" fill={SERIE_1} radius={[0, 4, 4, 0]} maxBarSize={18} />
                  </BarChart>
                </Grafico>
              ) : (
                <div className="panel"><EstadoVacio titulo="Sin planillas en el período." detalle="Cuando haya planillas confirmadas, aquí verá sus deducciones." /></div>
              )}
            </div>
            <FranjaCifras
              etiqueta="Pasivo laboral"
              cifras={[
                { label: "Cesantía acumulada", valor: formatCurrency(datos.pasivo.cesantia), detalle: "si se despidiera hoy a cada activo (Art. 120)" },
                { label: "Décimos devengados", valor: formatCurrency(datos.pasivo.decimosAcumulados), detalle: "13.º y 14.º en curso, sin pagar" },
                { label: "Pasivo laboral", valor: formatCurrency(datos.pasivo.total), destacada: true },
              ]}
            />
          </Seccion>

          {/* ─── Décimos ────────────────────────────────────────────────────── */}
          <Seccion
            titulo="Pagos del décimo tercer y cuarto mes"
            descripcion="Proyección al corte para quienes siguen activos, con el mismo cálculo de la planilla y su salario actual, menos los adelantos ya pagados (Deducciones → Anticipos de prestaciones)."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              {datos.decimos.map((d) => {
                const nombre = d.tipo === "DECIMO_TERCERO" ? `Décimo tercer mes ${d.anio}` : `Décimo cuarto mes ${d.anio}`;
                const corte = d.tipo === "DECIMO_TERCERO" ? "se paga en diciembre" : "se paga en junio";
                return (
                  <div key={d.tipo} className="panel space-y-3 p-4" data-decimo={d.tipo}>
                    <p className="font-medium text-gray-900">{nombre} <span className="text-xs font-normal text-gray-500">({corte})</span></p>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div><dt className="text-xs text-gray-500">Devengado a hoy</dt><dd className="tnum">{formatCurrency(d.acumulado)}</dd></div>
                      <div><dt className="text-xs text-gray-500">Proyectado al corte</dt><dd className="tnum">{formatCurrency(d.proyectado)}</dd></div>
                      <div><dt className="text-xs text-gray-500">Adelantos ya pagados</dt><dd className="tnum">− {formatCurrency(d.adelantos)}</dd></div>
                      <div><dt className="text-xs text-gray-500">Neto a desembolsar</dt><dd className="tnum text-lg font-semibold text-gray-900" data-neto>{formatCurrency(d.neto)}</dd></div>
                    </dl>
                    {d.porSucursal.length > 0 && (
                      <>
                        <div style={{ height: Math.max(140, d.porSucursal.length * 36 + 40) }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={d.porSucursal} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                              <CartesianGrid horizontal={false} stroke={REJILLA} />
                              <XAxis type="number" tickFormatter={compacto} {...ejes} />
                              <YAxis type="category" dataKey="nombre" {...ejes} width={130} />
                              <Tooltip {...tooltip} formatter={(v, nombreSerie) => [formatCurrency(Number(v)), nombreSerie]} />
                              <Legend wrapperStyle={{ fontSize: 12 }} />
                              {/* Apiladas: lo neto más lo adelantado es el proyectado. Un hueco de 2 px las separa. */}
                              <Bar dataKey="neto" name="Neto a desembolsar" stackId="d" fill={SERIE_1} stroke="#fff" strokeWidth={2} maxBarSize={20} />
                              <Bar dataKey="adelantos" name="Adelantos ya pagados" stackId="d" fill={SERIE_2} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} maxBarSize={20} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                        <table className="table-base text-xs">
                          <thead><tr><th>Sucursal</th><th className="num">Empleados</th><th className="num">Proyectado</th><th className="num">Adelantos</th><th className="num">Neto</th></tr></thead>
                          <tbody>
                            {d.porSucursal.map((s) => (
                              <tr key={s.nombre}><td>{s.nombre}</td><td className="num">{s.empleados}</td><td className="num">{formatCurrency(s.proyectado)}</td><td className="num">{formatCurrency(s.adelantos)}</td><td className="num">{formatCurrency(s.neto)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </Seccion>
        </>
      )}
    </div>
  );
}
