/**
 * Construcción del organigrama: consulta, alcance, PII, contexto y árbol.
 *
 * POR QUÉ VIVE AQUÍ Y NO EN LA RUTA API. La página del panel llegó a pedirle el
 * árbol a `/api/organigrama` con un `fetch` a su propio servidor. Funciona, pero
 * paga un viaje de red para hablar consigo mismo, depende de que la cabecera
 * `host` resuelva internamente —lo que no siempre ocurre detrás de un proxy o
 * dentro de un contenedor— y obliga a reenviar la cookie a mano. Y sobre todo:
 * cualquier fallo llegaba a la página como un `res.ok === false` sin causa, de
 * modo que un error de Prisma perfectamente legible se convertía en «no se pudo
 * cargar, vuelva a intentarlo».
 *
 * Con la lógica aquí, la página la llama como una función y la ruta API es una
 * envoltura fina. Una sola implementación, un solo sitio donde vive el alcance
 * de datos, y los errores suben con su mensaje.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { puede, type Usuario } from "@/lib/auth/guard";
import { filtroEmpleados, alcanceEsTotal } from "@/lib/auth/alcance";
import { construirArbol, ordenarArbol, ancestrosDeContexto, type NodoArbol } from "./jerarquia";
import { nombreCompleto } from "@/lib/utils";

/** Columnas que necesita un nodo. Nunca el registro entero. */
const CAMPOS = {
  id: true,
  codigo: true,
  primerNombre: true,
  segundoNombre: true,
  primerApellido: true,
  segundoApellido: true,
  fotoPerfil: true,
  estado: true,
  supervisorId: true,
  emailCorporativo: true,
  extension: true,
  salarioBase: true,
  fechaIngreso: true,
  puesto: { select: { id: true, nombre: true } },
  departamento: { select: { id: true, nombre: true } },
  sucursal: { select: { id: true, nombre: true, codigo: true } },
  centroCosto: { select: { id: true, codigo: true, nombre: true } },
} as const;

type EmpleadoCrudo = Prisma.EmpleadoGetPayload<{ select: typeof CAMPOS }>;

export interface NodoOrganigrama {
  id: string;
  codigo: string;
  nombre: string;
  supervisorId: string | null;
  puesto: string | null;
  departamento: string | null;
  departamentoId: string | null;
  sucursal: string | null;
  centroCosto: string | null;
  fotoPerfil: string | null;
  estado: string;
  emailCorporativo: string | null;
  extension: string | null;
  /** Sólo con permiso de datos personales. */
  salarioBase?: string;
  antiguedadAnios?: number;
  /** Fuera del alcance de datos: se dibuja para no romper la rama, sin detalle. */
  contexto?: boolean;
}

export interface Organigrama {
  raices: NodoArbol<NodoOrganigrama>[];
  /**
   * Empleados que forman parte de un ciclo. No se cuelgan de ningún sitio porque
   * un ciclo no tiene raíz; la pantalla los muestra aparte para que alguien los
   * arregle. Con la validación actual ya no se pueden crear, pero una base
   * anterior puede traerlos.
   */
  enCiclo: string[];
  huerfanos: string[];
  totales: { empleados: number; sinJefe: number; conContexto: number };
  vacantesPorDepartamento: Record<string, number>;
  puedeReasignar: boolean;
  vePII: boolean;
}

export interface OpcionesOrganigrama {
  sucursalId?: string;
  incluirInactivos?: boolean;
}

