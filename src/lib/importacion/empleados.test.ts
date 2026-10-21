import { describe, it, expect } from "vitest";
import {
  validar,
  type CatalogosEmpleados,
  type ComprobadorAlcance,
  type EmpleadoExistente,
} from "./empleados";
import type { ModoImportacion } from "./tipos";

/** Base de un empleado guardado, para no repetir los 25 campos en cada caso. */
function empleado(sobrescribe: Partial<EmpleadoExistente> & Pick<EmpleadoExistente, "id" | "codigo">): EmpleadoExistente {
  return {
    primerNombre: "Ana",
    segundoNombre: null,
    primerApellido: "Núñez",
    segundoApellido: null,
    sucursalId: "suc-tgu",
    departamentoId: "dep-conta",
    puestoId: null,
    supervisorId: null,
    salarioBase: "15000",
    identidad: null,
    rtn: null,
    ihssNro: null,
    rapNro: null,
    genero: "F",
    estadoCivil: null,
    nacionalidad: "Hondureño",
    telefonoPersonal: null,
    telefonoEmergencia: null,
    contactoEmergencia: null,
    direccion: null,
    banco: null,
    cuentaBancaria: null,
    estado: "ACTIVO",
    tipoContrato: "INDEFINIDO",
    tipoPlanilla: "MENSUAL",
    fechaNacimiento: "1990-03-15T00:00:00.000Z",
    fechaIngreso: "2024-02-01T00:00:00.000Z",
    fechaSalida: null,
    centroCostoId: null,
    emailCorporativo: null,
    extension: null,
    ...sobrescribe,
  };
}

/** Catálogos mínimos: dos sucursales, sus departamentos y dos empleados. */
function catalogos(): CatalogosEmpleados {
  return {
    sucursales: new Map([
      ["tgu", "suc-tgu"],
      ["tegucigalpa", "suc-tgu"],
      ["sps", "suc-sps"],
      ["san pedro sula", "suc-sps"],
    ]),
    departamentos: new Map([
      ["suc-tgu|contabilidad", "dep-conta"],
      ["suc-tgu|operaciones", "dep-oper"],
      ["suc-sps|ventas", "dep-ventas"],
    ]),
    puestos: new Map([
      ["dep-conta|analista contable", "pue-analista"],
      ["dep-oper|operario", "pue-operario"],
    ]),
    porCodigo: new Map([
      ["emp-0001", empleado({ id: "e1", codigo: "EMP-0001", identidad: "0801199012345" })],
      [
        "emp-0002",
        empleado({
          id: "e2", codigo: "EMP-0002", primerNombre: "Luis", primerApellido: "Discua",
          sucursalId: "suc-sps", departamentoId: "dep-ventas", salarioBase: "20000", genero: "M",
        }),
      ],
    ]),
    porIdentidad: new Map([["0801199012345", "EMP-0001"]]),
    centrosCosto: new Map([["adm", "cc-adm"], ["administracion", "cc-adm"], ["prod", "cc-prod"]]),
    salarioMinimo: 11903.13,
  };
}

/** Alcance total: no restringe nada. */
function alcanceTotal(): ComprobadorAlcance {
  const f = ((): boolean => true) as unknown as ComprobadorAlcance;
  f.sucursal = () => true;
  return f;
}

/** Alcance limitado a una sucursal. */
function alcanceSucursal(sucursalId: string): ComprobadorAlcance {
  const f = ((e: { sucursalId: string }) =>
    e.sucursalId === sucursalId) as unknown as ComprobadorAlcance;
  f.sucursal = (id: string) => id === sucursalId;
  return f;
}

const correr = (csv: string, modo: ModoImportacion = "CREAR_O_ACTUALIZAR", alcance = alcanceTotal()) =>
  validar(csv, catalogos(), modo, alcance);

const errores = (r: ReturnType<typeof validar>) => r.incidencias.filter((i) => i.severidad === "ERROR");
const avisos = (r: ReturnType<typeof validar>) => r.incidencias.filter((i) => i.severidad === "AVISO");

