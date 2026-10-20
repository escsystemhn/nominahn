import Image from "next/image";
import Link from "next/link";
import { requerirSesionPagina, puede } from "@/lib/auth/guard";
import { estadoLicencia, hayServidorDeLicencias } from "@/lib/licencia/estado";
import { fechaLarga, fechaConAnio, textoAviso, ultimoDiaValido, DIAS_EVALUACION } from "@/lib/licencia/evaluacion";
import ActivarLicencia from "@/components/licencia/ActivarLicencia";

export const dynamic = "force-dynamic";

/**
 * Licencia de la edición instalable.
 *
 * Fuera del grupo (dashboard) a propósito: con la licencia bloqueada, ese layout
 * no debe dibujarse (su menú sólo ofrecería enlaces que rebotan aquí). Es la
 * única pantalla, junto con el login y Mi cuenta, que sigue abierta al vencer.
 */
export default async function LicenciaPage() {
  const usuario = await requerirSesionPagina();
  const estado = await estadoLicencia();
  const puedeActivar = puede(usuario, "configuracion.editar");

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <span className="inline-flex rounded-xl bg-white p-2 shadow-sm">
          <Image src="/gestion360-logo.png" alt="Gestión360" width={820} height={561} className="h-auto w-32" priority />
        </span>
        <h1 className="mt-5 text-2xl font-semibold text-gray-900">Licencia</h1>

        <section className="panel mt-4 p-6">
          {estado.modo === "libre" && (
            <p className="text-sm text-gray-700">Esta edición de Gestión360 no requiere licencia.</p>
          )}

          {estado.modo === "indeterminado" && (
            <p className="text-sm text-gray-700">
              No se pudo consultar la base de datos para conocer el estado de la licencia. Intente de nuevo en un momento.
            </p>
          )}

          {estado.modo === "evaluacion" && (
            <div className="text-sm text-gray-700">
              <p className="text-base font-semibold text-gray-900">
                Versión de evaluación · día {estado.evaluacion.dia} de {DIAS_EVALUACION}
              </p>
              <p className="mt-1">
                {estado.evaluacion.mostrarAviso
                  ? textoAviso(estado.evaluacion)
                  : `El último día de la evaluación es ${fechaLarga(estado.evaluacion.ultimoDia)}.`}
              </p>
              <p className="mt-1 text-gray-500">
                Al terminar, el sistema se detiene hasta activar una licencia. Todo lo que haya registrado se conserva.
              </p>
            </div>
          )}

          {estado.modo === "licenciada" && (
            <div className="text-sm text-gray-700">
              <p className="text-base font-semibold text-emerald-800">Licencia activa</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
                <dt className="text-gray-500">Titular</dt>
                <dd className="font-medium text-gray-900">{estado.licencia.cliente}</dd>
                {estado.licencia.edicion && (
                  <>
                    <dt className="text-gray-500">Edición</dt>
                    <dd>{estado.licencia.edicion}</dd>
                  </>
                )}
                <dt className="text-gray-500">Vigencia</dt>
                <dd>
                  {estado.licencia.venceEn ? `hasta el ${ultimoDiaValido(estado.licencia.venceEn)}, inclusive` : "perpetua"}
                </dd>
                <dt className="text-gray-500">Código de equipo</dt>
                <dd className="font-mono">{estado.codigoEquipo}</dd>
              </dl>
              {estado.licencia.refrescarAntes && (
                <p className="mt-3 text-xs text-gray-500">
                  El servidor confirma la licencia en línea con ESC System; debe tener salida a internet al menos una vez
                  antes del {fechaConAnio(estado.licencia.refrescarAntes)}.
                </p>
              )}
            </div>
          )}

          {estado.modo === "bloqueada" && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <p className="font-semibold">El sistema está detenido.</p>
              <p className="mt-1">{estado.mensaje}</p>
            </div>
          )}

          {(estado.modo === "evaluacion" || estado.modo === "bloqueada") && (
            <div className="mt-6 border-t border-gray-100 pt-6">
              {puedeActivar ? (
                <ActivarLicencia enLinea={hayServidorDeLicencias()} codigoEquipo={estado.codigoEquipo} />
              ) : (
                <p className="text-sm text-gray-600">
                  Pida a un administrador del sistema que active la licencia. Código de este equipo:{" "}
                  <span className="font-mono text-gray-900">{estado.codigoEquipo ?? "no disponible"}</span>
                </p>
              )}
            </div>
          )}
        </section>

        <section className="mt-4 text-sm text-gray-600">
          <p>
            Para adquirir una licencia: <strong className="text-gray-800">ESC System Consultorías</strong> ·
            +504 9891-3809 (teléfono y WhatsApp) ·{" "}
            <a href="mailto:info@esc-systemhn.com" className="underline underline-offset-2">
              info@esc-systemhn.com
            </a>
          </p>
          <p className="mt-3 flex gap-4">
            {estado.modo !== "bloqueada" && (
              <Link href="/dashboard" className="font-medium text-blue-800 underline underline-offset-2">
                Volver al sistema
              </Link>
            )}
            <Link href="/mi-cuenta" className="text-gray-600 underline underline-offset-2">
              Mi cuenta
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
