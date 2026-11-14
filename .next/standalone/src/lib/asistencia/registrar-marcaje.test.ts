import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { registrarMarcaje } from "./registrar-marcaje";

const FECHA = new Date("2026-10-12T00:00:00.000Z");

function conMarcaje(fuente: string) {
  const upsert = vi.fn(async ({ update }: { update: object }) => update);
  const db = {
    empleado: { count: async () => 1 },
    marcaje: { findUnique: async () => ({ id: "m1", fuente }), upsert },
  };
  return { db: db as unknown as Parameters<typeof registrarMarcaje>[1], upsert };
}

describe("lo que no pisa el reloj", () => {
  it.each(["MANUAL", "PLANTILLA"])("la sincronización respeta un día con fuente %s", async (fuente) => {
    const { db, upsert } = conMarcaje(fuente);
    const r = await registrarMarcaje({ empleadoId: "e1", fecha: FECHA, fuente: "BIOMETRICO", sobrescribirManual: false }, db);
    expect(r).toMatchObject({ ok: true, omitido: true });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("la sincronización sí actualiza lo que vino del reloj", async () => {
    const { db, upsert } = conMarcaje("BIOMETRICO");
    await registrarMarcaje({ empleadoId: "e1", fecha: FECHA, fuente: "BIOMETRICO", sobrescribirManual: false }, db);
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("una corrección manual sí puede cambiar lo cargado por plantilla", async () => {
    const { db, upsert } = conMarcaje("PLANTILLA");
    await registrarMarcaje({ empleadoId: "e1", fecha: FECHA, fuente: "MANUAL" }, db);
    expect(upsert).toHaveBeenCalledOnce();
  });
});
