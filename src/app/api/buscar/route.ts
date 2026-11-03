import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puede, requerirSesion } from "@/lib/auth/guard";
import { conAlcance } from "@/lib/auth/alcance";
import { filtroBusquedaEmpleados } from "@/lib/empleados/busqueda";
import { coincide, palabrasDeBusqueda } from "@/lib/texto-busqueda";
import { formatDate, nombreCompleto } from "@/lib/utils";
import { etiquetaEstado } from "@/components/ui/EstadoBadge";

const POR_GRUPO = 6;
/** Las planillas se filtran aquí mismo: bastan las más recientes, no toda la historia. */
const PLANILLAS_A_REVISAR = 200;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * El buscador de la barra superior. Cada grupo responde a su propio permiso, y los
 * empleados además al alcance de la cuenta: buscar no debe enseñar nada que la persona
 * no vería entrando por el menú.
 */
export async function GET(req: NextRequest) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const q = new URL(req.url).searchParams.get("q")?.slice(0, 100) ?? "";
  const palabras = palabrasDeBusqueda(q);
  if (palabras.join("").length < 2) return NextResponse.json({ empleados: [], planillas: [] });

  const vePII = puede(g.usuario, "empleados.pii");
  const empleados = puede(g.usuario, "empleados.ver")
    ? await prisma.empleado.findMany({
        where: conAlcance(await filtroBusquedaEmpleados(prisma, q, { conIdentidad: vePII }), g.usuario),
        select: {
          id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
          estado: true, sucursal: { select: { nombre: true } },
        },
        orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
        take: POR_GRUPO,
      })
    : [];

  const planillas = puede(g.usuario, "planillas.ver")
    ? (
        await prisma.planilla.findMany({
          select: { id: true, tipo: true, estado: true, fechaInicio: true, fechaFin: true },
          orderBy: { fechaFin: "desc" },
          take: PLANILLAS_A_REVISAR,
        })
      )
        .filter((p) => {
          // También por el nombre del mes y el año, que es como se recuerda una planilla.
          const texto = `planilla ${etiquetaEstado(p.tipo)} ${etiquetaEstado(p.estado)} ${formatDate(p.fechaInicio)} ${formatDate(p.fechaFin)} ${MESES[p.fechaFin.getUTCMonth()]} ${p.fechaFin.getUTCFullYear()}`;
          return coincide(texto, palabras);
        })
        .slice(0, POR_GRUPO)
        .map((p) => ({
          id: p.id,
          titulo: `Planilla ${etiquetaEstado(p.tipo).toLowerCase()}`,
          detalle: `Del ${formatDate(p.fechaInicio)} al ${formatDate(p.fechaFin)}, ${etiquetaEstado(p.estado).toLowerCase()}`,
          href: `/planillas/${p.id}`,
        }))
    : [];

  return NextResponse.json({
    empleados: empleados.map((e) => ({
      id: e.id,
      titulo: nombreCompleto(e),
      detalle: `${e.codigo}, ${e.sucursal.nombre}${e.estado === "INACTIVO" ? ", inactivo" : ""}`,
      // La ficha exige ver datos personales: quien no puede, llega a su lista.
      href: vePII ? `/empleados/${e.id}` : `/empleados?search=${encodeURIComponent(e.codigo)}`,
    })),
    planillas,
  });
}
