"use client";

/**
 * Ficha médica, familiares y beneficiarios. Lo usan el expediente (RRHH) y
 * Mi espacio (el empleado): `endpoint` decide a quién se le escribe, y la API
 * dice qué partes puede ver y editar quien mira.
 */

import { useCallback, useEffect, useState } from "react";
import { PARENTESCOS, TIPOS_SANGRE, etiquetaParentesco, validarPorcentajes } from "@/lib/empleados/familia";

interface Ficha {
  tipoSangre: string | null; alergias: string | null; enfermedadesCronicas: string | null; medicamentos: string | null;
  discapacidad: string | null; medicoNombre: string | null; medicoTelefono: string | null; observaciones: string | null;
}
interface Familiar { nombre: string; parentesco: string; fechaNacimiento: string; identidad: string; telefono: string; esDependiente: boolean; esContactoEmergencia: boolean }
interface Beneficiario { nombre: string; parentesco: string; identidad: string; telefono: string; porcentaje: string }
interface Permisos { salud: boolean; verFamilia: boolean; editarFamilia: boolean; editarBeneficiarios?: boolean }

const fichaVacia: Ficha = { tipoSangre: null, alergias: null, enfermedadesCronicas: null, medicamentos: null, discapacidad: null, medicoNombre: null, medicoTelefono: null, observaciones: null };
const famVacio = (): Familiar => ({ nombre: "", parentesco: "HIJO", fechaNacimiento: "", identidad: "", telefono: "", esDependiente: false, esContactoEmergencia: false });
const benVacio = (): Beneficiario => ({ nombre: "", parentesco: "CONYUGE", identidad: "", telefono: "", porcentaje: "" });

