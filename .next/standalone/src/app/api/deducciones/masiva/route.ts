/**
 * Asignar un tipo de deducción a varios empleados a la vez, con un monto igual para
 * todos o uno por persona. Todo o nada: una sola transacción. Quien ya tiene el tipo
 * se salta o se actualiza según `siYaLaTiene` (ver `lib/payroll/asignacion-masiva.ts`).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { CODIGO_ISR_FIJO, esMontoDelPeriodo } from "@/lib/payroll/deducciones";
import { ESTADOS_QUE_COBRAN } from "@/lib/payroll/elegibles";
import { decidirAsignacion, opcionesSiYaLaTiene } from "@/lib/payroll/asignacion-masiva";
import { esFechaIso } from "@/lib/payroll/periodos-planilla";
import { leerMonto } from "@/lib/formato/monto-texto";
import { fechaCalendario, hoyHN, nombreCompleto } from "@/lib/utils";

const MAX_EMPLEADOS = 2_000;
const MONTO_MAXIMO = 5_000_000;

const schema = z.object({
  tipoDeduccionId: zId,
  forma: z.enum(["UNA_VEZ", "CUOTAS", "SIEMPRE"]),
  cuotasMeses: z.number().int().min(1).max(600).optional(),
  fechaInicio: z.string().refine(esFechaIso, "fecha inválida"),
  observacion: z.string().trim().max(500).optional(),
  siYaLaTiene: z.enum(["SALTAR", "ACTUALIZAR", "AGREGAR"]),
  filas: z.array(z.object({ empleadoId: zId, monto: z.string() })).min(1, "Marque al menos un empleado.").max(MAX_EMPLEADOS),
});

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("deducciones.asignar");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { tipoDeduccionId, forma, cuotasMeses, fechaInicio, observacion, siYaLaTiene, filas } = parsed.data;

  if (forma === "CUOTAS" && !cuotasMeses) return NextResponse.json({ error: "Indique en cuántas cuotas." }, { status: 400 });
  if (!opcionesSiYaLaTiene(forma).includes(siYaLaTiene)) return NextResponse.json({ error: "Esa opción no aplica a esta forma de cobro." }, { status: 400 });

  const tipo = await prisma.tipoDeduccionConfig.findUnique({ where: { id: tipoDeduccionId }, select: { id: true, nombre: true, codigo: true, activo: true, esLegal: true } });
  if (!tipo) return NextResponse.json({ error: "El tipo de deducción no existe." }, { status: 404 });
  if (!tipo.activo) return NextResponse.json({ error: `El tipo «${tipo.nombre}» está desactivado.` }, { status: 400 });
  if (tipo.esLegal) return NextResponse.json({ error: `«${tipo.nombre}» es de ley: la calcula la planilla y no se asigna por empleado.` }, { status: 400 });
  if (tipo.codigo === CODIGO_ISR_FIJO && forma !== "SIEMPRE") {
    return NextResponse.json({ error: "La retención fija de ISR se cobra en cada planilla." }, { status: 400 });
  }

  // Montos: los mismos que acepta la pantalla (coma o punto, hasta 2 decimales).
  const montos = new Map<string, string>();
  for (const f of filas) {
    if (montos.has(f.empleadoId)) return NextResponse.json({ error: "Un empleado viene dos veces." }, { status: 400 });
    const m = leerMonto(f.monto, { decimales: 2 });
    if (!m.ok || m.valor === null || m.valor <= 0 || m.valor > MONTO_MAXIMO) {
      return NextResponse.json({ error: `Monto inválido: «${f.monto}». Escriba un monto mayor que cero, como 1000.00.` }, { status: 400 });
    }
    montos.set(f.empleadoId, m.valor.toFixed(2));
  }

  const empleados = await prisma.empleado.findMany({
    where: { id: { in: [...montos.keys()] } },
    select: {
      id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
      sucursalId: true, departamentoId: true, estado: true,
      deducciones: {
        where: { tipoDeduccionId, activo: true, OR: [{ fechaFin: null }, { fechaFin: { gte: hoyHN() } }] },
        select: { id: true, monto: true, saldo: true, cuotasMeses: true, cuotasPagadas: true, fechaFin: true, observacion: true },
      },
    },
  });
  const cobran = new Set<string>(ESTADOS_QUE_COBRAN);
  // Fuera del alcance responde igual que si no existiera.
  const validos = empleados.filter((e) => alcanzaEmpleado(g.usuario, e) && cobran.has(e.estado));
  if (validos.length !== montos.size) {
    return NextResponse.json({ error: "Algún empleado marcado no existe, no está activo o está fuera de su alcance. Recargue la lista." }, { status: 400 });
  }

  const inicio = fechaCalendario(fechaInicio);
  const recurrente = forma === "SIEMPRE";
  const saltados: Array<{ codigo: string; nombre: string; motivo: string }> = [];
  const cambios: Array<{ empleadoId: string; deduccionId: string; accion: "CREAR" | "ACTUALIZAR"; monto: string; antes?: string }> = [];

  await prisma.$transaction(async (tx) => {
    for (const e of validos) {
      const monto = montos.get(e.id)!;
      const decision = decidirAsignacion(forma, siYaLaTiene, e.deducciones.filter((d) => !esMontoDelPeriodo(d)), monto);
      if (decision.accion === "SALTAR") {
        saltados.push({ codigo: e.codigo, nombre: nombreCompleto(e), motivo: decision.motivo });
      } else if (decision.accion === "ACTUALIZAR") {
        await tx.deduccionEmpleado.update({ where: { id: decision.id }, data: { monto } });
        cambios.push({ empleadoId: e.id, deduccionId: decision.id, accion: "ACTUALIZAR", monto, antes: decision.antes.toFixed(2) });
      } else {
        // Igual que la asignación de uno en uno: una vez = saldo igual al monto;
        // en cuotas = el monto es el total a repartir; cada planilla = sin saldo.
        const creada = await tx.deduccionEmpleado.create({
          data: {
            empleadoId: e.id, tipoDeduccionId, monto,
            saldo: recurrente ? null : monto,
            cuotasMeses: forma === "CUOTAS" ? cuotasMeses! : null,
            fechaInicio: inicio,
            observacion: observacion || null,
          },
          select: { id: true },
        });
        cambios.push({ empleadoId: e.id, deduccionId: creada.id, accion: "CREAR", monto });
      }
    }
  }, { timeout: 120_000, maxWait: 10_000 });

  const creadas = cambios.filter((c) => c.accion === "CREAR").length;
  const actualizadas = cambios.length - creadas;
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "DeduccionEmpleado",
    registroId: `masiva:${tipo.codigo}:${cambios.length}`,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { asignacionMasiva: true, tipo: tipo.codigo, forma, cuotasMeses, fechaInicio, observacion, siYaLaTiene, creadas, actualizadas, saltados: saltados.length, cambios },
    ip,
    userAgent,
  });

  return NextResponse.json({ creadas, actualizadas, saltados });
}
