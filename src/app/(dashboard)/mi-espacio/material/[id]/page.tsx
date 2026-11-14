import { requerirSesionPagina } from "@/lib/auth/guard";
import VisorMaterial from "@/components/portal/VisorMaterial";

export const metadata = { title: "Material de capacitación" };

/**
 * El visor de un material de capacitación. Lo abre quien está inscrito (desde Mi espacio)
 * o quien administra capacitaciones; quién puede verlo lo decide la API.
 */
export default async function MaterialPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ volver?: string }>;
}) {
  await requerirSesionPagina();
  const { id } = await params;
  const sp = await searchParams;
  return <VisorMaterial materialId={id} volver={sp.volver === "capacitaciones" ? "/capacitaciones" : "/mi-espacio?tab=capacitaciones"} />;
}
