/**
 * «Probar» un destino tal como está en el formulario, sin guardarlo: escribe, lee y
 * borra un archivo de prueba. Una clave que no se escribió se toma de la guardada.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requerirPermiso } from "@/lib/auth/guard";
import { parsearBody } from "@/lib/http/validar";
import { cifrar, cifradoDisponible } from "@/lib/seguridad/cifrado";
import { esquemaDestino, type Destino } from "@/lib/respaldos/config";
import { probarDestino } from "@/lib/respaldos/destinos";
import { leerConfigRespaldos } from "@/lib/respaldos/respaldos-bd";

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.respaldos");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, z.object({ destino: esquemaDestino }));
  if (!parsed.ok) return parsed.response;
  const d = parsed.data.destino;
  const previo = (await leerConfigRespaldos()).destinos.find((x) => x.id === d.id && x.tipo === d.tipo);

  const nueva = d.tipo === "RED" ? d.clave : d.tipo === "NUBE" ? d.secretAccessKey : null;
  if (nueva && !cifradoDisponible()) return NextResponse.json({ error: "Falta CIFRADO_KEY en el servidor." }, { status: 409 });
  let destino: Destino;
  if (d.tipo === "RED") destino = { ...d, clave: d.clave ? cifrar(d.clave) : previo?.tipo === "RED" ? previo.clave : null };
  else if (d.tipo === "NUBE") destino = { ...d, secretAccessKey: d.secretAccessKey ? cifrar(d.secretAccessKey) : previo?.tipo === "NUBE" ? previo.secretAccessKey : null };
  else destino = d;

  return NextResponse.json(await probarDestino(destino));
}
