"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({
  primerNombre: z.string().min(1, "Requerido"),
  segundoNombre: z.string().optional(),
  primerApellido: z.string().min(1, "Requerido"),
  segundoApellido: z.string().optional(),
  fechaNacimiento: z.string().min(1, "Requerido"),
  genero: z.string().min(1, "Requerido"),
  estadoCivil: z.string().optional(),
  identidad: z.string().optional(),
  rtn: z.string().optional(),
  ihssNro: z.string().optional(),
  rapNro: z.string().optional(),
  telefonoPersonal: z.string().optional(),
  emailPersonal: z.union([z.literal(""), z.string().trim().email("Correo inválido")]).optional(),
  emailCorporativo: z.union([z.literal(""), z.string().trim().email("Correo inválido")]).optional(),
  telefonoEmergencia: z.string().optional(),
  contactoEmergencia: z.string().optional(),
  direccion: z.string().optional(),
  fechaIngreso: z.string().min(1, "Requerido"),
  tipoContrato: z.enum(["INDEFINIDO", "TEMPORAL", "PRUEBA", "SERVICIO"]),
  salarioBase: z.number().positive("Debe ser mayor a 0"),
  tipoPlanilla: z.enum(["SEMANAL", "QUINCENAL", "MENSUAL"]),
  cuentaBancaria: z.string().optional(),
  banco: z.string().optional(),
  sucursalId: z.string().min(1, "Requerido"),
  departamentoId: z.string().min(1, "Requerido"),
  puestoId: z.string().optional(),
  // Vacío = IHSS por porcentaje. Se envía como texto; el servidor lo valida.
  ihssMontoFijo: z.union([z.literal(""), z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido")]).optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  sucursales: Array<{ id: string; nombre: string }>;
  /** Vacío si el administrador no habilitó el nivel División. */
  divisiones: Array<{ id: string; nombre: string; sucursalId: string }>;
  departamentos: Array<{ id: string; nombre: string; sucursalId: string; divisionId: string | null }>;
  puestos: Array<{ id: string; nombre: string; departamentoId: string }>;
}

const fieldClass =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "block text-sm font-medium text-gray-700 mb-1";
const errorClass = "text-xs text-red-600 mt-0.5";

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

export default function NuevoEmpleadoForm({ sucursales, divisiones, departamentos, puestos }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"personal" | "laboral">("personal");
  // La división no se guarda en el empleado (sale de su departamento): sólo
  // acota la lista de departamentos.
  const [divisionId, setDivisionId] = useState("");

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  // `useWatch` en vez de `watch()`: este último devuelve una función que el React
  // Compiler no puede memoizar, y por eso descartaba la optimización de todo el
  // componente. `useWatch` es la variante suscrita a un campo concreto.
  const sucursalId = useWatch({ control, name: "sucursalId" });
  const departamentoId = useWatch({ control, name: "departamentoId" });
  const divisionesSucursal = divisiones.filter((v) => v.sucursalId === sucursalId);
  const deptsFiltrados = departamentos.filter((d) =>
    (!sucursalId || d.sucursalId === sucursalId) && (!divisionId || d.divisionId === divisionId)
  );
  const nombreDivision = (id: string | null) => divisiones.find((v) => v.id === id)?.nombre;
  const puestosFiltrados = puestos.filter((p) => p.departamentoId === departamentoId);

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      const res = await fetch("/api/empleados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const emp = await res.json();
      if (!res.ok) {
        // El servidor dice qué campo falló; «intente nuevamente» no lo decía.
        const campos = emp?.detalles ? Object.entries(emp.detalles).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`) : [];
        throw new Error([emp?.error ?? "Error al crear el empleado", ...campos].join("\n"));
      }
      router.push(`/empleados/${emp.id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error al crear el empleado. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["personal", "laboral"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors -mb-px border-b-2 ${
              tab === t
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "personal" ? "Datos Personales" : "Datos Laborales"}
          </button>
        ))}
      </div>

      {/* Personal */}
      {tab === "personal" && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Primer Nombre *" error={errors.primerNombre?.message}>
              <input {...register("primerNombre")} className={fieldClass} />
            </Field>
            <Field label="Segundo Nombre" error={errors.segundoNombre?.message}>
              <input {...register("segundoNombre")} className={fieldClass} />
            </Field>
            <Field label="Primer Apellido *" error={errors.primerApellido?.message}>
              <input {...register("primerApellido")} className={fieldClass} />
            </Field>
            <Field label="Segundo Apellido" error={errors.segundoApellido?.message}>
              <input {...register("segundoApellido")} className={fieldClass} />
            </Field>
            <Field label="Fecha de Nacimiento *" error={errors.fechaNacimiento?.message}>
              <input {...register("fechaNacimiento")} type="date" className={fieldClass} />
            </Field>
            <Field label="Género *" error={errors.genero?.message}>
              <select {...register("genero")} className={fieldClass}>
                <option value="">Seleccione...</option>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
              </select>
            </Field>
            <Field label="Estado Civil" error={errors.estadoCivil?.message}>
              <select {...register("estadoCivil")} className={fieldClass}>
                <option value="">Seleccione...</option>
                <option value="SOLTERO">Soltero/a</option>
                <option value="CASADO">Casado/a</option>
                <option value="UNION_LIBRE">Unión Libre</option>
                <option value="DIVORCIADO">Divorciado/a</option>
                <option value="VIUDO">Viudo/a</option>
              </select>
            </Field>
            <Field label="No. Identidad" error={errors.identidad?.message}>
              <input {...register("identidad")} className={fieldClass} placeholder="0801-1990-XXXXX" />
            </Field>
            <Field label="RTN" error={errors.rtn?.message}>
              <input {...register("rtn")} className={fieldClass} placeholder="XXXX-XXXX-XXXXXX" />
            </Field>
            <Field label="No. IHSS" error={errors.ihssNro?.message}>
              <input {...register("ihssNro")} className={fieldClass} />
            </Field>
            <Field label="No. RAP" error={errors.rapNro?.message}>
              <input {...register("rapNro")} className={fieldClass} />
            </Field>
            <Field label="Teléfono Personal" error={errors.telefonoPersonal?.message}>
              <input {...register("telefonoPersonal")} className={fieldClass} placeholder="+504 XXXX-XXXX" />
            </Field>
            <Field label="Correo Electrónico Personal" error={errors.emailPersonal?.message}>
              <input {...register("emailPersonal")} type="email" className={fieldClass} placeholder="nombre@gmail.com" />
              <p className="text-xs text-gray-500 mt-1">Aquí se envían sus comprobantes de pago.</p>
            </Field>
            <Field label="Correo Corporativo" error={errors.emailCorporativo?.message}>
              <input {...register("emailCorporativo")} type="email" className={fieldClass} placeholder="nombre@empresa.hn" />
            </Field>
            <Field label="Contacto de Emergencia" error={errors.contactoEmergencia?.message}>
              <input {...register("contactoEmergencia")} className={fieldClass} />
            </Field>
            <Field label="Teléfono Emergencia" error={errors.telefonoEmergencia?.message}>
              <input {...register("telefonoEmergencia")} className={fieldClass} />
            </Field>
          </div>
          <Field label="Dirección" error={errors.direccion?.message}>
            <input {...register("direccion")} className={fieldClass} />
          </Field>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setTab("laboral")}
              className="px-5 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800"
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}

      {/* Laboral */}
      {tab === "laboral" && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Fecha de Ingreso *" error={errors.fechaIngreso?.message}>
              <input {...register("fechaIngreso")} type="date" className={fieldClass} />
            </Field>
            <Field label="Tipo de Contrato *" error={errors.tipoContrato?.message}>
              <select {...register("tipoContrato")} className={fieldClass}>
                <option value="INDEFINIDO">Indefinido</option>
                <option value="TEMPORAL">Temporal</option>
                <option value="PRUEBA">Período de Prueba</option>
                <option value="SERVICIO">Servicios</option>
              </select>
            </Field>
            <Field label="Salario Base (L.) *" error={errors.salarioBase?.message}>
              <input {...register("salarioBase", { valueAsNumber: true })} type="number" step="0.01" className={fieldClass} />
            </Field>
            <Field label="IHSS Fijo Mensual (L.)" error={errors.ihssMontoFijo?.message}>
              <input {...register("ihssMontoFijo")} type="number" step="0.01" min="0" className={fieldClass} placeholder="Vacío = cálculo por porcentaje" />
              <p className="text-xs text-gray-500 mt-1">
                Monto mensual que se le descuenta de IHSS. En planilla quincenal se descuenta la mitad.
                El aporte patronal sigue calculándose por porcentaje.
              </p>
            </Field>
            <Field label="Tipo de Planilla *" error={errors.tipoPlanilla?.message}>
              <select {...register("tipoPlanilla")} className={fieldClass}>
                <option value="MENSUAL">Mensual</option>
                <option value="QUINCENAL">Quincenal</option>
                <option value="SEMANAL">Semanal</option>
              </select>
            </Field>
            <Field label="Sucursal *" error={errors.sucursalId?.message}>
              {/* Cambiar de sucursal deja sin sentido la división, el departamento y el puesto elegidos. */}
              <select
                {...register("sucursalId", { onChange: () => { setDivisionId(""); setValue("departamentoId", ""); setValue("puestoId", ""); } })}
                className={fieldClass}
              >
                <option value="">Seleccione...</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </Field>
            {divisiones.length > 0 && (
              <Field label="División">
                <select
                  value={divisionId}
                  disabled={!sucursalId || divisionesSucursal.length === 0}
                  onChange={(e) => { setDivisionId(e.target.value); setValue("departamentoId", ""); setValue("puestoId", ""); }}
                  className={fieldClass}
                >
                  <option value="">{sucursalId && divisionesSucursal.length === 0 ? "La sucursal no tiene divisiones" : "Todas"}</option>
                  {divisionesSucursal.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
                </select>
              </Field>
            )}
            <Field label="Departamento *" error={errors.departamentoId?.message}>
              <select {...register("departamentoId", { onChange: () => setValue("puestoId", "") })} className={fieldClass}>
                <option value="">Seleccione...</option>
                {deptsFiltrados.map((d) => (
                  <option key={d.id} value={d.id}>
                    {!divisionId && nombreDivision(d.divisionId) ? `${d.nombre} (${nombreDivision(d.divisionId)})` : d.nombre}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Puesto" error={errors.puestoId?.message}>
              <select {...register("puestoId")} className={fieldClass} disabled={!departamentoId}>
                <option value="">Sin puesto</option>
                {puestosFiltrados.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </Field>
            <Field label="Banco" error={errors.banco?.message}>
              <select {...register("banco")} className={fieldClass}>
                <option value="">Seleccione...</option>
                <option value="BANCATLAN">Bancatlán</option>
                <option value="BAC">BAC Honduras</option>
                <option value="FICOHSA">Ficohsa</option>
                <option value="BANPAIS">Banpaís</option>
                <option value="BANHCAFE">Banhcafé</option>
                <option value="LAFISE">Lafise</option>
                <option value="BANCO_ATLANTIDA">Banco Atlántida</option>
                <option value="OTRO">Otro</option>
              </select>
            </Field>
            <Field label="No. Cuenta Bancaria" error={errors.cuentaBancaria?.message}>
              <input {...register("cuentaBancaria")} className={fieldClass} />
            </Field>
          </div>
          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setTab("personal")}
              className="px-5 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50"
            >
              ← Anterior
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 disabled:bg-blue-400"
            >
              {loading ? "Guardando..." : "Guardar Empleado"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
