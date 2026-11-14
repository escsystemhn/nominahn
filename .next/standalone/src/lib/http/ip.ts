/**
 * IP para el límite: la última de `x-forwarded-for`, que es la que añade el
 * proxy más cercano. Las anteriores las puede escribir el propio cliente.
 */
export function ipParaLimite(xForwardedFor: string | null, xRealIp: string | null): string {
  const ultima = xForwardedFor?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return ultima || xRealIp?.trim() || "desconocida";
}
