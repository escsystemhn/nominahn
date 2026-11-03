import { describe, expect, it, vi } from "vitest";
import { filtroBusquedaEmpleados, patronLike } from "./busqueda";

/** Lo que llegaría a la base: el texto de la consulta y sus valores. */
function dobleDeBase(ids: string[] = []) {
  const consultas: Array<{ sql: string; valores: unknown[] }> = [];
  const $queryRaw = vi.fn((partes: TemplateStringsArray, ...valores: Array<{ sql?: string; values?: unknown[] }>) => {
    consultas.push({ sql: partes.join("?") + valores.map((v) => v.sql ?? "").join(" "), valores: valores.flatMap((v) => v.values ?? []) });
    return Promise.resolve(ids.map((id) => ({ id })));
  });
  return { db: { $queryRaw } as never, consultas };
}

describe("filtroBusquedaEmpleados", () => {
  it("sin texto no filtra ni consulta", async () => {
    const { db, consultas } = dobleDeBase();
    expect(await filtroBusquedaEmpleados(db, "   ", { conIdentidad: false })).toEqual({});
    expect(consultas).toHaveLength(0);
  });

  it("cada palabra se exige por separado, sin tildes", async () => {
    const { db, consultas } = dobleDeBase(["e1"]);
    expect(await filtroBusquedaEmpleados(db, "Ana  Mejía ", { conIdentidad: false })).toEqual({ id: { in: ["e1"] } });
    expect(consultas[0].valores).toEqual(["%ana%", "%mejia%"]);
  });

  it("sin coincidencias, el filtro no deja pasar a nadie", async () => {
    const { db } = dobleDeBase([]);
    expect(await filtroBusquedaEmpleados(db, "nadie", { conIdentidad: false })).toEqual({ id: { in: [] } });
  });

  it("no busca por identidad si la persona no puede verla", async () => {
    const sin = dobleDeBase();
    await filtroBusquedaEmpleados(sin.db, "0801", { conIdentidad: false });
    expect(sin.consultas[0].sql).not.toContain("identidad");

    const con = dobleDeBase();
    await filtroBusquedaEmpleados(con.db, "0801", { conIdentidad: true });
    expect(con.consultas[0].sql).toContain("identidad");
  });
});

describe("patronLike", () => {
  it("lo que escribe la persona es literal, no un comodín", () => {
    expect(patronLike("50%")).toBe("%50\\%%");
    expect(patronLike("a_b")).toBe("%a\\_b%");
    expect(patronLike("c:\\x")).toBe("%c:\\\\x%");
  });
});
