#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Gestión360 Nómina — lo que comparten restaurar.sh y probar-restauracion.sh
# (2026-11-25). Se incluye con «source», no se ejecuta solo.
#
#   - La conexión de la app sale de DATABASE_URL (.env.local) y va por variables,
#     no en la línea de comandos: así la contraseña no aparece en `ps`.
#   - Las operaciones de superusuario (crear y borrar bases, renombrar) se hacen
#     como `postgres` con sudo; COMO_POSTGRES lo cambia (en pruebas: runuser).
#   - Se restaura SIEMPRE en una base nueva, con el rol de la app y sin dueños ni
#     permisos: los objetos quedan del rol de la app, como en una instalación normal.
# ═══════════════════════════════════════════════════════════════════════════

APP="${APP:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_LOCAL="${ENV_LOCAL:-$APP/.env.local}"
COMO_POSTGRES="${COMO_POSTGRES:-sudo -n -u postgres}"
BD_PRUEBA="g360_prueba_restauracion"

registrar() { logger -t gestion360-respaldos -- "$*" 2>/dev/null || true; echo "$*"; }
morir() { registrar "ERROR: $*"; exit 1; }
leer() { grep -E "^$1=" "$ENV_LOCAL" 2>/dev/null | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'; }
decodificar() { local s="${1//+/ }"; printf '%b' "${s//%/\\x}"; }

# DATABASE_URL → ROL, CLAVE_BD, HOST_BD, PUERTO_BD, BASE
leer_conexion() {
  local url re
  url="$(leer DATABASE_URL)"; url="${url%%\?*}"
  re='^postgres(ql)?://([^:@/]+)(:([^@/]*))?@([^:/]+)(:([0-9]+))?/([^/?]+)$'
  [[ "$url" =~ $re ]] || morir "No se pudo leer DATABASE_URL de $ENV_LOCAL."
  ROL="$(decodificar "${BASH_REMATCH[2]}")"
  CLAVE_BD="$(decodificar "${BASH_REMATCH[4]}")"
  HOST_BD="${BASH_REMATCH[5]}"
  PUERTO_BD="${BASH_REMATCH[7]:-5432}"
  BASE="$(decodificar "${BASH_REMATCH[8]}")"
}

admin_sql() { $COMO_POSTGRES psql -X -q -v ON_ERROR_STOP=1 "$@"; }

# La contraseña de cifrado: RESPALDO_CLAVE, el archivo de la cuenta o, con terminal, se pide.
clave_de_cifrado() {
  [[ -n "${RESPALDO_CLAVE:-}" ]] && return 0
  local archivo="${RESPALDO_CLAVE_ARCHIVO:-$HOME/.config/gestion360/respaldo-clave}"
  if [[ -r "$archivo" ]]; then RESPALDO_CLAVE="$(head -n1 "$archivo")"; export RESPALDO_CLAVE; return 0; fi
  if [[ -t 0 ]]; then read -rsp "  Contraseña de cifrado del respaldo: " RESPALDO_CLAVE; echo; export RESPALDO_CLAVE; return 0; fi
  return 1
}

# abrir_respaldo ARCHIVO CARPETA → DUMP, MANIFIESTO (o vacío), ADJUNTOS (o vacío)
abrir_respaldo() {
  local archivo="$1" carpeta="$2" esperado real
  MANIFIESTO=""; ADJUNTOS=""
  case "$archivo" in
    *.dump) DUMP="$archivo"; return 0 ;;
    *.tar.gz.enc)
      clave_de_cifrado || morir "El respaldo está cifrado y falta su contraseña (RESPALDO_CLAVE o ~/.config/gestion360/respaldo-clave)."
      mkdir -p "$carpeta"
      # -pass env: la contraseña no pasa por la línea de comandos.
      openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -pass env:RESPALDO_CLAVE -in "$archivo" | tar -xz -C "$carpeta" \
        || morir "No se pudo abrir: la contraseña no es la de este respaldo o el archivo está dañado."
      ;;
    *.tar.gz) mkdir -p "$carpeta"; tar -xzf "$archivo" -C "$carpeta" || morir "No se pudo abrir $archivo: está dañado." ;;
    *) morir "No es un respaldo de Gestión360 Nómina (.dump, .tar.gz o .tar.gz.enc)." ;;
  esac
  DUMP="$carpeta/base/g360-nomina.dump"
  [[ -f "$DUMP" ]] || morir "El respaldo no trae la base (base/g360-nomina.dump)."
  MANIFIESTO="$carpeta/manifiesto.json"
  [[ -d "$carpeta/adjuntos" ]] && ADJUNTOS="$carpeta/adjuntos"
  # La primera huella del manifiesto es la de la base.
  esperado="$(grep -oE '"sha256": *"[0-9a-f]{64}"' "$MANIFIESTO" 2>/dev/null | head -n1 | grep -oE '[0-9a-f]{64}')"
  real="$(sha256sum "$DUMP" | cut -c1-64)"
  [[ -z "$esperado" || "$esperado" == "$real" ]] || morir "La base dentro del respaldo no coincide con su huella: el archivo está dañado."
}

conteo_del_manifiesto() { grep -oE "\"$1\": *[0-9]+" "$MANIFIESTO" 2>/dev/null | head -n1 | grep -oE '[0-9]+$'; }

# restaurar_en BASE_NUEVA DUMP: base nueva del rol de la app, restaurada con ese rol.
restaurar_en() {
  local nueva="$1" dump="$2"
  admin_sql -d postgres \
    -c "DROP DATABASE IF EXISTS \"$nueva\" WITH (FORCE)" \
    -c "CREATE DATABASE \"$nueva\" OWNER \"$ROL\" ENCODING 'UTF8' TEMPLATE template0" \
    -c "REVOKE ALL ON DATABASE \"$nueva\" FROM PUBLIC" || return 1
  admin_sql -d "$nueva" -c "ALTER SCHEMA public OWNER TO \"$ROL\"" || return 1
  PGPASSWORD="$CLAVE_BD" pg_restore -h "$HOST_BD" -p "$PUERTO_BD" -U "$ROL" -d "$nueva" --no-owner --no-privileges --exit-on-error "$dump"
}

borrar_base() { admin_sql -d postgres -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)" >/dev/null 2>&1 || true; }
