/**
 * Lo que se ve mientras llega una pantalla. Copia la forma de la mayoría (cabecera y
 * tabla) para que el contenido aparezca sin que todo salte de lugar.
 */
const BLOQUE = "rounded bg-gray-200 animate-pulse motion-reduce:animate-none";

export default function Cargando() {
  return (
    <div className="space-y-6" role="status" aria-label="Cargando la pantalla">
      <div className="border-b border-gray-200 pb-5">
        <div className={`${BLOQUE} h-7 w-48 max-w-full`} />
        <div className={`${BLOQUE} mt-2 h-4 w-80 max-w-full`} />
      </div>
      <div className="panel space-y-4 p-4" aria-hidden="true">
        <div className={`${BLOQUE} h-4 w-full`} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-4">
            <div className={`${BLOQUE} h-4 w-1/4`} />
            <div className={`${BLOQUE} h-4 w-1/3`} />
            <div className={`${BLOQUE} h-4 flex-1`} />
          </div>
        ))}
      </div>
    </div>
  );
}
