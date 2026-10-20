-- ═══════════════════════════════════════════════════════════════════════════
-- Inmutabilidad del rastro de auditoría
--
-- `AuditLog` es de SÓLO INSERCIÓN. Sin esto, quien tenga acceso directo a la
-- base puede modificar un salario y después borrar la evidencia de haberlo
-- hecho — lo que deja el rastro sin ningún valor probatorio.
--
-- Es la misma doctrina que ya protege la planilla cerrada
-- (02-planilla-cerrada-inmutable.sql): la aplicación no borra registros de
-- auditoría, así que el trigger no rompe ningún flujo legítimo.
--
-- PURGA: si algún día hace falta retener sólo N años, deshabilitar el trigger
-- explícitamente para esa operación y volver a habilitarlo, dejando constancia:
--   ALTER TABLE "AuditLog" DISABLE TRIGGER auditlog_solo_insercion_trg;
--   DELETE FROM "AuditLog" WHERE "createdAt" < now() - interval '7 years';
--   ALTER TABLE "AuditLog" ENABLE TRIGGER auditlog_solo_insercion_trg;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auditlog_solo_insercion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog es de sólo inserción: no admite % (registro %)',
    lower(TG_OP), COALESCE(OLD."id", '?')
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auditlog_solo_insercion_trg ON "AuditLog";
CREATE TRIGGER auditlog_solo_insercion_trg
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION auditlog_solo_insercion();

-- ─── Historial salarial ────────────────────────────────────────────────────
-- Mismo criterio: el historial de salarios es un registro histórico. Se corrige
-- añadiendo un asiento nuevo, no reescribiendo el anterior.

CREATE OR REPLACE FUNCTION historial_salario_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'HistorialSalario es de sólo inserción: no admite % (registro %)',
    lower(TG_OP), COALESCE(OLD."id", '?')
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS historial_salario_inmutable_trg ON "HistorialSalario";
CREATE TRIGGER historial_salario_inmutable_trg
  BEFORE UPDATE OR DELETE ON "HistorialSalario"
  FOR EACH ROW EXECUTE FUNCTION historial_salario_inmutable();
