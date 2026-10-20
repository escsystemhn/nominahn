/**
 * Contenido de la tapa del inicio de sesión: avisos del calendario laboral,
 * consejo del día, novedades de la versión y contacto de soporte.
 *
 * Es PÚBLICO: se ve antes de autenticarse, así que aquí no va ningún dato de la
 * empresa ni de la nómina. Los avisos sólo recogen obligaciones fijadas por ley;
 * un plazo nuevo se confirma con el contador antes de añadirlo, porque un aviso
 * equivocado es peor que ninguno.
 */

export const VERSION = "1.0";

/** Contacto verificado en esc-systemhn.com. */
export const SOPORTE = {
  whatsapp: "+504 9891-3809",
  whatsappUrl: "https://wa.me/50498913809",
  correo: "info@esc-systemhn.com",
};

export interface Novedad {
  titulo: string;
  detalle: string;
  modulo: string;
}

export const NOVEDADES: Record<string, Novedad[]> = {
  "1.0": [
    {
      titulo: "Nueva imagen",
      detalle: "Paleta derivada del logo de ESC System, tipografía IBM Plex y cifras alineadas en todas las tablas.",
      modulo: "General",
    },
    {
      titulo: "Inicio operativo",
      detalle: "Conteos del día, solicitudes por aprobar y últimas planillas, según lo que cada perfil puede ver.",
      modulo: "Inicio",
    },
    {
      titulo: "Fondo de Reserva Laboral",
      detalle: "Aporte patronal del 4 % (Decreto 47-2024) en la planilla, el costo patronal y la partida contable.",
      modulo: "Nómina",
    },
    {
      titulo: "Parámetros de ley configurables",
      detalle: "IHSS, IVM, RAP, INFOP, la tabla de ISR y el impuesto vecinal se editan desde Configuración.",
      modulo: "Configuración",
    },
    {
      titulo: "Comprobantes por correo",
      detalle: "Cada boleta se envía al correo del empleado desde la planilla, con el servidor de correo configurable.",
      modulo: "Nómina",
    },
  ],
};

/** Sólo pantallas y reglas que existen. Entre corchetes va el nombre de una pantalla. */
const CONSEJOS = [
  "En [Mi espacio] cada empleado descarga sus boletas y solicita vacaciones sin pasar por Recursos Humanos.",
  "El reporte [Planilla IHSS] sale con las mismas cifras que se descontaron en la planilla: usa el mismo cálculo.",
  "Una planilla aprobada no se edita: se anula y se vuelve a calcular. Las cuotas de préstamos se devuelven solas.",
  "El almuerzo no cuenta como tiempo de trabajo: si nadie lo marca, se descuentan 60 minutos de la jornada.",
  "En [Parámetros de ley] conviene revisar cada enero el techo del IHSS y la tabla progresiva del ISR.",
  "Las horas extra se liquidan según la franja: 125 % diurna, 175 % nocturna y 200 % en feriado o día de descanso.",
  "Desde [Reportes] la nómina para banco toma sólo planillas aprobadas o pagadas.",
];

export function consejoDelDia(hoy: Date): string {
  const inicio = Date.UTC(hoy.getUTCFullYear(), 0, 1);
  const dia = Math.floor((hoy.getTime() - inicio) / 86_400_000);
  return CONSEJOS[dia % CONSEJOS.length];
}

export interface Aviso {
  tono: "aviso" | "alerta";
  texto: string;
}

/**
 * Avisos del calendario laboral hondureño que se calculan con la fecha del
 * equipo. Sólo los dos décimos, que fija la ley; el resto de plazos depende de
 * cada institución y no se anuncia sin confirmarlo.
 */
export function avisosDelCalendario(hoy: Date): Aviso[] {
  const mes = hoy.getMonth(); // 0 = enero
  const avisos: Aviso[] = [];
  if (mes === 4 || mes === 5) {
    avisos.push({
      tono: mes === 5 ? "alerta" : "aviso",
      texto: "Décimo cuarto mes: se paga en junio (Decreto 135-94). Devenga de julio a junio.",
    });
  }
  if (mes === 10 || mes === 11) {
    avisos.push({
      tono: mes === 11 ? "alerta" : "aviso",
      texto: "Décimo tercer mes (aguinaldo): se paga en diciembre (Decreto 112-82). Devenga de enero a diciembre.",
    });
  }
  if (mes === 0) {
    avisos.push({
      tono: "aviso",
      texto: "Nuevo año: verifique en Parámetros de ley el techo del IHSS y la tabla de ISR vigentes.",
    });
  }
  return avisos;
}