const CABECERA_ALTA =
  "Codigo,Primer Nombre,Primer Apellido,Fecha Nacimiento,Genero,Fecha Ingreso,Tipo Contrato,Tipo Planilla,Salario Base,Sucursal,Departamento";
const ALTA_OK =
  ",Marta,Zelaya,15/03/1990,F,01/02/2024,INDEFINIDO,MENSUAL,18000.00,TGU,Contabilidad";

describe("altas", () => {
  it("acepta una fila completa y la marca para crear", () => {
    const r = correr(`${CABECERA_ALTA}\n${ALTA_OK}`);
    expect(errores(r)).toHaveLength(0);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].accion).toBe("CREAR");
    expect(r.filas[0].datos.primer_nombre).toBe("Marta");
    expect(r.filas[0].datos.salario_base).toBe("18000.00");
    expect(r.filas[0].datos.sucursal).toBe("suc-tgu");
    expect(r.filas[0].datos.departamento).toBe("dep-conta");
  });

  it("exige los campos obligatorios y dice cuáles faltan", () => {
    const r = correr(`${CABECERA_ALTA}\n,,Zelaya,,F,01/02/2024,INDEFINIDO,MENSUAL,18000,TGU,Contabilidad`);
    const columnas = errores(r).map((e) => e.columna);
    expect(columnas).toContain("Primer Nombre");
    expect(columnas).toContain("Fecha Nacimiento");
    expect(r.filas).toHaveLength(0);
  });

  it("resuelve la sucursal por nombre además de por código", () => {
    const r = correr(
      `${CABECERA_ALTA}\n,Marta,Zelaya,15/03/1990,F,01/02/2024,INDEFINIDO,MENSUAL,18000,Tegucigalpa,Contabilidad`
    );
    expect(errores(r)).toHaveLength(0);
    expect(r.filas[0].datos.sucursal).toBe("suc-tgu");
  });

  /**
   * El departamento cuelga de la sucursal: "Ventas" existe, pero no en TGU.
   * Aceptarlo colocaría al empleado en una combinación que no existe.
   */
  it("no acepta un departamento que no pertenece a esa sucursal", () => {
    const r = correr(
      `${CABECERA_ALTA}\n,Marta,Zelaya,15/03/1990,F,01/02/2024,INDEFINIDO,MENSUAL,18000,TGU,Ventas`
    );
    expect(errores(r).some((e) => e.columna === "Departamento")).toBe(true);
  });

  describe("con divisiones: dos «Administración» en la misma sucursal", () => {
    const conDivisiones = (): CatalogosEmpleados => {
      const c = catalogos();
      c.departamentos.set("suc-tgu|administracion", "dep-adm-tgu");
      c.departamentosAmbiguos = new Set(["suc-tgu|administracion"]);
      c.departamentosPorDivision = new Map([
        ["suc-tgu|pagsa mayoreo|administracion", "dep-adm-may"],
        ["suc-tgu|pagsa tegucigalpa|administracion", "dep-adm-tgu"],
      ]);
      return c;
    };
    const fila = (division: string) =>
      `${CABECERA_ALTA},Division\n,Marta,Zelaya,15/03/1990,F,01/02/2024,INDEFINIDO,MENSUAL,18000,TGU,Administracion,${division}`;

    it("sin la división, rechaza la fila en vez de elegir una al azar", () => {
      const r = validar(fila(""), conDivisiones(), "CREAR_O_ACTUALIZAR", alcanceTotal());
      const e = errores(r).find((x) => x.columna === "Departamento");
      expect(e?.mensaje).toContain("indique la columna División");
    });

    it("con la división, resuelve el departamento correcto", () => {
      const r = validar(fila("PAGSA Mayoreo"), conDivisiones(), "CREAR_O_ACTUALIZAR", alcanceTotal());
      expect(errores(r)).toEqual([]);
      expect(r.filas[0].datos.departamento).toBe("dep-adm-may");
    });

    it("una división sin ese departamento da un error que la nombra", () => {
      const r = validar(fila("PAGSA Norte"), conDivisiones(), "CREAR_O_ACTUALIZAR", alcanceTotal());
      expect(errores(r).find((x) => x.columna === "Departamento")?.mensaje).toContain("PAGSA Norte");
    });
  });

  it("no repite el error de departamento cuando la sucursal ya falló", () => {
    const r = correr(
      `${CABECERA_ALTA}\n,Marta,Zelaya,15/03/1990,F,01/02/2024,INDEFINIDO,MENSUAL,18000,INEXISTENTE,Contabilidad`
    );
    expect(errores(r).filter((e) => e.columna === "Sucursal")).toHaveLength(1);
    expect(errores(r).filter((e) => e.columna === "Departamento")).toHaveLength(0);
  });

  it("avisa si el salario queda bajo el mínimo, sin bloquear", () => {
    const r = correr(
      `${CABECERA_ALTA}\n,Marta,Zelaya,15/03/1990,F,01/02/2024,INDEFINIDO,MENSUAL,9000,TGU,Contabilidad`
    );
    expect(errores(r)).toHaveLength(0);
    expect(avisos(r).some((a) => a.columna === "Salario Base")).toBe(true);
    expect(r.filas).toHaveLength(1); // se aplica igual
  });

  it("rechaza una edad de ingreso por debajo del mínimo legal", () => {
    const r = correr(
      `${CABECERA_ALTA}\n,Marta,Zelaya,15/03/2015,F,01/02/2024,INDEFINIDO,MENSUAL,18000,TGU,Contabilidad`
    );
    expect(errores(r).some((e) => e.mensaje.includes("mínimo legal"))).toBe(true);
  });
});

