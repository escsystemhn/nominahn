#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Gestión360 Nómina — prueba de restauración semanal (2026-11-25).
#
# Restaura el último respaldo de RESPALDOS_DIR (el destino «Disco local» de
# Configuración → Respaldos) en una base aparte, cuenta tablas, empleados y
# planillas, la borra y deja el resultado en la aplicación: lo muestra en
# Configuración → Respaldos y en Inicio, y si falló avisa por correo.
#
# 03-app.sh la deja en el crontab de `deploy`:   0 3 * * 0  …/deploy/probar-restauracion.sh
# Si los respaldos van cifrados, su contraseña en ~/.config/gestion360/respaldo-clave (chmod 600).
# Lo que pasa queda en el journal:  journalctl -t gestion360-respaldos
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/respaldos-comun.sh"
leer_conexion

DIR_RESP="$(leer RESPALDOS_DIR)"; DIR_RESP="${DIR_RESP:-/var/backups/gestion360}"
TRABAJO="$(mktemp -d "${TMPDIR:-/tmp}/g360-prueba-XXXXXX")"
INICIO=$(date +%s)
FECHA="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
OK=false; DETALLE=""; ARCHIVO=""; TABLAS=0; EMPLEADOS=0; PLANILLAS=0

guardar() {
  local json duracion archivo_json=null
  duracion=$(( ($(date +%s) - INICIO) * 1000 ))
  DETALLE="${DETALLE//\\/\\\\}"; DETALLE="${DETALLE//\"/\\\"}"
  [[ -n "$ARCHIVO" ]] && archivo_json="\"$ARCHIVO\""
  json="{\"ok\":$OK,\"fecha\":\"$FECHA\",\"archivo\":$archivo_json,\"detalle\":\"$DETALLE\",\"tablas\":${TABLAS:-0},\"empleados\":${EMPLEADOS:-0},\"planillas\":${PLANILLAS:-0},\"duracionMs\":$duracion}"
  admin_sql -d "$BASE" -v valor="$json" <<'SQL' || registrar "No se pudo guardar el resultado en la base."
INSERT INTO "ConfiguracionSistema" (id, clave, valor, descripcion, "updatedAt")
VALUES (gen_random_uuid()::text, 'RESPALDOS_PRUEBA_RESTAURACION', :'valor', 'Respaldos: la última prueba de restauración.', now())
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, "updatedAt" = now();
SQL
}

terminar() {
  borrar_base "$BD_PRUEBA"
  rm -rf "$TRABAJO"
  guardar
  if [[ "$OK" == true ]]; then registrar "Prueba de restauración correcta. $DETALLE"; else registrar "La prueba de restauración FALLÓ: $DETALLE"; fi
}

fallo() { DETALLE="$*"; terminar; exit 1; }

# El último respaldo de la app; si no hay, el último «antes de actualizar» de 03-app.sh.
# Sólo los de nombre con fecha (g360-nomina_AAAA-MM-DD_HHMMSS_…): otro nombre no puede quedar «último».
ULTIMO="$(ls -1 "$DIR_RESP"/g360-nomina_[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]_*.tar.gz "$DIR_RESP"/g360-nomina_[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]_*.tar.gz.enc 2>/dev/null | sort | tail -n1)"
NOTA=""
if [[ -z "$ULTIMO" ]]; then
  ULTIMO="$(ls -1 "$HOME"/respaldos-despliegue/*.dump 2>/dev/null | sort | tail -n1)"
  NOTA=" Se probó el respaldo de antes del último despliegue: no hay respaldos de Configuración → Respaldos en $DIR_RESP."
fi
[[ -n "$ULTIMO" ]] || fallo "No hay ningún respaldo en disco para probar ($DIR_RESP)."
ARCHIVO="$(basename "$ULTIMO")"

# En un subshell: si no abre, `morir` termina sólo ahí y el motivo queda en el registro.
( abrir_respaldo "$ULTIMO" "$TRABAJO/r" && declare -p DUMP MANIFIESTO > "$TRABAJO/abierto" ) >"$TRABAJO/abrir.log" 2>&1 \
  || fallo "No se pudo abrir $ARCHIVO: $(grep -h 'ERROR:' "$TRABAJO/abrir.log" | tail -n1 | sed 's/^ERROR: //')"
source "$TRABAJO/abierto"
restaurar_en "$BD_PRUEBA" "$DUMP" >"$TRABAJO/.restaurar.log" 2>&1 || fallo "pg_restore no pudo restaurar $ARCHIVO: $(tail -n2 "$TRABAJO/.restaurar.log" | tr '\n' ' ')"

contar() { admin_sql -d "$BD_PRUEBA" -tAc "$1"; }
TABLAS="$(contar "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
EMPLEADOS="$(contar 'SELECT count(*) FROM "Empleado"')"
PLANILLAS="$(contar 'SELECT count(*) FROM "Planilla"')"
[[ "$TABLAS" -gt 0 ]] || fallo "La base restaurada quedó sin tablas."

E_ANOTADO="$(conteo_del_manifiesto empleados)"; P_ANOTADO="$(conteo_del_manifiesto planillas)"
COMPARA=""
if [[ -n "$E_ANOTADO" ]]; then
  if [[ "$E_ANOTADO" == "$EMPLEADOS" && "$P_ANOTADO" == "$PLANILLAS" ]]; then COMPARA=", lo mismo que anotó el respaldo"
  else COMPARA=" (el respaldo anotó $E_ANOTADO y $P_ANOTADO: pudo haber movimiento mientras se hacía)"; fi
fi
OK=true
DETALLE="Se restauró $ARCHIVO en una base aparte: $TABLAS tablas, $EMPLEADOS empleados y $PLANILLAS planillas$COMPARA. La base de prueba se borró.$NOTA"
terminar
