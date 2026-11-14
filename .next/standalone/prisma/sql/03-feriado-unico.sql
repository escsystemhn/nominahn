-- ═══════════════════════════════════════════════════════════════════════════
-- Unicidad del feriado
--
-- Impide cargar dos veces el mismo feriado, lo que duplicaría el recargo del
-- Art. 339 sobre las horas de ese día.
--
-- Por qué no basta el @@unique([fecha, sucursalId]) del schema: en SQL
-- NULL <> NULL, y `sucursalId` es NULL justamente en los feriados NACIONALES,
-- que son la mayoría. Ese unique deja pasar tantos "1 de enero" nacionales como
-- se inserten. Es el mismo motivo por el que la unicidad de período de Planilla
-- vive en 01-planilla-periodo-unico.sql y no en el schema.
-- ═══════════════════════════════════════════════════════════════════════════

-- Falla con un mensaje accionable si ya hay duplicados: el CREATE INDEX se
-- caería igual, pero sin decir cuáles son.
DO $$
DECLARE
  duplicados text;
BEGIN
  SELECT string_agg(
           format('  %s → %s registros (%s)',
                  to_char("fecha", 'YYYY-MM-DD'),
                  n,
                  COALESCE("sucursalId", 'nacional')),
           E'\n')
    INTO duplicados
  FROM (
    SELECT "fecha", "sucursalId", count(*) AS n
    FROM "Feriado"
    GROUP BY "fecha", COALESCE("sucursalId", ''), "sucursalId"
    HAVING count(*) > 1
  ) d;

  IF duplicados IS NOT NULL THEN
    RAISE EXCEPTION E'Existen feriados duplicados; elimina los sobrantes antes de aplicar el índice:\n%', duplicados;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Feriado_fecha_ambito_key"
  ON "Feriado" ("fecha", COALESCE("sucursalId", ''));