describe("actualizaciones", () => {
  /**
   * Lo que hace útil la vista previa: si el archivo repite lo que ya está
   * guardado, no debe anunciar cambios. Reimportar un export sin editar llegó a
   * declarar dieciséis campos modificados cuando no cambiaba ninguno.
   */
  it("un archivo con los valores actuales no anuncia ningún cambio", () => {
    const csv =
      "Codigo,Primer Nombre,Primer Apellido,Genero,Nacionalidad,Estado,Tipo Contrato,Tipo Planilla,Salario Base,Sucursal,Departamento\n" +
      "EMP-0001,Ana,Núñez,F,Hondureño,ACTIVO,INDEFINIDO,MENSUAL,15000.00,TGU,Contabilidad";
    const r = correr(csv);
    expect(errores(r)).toHaveLength(0);
    expect(r.filas).toHaveLength(0);
    expect(r.totalOmitir).toBe(1);
  });

  it("y con un solo campo distinto, anuncia sólo ese", () => {
    const csv =
      "Codigo,Primer Nombre,Primer Apellido,Genero,Nacionalidad,Estado,Tipo Contrato,Tipo Planilla,Salario Base,Sucursal,Departamento\n" +
      "EMP-0001,Ana,Núñez,F,Hondureño,ACTIVO,INDEFINIDO,MENSUAL,17000.00,TGU,Contabilidad";
    const r = correr(csv);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].cambios).toEqual(["Salario 15000.00 → 17000.00"]);
    expect(Object.keys(r.filas[0].datos)).toEqual(["salario_base"]);
  });

  it("sólo toca las columnas presentes en el archivo", () => {
    const r = correr("Codigo,Salario Base\nEMP-0001,17000.00");
    expect(errores(r)).toHaveLength(0);
    expect(r.filas[0].accion).toBe("ACTUALIZAR");
    expect(r.filas[0].empleadoId).toBe("e1");
    expect(Object.keys(r.filas[0].datos)).toEqual(["salario_base"]);
  });

  /**
   * Sin esto, la importación sería el agujero por el que se pierde el historial
   * salarial: el sueldo cambia y nadie sabe cuándo ni desde cuánto.
   */
  it("guarda el salario anterior para el historial", () => {
    const r = correr("Codigo,Salario Base\nEMP-0001,17000.00");
    expect(r.filas[0].salarioAnterior).toBe("15000.00");
    expect(r.filas[0].cambios[0]).toContain("15000.00 → 17000.00");
  });

  it("una fila sin cambios reales no genera escritura", () => {
    const r = correr("Codigo,Salario Base\nEMP-0001,15000.00");
    expect(r.filas).toHaveLength(0);
    expect(r.totalOmitir).toBe(1);
    expect(r.previsualizacion[0].accion).toBe("OMITIR");
  });

  // Una celda en blanco no puede significar "borra este campo": no hay forma de
  // distinguirla de un descuido al editar en Excel.
  it("una celda vacía no borra el valor guardado", () => {
    const r = correr("Codigo,Telefono\nEMP-0001,");
    expect(errores(r)).toHaveLength(0);
    expect(r.filas).toHaveLength(0); // nada que escribir
  });
});

