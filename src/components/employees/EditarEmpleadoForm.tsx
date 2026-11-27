"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAvisos } from "@/components/ui/Avisos";
import { Field, PestanasFicha, ResumenErrores, erroresPorPestana, fieldClass, primerError, type PestanaFicha } from "./CamposFicha";
import { montoComoTexto } from "@/lib/formato/monto-texto";
import { etiquetasNiveles, type NivelesEstructura } from "@/lib/organizacion/estructura";
import FlechasEmpleado, { type DestinoFlecha } from "./FlechasEmpleado";
import EditorFotoEmpleado from "./EditorFotoEmpleado";
import CampoEmpleado, { useEmpleadoElegido } from "./CampoEmpleado";

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
  nacionalidad: z.string().optional(),
  identidad: z.string().optional(),
  rtn: z.string().optional(),
  ihssNro: z.string().optional(),
  rapNro: z.string().optional(),
  telefonoPersonal: z.string().optional(),
  telefonoEmergencia: z.string().optional(),
  contactoEmergencia: z.string().optional(),
  direccion: z.string().optional(),
  fechaIngreso: z.string().min(1, OBLIGATORIO),
  fechaSalida: z.string().optional(),
  estado: z.enum(["ACTIVO", "INACTIVO", "SUSPENDIDO", "VACACIONES", "PERMISO"]),
  tipoContrato: z.enum(["INDEFINIDO", "TEMPORAL", "PRUEBA", "SERVICIO"], { error: ELEGIR }),
  salarioBase: z.number({ error: "Indique el salario." }).positive("El salario debe ser mayor que cero."),
  motivo: z.string().optional(),
  tipoPlanilla: z.enum(["SEMANAL", "QUINCENAL", "MENSUAL"], { error: ELEGIR }),
  cuentaBancaria: z.string().optional(),
  banco: z.string().optional(),
  sucursalId: z.string().min(1, OBLIGATORIO),
  departamentoId: z.string().min(1, OBLIGATORIO),
  puestoId: z.string().optional(),
  supervisorId: z.string().optional(),
  centroCostoId: z.string().optional(),
  emailCorporativo: z.string().optional(),
  extension: z.string().optional(),
  emailPersonal: z.union([z.literal(""), z.string().trim().email("Escriba un correo válido.")]).optional(),
  // Vacío = IHSS por porcentaje. Texto: el servidor lo valida y lo convierte. Se
  // acepta la coma decimal («297,58»): ver `montoComoTexto`.
  ihssMontoFijo: z.string().transform(montoComoTexto)
    .pipe(z.union([z.literal(""), z.string().regex(/^\d+(\.\d{1,2})?$/, "Escriba un monto, como 595.16.")])).optional(),
  // ¿Cotiza al IHSS / RAP en esta ficha? Sólo el administrador los cambia.
  aplicaIhss: z.boolean().optional(),
  aplicaRap: z.boolean().optional(),
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
  /** Vacío si el administrador no habilitó el nivel División. */
  divisiones: Array<{ id: string; nombre: string; sucursalId: string }>;
  /** «Grupo»/«Sucursal» con la jerarquía de nómina; «Sucursal»/«División» sin ella. */
  niveles?: NivelesEstructura;
  departamentos: Array<{ id: string; nombre: string; sucursalId: string; divisionId: string | null }>;
  puestos: Array<{ id: string; nombre: string; departamentoId: string; activo: boolean }>;
  centrosCosto: Array<{ id: string; codigo: string; nombre: string }>;
  /** Con uno vigente, el tipo cambia registrando un contrato nuevo, no aquí. */
  tieneContratoVigente: boolean;
  /** Apagar el IHSS o el RAP de la ficha: sólo con el permiso de los parámetros de ley. */
  puedeCambiarAportes: boolean;
  /** El expediente, con los filtros de la lista: a donde se vuelve al guardar o cancelar. */
  volverA: string;
  /** Flechas ‹ › al anterior y al siguiente de la lista; null si no hay lista que recorrer. */
  navegacion: { anterior: DestinoFlecha | null; siguiente: DestinoFlecha | null; posicion: number; total: number } | null;
  /** Marca de la foto actual (updatedAt en ms); null = sin foto. */
  fotoVersion?: number | null;
  /** Con `empleados.crear`: «Guardar y registrar otro» lleva al alta tras guardar (pedido de Edbin, 2026-11-18). */
  puedeCrear?: boolean;
}

