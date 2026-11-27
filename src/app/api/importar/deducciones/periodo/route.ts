/**
 * Montos del período, fase 1: VALIDAR. No escribe nada.
 *
 * Recibe el archivo por empleado (una columna por tipo de deducción) y el período al
 * que se aplica, y devuelve qué celdas cambian contra lo que hay hoy: nuevos, que
 * cambian, que se quitan y sin cambio. Ver `lib/importacion/montos-periodo.ts`.
 *
 * El formato por grupo (2026-11-27) trae una hoja por tipo de planilla, cada una de su
 * período (`leerArchivoDeMontos`): cada hoja se valida contra el suyo y el período
 * elegido no se usa. Todo queda en un solo lote, que se aplica todo o nada.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { crearLote, leerArchivo } from "@/lib/importacion/lote";
import { ACEPTA_PLANTILLA, leerArchivoDeMontos } from "@/lib/importacion/xlsx";
import { cargarContexto, etiquetaTipo, sugerirTiposNuevos, validarMontos, type HojaMontos, type ResultadoMontos } from "@/lib/importacion/montos-periodo";
import {
  TIPOS_PLANILLA,
  errorDePeriodo,
  frasePeriodo,
  periodoDeNombreArchivo,
  rangoPeriodo,
  type PeriodoPlanilla,
  type TipoPlanillaPeriodo,
} from "@/lib/payroll/periodos-planilla";
import type { InformeValidacion } from "@/lib/importacion/tipos";

/** Lo validado de una hoja: la única del archivo de siempre, o una del libro por grupo. */
interface Parte {
  /** El nombre de la hoja en el libro por grupo; null en un archivo de una sola hoja. */
  hoja: string | null;
  periodo: PeriodoPlanilla;
  texto: string;
  r: ResultadoMontos;
}

/**
 * Las columnas desconocidas de todas las hojas como si fueran una sola: así una columna
 * vacía en una hoja y con montos en otra se propone crear igual.
 */
