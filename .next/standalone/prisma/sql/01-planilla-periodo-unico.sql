-- ═══════════════════════════════════════════════════════════════════════════
-- Unicidad del período de planilla
--
-- Impide emitir dos planillas para el mismo (empresa, sucursal, división,
-- departamento, tipo, período) y con ello el doble pago. Es la red de seguridad
-- de la verificación que hace la aplicación: protege también contra escrituras
-- concurrentes y contra cualquier cliente que escriba directo en la base.
--
-- Alcances DISTINTOS que se cruzan (toda la sucursal y una de sus divisiones,
-- por ejemplo) tienen claves distintas aquí: eso lo impide la API, que rechaza
-- a cualquier persona que ya esté en otra planilla vigente del mismo tipo y de
-- fechas que se traslapan (src/app/api/planillas/route.ts).
--
-- Por qué no está en schema.prisma — Prisma no puede expresar ninguna de las dos
-- cosas que este índice necesita:
--
--   1. PARCIAL (WHERE estado <> 'ANULADA'). El flujo de corrección del sistema es
--      anular y reemitir; un único total dejaría un período anulado bloqueado
--      para siempre. La lista replica ESTADOS_OCUPAN_PERIODO de
--      src/lib/payroll/estado-planilla.ts — si cambia una, cambia la otra.
--
--   2. COALESCE sobre "sucursalId", "divisionId" y "departamentoId". En SQL
--      NULL <> NULL, así que un único normal dejaría pasar dos planillas de
--      empresa completa (todo NULL) para el mismo período: justo el caso que más
--      se repite.
-- ═══════════════════════════════════════════════════════════════════════════

-- Falla con un mensaje accionable si ya existen duplicados: el CREATE INDEX de
-- abajo se caería igual, pero con un error que no dice cuáles son.
DO $$
DECLARE
  duplicados text;
BEGIN
  SELECT string_agg(
           format('  empresa=%s sucursal=%s división=%s departamento=%s tipo=%s período=%s..%s → %s planillas',
                  "empresaId", COALESCE("sucursalId", '(toda la empresa)'),
                  COALESCE("divisionId", '(todas)'), COALESCE("departamentoId", '(todos)'),
                  "tipo", "fechaInicio", "fechaFin", n),
           E'\n')
    INTO duplicados
  FROM (
    SELECT "empresaId", "sucursalId", "divisionId", "departamentoId", "tipo", "fechaInicio", "fechaFin", count(*) AS n
    FROM "Planilla"
    WHERE "estado" <> 'ANULADA'
    GROUP BY "empresaId", "sucursalId", "divisionId", "departamentoId", "tipo", "fechaInicio", "fechaFin"
    HAVING count(*) > 1
  ) d;

  IF duplicados IS NOT NULL THEN
    RAISE EXCEPTION E'Existen planillas duplicadas; resuélvelas (anular las sobrantes) antes de aplicar el índice:\n%', duplicados;
  END IF;
END $$;

-- Se reemplaza en vez de `IF NOT EXISTS`: la versión anterior del índice no
-- incluía división ni departamento, y `IF NOT EXISTS` la habría dejado así.
-- `apply.ts` corre este archivo en una transacción, así que nunca queda la
-- tabla sin índice.
DROP INDEX IF EXISTS "Planilla_periodo_vigente_key";

CREATE UNIQUE INDEX "Planilla_periodo_vigente_key"
  ON "Planilla" (
    "empresaId",
    COALESCE("sucursalId", ''),
    COALESCE("divisionId", ''),
    COALESCE("departamentoId", ''),
    "tipo",
    "fechaInicio",
    "fechaFin"
  )
  WHERE "estado" <> 'ANULADA';