const TIPOS_CONTRATO: Record<FormData["tipoContrato"], string> = {
  INDEFINIDO: "Indefinido",
  TEMPORAL: "Temporal",
  PRUEBA: "Período de prueba",
  SERVICIO: "Servicios",
};

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
 * A diferencia del alta, aquí sólo se envían los campos que CAMBIARON respecto de lo
 * que se cargó (`cambio` en `onSubmit`): `PUT /api/empleados/[id]` aplica una actualización parcial
 * sobre un allowlist, y mandar el formulario entero reescribiría columnas que
 * nadie modificó — incluidas las que otro usuario pudo cambiar mientras esta
 * pantalla estaba abierta.
 */
export default function EditarEmpleadoForm({
  empleado,
  sucursales,
  divisiones,
  departamentos,
  puestos,
  centrosCosto,
  tieneContratoVigente,
  puedeCambiarAportes,
  volverA,
  niveles = etiquetasNiveles(false),
  navegacion,
  fotoVersion = null,
  puedeCrear = false,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorApi, setErrorApi] = useState<string | null>(null);
  const [tab, setTab] = useState<PestanaFicha>("personal");
  const { avisar } = useAvisos();

  const { id, ...valoresIniciales } = empleado;
  // La división no se guarda en el empleado (sale de su departamento): sólo
  // acota la lista de departamentos. Arranca en la de su departamento actual.
  const [divisionId, setDivisionId] = useState(
    () => departamentos.find((d) => d.id === valoresIniciales.departamentoId)?.divisionId ?? ""
  );

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    setFocus,
    formState: { errors, dirtyFields },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: valoresIniciales,
  });
  const porPestana = erroresPorPestana(errors);

  // El primer error puede estar en la otra pestaña, que no está dibujada: se abre y luego se enfoca.
  function alFallar(e: FieldErrors<FormData>) {
    const primero = primerError(e);
    if (!primero) return;
    setTab(primero.pestana);
    setTimeout(() => setFocus(primero.campo as keyof FormData), 0);
  }

  // `useWatch` en vez de `watch()` por la misma razón que en el alta: `watch`
  // devuelve una función que el React Compiler no puede memoizar.
  const sucursalId = useWatch({ control, name: "sucursalId" });
  const departamentoId = useWatch({ control, name: "departamentoId" });
  const salarioBase = useWatch({ control, name: "salarioBase" });
  const estado = useWatch({ control, name: "estado" });
  // Supervisor con el buscador (activos de toda la empresa, menos este empleado), en vez de
  // un <select> con todos. El campo del formulario sigue siendo el id: es lo que compara
  // `cambio()` y lo que viaja. Aquí vive también el elegido, para que no se pierda al
  // cambiar de pestaña (la de datos laborales se desmonta).
  const supervisorId = useWatch({ control, name: "supervisorId" });
  const [supervisor, setSupervisor] = useEmpleadoElegido("supervisor", valoresIniciales.supervisorId);
  const divisionesSucursal = divisiones.filter((v) => v.sucursalId === sucursalId);
  const deptsFiltrados = departamentos.filter((d) =>
    (!sucursalId || d.sucursalId === sucursalId) && (!divisionId || d.divisionId === divisionId)
  );
  const nombreDivision = (did: string | null) => divisiones.find((v) => v.id === did)?.nombre;
  const puestosFiltrados = puestos.filter((p) => p.departamentoId === departamentoId);
  // Al cambiar un nivel, los de abajo dejan de valer. `shouldDirty` hace que el
  // puesto vacío viaje como `null` en vez de conservar uno de otro departamento.
  const limpiarDesdeDepartamento = () => {
    setValue("departamentoId", "", { shouldDirty: true });
    setValue("puestoId", "", { shouldDirty: true });
  };
  const salarioCambio = Number(salarioBase) !== Number(valoresIniciales.salarioBase);

  async function onSubmit(data: FormData, evento?: React.BaseSyntheticEvent) {
    // Qué botón se pulsó: «Guardar y registrar otro» abre el alta en vez de volver a la ficha.
    const registrarOtro = !!(evento?.nativeEvent as SubmitEvent | undefined)?.submitter?.hasAttribute("data-registrar-otro");
    const destino = registrarOtro ? "/empleados/nuevo" : volverA;
    // Qué cambió: cada valor contra el que se cargó. El registro de campos «tocados» del
    // formulario no siempre se enteraba: el departamento cambiado a un empleado sin puesto
    // no viajaba y la ficha volvía como guardada, sin el cambio (Edbin, 2026-11-23).
    const cambio = (clave: keyof FormData) => {
      const a = data[clave];
      const b = valoresIniciales[clave];
      return typeof a === "boolean" || typeof b === "boolean" ? a !== b : String(a ?? "") !== String(b ?? "");
    };

    // Sólo al dar de baja: un registro antiguo sin fecha debe poder seguir
    // corrigiéndose. El API comprueba lo mismo.
    if (data.estado === "INACTIVO" && !data.fechaSalida && (cambio("estado") || cambio("fechaSalida"))) {
      setError("fechaSalida", { message: "Indique la fecha de salida: sin ella no se le pagarían los días trabajados del último período." });
      setTab("laboral");
      setTimeout(() => setFocus("fechaSalida"), 0);
      return;
    }

    // Sólo los campos que cambiaron. El API responde 400 "Sin cambios" con un body
    // vacío, así que ese caso se resuelve aquí sin ir al servidor.
    const cambios: Record<string, unknown> = {};
    for (const clave of Object.keys(data) as Array<keyof FormData>) {
      if (clave === "motivo" || !cambio(clave)) continue; // el motivo no es columna; se añade abajo
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
      router.push(destino);
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
      avisar.exito(registrarOtro ? "Cambios guardados. Ya puede registrar al nuevo empleado." : "Cambios guardados.");
      router.push(destino);
      router.refresh();
    } catch {
      setErrorApi("No se pudo conectar con el servidor. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form method="post" onSubmit={handleSubmit(onSubmit, alFallar)} className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PestanasFicha tab={tab} onCambiar={setTab} errores={porPestana} />
        {navegacion && <FlechasEmpleado {...navegacion} hayCambios={Object.keys(dirtyFields).length > 0} />}
      </div>
      <ResumenErrores errores={porPestana} />

      {errorApi && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorApi}
        </div>
      )}

      {/* Personal */}
      {tab === "personal" && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
          <div className="border-b border-gray-100 pb-4">
            <p className="mb-2 text-sm font-medium text-gray-800">Foto</p>
            <EditorFotoEmpleado empleadoId={empleado.id} version={fotoVersion} nombre={`${empleado.primerNombre} ${empleado.primerApellido}`} />
            <p className="mt-2 text-xs text-gray-500">La foto se guarda al momento, sin esperar a «Guardar cambios».</p>
          </div>
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
            <Field label="Nacionalidad" error={errors.nacionalidad?.message}>
              <input {...register("nacionalidad")} className={fieldClass} />
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
            <Field label="Fecha de ingreso *" error={errors.fechaIngreso?.message}>
              <input {...register("fechaIngreso")} type="date" className={fieldClass} />
            </Field>
            <Field
              label="Estado *"
              error={errors.estado?.message}
              hint="Vacaciones y Permiso siguen cobrando. Suspendido e Inactivo no entran en planilla."
            >
              <select
                {...register("estado", {
                  // Al reincorporarlo, la salida anterior ya no vale.
                  onChange: (e) => {
                    if (valoresIniciales.estado === "INACTIVO" && e.target.value !== "INACTIVO") {
                      setValue("fechaSalida", "", { shouldDirty: true });
                    }
                  },
                })}
                className={fieldClass}
              >
                <option value="ACTIVO">Activo</option>
                <option value="VACACIONES">Vacaciones</option>
                <option value="PERMISO">Permiso</option>
                <option value="SUSPENDIDO">Suspendido</option>
                <option value="INACTIVO">Inactivo</option>
              </select>
            </Field>
            <Field
              label="Tipo de contrato *"
              error={errors.tipoContrato?.message}
              hint={tieneContratoVigente ? "Para cambiarlo, registre un contrato nuevo en la pestaña Contrato laboral del expediente." : undefined}
            >
              {tieneContratoVigente ? (
                <>
                  <input type="hidden" {...register("tipoContrato")} />
                  <input
                    readOnly
                    aria-label="Tipo de contrato"
                    value={TIPOS_CONTRATO[valoresIniciales.tipoContrato]}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 bg-gray-50"
                  />
                </>
              ) : (
                <select {...register("tipoContrato")} className={fieldClass}>
                  {Object.entries(TIPOS_CONTRATO).map(([valor, etiqueta]) => (
                    <option key={valor} value={valor}>{etiqueta}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={estado === "INACTIVO" ? "Fecha de Salida *" : "Fecha de Salida"} error={errors.fechaSalida?.message}>
              <input {...register("fechaSalida")} type="date" className={fieldClass} />
            </Field>
            <Field label="Salario base (L) *" error={errors.salarioBase?.message}>
              <input
                {...register("salarioBase", { valueAsNumber: true })}
                type="number"
                step="0.01"
                className={fieldClass}
              />
            </Field>
            <Field
              label="IHSS fijo mensual (L)"
              error={errors.ihssMontoFijo?.message}
              hint="Reemplaza el IHSS calculado (EM + IVM) del trabajador. Es mensual: en planilla quincenal se descuenta como diga Parámetros de ley (la mitad en cada quincena o completo en una). El aporte patronal sigue por porcentaje."
            >
              <input
                {...register("ihssMontoFijo")}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className={fieldClass}
                placeholder="Vacío = cálculo por porcentaje"
              />
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
                Apáguelo sólo si la persona ya cotiza en otra ficha (otra nómina), para no deducirle de más en el mes: esta ficha deja de
                calcular ese aporte, lo del trabajador y lo patronal. INFOP y Reserva Laboral no cambian.
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
            <Field label={`${niveles.sucursal} *`} error={errors.sucursalId?.message}>
              <select
                {...register("sucursalId", { onChange: () => { setDivisionId(""); limpiarDesdeDepartamento(); } })}
                className={fieldClass}
              >
                <option value="">Seleccione…</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </Field>
            {divisiones.length > 0 && (
              <Field label={niveles.division}>
                <select
                  value={divisionId}
                  disabled={!sucursalId || divisionesSucursal.length === 0}
                  onChange={(e) => { setDivisionId(e.target.value); limpiarDesdeDepartamento(); }}
                  className={fieldClass}
                >
                  <option value="">{sucursalId && divisionesSucursal.length === 0 ? niveles.sinDivisiones : niveles.todasDivisiones}</option>
                  {divisionesSucursal.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
                </select>
              </Field>
            )}
            <Field label="Departamento *" error={errors.departamentoId?.message}>
              <select {...register("departamentoId", { onChange: () => setValue("puestoId", "", { shouldDirty: true }) })} className={fieldClass}>
                <option value="">Seleccione…</option>
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
                  <option key={p.id} value={p.id}>{p.nombre}{p.activo ? "" : " (inactivo)"}</option>
                ))}
              </select>
            </Field>
            {/* Sin `Field`: envuelve en un <label>, y el buscador tiene botones y una lista. */}
            <CampoEmpleado
              etiqueta="Supervisor"
              para="supervisor"
              parametros={{ excluir: id }}
              valor={supervisor}
              onCambio={(e) => {
                setSupervisor(e);
                // «Quitar» deja el id vacío: `CAMPOS_ANULABLES` lo envía como null (sin supervisor).
                setValue("supervisorId", e?.id ?? "", { shouldDirty: true });
              }}
              ayuda={
                errors.supervisorId?.message ? (
                  <p className="text-xs text-red-700 mt-0.5">{errors.supervisorId.message}</p>
                ) : !supervisorId ? (
                  <p className="mt-1 text-xs text-gray-500" data-sin-supervisor>Sin supervisor.</p>
                ) : !supervisor ? (
                  // El id ya está en el formulario; sólo faltan sus datos para mostrarlo.
                  <p className="mt-1 text-xs text-gray-500">Cargando el supervisor actual…</p>
                ) : null
              }
            />
            <Field
              label="Centro de costo"
              error={errors.centroCostoId?.message}
              hint="Vacío = hereda el de su departamento."
            >
              <select {...register("centroCostoId")} className={fieldClass}>
                <option value="">Heredar del departamento</option>
                {centrosCosto.map((c) => (
                  <option key={c.id} value={c.id}>{c.codigo}, {c.nombre}</option>
                ))}
              </select>
            </Field>
            <Field label="Correo corporativo" error={errors.emailCorporativo?.message}>
              <input {...register("emailCorporativo")} className={fieldClass} placeholder="nombre@empresa.hn" />
            </Field>
            <Field label="Extensión" error={errors.extension?.message}>
              <input {...register("extension")} className={fieldClass} placeholder="1042" />
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
                href={volverA}
                className="px-5 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </Link>
              {puedeCrear && (
                <button
                  type="submit"
                  disabled={loading}
                  data-registrar-otro
                  className="px-5 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-60"
                >
                  Guardar y registrar otro
                </button>
              )}
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 disabled:bg-blue-400"
              >
                {loading ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
