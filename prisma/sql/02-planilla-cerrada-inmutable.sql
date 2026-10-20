-- ═══════════════════════════════════════════════════════════════════════════
-- Inmutabilidad de la planilla cerrada (APROBADA / PAGADA / ANULADA)
--
-- La aplicación ya impide editar una planilla cerrada, y `hashCalculo` DETECTA
-- una alteración hecha por fuera. Estos triggers la IMPIDEN: son la diferencia
-- entre enterarse de que alguien cambió un monto pagado y que no pueda hacerlo,
-- ni siquiera con acceso directo a la base de datos.
--
-- Qué sigue permitido en una planilla cerrada:
--   · Planilla        → cambios de estado y su metadata (anulación, pago, sello).
--   · PlanillaDetalle → sólo el control de envío de boleta (emailEnviado).
-- Cualquier otra columna queda congelada. La comparación es por diferencia de
-- jsonb en vez de campo por campo para que FALLE CERRADO: una columna nueva
-- queda protegida automáticamente, sin tener que acordarse de listarla aquí.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Cabecera de planilla ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION planilla_cerrada_inmutable() RETURNS trigger AS $$
BEGIN
  IF OLD."estado"::text NOT IN ('APROBADA', 'PAGADA', 'ANULADA') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'La planilla % está % y no puede eliminarse: es un documento contable cerrado (se anula, no se borra)',
      OLD."id", OLD."estado"
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF (to_jsonb(NEW) - 'estado' - 'observaciones' - 'aprobadoPor' - 'pagadoPor'
        - 'anuladaPor' - 'motivoAnulacion' - 'fechaPago' - 'cerradaAt'
        - 'hashCalculo' - 'updatedAt')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'estado' - 'observaciones' - 'aprobadoPor' - 'pagadoPor'
        - 'anuladaPor' - 'motivoAnulacion' - 'fechaPago' - 'cerradaAt'
        - 'hashCalculo' - 'updatedAt')
  THEN
    RAISE EXCEPTION 'La planilla % está % : sus importes y su período no admiten cambios',
      OLD."id", OLD."estado"
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS planilla_cerrada_inmutable_trg ON "Planilla";
CREATE TRIGGER planilla_cerrada_inmutable_trg
  BEFORE UPDATE OR DELETE ON "Planilla"
  FOR EACH ROW EXECUTE FUNCTION planilla_cerrada_inmutable();

-- ─── Líneas de planilla ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION planilla_detalle_inmutable() RETURNS trigger AS $$
DECLARE
  planilla_id   text := COALESCE(NEW."planillaId", OLD."planillaId");
  estado_actual text;
BEGIN
  SELECT p."estado"::text INTO estado_actual FROM "Planilla" p WHERE p."id" = planilla_id;

  IF estado_actual IS NULL OR estado_actual NOT IN ('APROBADA', 'PAGADA', 'ANULADA') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'La planilla % está % : no admite % de líneas',
      planilla_id, estado_actual, lower(TG_OP)
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF (to_jsonb(NEW) - 'emailEnviado' - 'emailEnviadoAt' - 'updatedAt')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'emailEnviado' - 'emailEnviadoAt' - 'updatedAt')
  THEN
    RAISE EXCEPTION 'La planilla % está % : los importes de la línea del empleado % no admiten cambios',
      planilla_id, estado_actual, OLD."empleadoId"
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS planilla_detalle_inmutable_trg ON "PlanillaDetalle";
CREATE TRIGGER planilla_detalle_inmutable_trg
  BEFORE INSERT OR UPDATE OR DELETE ON "PlanillaDetalle"
  FOR EACH ROW EXECUTE FUNCTION planilla_detalle_inmutable();
