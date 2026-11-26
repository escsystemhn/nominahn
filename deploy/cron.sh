#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Gestión360 Nómina — tareas programadas (las mismas que corre el instalador de
# Windows cada 5 minutos). 03-app.sh lo deja en el crontab del usuario `deploy`:
#
#   */5 * * * *  ~/nominahn/deploy/cron.sh biometrico sap
#   */15 * * * * ~/nominahn/deploy/cron.sh respaldos
#   0 3 * * 0    ~/nominahn/deploy/probar-restauracion.sh
#   15 6 * * *   ~/nominahn/deploy/cron.sh evaluaciones
#
# Cada ruta decide sola si le toca hacer algo (por ejemplo, Configuración →
# Respaldos sólo respalda a la hora elegida). La clave se lee de .env.local en
# cada llamada: así no queda copiada en el crontab ni en la lista de procesos.
# Lo que pasa queda en el journal:  journalctl -t gestion360-cron
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUERTO="${PUERTO:-3009}"
registrar() { logger -t gestion360-cron -- "$*" 2>/dev/null || echo "$*"; }

CLAVE="$(grep -E '^CRON_SECRET=' "$APP/.env.local" 2>/dev/null | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
if [[ -z "$CLAVE" ]]; then
  registrar "sin CRON_SECRET en $APP/.env.local: no se llama a nada"
  exit 1
fi

# Un respaldo a la nube puede tardar; mientras corre, la vuelta siguiente no se encima.
# Un candado por grupo de rutas (2026-11-25): el respaldo largo no frena relojes ni SAP.
exec 9>"${XDG_RUNTIME_DIR:-/tmp}/gestion360-cron-$(id -u)-$(IFS=-; echo "$*").lock"
if command -v flock >/dev/null && ! flock -n 9; then
  registrar "la vuelta anterior sigue en curso: se omite ésta"
  exit 0
fi

for ruta in "$@"; do
  [[ "$ruta" =~ ^[a-z]+$ ]] || { registrar "ruta inválida: $ruta"; continue; }
  limite=60
  [[ "$ruta" == "respaldos" ]] && limite=3600
  # La clave va por la entrada estándar (-H @-), no como argumento visible en `ps`.
  codigo=$(printf 'x-cron-secret: %s\n' "$CLAVE" | curl -s -o /dev/null -w '%{http_code}' --max-time "$limite" \
    -X POST -H @- "http://127.0.0.1:${PUERTO}/api/cron/${ruta}") || codigo="000"
  registrar "/api/cron/${ruta} → ${codigo}"
done
