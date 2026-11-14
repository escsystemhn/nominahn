/**
 * Lectura de un monto o porcentaje escrito a mano en un formulario. PURO: sirve
 * en el navegador y en el servidor.
 *
 * POR QUÉ NO `<input type="number">`. Con la coma decimal, el navegador hace una
 * de dos cosas según el idioma de Windows: deja el campo «inválido» y lo envía
 * vacío («Monto empleado: requerido»), o quita la coma y «297,58» se guarda como
 * 29,758. Ninguna avisa. Aquí se lee el texto con la convención de Honduras:
 *
 *   · Punto decimal y coma de miles: «1,011.77», «297.58».
 *   · También coma decimal: «297,58» → 297.58; «1.011,77» → 1011.77.
 *   · Una coma seguida de exactamente 3 dígitos es de miles: «1,011» → 1011.
 *   · «L», «L.» o «HNL» delante se ignoran.
 *   · Más decimales de los permitidos es un error, no un redondeo silencioso.
 */

export type LecturaMonto = { ok: true; valor: number | null } | { ok: false; error: string };

export function leerMonto(texto: string, opciones: { decimales?: number } = {}): LecturaMonto {
  const decimales = opciones.decimales ?? 2;
  let v = texto.trim().replace(/^(HNL|L\.?)\s*/i, "").replace(/[\s  ]/g, "");
  if (v === "") return { ok: true, valor: null };

  const coma = v.lastIndexOf(",");
  const punto = v.lastIndexOf(".");
  if (coma >= 0 && punto >= 0) {
    // Con los dos, el último es el decimal y el otro separa miles.
    const decimal = coma > punto ? "," : ".";
    v = v.split(decimal === "," ? "." : ",").join("").replace(decimal, ".");
  } else if (coma >= 0) {
    const partes = v.split(",");
    v = partes.length === 2 && partes[1].length !== 3 ? partes.join(".") : partes.join("");
  }

  if (!/^\d+(\.\d+)?$/.test(v)) return { ok: false, error: "escriba sólo el número, como 297.58" };
  const decs = v.split(".")[1] ?? "";
  if (decs.length > decimales) return { ok: false, error: `máximo ${decimales} decimales` };
  return { ok: true, valor: Number(v) };
}

/**
 * El texto en forma canónica para validarlo con una expresión regular: «297,58» →
 * «297.58», vacío → «». Lo que no se entiende se devuelve tal cual, para que la
 * validación del formulario muestre su mensaje.
 */
export function montoComoTexto(texto: string): string {
  const r = leerMonto(texto);
  if (!r.ok) return texto;
  return r.valor === null ? "" : String(r.valor);
}
