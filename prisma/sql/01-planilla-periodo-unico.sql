-- ═══════════════════════════════════════════════════════════════════════════
-- Unicidad del período de planilla
--
-- Impide emitir dos planillas para la misma (empresa, sucursal, tipo, período)
-- y con ello el doble pago. Es la red de seguridad de la verificación que hace
-- la aplicación: protege también contra escrituras concurrentes y contra
-- cualquier cliente que escriba directo en la base.
--
-- Por qué no está en schema.prisma — Prisma no puede expresar ninguna de las dos
-- cosas que este índice necesita:
--
--   1. PARCIAL (WHERE estado <> 'ANULADA'). El flujo de corrección del sistema es
--      anular y reemitir; un único total dejaría un período anulado bloqueado
--      para siempre. La lista replica ESTADOS_OCUPAN_PERIODO de
--      src/lib/payroll/estado-planilla.ts — si cambia una, cambia la otra.
--
--   2. COALESCE sobre "sucursalId". En SQL NULL <> NULL, así que un único normal
--      dejaría pasar dos planillas de empresa completa (sucursalId NULL) para el
--      mismo período: justo el caso que más se repite.
-- ═══════════════════════════════════════════════════════════════════════════

-- Falla con un mensaje accionable si ya existen duplicados: el CREATE INDEX de
-- abajo se caería igual, pero con un error que no dice cuáles son.
DO $$
DECLARE
  duplicados text;
BEGIN
  SELECT string_agg(
           format('  empresa=%s sucursal=%s tipo=%s período=%s..%s → %s planillas',
                  "empresaId", COALESCE("sucursalId", '(toda la empresa)'),
                  "tipo", "fechaInicio", "fechaFin", n),
           E'\n')
    INTO duplicados
  FROM (
    SELECT "empresaId", "sucursalId", "tipo", "fechaInicio", "fechaFin", count(*) AS n
    FROM "Planilla"
    WHERE "estado" <> 'ANULADA'
    GROUP BY "empresaId", "sucursalId", "tipo", "fechaInicio", "fechaFin"
    HAVING count(*) > 1
  ) d;

  IF duplicados IS NOT NULL THEN
    RAISE EXCEPTION E'Existen planillas duplicadas; resuélvelas (anular las sobrantes) antes de aplicar el índice:\n%', duplicados;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Planilla_periodo_vigente_key"
  ON "Planilla" (
    "empresaId",
    COALESCE("sucursalId", ''),
    "tipo",
    "fechaInicio",
    "fechaFin"
  )
  WHERE "estado" <> 'ANULADA';
