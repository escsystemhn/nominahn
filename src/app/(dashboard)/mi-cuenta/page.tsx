import { requerirSesionPagina } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { expandir, definicion } from "@/lib/auth/permisos";
import { ETIQUETAS_ALCANCE } from "@/lib/auth/alcance";
import CambiarPassword from "@/components/seguridad/CambiarPassword";
import PageHeader from "@/components/ui/PageHeader";

/**
 * La cuenta de quien ha iniciado sesión: su contraseña y sus accesos.
 *
 * Vive fuera de `/mi-espacio` a propósito. Aquella pantalla exige un expediente
 * de empleado vinculado, y las cuentas puramente administrativas no lo tienen:
 * si el cambio de contraseña estuviera allí, precisamente las cuentas con más
 * permisos serían las únicas sin forma de cambiar su clave.
 */
export default async function MiCuentaPage() {
  const usuario = await requerirSesionPagina();

  const cuenta = await prisma.user.findUnique({
    where: { id: usuario.id },
    select: {
      name: true,
      email: true,
      debeCambiarPassword: true,
      passwordCambiadaAt: true,
      perfil: { select: { nombre: true, descripcion: true } },
      role: true,
    },
  });

  const permisos = expandir(usuario.permisos);
  const alcance = ETIQUETAS_ALCANCE[usuario.alcance ?? "TODO"];

  return (
    <div className="space-y-6">
      <PageHeader title="Mi cuenta" description={`${cuenta?.name ?? usuario.email}, ${cuenta?.email ?? ""}`} />

      {cuenta?.debeCambiarPassword && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-900">
          Está usando una contraseña temporal. Cámbiela ahora para que sólo usted la conozca.
        </div>
      )}

      <div className="grid max-w-4xl items-start gap-5 md:grid-cols-2">
        <CambiarPassword
          contexto={[cuenta?.email ?? "", cuenta?.name ?? ""]}
          obligatorio={cuenta?.debeCambiarPassword}
        />

        <div className="panel space-y-4 p-5">
          <div>
            <h2 className="font-semibold text-gray-900">Mis accesos</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Lo asigna Recursos Humanos. Si necesita algo más, solicítelo.
            </p>
          </div>

          <dl className="text-sm space-y-2">
            <div>
              <dt className="text-xs text-gray-500">Perfil</dt>
              <dd className="font-medium text-gray-900">
                {cuenta?.perfil?.nombre ?? `Sin perfil, permisos del rol ${cuenta?.role}`}
              </dd>
              {cuenta?.perfil?.descripcion && (
                <dd className="text-xs text-gray-500">{cuenta.perfil.descripcion}</dd>
              )}
            </div>
            <div>
              <dt className="text-xs text-gray-500">Alcance de datos</dt>
              <dd className="font-medium text-gray-900">{alcance.titulo}</dd>
              <dd className="text-xs text-gray-500">{alcance.detalle}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Contraseña cambiada</dt>
              <dd className="text-gray-700">
                {cuenta?.passwordCambiadaAt
                  ? new Intl.DateTimeFormat("es-HN", {
                      dateStyle: "long",
                      timeZone: "America/Tegucigalpa",
                    }).format(cuenta.passwordCambiadaAt)
                  : "Nunca desde que se creó la cuenta"}
              </dd>
            </div>
          </dl>

          <div>
            <p className="text-xs text-gray-500 mb-2">
              {permisos.length} permiso(s) concedido(s)
            </p>
            <ul tabIndex={0} aria-label="Permisos concedidos" className="max-h-64 list-disc space-y-1 overflow-y-auto pl-4 text-xs">
              {permisos.length === 0 && (
                <li className="text-gray-500">
                  Sin permisos de gestión. Su acceso se limita a su propio espacio.
                </li>
              )}
              {permisos.map((codigo) => (
                <li key={codigo} className="text-gray-700">
                  {definicion(codigo)?.etiqueta ?? codigo}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
