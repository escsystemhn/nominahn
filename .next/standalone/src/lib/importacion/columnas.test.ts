import { describe, it, expect } from "vitest";
import {
  COLUMNAS_EMPLEADO,
  COLUMNAS_DEDUCCION,
  columnasVisibles,
  etiquetas,
  clavesEsperadas,
  columnasEscribibles,
  filaEjemplo,
} from "./columnas";
import { mapearColumnas, generarCsv, parsearCsv } from "./csv";
import type { ColumnaCsv } from "./tipos";

const CATALOGOS: Array<[string, readonly ColumnaCsv[]]> = [
  ["empleados", COLUMNAS_EMPLEADO],
  ["deducciones", COLUMNAS_DEDUCCION],
];

describe.each(CATALOGOS)("catálogo de %s", (_nombre, columnas) => {
  it("no repite claves ni etiquetas", () => {
    const claves = columnas.map((c) => c.clave);
    const etqs = columnas.map((c) => c.etiqueta);
    expect(new Set(claves).size).toBe(claves.length);
    expect(new Set(etqs).size).toBe(etqs.length);
  });

  it("toda columna tiene descripción", () => {
    for (const c of columnas) expect(c.descripcion.length, c.clave).toBeGreaterThan(0);
  });

  /**
   * EL TEST QUE IMPORTA. El exportador escribe la ETIQUETA ("Codigo Supervisor")
   * y el importador consulta la CLAVE (`supervisor_codigo`); las dos normalizan
   * distinto. Sin esta comprobación, catorce columnas exportadas volvían a
   * entrar como "no reconocidas" y sus valores se perdían sin un solo error:
   * el usuario veía "actualizado" y su cambio no se había guardado.
   */
  it("cada etiqueta exportada se reconoce como su propia clave al importar", () => {
    const { indices, desconocidas } = mapearColumnas(etiquetas(columnas), clavesEsperadas(columnas));

    expect(desconocidas, "cabeceras exportadas que el importador no reconoce").toEqual([]);
    for (const [i, columna] of columnas.entries()) {
      expect(indices[columna.clave], `no se mapeó "${columna.etiqueta}"`).toBe(i);
    }
  });

  it("también se reconoce el archivo escrito con las claves internas", () => {
    const { indices, desconocidas } = mapearColumnas(
      columnas.map((c) => c.clave),
      clavesEsperadas(columnas)
    );
    expect(desconocidas).toEqual([]);
    expect(Object.keys(indices)).toHaveLength(columnas.length);
  });

  it("la plantilla de ejemplo se vuelve a leer con las mismas columnas", () => {
    const csv = generarCsv(etiquetas(columnas), [filaEjemplo(columnas)]);
    const leido = parsearCsv(csv);
    const { desconocidas } = mapearColumnas(leido.cabeceras, clavesEsperadas(columnas));
    expect(desconocidas).toEqual([]);
  });
});

describe("columnasVisibles", () => {
  /**
   * La misma puerta que aplica `/api/empleados`. Si la exportación no la
   * respetara, sería la vía cómoda para sacar en un archivo justo lo que la
   * pantalla oculta.
   */
  it("sin permiso de datos personales excluye las columnas sensibles", () => {
    const visibles = columnasVisibles(COLUMNAS_EMPLEADO, false);
    expect(visibles.some((c) => c.sensible)).toBe(false);
    for (const clave of ["identidad", "rtn", "salario_base", "cuenta_bancaria", "direccion"]) {
      expect(visibles.some((c) => c.clave === clave), clave).toBe(false);
    }
  });

  it("sin permiso conserva el directorio", () => {
    const visibles = columnasVisibles(COLUMNAS_EMPLEADO, false).map((c) => c.clave);
    for (const clave of ["codigo", "primer_nombre", "primer_apellido", "sucursal", "departamento"]) {
      expect(visibles, clave).toContain(clave);
    }
  });

  it("con permiso devuelve el catálogo completo", () => {
    expect(columnasVisibles(COLUMNAS_EMPLEADO, true)).toHaveLength(COLUMNAS_EMPLEADO.length);
  });

  it("el monto de una deducción es sensible", () => {
    const visibles = columnasVisibles(COLUMNAS_DEDUCCION, false).map((c) => c.clave);
    expect(visibles).not.toContain("monto");
    expect(visibles).not.toContain("saldo");
    expect(visibles).toContain("empleado_codigo");
  });
});

describe("columnasEscribibles", () => {
  it("deja fuera las columnas informativas", () => {
    const claves = columnasEscribibles(COLUMNAS_DEDUCCION).map((c) => c.clave);
    expect(claves).not.toContain("saldo");
    expect(claves).not.toContain("cuotas_pagadas");
    expect(claves).not.toContain("empleado_nombre");
    expect(claves).toContain("monto");
  });

  // Se reconocen aunque se ignoren: una exportación previa las trae, y
  // reportarlas como desconocidas alarmaría sin motivo.
  it("las de sólo lectura siguen siendo columnas esperadas", () => {
    const esperadas = clavesEsperadas(COLUMNAS_DEDUCCION).map((c) => c.clave);
    expect(esperadas).toContain("saldo");
  });
});

describe("filaEjemplo", () => {
  it("rellena las columnas obligatorias con un valor de muestra", () => {
    const columnas = COLUMNAS_EMPLEADO.filter((c) => c.requerido);
    const ejemplo = filaEjemplo(columnas);
    for (const [i, c] of columnas.entries()) {
      expect(ejemplo[i], `falta ejemplo para "${c.etiqueta}"`).not.toBe("");
    }
  });
});