describe("centro de costo y directorio", () => {
  it("resuelve el centro de costo por código", () => {
    const r = correr("Codigo,Centro Costo\nEMP-0001,PROD");
    expect(errores(r)).toHaveLength(0);
    expect(r.filas[0].datos.centro_costo).toBe("cc-prod");
  });

  it("rechaza un centro que no existe, con el valor que se escribió", () => {
    const r = correr("Codigo,Centro Costo\nEMP-0001,INVENTADO");
    expect(errores(r).some((e) => e.columna === "Centro Costo" && e.mensaje.includes("INVENTADO"))).toBe(true);
  });

  it("valida el correo corporativo", () => {
    expect(errores(correr("Codigo,Correo Corporativo\nEMP-0001,ana@")).some(
      (e) => e.columna === "Correo Corporativo"
    )).toBe(true);
    expect(errores(correr("Codigo,Correo Corporativo\nEMP-0001,ana@empresa.hn"))).toHaveLength(0);
  });

  it("acepta la extensión como texto corto", () => {
    const r = correr("Codigo,Extension\nEMP-0001,1042");
    expect(errores(r)).toHaveLength(0);
    expect(r.filas[0].datos.extension).toBe("1042");
  });
});

describe("modos", () => {
  it("CREAR omite lo que ya existe", () => {
    const r = correr("Codigo,Salario Base\nEMP-0001,17000", "CREAR");
    expect(r.filas).toHaveLength(0);
    expect(r.totalOmitir).toBe(1);
  });

  it("ACTUALIZAR omite lo que no existe", () => {
    const r = correr(`${CABECERA_ALTA}\nEMP-9999${ALTA_OK}`, "ACTUALIZAR");
    expect(r.filas).toHaveLength(0);
    expect(r.totalOmitir).toBe(1);
  });
});

describe("duplicados", () => {
  it("detecta dos filas con el mismo código y señala la línea previa", () => {
    const r = correr("Codigo,Salario Base\nEMP-0001,17000\nEMP-0001,18000");
    const e = errores(r).find((x) => x.columna === "Codigo");
    expect(e?.mensaje).toContain("línea 2");
    expect(e?.linea).toBe(3);
  });

  it("detecta la misma identidad repetida en el archivo", () => {
    const csv =
      "Codigo,Identidad,Primer Nombre,Primer Apellido,Fecha Nacimiento,Genero,Fecha Ingreso,Tipo Contrato,Tipo Planilla,Salario Base,Sucursal,Departamento\n" +
      ",0801-1999-11111,A,Uno,15/03/1990,F,01/02/2024,INDEFINIDO,MENSUAL,18000,TGU,Contabilidad\n" +
      ",0801-1999-11111,B,Dos,15/03/1990,M,01/02/2024,INDEFINIDO,MENSUAL,18000,TGU,Contabilidad";
    expect(errores(correr(csv)).some((e) => e.mensaje.includes("línea 2"))).toBe(true);
  });

  /** El índice único de la base rechazaría esto; mejor decirlo antes de escribir. */
  it("detecta una identidad que ya pertenece a otro empleado", () => {
    const r = correr("Codigo,Identidad\nEMP-0002,0801-1990-12345");
    expect(errores(r).some((e) => e.mensaje.includes("EMP-0001"))).toBe(true);
  });

  it("no marca duplicada la identidad que ya es del propio empleado", () => {
    const r = correr("Codigo,Identidad\nEMP-0001,0801-1990-12345");
    expect(errores(r)).toHaveLength(0);
  });
});

