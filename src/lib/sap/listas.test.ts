import { describe, it, expect } from "vitest";
import { ServiceLayer, rutaRelativa } from "./service-layer";
import { Money } from "@/lib/payroll/money";
import type { PartidaContable } from "@/lib/payroll/partida-contable";
import { construirAsiento, type MapeoSap, type OpcionesAsiento } from "./asiento";

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

/** Servidor con sesión fija y un plan de 45 cuentas paginado de 20 en 20. */
function servidorPaginado(opts: { sinSelect?: boolean; nextAbsoluto?: boolean } = {}) {
  const peticiones: string[] = [];
  const cuentas = Array.from({ length: 45 }, (_, i) => ({ Code: `C${String(i).padStart(3, "0")}`, Name: `Cuenta ${i}`, FormatCode: `${1000 + i}` }));
  const fetchImpl: typeof fetch = async (entrada, init) => {
    const url = String(entrada);
    peticiones.push(url + "|" + ((init?.headers as Record<string, string>)?.Prefer ?? ""));
    if (url.endsWith("/Login")) {
      const h = new Headers({ "content-type": "application/json" });
      h.append("set-cookie", "B1SESSION=s1; Path=/");
      return new Response(JSON.stringify({ SessionId: "s1", Version: "1000230", SessionTimeout: 30 }), { status: 200, headers: h });
    }
    if (url.endsWith("/Logout")) return new Response(null, { status: 204 });
    const u = new URL(url);
    if (u.pathname.endsWith("/ChartOfAccounts")) {
      if (opts.sinSelect && u.searchParams.has("$select")) {
        return json({ error: { code: -1, message: { value: "Invalid property 'FrozenFor'" } } }, 400);
      }
      const tam = Number(/odata\.maxpagesize=(\d+)/.exec((init?.headers as Record<string, string>)?.Prefer ?? "")?.[1] ?? 20);
      const skip = Number(u.searchParams.get("$skip") ?? 0);
      const pagina = cuentas.slice(skip, skip + tam);
      const hayMas = skip + tam < cuentas.length;
      const siguiente = `ChartOfAccounts?$orderby=Code&$skip=${skip + tam}`;
      return json({ value: pagina, ...(hayMas ? { "@odata.nextLink": opts.nextAbsoluto ? `https://sap.local:50000/b1s/v1/${siguiente}` : siguiente } : {}) });
    }
    if (u.pathname.endsWith("/BusinessPlaces")) {
      return json({ value: [{ BPLID: 1, BPLName: "Sede Central", Disabled: "tNO" }, { BPLID: 2, BPLName: "San Pedro Sula", Disabled: "tNO" }] });
    }
    return json({ error: { code: -1, message: { value: "Resource not found" } } }, 404);
  };
  return { fetchImpl, peticiones };
}

const cfg = (fetchImpl: typeof fetch) => ({ urlBase: "https://sap.local:50000/b1s/v1/", companyDb: "SBO", usuario: "u", password: "p", fetchImpl });

describe("listarPlanCuentas", () => {
  it("sigue el nextLink relativo hasta traer todo, pidiendo páginas grandes", async () => {
    const srv = servidorPaginado();
    const lista = await new ServiceLayer(cfg(srv.fetchImpl)).listarPlanCuentas(20);
    expect(lista).toHaveLength(45);
    expect(lista[44].Code).toBe("C044");
    const paginas = srv.peticiones.filter((p) => p.includes("ChartOfAccounts"));
    expect(paginas).toHaveLength(3);
    expect(paginas[0]).toMatch(/odata\.maxpagesize=20$/);
    expect(paginas[0]).toContain("$select=Code,Name,FormatCode,ActiveAccount,FatherAccountKey,AccountLevel,AccountType,FrozenFor");
  });

  it("acepta nextLink absoluto", async () => {
    const srv = servidorPaginado({ nextAbsoluto: true });
    expect(await new ServiceLayer(cfg(srv.fetchImpl)).listarPlanCuentas(20)).toHaveLength(45);
  });

  it("si el servidor rechaza el $select, vuelve a pedir sin él", async () => {
    const srv = servidorPaginado({ sinSelect: true });
    const lista = await new ServiceLayer(cfg(srv.fetchImpl)).listarPlanCuentas(50);
    expect(lista).toHaveLength(45);
    const paginas = srv.peticiones.filter((p) => p.includes("ChartOfAccounts"));
    expect(paginas[0]).toContain("$select");
    expect(paginas[1]).not.toContain("$select");
  });

  it("lista las sucursales de SAP", async () => {
    const srv = servidorPaginado();
    const s = await new ServiceLayer(cfg(srv.fetchImpl)).listarSucursales();
    expect(s.map((x) => x.BPLID)).toEqual([1, 2]);
  });
});

