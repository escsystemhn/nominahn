import { describe, it, expect } from "vitest";
import { correoDeComprobantes } from "./destinatario";

describe("correoDeComprobantes — a dónde va el comprobante", () => {
  it("prefiere el correo personal", () => {
    expect(correoDeComprobantes({
      emailPersonal: "ana@gmail.com", emailCorporativo: "ana@empresa.hn", user: { email: "ana@nominahn.hn" },
    })).toBe("ana@gmail.com");
  });

  it("sin personal, usa el corporativo", () => {
    expect(correoDeComprobantes({ emailCorporativo: "ana@empresa.hn", user: { email: "u@x.hn" } }))
      .toBe("ana@empresa.hn");
  });

  it("sin ninguno de los dos, el de la cuenta de usuario", () => {
    expect(correoDeComprobantes({ user: { email: "ana@nominahn.hn" } })).toBe("ana@nominahn.hn");
  });

  it("un operario SIN cuenta de usuario recibe su comprobante si tiene correo en la ficha", () => {
    // El caso que fallaba: antes sólo se miraba `user.email`.
    expect(correoDeComprobantes({ emailPersonal: "kevin@gmail.com", user: null })).toBe("kevin@gmail.com");
  });

  it("los vacíos o con espacios no cuentan", () => {
    expect(correoDeComprobantes({ emailPersonal: "  ", emailCorporativo: "", user: null })).toBeNull();
  });
});
