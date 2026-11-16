"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAvisos } from "@/components/ui/Avisos";
import { Field, PestanasFicha, ResumenErrores, erroresPorPestana, fieldClass, primerError, type PestanaFicha } from "./CamposFicha";
import { montoComoTexto } from "@/lib/formato/monto-texto";

const OBLIGATORIO = "Este dato es obligatorio.";
const ELEGIR = "Elija una opción.";

const schema = z.object({
  primerNombre: z.string().min(1, OBLIGATORIO),
  segundoNombre: z.string().optional(),
  primerApellido: z.string().min(1, OBLIGATORIO),
  segundoApellido: z.string().optional(),
  fechaNacimiento: z.string().min(1, OBLIGATORIO),
  genero: z.string().min(1, OBLIGATORIO),
  estadoCivil: z.string().optional(),
  identidad: z.string().optional(),
  rtn: z.string().optional(),
  ihssNro: z.string().optional(),
  rapNro: z.string().optional(),
  telefonoPersonal: z.string().optional(),
  emailPersonal: z.union([z.literal(""), z.string().trim().email("Escriba un correo válido.")]).optional(),
  emailCorporativo: z.union([z.literal(""), z.string().trim().email("Escriba un correo válido.")]).optional(),
  telefonoEmergencia: z.string().optional(),
  contactoEmergencia: z.string().optional(),
  direccion: z.string().optional(),
  fechaIngreso: z.string().min(1, OBLIGATORIO),
  tipoContrato: z.enum(["INDEFINIDO", "TEMPORAL", "PRUEBA", "SERVICIO"], { error: ELEGIR }),
  salarioBase: z.number({ error: "Indique el salario." }).positive("El salario debe ser mayor que cero."),
  tipoPlanilla: z.enum(["SEMANAL", "QUINCENAL", "MENSUAL"], { error: ELEGIR }),
  cuentaBancaria: z.string().optional(),
  banco: z.string().optional(),
  sucursalId: z.string().min(1, OBLIGATORIO),
  departamentoId: z.string().min(1, OBLIGATORIO),
  puestoId: z.string().optional(),
  // Vacío = IHSS por porcentaje. Se envía como texto; el servidor lo valida. Se
  // acepta la coma decimal («297,58»): ver `montoComoTexto`.
  ihssMontoFijo: z.string().transform(montoComoTexto)
    .pipe(z.union([z.literal(""), z.string().regex(/^\d+(\.\d{1,2})?$/, "Escriba un monto, como 595.16.")])).optional(),
  // ¿Cotiza al IHSS / RAP en esta ficha? Por omisión sí; sólo el administrador los apaga.
  aplicaIhss: z.boolean().optional(),
  aplicaRap: z.boolean().optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  sucursales: Array<{ id: string; nombre: string }>;
  /** Vacío si el administrador no habilitó el nivel División. */
  divisiones: Array<{ id: string; nombre: string; sucursalId: string }>;
  departamentos: Array<{ id: string; nombre: string; sucursalId: string; divisionId: string | null }>;
  puestos: Array<{ id: string; nombre: string; departamentoId: string }>;
  /** Apagar el IHSS o el RAP de la ficha: sólo con el permiso de los parámetros de ley. */
  puedeCambiarAportes: boolean;
}

export default function NuevoEmpleadoForm({ sucursales, divisiones, departamentos, puestos, puedeCambiarAportes }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<PestanaFicha>("personal");
  const { avisar } = useAvisos();
  // La división no se guarda en el empleado (sale de su departamento): sólo
  // acota la lista de departamentos.
  const [divisionId, setDivisionId] = useState("");
  // «Guardar y registrar otro»: tras guardar, el formulario queda listo para el siguiente
  // (pedido de Edbin, 2026-11-16), con un aviso del que se acaba de registrar.
  const [registrado, setRegistrado] = useState<{ id: string; codigo: string; nombre: string } | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setFocus,
    getValues,
    reset,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { aplicaIhss: true, aplicaRap: true } });
  const porPestana = erroresPorPestana(errors);

  // El primer error puede estar en la otra pestaña, que no está dibujada: se abre y luego se enfoca.
  function alFallar(e: FieldErrors<FormData>) {
    const primero = primerError(e);
    if (!primero) return;
    setTab(primero.pestana);
    setTimeout(() => setFocus(primero.campo as keyof FormData), 0);
  }

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

  async function onSubmit(data: FormData, evento?: React.BaseSyntheticEvent) {
    // Qué botón se pulsó: «Guardar y registrar otro» o «Guardar empleado».
    const seguirRegistrando = !!(evento?.nativeEvent as SubmitEvent | undefined)?.submitter?.hasAttribute("data-registrar-otro");
    setLoading(true);
    try {
      const res = await fetch("/api/empleados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      // Un fallo interno del servidor llega sin cuerpo: leerlo a ciegas mostraba un error del navegador en inglés.
      const emp = await res.json().catch(() => null);
      if (!res.ok || !emp) {
        // El servidor dice qué campo falló; «intente nuevamente» no lo decía.
        const campos = emp?.detalles ? Object.entries(emp.detalles).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`) : [];
        throw new Error([emp?.error ?? "El servidor no pudo registrar el empleado. Intente de nuevo.", ...campos].join("\n"));
      }
      if (seguirRegistrando) {
        // Lo de la organización se conserva (suele ser igual para el siguiente); lo personal y el salario, no.
        const v = getValues();
        reset({
          aplicaIhss: true, aplicaRap: true,
          fechaIngreso: v.fechaIngreso, tipoContrato: v.tipoContrato, tipoPlanilla: v.tipoPlanilla, banco: v.banco,
          sucursalId: v.sucursalId, departamentoId: v.departamentoId, puestoId: v.puestoId,
        });
        setRegistrado({ id: emp.id, codigo: emp.codigo, nombre: `${data.primerNombre} ${data.primerApellido}` });
        setTab("personal");
        window.scrollTo({ top: 0, behavior: "smooth" });
        setTimeout(() => setFocus("primerNombre"), 0);
        avisar.exito(`Empleado ${emp.codigo} registrado. Puede registrar el siguiente.`);
        return;
      }
      avisar.exito("Empleado registrado.");
      router.push(`/empleados/${emp.id}`);
    } catch (e) {
      avisar.error(e instanceof Error ? e.message : "No se pudo registrar el empleado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form method="post" onSubmit={handleSubmit(onSubmit, alFallar)} className="space-y-5">
      {registrado && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900" data-registrado>
          <span>
            Se registró a <b>{registrado.nombre}</b> con el código <b className="font-mono">{registrado.codigo}</b>. Siga con el siguiente:
            se conservaron la sucursal, el departamento, el puesto, la planilla y la fecha de ingreso.
          </span>
          <Link href={`/empleados/${registrado.id}`} className="font-medium text-green-800 underline">Ver su ficha</Link>
        </div>
      )}
      <PestanasFicha tab={tab} onCambiar={setTab} errores={porPestana} />
      <ResumenErrores errores={porPestana} />

      {/* Personal */}
      {tab === "personal" && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Primer nombre *" error={errors.primerNombre?.message}>
              <input {...register("primerNombre")} className={fieldClass} />
            </Field>
            <Field label="Segundo nombre" error={errors.segundoNombre?.message}>
              <input {...register("segundoNombre")} className={fieldClass} />
            </Field>
            <Field label="Primer apellido *" error={errors.primerApellido?.message}>
              <input {...register("primerApellido")} className={fieldClass} />
            </Field>
            <Field label="Segundo apellido" error={errors.segundoApellido?.message}>
              <input {...register("segundoApellido")} className={fieldClass} />
            </Field>
            <Field label="Fecha de nacimiento *" error={errors.fechaNacimiento?.message}>
              <input {...register("fechaNacimiento")} type="date" className={fieldClass} />
            </Field>
            <Field label="Género *" error={errors.genero?.message}>
              <select {...register("genero")} className={fieldClass}>
                <option value="">Seleccione…</option>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
              </select>
            </Field>
            <Field label="Estado civil" error={errors.estadoCivil?.message}>
              <select {...register("estadoCivil")} className={fieldClass}>
                <option value="">Seleccione…</option>
                <option value="SOLTERO">Soltero/a</option>
                <option value="CASADO">Casado/a</option>
                <option value="UNION_LIBRE">Unión libre</option>
                <option value="DIVORCIADO">Divorciado/a</option>
                <option value="VIUDO">Viudo/a</option>
              </select>
            </Field>
            <Field label="Número de identidad" error={errors.identidad?.message}>
              <input {...register("identidad")} className={fieldClass} placeholder="0801-1990-XXXXX" />
            </Field>
            <Field label="RTN" error={errors.rtn?.message}>
              <input {...register("rtn")} className={fieldClass} placeholder="XXXX-XXXX-XXXXXX" />
            </Field>
            <Field label="Número de IHSS" error={errors.ihssNro?.message}>
              <input {...register("ihssNro")} className={fieldClass} />
            </Field>
            <Field label="Número de RAP" error={errors.rapNro?.message}>
              <input {...register("rapNro")} className={fieldClass} />
            </Field>
            <Field label="Teléfono personal" error={errors.telefonoPersonal?.message}>
              <input {...register("telefonoPersonal")} className={fieldClass} placeholder="+504 XXXX-XXXX" />
            </Field>
            <Field label="Correo personal" error={errors.emailPersonal?.message} hint="Aquí se envían sus comprobantes de pago.">
              <input {...register("emailPersonal")} type="email" className={fieldClass} placeholder="nombre@gmail.com" />
            </Field>
            <Field label="Correo corporativo" error={errors.emailCorporativo?.message}>
              <input {...register("emailCorporativo")} type="email" className={fieldClass} placeholder="nombre@empresa.hn" />
            </Field>
            <Field label="Contacto de emergencia" error={errors.contactoEmergencia?.message}>
              <input {...register("contactoEmergencia")} className={fieldClass} />
            </Field>
            <Field label="Teléfono de emergencia" error={errors.telefonoEmergencia?.message}>
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
              className="btn btn-secondary"
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
            <Field label="Fecha de ingreso *" error={errors.fechaIngreso?.message}>
              <input {...register("fechaIngreso")} type="date" className={fieldClass} />
            </Field>
            <Field label="Tipo de contrato *" error={errors.tipoContrato?.message}>
              <select {...register("tipoContrato")} className={fieldClass}>
                <option value="INDEFINIDO">Indefinido</option>
                <option value="TEMPORAL">Temporal</option>
                <option value="PRUEBA">Período de prueba</option>
                <option value="SERVICIO">Servicios</option>
              </select>
            </Field>
            <Field label="Salario base (L) *" error={errors.salarioBase?.message}>
              <input {...register("salarioBase", { valueAsNumber: true })} type="number" step="0.01" className={fieldClass} />
            </Field>
            <Field
              label="IHSS fijo mensual (L)"
              error={errors.ihssMontoFijo?.message}
              hint="Monto mensual de IHSS (EM + IVM) que se le descuenta. En planilla quincenal se descuenta como diga Parámetros de ley (la mitad en cada quincena o completo en una). El aporte patronal sigue calculándose por porcentaje."
            >
              <input {...register("ihssMontoFijo")} type="text" inputMode="decimal" autoComplete="off" className={fieldClass} placeholder="Vacío = cálculo por porcentaje" />
            </Field>
            <fieldset className="sm:col-span-2 rounded-lg border border-gray-200 p-3" data-aportes-ficha>
              <legend className="px-1 text-sm font-medium text-gray-700">IHSS y RAP en esta ficha</legend>
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" className="h-4 w-4" {...register("aplicaIhss")} disabled={!puedeCambiarAportes} />
                  Deducir IHSS
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" className="h-4 w-4" {...register("aplicaRap")} disabled={!puedeCambiarAportes} />
                  Deducir RAP
                </label>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Apáguelo sólo si la persona ya cotiza en otra ficha (otra nómina), para no deducirle de más en el mes: esta ficha no
                calcula ese aporte, ni lo del trabajador ni lo patronal. INFOP y Reserva Laboral no cambian.
                {!puedeCambiarAportes && " Sólo el administrador puede cambiarlo."}
              </p>
            </fieldset>
            <Field label="Tipo de planilla *" error={errors.tipoPlanilla?.message}>
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
                <option value="">Seleccione…</option>
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
                <option value="">Seleccione…</option>
                {deptsFiltrados.map((d) => (
                  <option key={d.id} value={d.id}>
                    {!divisionId && nombreDivision(d.divisionId) ? `${d.nombre} (${nombreDivision(d.divisionId)})` : d.nombre}
                  </option>
                ))}
              </select>
              {sucursalId && deptsFiltrados.length === 0 && (
                <p className="mt-1 text-xs text-amber-700">No hay departamentos aquí. Créelos en Configuración, Estructura organizacional.</p>
              )}
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
                <option value="">Seleccione…</option>
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
            <Field label="Número de cuenta bancaria" error={errors.cuentaBancaria?.message}>
              <input {...register("cuentaBancaria")} className={fieldClass} />
            </Field>
          </div>
          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setTab("personal")}
              className="btn btn-secondary"
            >
              Anterior
            </button>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="submit"
                disabled={loading}
                className="btn btn-secondary"
                data-registrar-otro
              >
                Guardar y registrar otro
              </button>
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary"
              >
                {loading ? "Guardando…" : "Guardar empleado"}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