describe("rutaRelativa", () => {
  const base = "https://sap.local:50000/b1s/v1/";
  it("relativa, absoluta con la misma base, absoluta con otra base y vacía", () => {
    expect(rutaRelativa("ChartOfAccounts?$skip=20", base)).toBe("ChartOfAccounts?$skip=20");
    expect(rutaRelativa("/ChartOfAccounts?$skip=20", base)).toBe("ChartOfAccounts?$skip=20");
    expect(rutaRelativa("https://sap.local:50000/b1s/v1/ChartOfAccounts?$skip=20", base)).toBe("ChartOfAccounts?$skip=20");
    expect(rutaRelativa("https://otro-nodo:50000/b1s/v1/ChartOfAccounts?$skip=40", base)).toBe("ChartOfAccounts?$skip=40");
    expect(rutaRelativa(null, base)).toBeNull();
    expect(rutaRelativa("", base)).toBeNull();
  });
});

describe("construirAsiento con sucursales de SAP", () => {
  const m = (v: number) => new Money(v);
  const partida = {
    lineas: [
      { clave: "sueldos", cuenta: "610201", nombre: "Sueldos", debe: m(100), haber: m(0) },
      { clave: "sueldosPorPagar", cuenta: "2111", nombre: "Por pagar", debe: m(0), haber: m(100) },
    ],
    totalDebe: m(100),
    totalHaber: m(100),
    cuadra: true,
    diferencia: m(0),
    anomalias: [],
  } as unknown as PartidaContable;
  const mapeo: MapeoSap = {
    porClave: { sueldos: { acctCode: "A", nombre: "Sueldos", codigoLocal: "610201" }, sueldosPorPagar: { acctCode: "B", nombre: "Por pagar", codigoLocal: "2111" } },
    centros: {},
  };
  const base: OpcionesAsiento = {
    planillaId: "p1",
    tipoPlanilla: "MENSUAL",
    empresa: "E",
    fechaInicio: new Date("2026-10-01T00:00:00Z"),
    fechaFin: new Date("2026-10-31T00:00:00Z"),
    fechaPago: null,
    fechaContable: "FIN_PERIODO",
    porCentroCosto: false,
    dimensionCentro: 1,
    memoPlantilla: "x",
    longitudes: { memo: 50, lineMemo: 50, referencia: 100 },
  };

  it("sin sucursales no hay BPLID; con sucursal va en todas las líneas", () => {
    expect(construirAsiento(partida, mapeo, base).payload?.JournalEntryLines.every((l) => l.BPLID === undefined)).toBe(true);
    const r = construirAsiento(partida, mapeo, { ...base, sucursal: { usa: true, bplId: 2, nombre: "San Pedro Sula" } });
    expect(r.errores).toEqual([]);
    expect(r.payload?.JournalEntryLines.map((l) => l.BPLID)).toEqual([2, 2]);
  });

  it("sucursal local sin equivalente en SAP, o planilla de toda la empresa sin sucursal por omisión: error claro", () => {
    expect(construirAsiento(partida, mapeo, { ...base, sucursal: { usa: true, bplId: null, nombre: "La Ceiba" } }).errores[0]).toMatch(/La sucursal La Ceiba no tiene sucursal de SAP asignada/);
    expect(construirAsiento(partida, mapeo, { ...base, sucursal: { usa: true, bplId: null, nombre: null } }).errores[0]).toMatch(/planillas de toda la empresa necesitan una sucursal de SAP por omisión/);
  });
});