function hojaUnida(partes: readonly Parte[], desconocidas: readonly string[]): Pick<HojaMontos, "cabeceras" | "filas"> {
  const filas = partes.flatMap(({ r }) => {
    const cab = r.hoja?.cabeceras ?? [];
    const indices = desconocidas.map((d) => cab.indexOf(d));
    return (r.hoja?.filas ?? []).map((f) => ({ linea: f.linea, celdas: indices.map((i) => (i < 0 ? "" : f.celdas[i] ?? "")) }));
  });
  return { cabeceras: [...desconocidas], filas };
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("deducciones.importar");
  if (!g.ok) return g.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "La petición no trae un archivo válido." }, { status: 400 });
  }

  const tipo = String(form.get("tipoPlanilla") ?? "") as TipoPlanillaPeriodo;
  const desde = String(form.get("desde") ?? "");
  const hasta = String(form.get("hasta") ?? "");
  if (!TIPOS_PLANILLA.includes(tipo)) return NextResponse.json({ error: "Elija el tipo de planilla." }, { status: 400 });
  const errorPeriodo = errorDePeriodo({ desde, hasta });
  if (errorPeriodo) return NextResponse.json({ error: errorPeriodo }, { status: 400 });
  const periodo = { tipo, desde, hasta };

  const archivo = await leerArchivo(form, "archivo", ACEPTA_PLANTILLA);
  if (!archivo.ok) return NextResponse.json({ error: archivo.error }, { status: 400 });
  const lectura = await leerArchivoDeMontos(archivo.nombre, archivo.bytes);
  if (!lectura.ok) return NextResponse.json({ error: lectura.error }, { status: 400 });

  // Un archivo de siempre: una parte, del período elegido. El libro por grupo: una por hoja, cada una del suyo.
  const porGrupo = !!lectura.hojas;
  const aValidar = lectura.hojas
    ? lectura.hojas.map((h) => ({ hoja: h.nombre, periodo: h.periodo, texto: h.texto }))
    : [{ hoja: null, periodo, texto: lectura.texto }];
  const alcanza = (e: Parameters<typeof alcanzaEmpleado>[1]) => alcanzaEmpleado(g.usuario, e);
  const partes: Parte[] = [];
  let tiposExistentes: InformeValidacion["tiposExistentes"] = [];
  for (const p of aValidar) {
    const ctx = await cargarContexto(prisma, p.periodo);
    tiposExistentes = ctx.tipos.map((t) => ({ codigo: t.codigo, etiqueta: etiquetaTipo(t) }));
    partes.push({ ...p, r: validarMontos(p.texto, ctx, alcanza) });
  }
  const codigos = await prisma.tipoDeduccionConfig.findMany({ select: { codigo: true } });

  // Con varias hojas, cada incidencia y cada fila dice de qué hoja es: las líneas se repiten.
  const deHoja = <T extends object>(x: T, hoja: string | null): T => (hoja ? { ...x, hoja } : x);
  const incidencias = partes.flatMap(({ hoja, r }) => r.incidencias.map((i) => deHoja(i, hoja)));
  const filasVistas = partes.flatMap(({ hoja, r }) => r.previsualizacion.map((f) => deHoja(f, hoja)));
  const operaciones = partes.flatMap(({ periodo: p, r }) => r.operaciones.map((o) => ({ ...o, ...p })));
  const suma = (k: "nuevos" | "cambian" | "seQuitan" | "sinCambio" | "sinMontos" | "totalFilas") => partes.reduce((n, { r }) => n + r[k], 0);
  const desconocidas = [...new Set(partes.flatMap(({ r }) => r.columnasDesconocidas))];
  const columnasLeidas = [...new Map(partes.flatMap(({ r }) => r.columnasLeidas).map((c) => [c.cabecera, c])).values()];
  const tiposNuevos = sugerirTiposNuevos(
    porGrupo ? hojaUnida(partes, desconocidas) : partes[0].r.hoja ?? partes[0].texto,
    desconocidas,
    codigos.map((c) => c.codigo),
  );

  // La planilla hecha a mano: dónde estaban los encabezados, para que se vea qué se leyó.
  const h = porGrupo ? null : partes[0].r.hoja;
  const dondeCabecera = h && (h.lineaCabecera > 1 || h.dosFilas)
    ? `Los encabezados se leyeron en ${h.dosFilas ? `las filas ${h.lineaCabecera} y ${h.lineaCabecera + 1}` : `la fila ${h.lineaCabecera}`}; lo de arriba se ignora.`
    : "";

  // El archivo exportado lleva sus fechas en el nombre: si no coinciden con las elegidas, se avisa.
  const delNombre = porGrupo ? null : periodoDeNombreArchivo(archivo.nombre);
  if (delNombre && (delNombre.desde !== desde || delNombre.hasta !== hasta)) {
    incidencias.unshift({
      linea: 1,
      severidad: "AVISO",
      mensaje: `El archivo se exportó para el período ${rangoPeriodo(delNombre.desde, delNombre.hasta)}, pero eligió ${rangoPeriodo(desde, hasta)}. Los montos se aplicarán al período elegido.`,
    });
  }

  const nuevos = suma("nuevos");
  const cambian = suma("cambian");
  const seQuitan = suma("seQuitan");
  const sinCambio = suma("sinCambio");
  const sinMontos = suma("sinMontos");
  const totalErrores = incidencias.filter((i) => i.severidad === "ERROR").length;
  const aplicable = totalErrores === 0 && operaciones.length > 0;
  const lote = await crearLote(prisma, {
    tipo: "DEDUCCIONES",
    nombreArchivo: archivo.nombre,
    filas: operaciones,
    incidencias,
    previsualizacion: filasVistas,
    totalCrear: nuevos,
    totalActualizar: cambian + seQuitan,
    totalErrores,
    usuario: g.usuario,
  });

  const hojasDelLibro = porGrupo
    ? `El libro trae ${partes.length === 1 ? "una hoja" : `${partes.length} hojas`}: ${partes.map((p) => `«${p.hoja}», ${frasePeriodo(p.periodo, "de").replace(/^(del|de la) /, "")}`).join("; ")}. Cada hoja se aplica a su período: el elegido arriba no se usa.`
    : "";
  const informe: InformeValidacion = {
    loteId: aplicable ? lote.id : null,
    tipo: "DEDUCCIONES",
    nombreArchivo: archivo.nombre,
    totalFilas: suma("totalFilas"),
    totalCrear: nuevos,
    totalActualizar: cambian + seQuitan,
    totalOmitir: sinCambio,
    totalErrores,
    incidencias,
    filas: filasVistas,
    columnasDesconocidas: desconocidas,
    expiraEn: lote.expiraEn.toISOString(),
    aplicable,
    cifras: [
      { label: "Nuevos", valor: nuevos },
      { label: "Cambian", valor: cambian },
      { label: "Se quitan", valor: seQuitan },
      { label: "Sin cambio", valor: sinCambio },
      { label: "Con errores", valor: totalErrores },
    ],
    resumen: [
      hojasDelLibro,
      operaciones.length
        ? porGrupo
          ? "Las deducciones de cada planilla no cambian: en cada período, el monto nuevo las reemplaza."
          : `Se aplicarán sólo ${frasePeriodo(periodo, "a")}. Las deducciones de cada planilla no cambian: en este período, el monto nuevo las reemplaza.`
        : totalErrores === 0 ? "El archivo coincide con lo que ya hay en el período: no hay nada que cambiar." : "",
      sinMontos ? `${sinMontos} ${sinMontos === 1 ? "fila sin montos no se toca" : "filas sin montos no se tocan"}.` : "",
      dondeCabecera,
    ].filter(Boolean).join(" ") || undefined,
    tiposNuevos,
    columnasLeidas,
    tiposExistentes,
  };
  return NextResponse.json(informe);
}
