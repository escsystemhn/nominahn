"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  nacionalidad: z.string().optional(),
  identidad: z.string().optional(),
  rtn: z.string().optional(),
  ihssNro: z.string().optional(),
  rapNro: z.string().optional(),
  telefonoPersonal: z.string().optional(),
  telefonoEmergencia: z.string().optional(),
  contactoEmergencia: z.string().optional(),
  direccion: z.string().optional(),
  fechaIngreso: z.string().min(1, "Requerido"),
  fechaSalida: z.string().optional(),
  estado: z.enum(["ACTIVO", "INACTIVO", "SUSPENDIDO", "VACACIONES", "PERMISO"]),
  tipoContrato: z.enum(["INDEFINIDO", "TEMPORAL", "PRUEBA", "SERVICIO"]),
  salarioBase: z.number().positive("Debe ser mayor a 0"),
  motivo: z.string().optional(),
  tipoPlanilla: z.enum(["SEMANAL", "QUINCENAL", "MENSUAL"]),
  cuentaBancaria: z.string().optional(),
  banco: z.string().optional(),
  sucursalId: z.string().min(1, "Requerido"),
  departamentoId: z.string().min(1, "Requerido"),
  puestoId: z.string().optional(),
  supervisorId: z.string().optional(),
  centroCostoId: z.string().optional(),
  emailCorporativo: z.string().optional(),
  extension: z.string().optional(),
  emailPersonal: z.union([z.literal(""), z.string().trim().email("Correo inválido")]).optional(),
  // Vacío = IHSS por porcentaje. Texto: el servidor lo valida y lo convierte.
  ihssMontoFijo: z.union([z.literal(""), z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido")]).optional(),
});

type FormData = z.infer<typeof schema>;

/** Campos anulables: al vaciarlos se envía `null` para BORRAR el valor. */
// `ihssMontoFijo` vacío = volver al cálculo por porcentaje; `emailPersonal`
// vacío = borrar el correo. Por eso viajan como `null` y no se omiten.
const CAMPOS_ANULABLES: readonly string[] = [
  "puestoId", "supervisorId", "centroCostoId", "fechaSalida", "emailPersonal", "ihssMontoFijo",
];

export interface EmpleadoEditable extends FormData {
  id: string;
}

interface Props {
  empleado: EmpleadoEditable;
  sucursales: Array<{ id: string; nombre: string }>;
  departamentos: Array<{ id: string; nombre: string; sucursalId: string }>;
  puestos: Array<{ id: string; nombre: string; departamentoId: string }>;
  supervisores: Array<{ id: string; nombre: string }>;
  centrosCosto: Array<{ id: string; codigo: string; nombre: string }>;
}

const fieldClass =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "block text-sm font-medium text-gray-700 mb-1";
const errorClass = "text-xs text-red-600 mt-0.5";