export async function construirOrganigrama(
  usuario: Usuario,
  opciones: OpcionesOrganigrama = {}
): Promise<Organigrama> {
  const { sucursalId, incluirInactivos = false } = opciones;
  const vePII = puede(usuario, "empleados.pii");

  const estadoFiltro: Prisma.EmpleadoWhereInput = incluirInactivos
    ? {}
    : { estado: { not: "INACTIVO" } };

  // ─── Qué empleados alcanza quien mira ──────────────────────────────────────
  const alcance = filtroEmpleados(usuario);
  const visibles = await prisma.empleado.findMany({
    where: { AND: [estadoFiltro, alcance, sucursalId ? { sucursalId } : {}] },
    select: CAMPOS,
  });

  /**
   * ANCESTROS DE CONTEXTO. Con alcance de sucursal o departamento se puede
   * alcanzar a un subordinado pero no a su jefe, y la rama queda colgando como
   * si el organigrama estuviera corrupto. Se traen esos jefes con el detalle
   * recortado: se ve de quién cuelga la rama, pero el alcance sigue mandando
   * sobre los datos.
   *
   * Con alcance total y sin filtro no hay nada que completar, y la consulta se
   * ahorra.
   */
  let contexto: EmpleadoCrudo[] = [];
  const idsContexto = new Set<string>();

  if (!alcanceEsTotal(usuario) || sucursalId) {
    // Se necesita la jerarquía COMPLETA para subir; sólo dos columnas.
    const plantilla = await prisma.empleado.findMany({
      select: { id: true, supervisorId: true },
    });
    const padreDe = new Map(plantilla.map((e) => [e.id, e.supervisorId]));
    const faltantes = ancestrosDeContexto(padreDe, new Set(visibles.map((e) => e.id)));

    if (faltantes.size > 0) {
      contexto = await prisma.empleado.findMany({
        where: { id: { in: [...faltantes] } },
        select: CAMPOS,
      });
      for (const c of contexto) idsContexto.add(c.id);
    }
  }

  // ─── Nodos ────────────────────────────────────────────────────────────────
  const aNodo = (e: EmpleadoCrudo): NodoOrganigrama => {
    const esContexto = idsContexto.has(e.id);
    return {
      id: e.id,
      codigo: e.codigo,
      nombre: nombreCompleto(e),
      supervisorId: e.supervisorId,
      puesto: e.puesto?.nombre ?? null,
      departamento: e.departamento?.nombre ?? null,
      departamentoId: e.departamento?.id ?? null,
      sucursal: e.sucursal?.nombre ?? null,
      centroCosto: e.centroCosto ? `${e.centroCosto.codigo} · ${e.centroCosto.nombre}` : null,
      fotoPerfil: e.fotoPerfil,
      estado: e.estado,
      // Un nodo de contexto no entrega datos de contacto: está fuera del alcance.
      emailCorporativo: esContexto ? null : e.emailCorporativo,
      extension: esContexto ? null : e.extension,
      ...(vePII && !esContexto
        ? {
            salarioBase: e.salarioBase.toFixed(2),
            antiguedadAnios: Math.floor(
              (Date.now() - e.fechaIngreso.getTime()) / (365.25 * 24 * 3600 * 1000)
            ),
          }
        : {}),
      ...(esContexto ? { contexto: true } : {}),
    };
  };

  const nodos = [...visibles, ...contexto].map(aNodo);
  const arbol = construirArbol(nodos, { contexto: idsContexto });
  ordenarArbol(arbol.raices, (a, b) => a.nombre.localeCompare(b.nombre, "es"));

  // ─── Vacantes abiertas, por departamento ──────────────────────────────────
  // El modelo `Vacante` ya cuelga del departamento, así que sale casi gratis. Es
  // la diferencia entre ver la plantilla que hay y la que se está construyendo.
  const vacantes = await prisma.vacante.groupBy({
    by: ["departamentoId"],
    where: { estado: "ABIERTA" },
    _sum: { plazas: true },
  });

  return {
    raices: arbol.raices,
    enCiclo: arbol.enCiclo,
    huerfanos: arbol.huerfanos,
    totales: {
      empleados: visibles.length,
      sinJefe: visibles.filter((e) => !e.supervisorId).length,
      conContexto: contexto.length,
    },
    vacantesPorDepartamento: Object.fromEntries(
      vacantes.filter((v) => v.departamentoId).map((v) => [v.departamentoId!, v._sum.plazas ?? 0])
    ),
    puedeReasignar: puede(usuario, "organizacion.reasignar"),
    vePII,
  };
}
