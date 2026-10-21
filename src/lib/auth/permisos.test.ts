import { describe, it, expect } from "vitest";
import {
  CATALOGO,
  TODOS_LOS_PERMISOS,
  PERMISOS_POR_ROL,
  COMODIN,
  tienePermiso,
  tieneAlguno,
  tieneTodos,
  expandir,
  esPermisoValido,
  permisosEfectivos,
  permisosNoVistos,
} from "./permisos";

describe("catálogo", () => {
  it("no repite códigos entre módulos", () => {
    const vistos = new Set<string>();
    for (const codigo of TODOS_LOS_PERMISOS) {
      expect(vistos.has(codigo), `código duplicado: ${codigo}`).toBe(false);
      vistos.add(codigo);
    }
  });

  it("todos los códigos usan el formato modulo.accion y coinciden con su módulo", () => {
    for (const modulo of CATALOGO) {
      for (const permiso of modulo.permisos) {
        expect(permiso.codigo).toMatch(/^[a-z]+\.[a-z_]+$/);
        expect(permiso.codigo.split(".")[0]).toBe(modulo.modulo);
      }
    }
  });

  it("cada permiso tiene etiqueta y descripción para la interfaz", () => {
    for (const modulo of CATALOGO) {
      for (const permiso of modulo.permisos) {
        expect(permiso.etiqueta.length).toBeGreaterThan(0);
        expect(permiso.descripcion.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("tienePermiso", () => {
  it("concede por coincidencia exacta", () => {
    expect(tienePermiso(["empleados.ver"], "empleados.ver")).toBe(true);
  });

  it("niega lo que no está en la lista", () => {
    expect(tienePermiso(["empleados.ver"], "empleados.editar")).toBe(false);
  });

  it("el comodín global concede cualquier permiso", () => {
    for (const codigo of TODOS_LOS_PERMISOS) {
      expect(tienePermiso([COMODIN], codigo)).toBe(true);
    }
  });

  it("el comodín de módulo concede sólo dentro de su módulo", () => {
    expect(tienePermiso(["empleados.*"], "empleados.pii")).toBe(true);
    expect(tienePermiso(["empleados.*"], "planillas.pagar")).toBe(false);
  });

  it("una lista vacía o ausente no concede nada", () => {
    expect(tienePermiso([], "empleados.ver")).toBe(false);
    expect(tienePermiso(undefined, "empleados.ver")).toBe(false);
  });

  // El fallo clásico: `permisos.includes(pedido)` con un prefijo compartido.
  it("no concede por prefijo parcial", () => {
    expect(tienePermiso(["empleados.ver"], "empleados.ver_todo")).toBe(false);
    expect(tienePermiso(["seguridad.usuarios_ver"], "seguridad.usuarios_gestionar")).toBe(false);
  });
});

describe("tieneAlguno / tieneTodos", () => {
  it("alguno basta con una coincidencia", () => {
    expect(tieneAlguno(["planillas.ver"], ["planillas.ver", "planillas.pagar"])).toBe(true);
  });

  it("todos exige la lista completa", () => {
    expect(tieneTodos(["planillas.ver"], ["planillas.ver", "planillas.pagar"])).toBe(false);
    expect(tieneTodos(["planillas.ver", "planillas.pagar"], ["planillas.ver", "planillas.pagar"])).toBe(true);
  });

  it("con lista de pedidos vacía, tieneTodos es cierto y tieneAlguno falso", () => {
    expect(tieneTodos(["empleados.ver"], [])).toBe(true);
    expect(tieneAlguno(["empleados.ver"], [])).toBe(false);
  });
});

describe("expandir", () => {
  it("el comodín se expande al catálogo completo", () => {
    expect(expandir([COMODIN])).toEqual([...TODOS_LOS_PERMISOS]);
  });

  it("descarta códigos que ya no existen en el catálogo", () => {
    // Un perfil guardado antes de renombrar un permiso no debe resucitarlo.
    expect(expandir(["empleados.ver", "modulo.inexistente"])).toEqual(["empleados.ver"]);
  });
});

describe("esPermisoValido", () => {
  it("acepta los del catálogo y rechaza el resto", () => {
    expect(esPermisoValido("empleados.pii")).toBe(true);
    expect(esPermisoValido("empleados.borrar_todo")).toBe(false);
    expect(esPermisoValido(COMODIN)).toBe(false); // el comodín no es un permiso asignable
  });
});

describe("PERMISOS_POR_ROL — compatibilidad con el reparto anterior", () => {
  it("sólo SUPER_ADMIN tiene el comodín", () => {
    expect(PERMISOS_POR_ROL.SUPER_ADMIN).toContain(COMODIN);
    for (const [rol, permisos] of Object.entries(PERMISOS_POR_ROL)) {
      if (rol !== "SUPER_ADMIN") expect(permisos).not.toContain(COMODIN);
    }
  });

  it("no concede códigos fuera del catálogo", () => {
    for (const [rol, permisos] of Object.entries(PERMISOS_POR_ROL)) {
      for (const codigo of permisos) {
        if (codigo === COMODIN) continue;
        expect(esPermisoValido(codigo), `${rol} concede un permiso inexistente: ${codigo}`).toBe(true);
      }
    }
  });

  // Estas eran ROLES_PII en guard.ts. Que GERENTE y SUPERVISOR queden fuera es
  // el comportamiento anterior, no un descuido.
  it("respeta quién veía datos personales", () => {
    for (const rol of ["SUPER_ADMIN", "ADMIN_RRHH", "CONTADOR", "AUDITOR"] as const) {
      expect(tienePermiso(PERMISOS_POR_ROL[rol], "empleados.pii"), rol).toBe(true);
    }
    for (const rol of ["GERENTE", "SUPERVISOR", "EMPLEADO"] as const) {
      expect(tienePermiso(PERMISOS_POR_ROL[rol], "empleados.pii"), rol).toBe(false);
    }
  });

  // ROLES_NOMINA: quien puede operar la nómina en algún grado.
  it("respeta quién opera la nómina", () => {
    for (const rol of ["SUPER_ADMIN", "ADMIN_RRHH", "CONTADOR"] as const) {
      expect(tienePermiso(PERMISOS_POR_ROL[rol], "planillas.calcular"), rol).toBe(true);
    }
    for (const rol of ["GERENTE", "SUPERVISOR", "AUDITOR", "EMPLEADO"] as const) {
      expect(tienePermiso(PERMISOS_POR_ROL[rol], "planillas.calcular"), rol).toBe(false);
    }
  });

  /**
   * La guardia gruesa `ROLES_NOMINA` daba entrada a la ruta por igual a RRHH y a
   * Contabilidad, pero la matriz de transiciones de `estado-planilla.ts` era más
   * estricta: RRHH aprueba y Contabilidad paga, y ninguno hace lo del otro.
   *
   * El reparto real es esa intersección, y es lo que reproduce el mapa: derivarlo
   * sólo de la guardia gruesa habría concedido a cada uno el permiso del otro.
   */
  it("mantiene la separación de funciones entre aprobar y pagar", () => {
    expect(tienePermiso(PERMISOS_POR_ROL.ADMIN_RRHH, "planillas.aprobar")).toBe(true);
    expect(tienePermiso(PERMISOS_POR_ROL.ADMIN_RRHH, "planillas.pagar")).toBe(false);

    // Un contador no aprueba la planilla que él mismo calculó.
    expect(tienePermiso(PERMISOS_POR_ROL.CONTADOR, "planillas.aprobar")).toBe(false);
    expect(tienePermiso(PERMISOS_POR_ROL.CONTADOR, "planillas.pagar")).toBe(true);
  });

  it("modificar los datos de la empresa queda reservado al super administrador", () => {
    expect(tienePermiso(PERMISOS_POR_ROL.SUPER_ADMIN, "configuracion.empresa")).toBe(true);
    for (const rol of ["ADMIN_RRHH", "CONTADOR", "GERENTE", "SUPERVISOR", "AUDITOR", "EMPLEADO"] as const) {
      expect(tienePermiso(PERMISOS_POR_ROL[rol], "configuracion.empresa"), rol).toBe(false);
    }
  });

  it("anular una planilla ya PAGADA queda reservado al super administrador", () => {
    expect(tienePermiso(PERMISOS_POR_ROL.SUPER_ADMIN, "planillas.anular_pagada")).toBe(true);
    for (const rol of ["ADMIN_RRHH", "CONTADOR", "GERENTE", "SUPERVISOR", "AUDITOR", "EMPLEADO"] as const) {
      expect(tienePermiso(PERMISOS_POR_ROL[rol], "planillas.anular_pagada"), rol).toBe(false);
    }
  });

  /**
   * La gestión de los módulos de talento era de SUPER_ADMIN y ADMIN_RRHH; el
   * resto sólo consultaba. Colapsar ver y gestionar en un permiso único dejaría
   * escribir a un AUDITOR, que es exactamente lo contrario de su función.
   */
  it("separa consultar de gestionar en los módulos de talento", () => {
    for (const modulo of ["capacitaciones", "reclutamiento", "dotaciones"]) {
      for (const rol of ["GERENTE", "SUPERVISOR", "AUDITOR"] as const) {
        expect(tienePermiso(PERMISOS_POR_ROL[rol], `talento.${modulo}`), `${rol}/${modulo}`).toBe(true);
        expect(
          tienePermiso(PERMISOS_POR_ROL[rol], `talento.${modulo}_gestionar`),
          `${rol}/${modulo}`
        ).toBe(false);
      }
      expect(tienePermiso(PERMISOS_POR_ROL.ADMIN_RRHH, `talento.${modulo}_gestionar`)).toBe(true);
    }
  });

  // ROLES_LECTURA_NOMINA.
  it("respeta quién lee la nómina sin operarla", () => {
    for (const rol of ["GERENTE", "AUDITOR"] as const) {
      expect(tienePermiso(PERMISOS_POR_ROL[rol], "planillas.ver"), rol).toBe(true);
      expect(tienePermiso(PERMISOS_POR_ROL[rol], "planillas.calcular"), rol).toBe(false);
    }
  });

  // ROLES_EXPEDIENTE.
  it("respeta quién edita el expediente", () => {
    for (const rol of ["SUPER_ADMIN", "ADMIN_RRHH"] as const) {
      expect(tienePermiso(PERMISOS_POR_ROL[rol], "empleados.editar"), rol).toBe(true);
    }
    for (const rol of ["CONTADOR", "GERENTE", "SUPERVISOR", "AUDITOR", "EMPLEADO"] as const) {
      expect(tienePermiso(PERMISOS_POR_ROL[rol], "empleados.editar"), rol).toBe(false);
    }
  });

  it("AUDITOR no puede escribir nada", () => {
    const escrituras = [
      "empleados.crear", "empleados.editar", "empleados.importar",
      "deducciones.configurar", "deducciones.asignar", "deducciones.importar",
      "planillas.calcular", "planillas.aprobar", "planillas.pagar", "planillas.anular",
      "planillas.reabrir", "planillas.anular_pagada",
      "talento.capacitaciones_gestionar", "talento.reclutamiento_gestionar",
      "talento.dotaciones_gestionar",
      "prestaciones.generar", "prestaciones.salarios",
      "configuracion.editar", "configuracion.empresa",
      "seguridad.usuarios_gestionar", "seguridad.perfiles",
    ];
    for (const permiso of escrituras) {
      expect(tienePermiso(PERMISOS_POR_ROL.AUDITOR, permiso), permiso).toBe(false);
    }
  });

  it("EMPLEADO no recibe ningún permiso del catálogo", () => {
    expect(PERMISOS_POR_ROL.EMPLEADO).toHaveLength(0);
  });

  // La gestión de usuarios y perfiles es nueva: nadie salvo el super
  // administrador debe heredarla por su rol antiguo.
  it("sólo SUPER_ADMIN administra usuarios y perfiles", () => {
    for (const rol of ["ADMIN_RRHH", "CONTADOR", "GERENTE", "SUPERVISOR", "AUDITOR", "EMPLEADO"] as const) {
      expect(tienePermiso(PERMISOS_POR_ROL[rol], "seguridad.usuarios_gestionar"), rol).toBe(false);
      expect(tienePermiso(PERMISOS_POR_ROL[rol], "seguridad.perfiles"), rol).toBe(false);
    }
  });
});

describe("permisosEfectivos", () => {
  it("sin perfil, resuelve por el rol", () => {
    expect(permisosEfectivos({ role: "CONTADOR" })).toEqual([...PERMISOS_POR_ROL.CONTADOR]);
  });

  it("el perfil manda sobre el rol", () => {
    const permisos = permisosEfectivos({
      role: "SUPER_ADMIN",
      perfil: { permisos: ["empleados.ver"], activo: true },
    });
    expect(permisos).toEqual(["empleados.ver"]);
    expect(tienePermiso(permisos, "planillas.pagar")).toBe(false);
  });

  // Desactivar un perfil debe CORTAR el acceso, no devolver a la persona a los
  // permisos de su rol antiguo: eso sería una escalada silenciosa.
  it("un perfil inactivo no concede nada, ni siquiera lo del rol", () => {
    expect(
      permisosEfectivos({ role: "ADMIN_RRHH", perfil: { permisos: ["empleados.ver"], activo: false } })
    ).toEqual([]);
  });

  it("sin rol ni perfil no concede nada", () => {
    expect(permisosEfectivos({})).toEqual([]);
  });
});

describe("permisosNoVistos", () => {
  const CATALOGO_VIEJO = ["empleados.ver", "empleados.pii", "planillas.ver"];

  /**
   * El hueco que esta regla tapa: al añadir el módulo `organizacion`, los
   * perfiles ya creados se quedaron sin sus permisos y el organigrama resultó
   * invisible para todos salvo quien tuviera comodín, sin ningún error.
   */
  it("añade lo que no existía cuando se guardó el perfil", () => {
    const baseline = [...CATALOGO_VIEJO, "organizacion.ver", "organizacion.reasignar"];
    expect(permisosNoVistos(CATALOGO_VIEJO, CATALOGO_VIEJO, baseline)).toEqual([
      "organizacion.ver",
      "organizacion.reasignar",
    ]);
  });

  /**
   * EL CASO QUE LA REGLA ANTERIOR FALLABA. `planillas.plan_cuentas` es nuevo,
   * pero dentro de un módulo que el perfil ya conocía. Comparando por módulo se
   * daba por visto y Contabilidad se quedaba sin poder configurar su catálogo.
   */
  it("también si el permiso nuevo está en un módulo que el perfil ya conocía", () => {
    const baseline = [...CATALOGO_VIEJO, "planillas.plan_cuentas"];
    expect(permisosNoVistos(CATALOGO_VIEJO, CATALOGO_VIEJO, baseline)).toEqual([
      "planillas.plan_cuentas",
    ]);
  });

  /**
   * Lo contrario: un permiso que SÍ existía y que el administrador quitó a
   * conciencia. Devolvérselo revertiría su decisión, que es justo lo que la
   * regla de «no pisar la configuración» pretende evitar.
   */
  it("respeta lo que se quitó a propósito", () => {
    const actuales = ["empleados.ver", "planillas.ver"]; // sin empleados.pii
    expect(permisosNoVistos(CATALOGO_VIEJO, actuales, CATALOGO_VIEJO)).toEqual([]);
  });

  it("nunca devuelve algo que el perfil ya tiene", () => {
    expect(permisosNoVistos([], CATALOGO_VIEJO, CATALOGO_VIEJO)).toEqual([]);
  });

  it("nunca devuelve algo fuera de su línea base", () => {
    const nuevos = permisosNoVistos([], ["empleados.ver"], ["empleados.ver", "empleados.pii"]);
    expect(nuevos).toEqual(["empleados.pii"]);
    expect(nuevos).not.toContain("planillas.pagar");
  });

  it("a un perfil con comodín no le falta nada", () => {
    expect(permisosNoVistos([], [COMODIN], [...TODOS_LOS_PERMISOS])).toEqual([]);
  });

  it("nunca propone el comodín", () => {
    expect(permisosNoVistos([], ["empleados.ver"], [COMODIN])).toEqual([]);
  });

  /**
   * Un perfil anterior a esta columna no tiene registro de lo que vio. Se
   * completa hasta su línea base una sola vez; a partir de ahí la comparación es
   * exacta.
   */
  it("un perfil sin registro previo se completa hasta su línea base", () => {
    expect(permisosNoVistos([], [], CATALOGO_VIEJO)).toEqual(CATALOGO_VIEJO);
  });

  /** La propiedad que la hace segura: sólo suma, nunca resta. */
  it("es puramente aditiva", () => {
    const actuales = ["empleados.ver", "planillas.pagar"];
    const resultado = [...actuales, ...permisosNoVistos([], actuales, ["organizacion.ver"])];
    for (const p of actuales) expect(resultado).toContain(p);
  });

  it("reproduce el caso real de los perfiles sembrados", () => {
    const sinOrganizacion = TODOS_LOS_PERMISOS.filter((p) => !p.startsWith("organizacion."));
    const rrhhAntiguo = PERMISOS_POR_ROL.ADMIN_RRHH.filter((p) => !p.startsWith("organizacion."));
    expect(permisosNoVistos(sinOrganizacion, rrhhAntiguo, PERMISOS_POR_ROL.ADMIN_RRHH)).toEqual([
      "organizacion.ver",
      "organizacion.reasignar",
      "organizacion.centros_costo",
    ]);
  });
});