function Field({
  label,
  error,
  hint,
  children,
}: {
  hint?: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

/** Mensaje legible desde la respuesta del API (incluye el detalle por campo). */
function mensajeDeError(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null) {
    const b = body as { error?: string; detalles?: Record<string, string[]> };
    const campos = b.detalles
      ? Object.entries(b.detalles)
          .map(([k, v]) => `${k}: ${v.join(", ")}`)
          .join(" | ")
      : "";
    if (b.error) return campos ? `${b.error} - ${campos}` : b.error;
  }
  return `Error ${status} al guardar los cambios`;
}

/**
 * Edición del expediente.
 *
 * A diferencia del alta, aquí sólo se envían los campos que el usuario TOCÓ
 * (`dirtyFields`): `PUT /api/empleados/[id]` aplica una actualización parcial
 * sobre un allowlist, y mandar el formulario entero reescribiría columnas que
 * nadie modificó — incluidas las que otro usuario pudo cambiar mientras esta
 * pantalla estaba abierta.
 */
export default function EditarEmpleadoForm({
  empleado,
  sucursales,
  departamentos,
  puestos,
  supervisores,
  centrosCosto,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorApi, setErrorApi] = useState<string | null>(null);
  const [tab, setTab] = useState<"personal" | "laboral">("personal");

  const { id, ...valoresIniciales } = empleado;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, dirtyFields },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: valoresIniciales,
  });

  // `useWatch` en vez de `watch()` por la misma razón que en el alta: `watch`
  // devuelve una función que el React Compiler no puede memoizar.
  const sucursalId = useWatch({ control, name: "sucursalId" });
  const salarioBase = useWatch({ control, name: "salarioBase" });
  const deptsFiltrados = departamentos.filter((d) => !sucursalId || d.sucursalId === sucursalId);
  const salarioCambio = Number(salarioBase) !== Number(valoresIniciales.salarioBase);

  async function onSubmit(data: FormData) {
    // Sólo los campos tocados. El API responde 400 "Sin cambios" con un body
    // vacío, así que ese caso se resuelve aquí sin ir al servidor.
    const cambios: Record<string, unknown> = {};
    for (const clave of Object.keys(dirtyFields) as Array<keyof FormData>) {
      if (clave === "motivo") continue; // no es columna; se añade abajo
      const valor = data[clave];
      const vacio = valor === "" || valor === undefined;
      if (vacio && CAMPOS_ANULABLES.includes(clave)) {
        cambios[clave] = null;
      } else if (!vacio) {
        cambios[clave] = valor;
      }
      // Vaciar un texto no anulable (p. ej. RTN) no se envía: el allowlist del
      // API no acepta cadena vacía y borrarlo no es la intención habitual.
    }

    if (Object.keys(cambios).length === 0) {
      router.push(`/empleados/${id}`);
      return;
    }

    // El motivo sólo tiene sentido acompañando un cambio de salario: alimenta
    // el registro de HistorialSalario que crea el API.
    if (cambios.salarioBase !== undefined && data.motivo?.trim()) {
      cambios.motivo = data.motivo.trim();
    }

    setLoading(true);
    setErrorApi(null);
    try {
      const res = await fetch(`/api/empleados/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErrorApi(mensajeDeError(body, res.status));
        return;
      }
      router.push(`/empleados/${id}`);
      router.refresh();
    } catch {
      setErrorApi("No se pudo conectar con el servidor. Intente nuevamente.");
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

      {errorApi && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorApi}
        </div>
      )}

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
            <Field label="Nacionalidad" error={errors.nacionalidad?.message}>
              <input {...register("nacionalidad")} className={fieldClass} />
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
              Siguiente
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
            <Field label="Estado *" error={errors.estado?.message}>
              <select {...register("estado")} className={fieldClass}>
                <option value="ACTIVO">Activo</option>
                <option value="VACACIONES">Vacaciones</option>
                <option value="PERMISO">Permiso</option>
                <option value="SUSPENDIDO">Suspendido</option>
                <option value="INACTIVO">Inactivo</option>
              </select>
            </Field>
            <Field label="Tipo de Contrato *" error={errors.tipoContrato?.message}>
              <select {...register("tipoContrato")} className={fieldClass}>
                <option value="INDEFINIDO">Indefinido</option>
                <option value="TEMPORAL">Temporal</option>
                <option value="PRUEBA">Período de Prueba</option>
                <option value="SERVICIO">Servicios</option>
              </select>
            </Field>
            <Field label="Fecha de Salida" error={errors.fechaSalida?.message}>
              <input {...register("fechaSalida")} type="date" className={fieldClass} />
            </Field>
            <Field label="Salario Base (L.) *" error={errors.salarioBase?.message}>
              <input
                {...register("salarioBase", { valueAsNumber: true })}
                type="number"
                step="0.01"
                className={fieldClass}
              />
            </Field>
            <Field label="IHSS Fijo Mensual (L.)" error={errors.ihssMontoFijo?.message}>
              <input
                {...register("ihssMontoFijo")}
                type="number"
                step="0.01"
                min="0"
                className={fieldClass}
                placeholder="Vacío = cálculo por porcentaje"
              />
              <p className="text-xs text-gray-500 mt-1">
                Reemplaza el IHSS calculado por porcentaje. Mensual: en planilla quincenal se descuenta la
                mitad. El aporte patronal sigue por porcentaje.
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
              <select {...register("sucursalId")} className={fieldClass}>
                <option value="">Seleccione...</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </Field>
            <Field label="Departamento *" error={errors.departamentoId?.message}>
              <select {...register("departamentoId")} className={fieldClass}>
                <option value="">Seleccione...</option>
                {deptsFiltrados.map((d) => (
                  <option key={d.id} value={d.id}>{d.nombre}</option>
                ))}
              </select>
            </Field>
            <Field label="Puesto" error={errors.puestoId?.message}>
              <select {...register("puestoId")} className={fieldClass}>
                <option value="">Sin puesto</option>
                {puestos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </Field>
            <Field label="Supervisor" error={errors.supervisorId?.message}>
              <select {...register("supervisorId")} className={fieldClass}>
                <option value="">Sin supervisor</option>
                {supervisores.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Centro de Costo"
              error={errors.centroCostoId?.message}
              hint="Vacío = hereda el de su departamento."
            >
              <select {...register("centroCostoId")} className={fieldClass}>
                <option value="">Heredar del departamento</option>
                {centrosCosto.map((c) => (
                  <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
                ))}
              </select>
            </Field>
            <Field label="Correo Corporativo" error={errors.emailCorporativo?.message}>
              <input {...register("emailCorporativo")} className={fieldClass} placeholder="nombre@empresa.hn" />
            </Field>
            <Field label="Extensión" error={errors.extension?.message}>
              <input {...register("extension")} className={fieldClass} placeholder="1042" />
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

          {/* El motivo queda registrado en el historial salarial junto al cambio. */}
          {salarioCambio && (
            <Field label="Motivo del cambio de salario" error={errors.motivo?.message}>
              <input
                {...register("motivo")}
                className={fieldClass}
                placeholder="Ej. Ajuste anual, promoción, corrección"
              />
            </Field>
          )}

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setTab("personal")}
              className="px-5 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50"
            >
              Anterior
            </button>
            <div className="flex gap-2">
              <Link
                href={`/empleados/${id}`}
                className="px-5 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 disabled:bg-blue-400"
              >
                {loading ? "Guardando..." : "Guardar Cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