describe("alcance de datos", () => {
  it("bloquea actualizar un empleado de otra sucursal", () => {
    const r = correr("Codigo,Salario Base\nEMP-0002,21000", "CREAR_O_ACTUALIZAR", alcanceSucursal("suc-tgu"));
    expect(errores(r).some((e) => e.mensaje.includes("fuera de su alcance"))).toBe(true);
    expect(r.filas).toHaveLength(0);
  });

  it("permite actualizar dentro de su sucursal", () => {
    const r = correr("Codigo,Salario Base\nEMP-0001,16000", "CREAR_O_ACTUALIZAR", alcanceSucursal("suc-tgu"));
    expect(errores(r)).toHaveLength(0);
  });

  /**
   * El hueco que cerraría un atacante con permiso de importar: dar de alta en
   * una sucursal ajena, donde el empleado ya no está bajo su alcance.
   */
  it("bloquea dar de alta en una sucursal fuera de su alcance", () => {
    const csv = `${CABECERA_ALTA}\n,Marta,Zelaya,15/03/1990,F,01/02/2024,INDEFINIDO,MENSUAL,18000,SPS,Ventas`;
    const r = correr(csv, "CREAR_O_ACTUALIZAR", alcanceSucursal("suc-tgu"));
    expect(errores(r).some((e) => e.columna === "Sucursal")).toBe(true);
    expect(r.filas).toHaveLength(0);
  });
});

describe("cabeceras", () => {
  /**
   * "Salaio Base" no se aplicaría y el usuario vería "1 actualizado" sin que su
   * cambio se guardara. El aviso es lo único que lo delata.
   */
  it("avisa de una cabecera mal escrita en vez de ignorarla en silencio", () => {
    const r = correr("Codigo,Salaio Base\nEMP-0001,17000");
    expect(avisos(r).some((a) => a.columna === "Salaio Base")).toBe(true);
  });

  it("tolera mayúsculas, tildes y guiones bajos en las cabeceras", () => {
    const r = correr("codigo,salario_base\nEMP-0001,17000");
    expect(errores(r)).toHaveLength(0);
    expect(r.filas).toHaveLength(1);
  });

  it("un archivo vacío da un error claro, no una excepción", () => {
    const r = correr("");
    expect(errores(r)[0].mensaje).toContain("vacío");
  });
});

describe("supervisor", () => {
  it("se guarda por código para resolverlo al aplicar", () => {
    const r = correr("Codigo,Codigo Supervisor\nEMP-0001,EMP-0002");
    expect(r.filas[0].supervisorCodigo).toBe("EMP-0002");
  });

  it("no deja que alguien sea su propio supervisor", () => {
    const r = correr("Codigo,Codigo Supervisor\nEMP-0001,EMP-0001");
    expect(errores(r).some((e) => e.mensaje.includes("su propio supervisor"))).toBe(true);
  });
});

describe("coherencia de fechas", () => {
  it("rechaza una salida anterior al ingreso", () => {
    const r = correr("Codigo,Fecha Ingreso,Fecha Salida\nEMP-0001,01/02/2024,01/01/2024");
    expect(errores(r).some((e) => e.columna === "Fecha Salida")).toBe(true);
  });

  it("avisa de una fecha de ingreso futura sin bloquear", () => {
    const r = correr("Codigo,Fecha Ingreso\nEMP-0001,01/01/2099");
    expect(errores(r)).toHaveLength(0);
    expect(avisos(r).some((a) => a.columna === "Fecha Ingreso")).toBe(true);
  });
});

describe("números de línea", () => {
  /** El informe tiene que apuntar a la línea que el usuario ve al abrir el CSV. */
  it("los errores apuntan a la línea real del archivo", () => {
    const csv = "Codigo,Salario Base\nEMP-0001,15000\nEMP-0001,ochomil";
    const e = errores(correr(csv));
    expect(e.every((x) => x.linea === 3)).toBe(true);
  });
});