export default function SaludFamilia({ endpoint, descripcionPropia = false }: { endpoint: string; descripcionPropia?: boolean }) {
  const [permisos, setPermisos] = useState<Permisos | null>(null);
  const [ficha, setFicha] = useState<Ficha>(fichaVacia);
  const [familiares, setFamiliares] = useState<Familiar[]>([]);
  const [beneficiarios, setBeneficiarios] = useState<Beneficiario[]>([]);
  const [aviso, setAviso] = useState<{ seccion: string; ok: boolean; texto: string } | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch(endpoint, { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) return;
    setPermisos(d.permisos);
    if (d.fichaMedica) setFicha({ ...fichaVacia, ...d.fichaMedica });
    if (d.familiares) {
      setFamiliares(d.familiares.map((f: Record<string, unknown>) => ({
        nombre: String(f.nombre ?? ""), parentesco: String(f.parentesco), fechaNacimiento: f.fechaNacimiento ? String(f.fechaNacimiento).slice(0, 10) : "",
        identidad: String(f.identidad ?? ""), telefono: String(f.telefono ?? ""), esDependiente: !!f.esDependiente, esContactoEmergencia: !!f.esContactoEmergencia,
      })));
    }
    if (d.beneficiarios) {
      setBeneficiarios(d.beneficiarios.map((b: Record<string, unknown>) => ({
        nombre: String(b.nombre ?? ""), parentesco: String(b.parentesco), identidad: String(b.identidad ?? ""), telefono: String(b.telefono ?? ""), porcentaje: String(b.porcentaje ?? ""),
      })));
    }
  }, [endpoint]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  async function guardar(seccion: "ficha" | "familia" | "beneficiarios") {
    setGuardando(seccion);
    setAviso(null);
    const cuerpo =
      seccion === "ficha" ? { fichaMedica: ficha }
      : seccion === "familia" ? { familiares: familiares.filter((f) => f.nombre.trim()) }
      : { beneficiarios: beneficiarios.filter((b) => b.nombre.trim()).map((b) => ({ ...b, porcentaje: Number(b.porcentaje) })) };
    try {
      const res = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      const d = await res.json();
      if (!res.ok) {
        const campos = d.detalles ? Object.entries(d.detalles).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`) : [];
        throw new Error([d.error ?? "No se pudo guardar", ...campos].join(" "));
      }
      setAviso({ seccion, ok: true, texto: "Guardado." });
      await cargar();
    } catch (e) {
      setAviso({ seccion, ok: false, texto: e instanceof Error ? e.message : "Error" });
    } finally {
      setGuardando(null);
    }
  }

  if (!permisos) return <p className="text-sm text-gray-400">Cargando…</p>;
  const sumaBen = beneficiarios.filter((b) => b.nombre.trim()).map((b) => Number(b.porcentaje) || 0);
  const valBen = validarPorcentajes(sumaBen);
  const editarBen = permisos.editarBeneficiarios ?? permisos.editarFamilia;
  const msg = (s: string) => aviso?.seccion === s ? <span className={`text-sm ${aviso.ok ? "text-green-800" : "text-red-700"}`}>{aviso.texto}</span> : null;

  return (
    <div className="space-y-5">
      {permisos.salud && (
        <section className="panel space-y-3 p-5" aria-labelledby="sf-ficha">
          <div>
            <h2 id="sf-ficha" className="text-base font-semibold text-gray-900">Ficha médica</h2>
            <p className="text-xs text-gray-500">
              {descripcionPropia ? "Sirve para atenderle en una emergencia. Sólo la ven Recursos Humanos y usted." : "Dato de salud: sólo lo ven quienes tienen el permiso de ficha médica y el propio empleado."}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sf-sangre">Tipo de sangre</label>
              <select id="sf-sangre" className="input" value={ficha.tipoSangre ?? ""} onChange={(e) => setFicha((f) => ({ ...f, tipoSangre: e.target.value || null }))}>
                <option value="">Sin dato</option>
                {TIPOS_SANGRE.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sf-medico">Médico de cabecera</label><input id="sf-medico" className="input" value={ficha.medicoNombre ?? ""} onChange={(e) => setFicha((f) => ({ ...f, medicoNombre: e.target.value }))} /></div>
            <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sf-medtel">Teléfono del médico</label><input id="sf-medtel" className="input" value={ficha.medicoTelefono ?? ""} onChange={(e) => setFicha((f) => ({ ...f, medicoTelefono: e.target.value }))} /></div>
            <div className="sm:col-span-3 grid gap-3 sm:grid-cols-2">
              <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sf-alergias">Alergias</label><textarea id="sf-alergias" rows={2} className="input" value={ficha.alergias ?? ""} onChange={(e) => setFicha((f) => ({ ...f, alergias: e.target.value }))} /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sf-cronicas">Enfermedades crónicas</label><textarea id="sf-cronicas" rows={2} className="input" value={ficha.enfermedadesCronicas ?? ""} onChange={(e) => setFicha((f) => ({ ...f, enfermedadesCronicas: e.target.value }))} /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sf-medicamentos">Medicamentos de uso continuo</label><textarea id="sf-medicamentos" rows={2} className="input" value={ficha.medicamentos ?? ""} onChange={(e) => setFicha((f) => ({ ...f, medicamentos: e.target.value }))} /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="sf-discapacidad">Discapacidad</label><input id="sf-discapacidad" className="input" value={ficha.discapacidad ?? ""} onChange={(e) => setFicha((f) => ({ ...f, discapacidad: e.target.value }))} /></div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-3">{msg("ficha")}<button type="button" className="btn btn-primary" onClick={() => void guardar("ficha")} disabled={guardando === "ficha"}>{guardando === "ficha" ? "Guardando…" : "Guardar ficha"}</button></div>
        </section>
      )}

      {permisos.verFamilia && (
        <section className="panel space-y-3 p-5" aria-labelledby="sf-familia">
          <div>
            <h2 id="sf-familia" className="text-base font-semibold text-gray-900">Familiares</h2>
            <p className="text-xs text-gray-500">Marque quiénes dependen económicamente y a quién llamar en una emergencia.</p>
          </div>
          {familiares.length === 0 && <p className="text-sm text-gray-500">Sin familiares registrados.</p>}
          <div className="space-y-3">
            {familiares.map((f, i) => (
              <div key={i} className="grid gap-2 rounded-md border border-gray-200 p-3 sm:grid-cols-6">
                <input aria-label="Nombre del familiar" className="input sm:col-span-2" placeholder="Nombre completo" value={f.nombre} disabled={!permisos.editarFamilia} onChange={(e) => setFamiliares((l) => l.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))} />
                <select aria-label="Parentesco" className="input" value={f.parentesco} disabled={!permisos.editarFamilia} onChange={(e) => setFamiliares((l) => l.map((x, j) => j === i ? { ...x, parentesco: e.target.value } : x))}>
                  {PARENTESCOS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
                </select>
                <input aria-label="Fecha de nacimiento" type="date" className="input" value={f.fechaNacimiento} disabled={!permisos.editarFamilia} onChange={(e) => setFamiliares((l) => l.map((x, j) => j === i ? { ...x, fechaNacimiento: e.target.value } : x))} />
                <input aria-label="Teléfono" className="input" placeholder="Teléfono" value={f.telefono} disabled={!permisos.editarFamilia} onChange={(e) => setFamiliares((l) => l.map((x, j) => j === i ? { ...x, telefono: e.target.value } : x))} />
                <input aria-label="Identidad" className="input" placeholder="Identidad" value={f.identidad} disabled={!permisos.editarFamilia} onChange={(e) => setFamiliares((l) => l.map((x, j) => j === i ? { ...x, identidad: e.target.value } : x))} />
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-700 sm:col-span-6">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={f.esDependiente} disabled={!permisos.editarFamilia} onChange={(e) => setFamiliares((l) => l.map((x, j) => j === i ? { ...x, esDependiente: e.target.checked } : x))} />Dependiente</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={f.esContactoEmergencia} disabled={!permisos.editarFamilia} onChange={(e) => setFamiliares((l) => l.map((x, j) => j === i ? { ...x, esContactoEmergencia: e.target.checked } : x))} />Contacto de emergencia</label>
                  {permisos.editarFamilia && <button type="button" className="ml-auto text-xs text-red-700 hover:underline" onClick={() => setFamiliares((l) => l.filter((_, j) => j !== i))}>Quitar</button>}
                </div>
              </div>
            ))}
          </div>
          {permisos.editarFamilia && (
            <div className="flex items-center justify-between gap-3">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFamiliares((l) => [...l, famVacio()])}>Agregar familiar</button>
              <div className="flex items-center gap-3">{msg("familia")}<button type="button" className="btn btn-primary" onClick={() => void guardar("familia")} disabled={guardando === "familia"}>{guardando === "familia" ? "Guardando…" : "Guardar familiares"}</button></div>
            </div>
          )}
        </section>
      )}

      {permisos.verFamilia && (
        <section className="panel space-y-3 p-5" aria-labelledby="sf-benef">
          <div>
            <h2 id="sf-benef" className="text-base font-semibold text-gray-900">Beneficiarios</h2>
            <p className="text-xs text-gray-500">
              A quién se pagan las prestaciones en caso de muerte del trabajador. Los porcentajes deben sumar 100 %.
              {!editarBen ? " Para cambiarlos, entregue el formulario firmado a Recursos Humanos." : ""}
            </p>
          </div>
          {beneficiarios.length === 0 && <p className="text-sm text-gray-500">Sin beneficiarios designados.</p>}
          {editarBen ? (
            <div className="space-y-2">
              {beneficiarios.map((b, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-6">
                  <input aria-label="Nombre del beneficiario" className="input sm:col-span-2" placeholder="Nombre completo" value={b.nombre} onChange={(e) => setBeneficiarios((l) => l.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))} />
                  <select aria-label="Parentesco del beneficiario" className="input" value={b.parentesco} onChange={(e) => setBeneficiarios((l) => l.map((x, j) => j === i ? { ...x, parentesco: e.target.value } : x))}>
                    {PARENTESCOS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
                  </select>
                  <input aria-label="Identidad del beneficiario" className="input" placeholder="Identidad" value={b.identidad} onChange={(e) => setBeneficiarios((l) => l.map((x, j) => j === i ? { ...x, identidad: e.target.value } : x))} />
                  <input aria-label="Porcentaje" type="number" min={0.01} max={100} step="0.01" className="input" placeholder="%" value={b.porcentaje} onChange={(e) => setBeneficiarios((l) => l.map((x, j) => j === i ? { ...x, porcentaje: e.target.value } : x))} />
                  <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => setBeneficiarios((l) => l.filter((_, j) => j !== i))}>Quitar</button>
                </div>
              ))}
              {!valBen.ok && beneficiarios.some((b) => b.nombre.trim()) && <p className="text-xs text-red-700">{valBen.error}</p>}
              <div className="flex items-center justify-between gap-3">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBeneficiarios((l) => [...l, benVacio()])}>Agregar beneficiario</button>
                <div className="flex items-center gap-3">{msg("beneficiarios")}<button type="button" className="btn btn-primary" onClick={() => void guardar("beneficiarios")} disabled={guardando === "beneficiarios" || !valBen.ok}>{guardando === "beneficiarios" ? "Guardando…" : "Guardar beneficiarios"}</button></div>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {beneficiarios.map((b, i) => (
                <li key={i} className="flex justify-between py-2"><span>{b.nombre} <span className="text-gray-500">({etiquetaParentesco(b.parentesco)})</span></span><span className="tnum">{Number(b.porcentaje).toFixed(2)} %</span></li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
