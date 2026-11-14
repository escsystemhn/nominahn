import { describe, it, expect } from "vitest";
import { validarTipos, type TipoExistente } from "@/lib/importacion/tipos-deduccion";

const tipo = (o: Partial<TipoExistente>): TipoExistente => ({
  id: `id-${o.codigo}`, codigo: "X", nombre: "X", tipo: "VOLUNTARIA", montoFijo: null, descripcion: null, activo: true, esLegal: false, asignadas: 0, ...o,
});
const EXISTENTES = [
  tipo({ codigo: "COOP1", nombre: "Cooperativa Empleados", tipo: "COOPERATIVA", asignadas: 4 }),
  tipo({ codigo: "SEG-MED", nombre: "Seguro médico", montoFijo: "1000.00" }),
  tipo({ codigo: "IHSS", nombre: "IHSS - EM", tipo: "LEGAL", esLegal: true }),
  tipo({ codigo: "ISR-FIJO", nombre: "Retención fija de ISR", tipo: "IMPUESTO" }),
];
const CAB = "Codigo,Nombre,Categoria,Monto Habitual,Descripcion,Activo";

describe("catálogo de tipos por plantilla", () => {
  it("crea los nuevos y actualiza por código, con lo que cambia", () => {
    const r = validarTipos([
      CAB,
      "coop-elga,Cooperativa ELGA,Cooperativa,,Ahorro y crédito,",
      "SEG-MED,Seguro médico,Descuento autorizado,1200,,",
      "PTMO-RAP,Préstamo RAP,descuento autorizado,,,Sí",
    ].join("\n"), EXISTENTES, "CREAR_O_ACTUALIZAR");
    expect(r.incidencias.filter((i) => i.severidad === "ERROR")).toEqual([]);
    expect(r.filas.map((f) => `${f.accion}:${f.datos.codigo}:${f.datos.tipo}`)).toEqual([
      "CREAR:COOP-ELGA:COOPERATIVA", "ACTUALIZAR:SEG-MED:VOLUNTARIA", "CREAR:PTMO-RAP:VOLUNTARIA",
    ]);
    expect(r.filas[1].cambios).toEqual(["Monto habitual: 1,000.00 → 1,200.00"]);
  });

  it("los de ley y el ISR fijo no se tocan por aquí", () => {
    const r = validarTipos([CAB, "IHSS,IHSS,Otro,,,", "ISR-FIJO,ISR,Otro,,,"].join("\n"), EXISTENTES, "CREAR_O_ACTUALIZAR");
    expect(r.filas).toHaveLength(0);
    expect(r.incidencias.map((i) => i.mensaje).every((m) => /Parámetros de ley/.test(m))).toBe(true);
  });

  it("al actualizar, lo vacío no cambia; sin cambios se omite", () => {
    const r = validarTipos(["Codigo,Nombre,Categoria", "COOP1,,"].join("\n"), EXISTENTES, "CREAR_O_ACTUALIZAR");
    expect(r.filas).toHaveLength(0);
    expect(r.previsualizacion[0]).toMatchObject({ accion: "OMITIR", cambios: ["Sin cambios."] });
  });

  it("avisa lo que afecta a lo ya asignado: cambiar la categoría o desactivar", () => {
    const r = validarTipos([CAB, "COOP1,Cooperativa Empleados,Préstamo de la empresa,,,No"].join("\n"), EXISTENTES, "CREAR_O_ACTUALIZAR");
    expect(r.filas[0].cambios).toEqual(["Categoría: Cooperativa → Préstamo de la empresa", "Desactivar"]);
    const avisos = r.incidencias.filter((i) => i.severidad === "AVISO").map((i) => i.mensaje);
    expect(avisos.some((m) => /4 empleado\(s\).*tope de «Préstamo de la empresa»/.test(m))).toBe(true);
    expect(avisos.some((m) => /se les sigue cobrando/.test(m))).toBe(true);
  });

  it("errores con su línea: sin categoría al crear, categoría desconocida, código repetido, nombre de otro tipo", () => {
    const r = validarTipos([
      CAB,
      "NUEVO1,Nuevo uno,,,,",
      "NUEVO2,Nuevo dos,Bono,,,",
      "NUEVO3,Nuevo tres,Otro,,,",
      "NUEVO3,Nuevo tres bis,Otro,,,",
      "NUEVO4,Seguro Médico,Otro,,,",
      "NUEVO5,Nuevo cinco,Otro,,,Quizá",
    ].join("\n"), EXISTENTES, "CREAR_O_ACTUALIZAR");
    const errores = r.incidencias.filter((i) => i.severidad === "ERROR").map((i) => `${i.linea}:${i.mensaje}`);
    expect(errores[0]).toMatch(/^2:Elija la categoría/);
    expect(errores[1]).toMatch(/^3:«Bono» no es una categoría/);
    expect(errores[2]).toMatch(/^5:El código NUEVO3 ya viene en la línea 4/);
    expect(errores[3]).toMatch(/^6:Ya hay un tipo llamado «Seguro médico» con el código SEG-MED/);
    expect(errores[4]).toMatch(/^7:«Quizá»: escriba Sí o No/);
    expect(r.filas.map((f) => f.datos.codigo)).toEqual(["NUEVO3"]);
  });

  it("respeta los modos sólo alta y sólo actualización", () => {
    const archivo = [CAB, "SEG-MED,Seguro médico,Otro,,,", "NUEVO,Nuevo,Otro,,,"].join("\n");
    expect(validarTipos(archivo, EXISTENTES, "CREAR").filas.map((f) => f.datos.codigo)).toEqual(["NUEVO"]);
    expect(validarTipos(archivo, EXISTENTES, "ACTUALIZAR").filas.map((f) => f.datos.codigo)).toEqual(["SEG-MED"]);
  });

  it("sin la columna Codigo no hay nada que leer", () => {
    expect(validarTipos("Nombre,Categoria\nX,Otro", EXISTENTES, "CREAR_O_ACTUALIZAR").incidencias[0].mensaje).toMatch(/Codigo/);
  });
});
