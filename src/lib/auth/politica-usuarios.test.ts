import { describe, it, expect } from "vitest";
import {
  puedeOtorgar,
  cambioSobreSiMismo,
  dejariaSinAdministrador,
  validarCambioUsuario,
  puedeBorrarPerfil,
  PERMISO_LLAVE,
} from "./politica-usuarios";
import { COMODIN, TODOS_LOS_PERMISOS } from "./permisos";

const motivo = (v: { ok: true } | { ok: false; motivo: string }) => (v.ok ? "" : v.motivo);

describe("puedeOtorgar", () => {
  it("deja repartir lo que se tiene", () => {
    const actor = { permisos: ["empleados.ver", "empleados.editar"] };
    expect(puedeOtorgar(actor, ["empleados.ver"]).ok).toBe(true);
    expect(puedeOtorgar(actor, ["empleados.ver", "empleados.editar"]).ok).toBe(true);
  });

  /**
   * La regla que impide convertir "administrar cuentas" en "administrarlo todo":
   * sin ella, quien gestiona usuarios se fabrica un perfil con planillas.pagar y
   * se lo asigna.
   */
  it("no deja conceder un permiso que el actor no tiene", () => {
    const actor = { permisos: ["seguridad.usuarios_gestionar", "seguridad.perfiles"] };
    const v = puedeOtorgar(actor, ["planillas.pagar"]);
    expect(v.ok).toBe(false);
    expect(motivo(v)).toContain("planillas.pagar");
  });

  it("no deja fabricar un perfil con acceso total desde permisos parciales", () => {
    const actor = { permisos: ["seguridad.perfiles", "empleados.ver"] };
    expect(puedeOtorgar(actor, [COMODIN]).ok).toBe(false);
  });

  it("quien ya tiene el comodín sí puede otorgarlo", () => {
    expect(puedeOtorgar({ permisos: [COMODIN] }, [COMODIN]).ok).toBe(true);
    expect(puedeOtorgar({ permisos: [COMODIN] }, [...TODOS_LOS_PERMISOS]).ok).toBe(true);
  });

  it("el comodín de módulo cubre los permisos de ese módulo", () => {
    const actor = { permisos: ["empleados.*"] };
    expect(puedeOtorgar(actor, ["empleados.pii", "empleados.importar"]).ok).toBe(true);
    expect(puedeOtorgar(actor, ["planillas.ver"]).ok).toBe(false);
  });

  it("un actor sin permisos no otorga nada", () => {
    expect(puedeOtorgar({}, ["empleados.ver"]).ok).toBe(false);
    expect(puedeOtorgar({ permisos: [] }, []).ok).toBe(true); // conceder nada es válido
  });
});

describe("cambioSobreSiMismo", () => {
  const actor = { id: "u1", permisos: [PERMISO_LLAVE, "empleados.ver"] };

  it("no deja desactivarse a sí mismo", () => {
    const v = cambioSobreSiMismo(actor, { activo: false });
    expect(v.ok).toBe(false);
    expect(motivo(v)).toContain("su propia cuenta");
  });

  it("no deja quitarse el permiso desde el que se administra", () => {
    const v = cambioSobreSiMismo(actor, { permisos: ["empleados.ver"] });
    expect(v.ok).toBe(false);
    expect(motivo(v)).toContain("sin acceso");
  });

  it("permite cambiarse otras cosas", () => {
    expect(cambioSobreSiMismo(actor, { permisos: [PERMISO_LLAVE, "planillas.ver"] }).ok).toBe(true);
    expect(cambioSobreSiMismo(actor, { activo: true }).ok).toBe(true);
  });
});

describe("dejariaSinAdministrador", () => {
  const admin = { id: "u1", activo: true, permisos: [PERMISO_LLAVE] };

  it("bloquea desactivar al último administrador", () => {
    const v = dejariaSinAdministrador(admin, { activo: false }, 0);
    expect(v.ok).toBe(false);
    expect(motivo(v)).toContain("única cuenta activa");
  });

  it("bloquea quitarle el permiso llave al último administrador", () => {
    expect(dejariaSinAdministrador(admin, { permisos: ["empleados.ver"] }, 0).ok).toBe(false);
  });

  it("lo permite en cuanto hay otro administrador activo", () => {
    expect(dejariaSinAdministrador(admin, { activo: false }, 1).ok).toBe(true);
    expect(dejariaSinAdministrador(admin, { permisos: [] }, 1).ok).toBe(true);
  });

  it("no estorba con cuentas que no son administradoras", () => {
    const normal = { id: "u2", activo: true, permisos: ["empleados.ver"] };
    expect(dejariaSinAdministrador(normal, { activo: false }, 0).ok).toBe(true);
  });

  // Un administrador ya inactivo no sostiene el sistema: no hay nada que perder.
  it("no bloquea cambios sobre un administrador ya desactivado", () => {
    const inactivo = { id: "u1", activo: false, permisos: [PERMISO_LLAVE] };
    expect(dejariaSinAdministrador(inactivo, { permisos: [] }, 0).ok).toBe(true);
  });

  it("el comodín cuenta como permiso llave", () => {
    const superAdmin = { id: "u1", activo: true, permisos: [COMODIN] };
    expect(dejariaSinAdministrador(superAdmin, { activo: false }, 0).ok).toBe(false);
  });
});

describe("validarCambioUsuario", () => {
  const actor = { id: "admin", permisos: [PERMISO_LLAVE, "empleados.ver", "empleados.editar"] };
  const objetivo = { id: "u2", activo: true, permisos: ["empleados.ver"] };

  it("acepta un cambio dentro de lo que el actor controla", () => {
    expect(validarCambioUsuario(actor, objetivo, { permisos: ["empleados.editar"] }, 1).ok).toBe(true);
  });

  it("rechaza conceder de más", () => {
    expect(validarCambioUsuario(actor, objetivo, { permisos: ["planillas.pagar"] }, 1).ok).toBe(false);
  });

  /**
   * Sin esta comprobación, quien sólo gestiona usuarios podría desactivar al
   * super administrador —o reasignarle un perfil mínimo— y quedarse como la
   * única persona con acceso efectivo.
   */
  it("rechaza tocar una cuenta con más permisos que la propia", () => {
    const superior = { id: "u3", activo: true, permisos: [COMODIN] };
    const v = validarCambioUsuario(actor, superior, { activo: false }, 1);
    expect(v.ok).toBe(false);
    expect(motivo(v)).toContain("más permisos que la suya");
  });

  it("aplica también las reglas sobre uno mismo", () => {
    const propio = { id: "admin", activo: true, permisos: [PERMISO_LLAVE, "empleados.ver", "empleados.editar"] };
    expect(validarCambioUsuario(actor, propio, { activo: false }, 5).ok).toBe(false);
  });

  it("aplica también la protección del último administrador", () => {
    const otroAdmin = { id: "u9", activo: true, permisos: [PERMISO_LLAVE] };
    const actorSuper = { id: "root", permisos: [COMODIN] };
    expect(validarCambioUsuario(actorSuper, otroAdmin, { activo: false }, 0).ok).toBe(false);
    expect(validarCambioUsuario(actorSuper, otroAdmin, { activo: false }, 2).ok).toBe(true);
  });
});

describe("puedeBorrarPerfil", () => {
  it("protege los perfiles de sistema", () => {
    expect(puedeBorrarPerfil({ esSistema: true, usuariosAsignados: 0 }).ok).toBe(false);
  });

  it("no borra un perfil con usuarios asignados", () => {
    const v = puedeBorrarPerfil({ esSistema: false, usuariosAsignados: 3 });
    expect(v.ok).toBe(false);
    expect(motivo(v)).toContain("3 usuario(s)");
  });

  it("borra un perfil libre", () => {
    expect(puedeBorrarPerfil({ esSistema: false, usuariosAsignados: 0 }).ok).toBe(true);
  });
});
