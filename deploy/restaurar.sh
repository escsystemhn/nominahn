#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Gestión360 Nómina — restaurar un respaldo (sólo por comando; 2026-11-25).
#
#   ~/nominahn/deploy/restaurar.sh /ruta/g360-nomina_2026-11-25_013000_automatico.tar.gz.enc
#
# REEMPLAZA la base. Antes la respalda (~/respaldos-despliegue/antes-de-restaurar-*.dump),
# restaura en una base nueva mientras la aplicación sigue funcionando y recién
# entonces detiene el servicio, cambia una base por la otra (la anterior queda con
# otro nombre), sincroniza el esquema de esta versión, devuelve los adjuntos y vuelve
# a iniciar. Si la sincronización falla, vuelve a la base anterior.
# Si está cifrado, pide la contraseña (o RESPALDO_CLAVE, o ~/.config/gestion360/respaldo-clave).
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/respaldos-comun.sh"
SERVICIO="${SERVICIO:-nominahn}"
# En una prueba sin la app, SINCRONIZAR_ESQUEMA=true.
SINCRONIZAR_ESQUEMA="${SINCRONIZAR_ESQUEMA:-cd \"$APP\" && npm run db:push && npm run db:constraints}"

ARCHIVO="${1:-}"
[[ -n "$ARCHIVO" && -f "$ARCHIVO" ]] || morir "Uso: deploy/restaurar.sh RUTA_DEL_RESPALDO (.tar.gz.enc, .tar.gz o .dump)"
leer_conexion
TRABAJO="$(mktemp -d "${TMPDIR:-/tmp}/g360-restaurar-XXXXXX")"
trap 'rm -rf "$TRABAJO"' EXIT
# Con el número de proceso: dos restauraciones en el mismo segundo no comparten nombres.
MARCA="$(date +%Y%m%d_%H%M%S)_$$"

servicio() {  # servicio stop|start: sólo si existe (en una prueba no hay systemd)
  command -v systemctl >/dev/null && systemctl list-unit-files "$SERVICIO.service" >/dev/null 2>&1 && sudo -n systemctl "$1" "$SERVICIO" || true
}

registrar "Abriendo $ARCHIVO…"
abrir_respaldo "$ARCHIVO" "$TRABAJO"

registrar "Respaldando la base actual antes de reemplazarla…"
PREVIOS="$HOME/respaldos-despliegue"; install -d -m 700 "$PREVIOS"
PREVIO="$PREVIOS/antes-de-restaurar-$MARCA.dump"
PGPASSWORD="$CLAVE_BD" pg_dump -h "$HOST_BD" -p "$PUERTO_BD" -U "$ROL" -Fc -f "$PREVIO" "$BASE"
pg_restore --list "$PREVIO" >/dev/null || morir "No se pudo respaldar la base actual: no se restaura nada."
chmod 600 "$PREVIO"

NUEVA="${BASE}_restaurando"
registrar "Restaurando en una base nueva (la aplicación sigue funcionando)…"
restaurar_en "$NUEVA" "$DUMP" || { borrar_base "$NUEVA"; morir "pg_restore no pudo restaurar el respaldo: la base actual no se tocó."; }

ANTERIOR="${BASE}_anterior_$MARCA"
# cambiar BASE A OTRA: BASE→A y OTRA→BASE, en una transacción: si el segundo nombre
# falla, el primero se deshace y la base nunca queda sin su nombre.
cambiar() {
  admin_sql -d postgres -v base="$1" -v a="$2" -v otra="$3" >/dev/null <<'SQL'
BEGIN;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN (:'base', :'otra') AND pid <> pg_backend_pid();
ALTER DATABASE :"base" RENAME TO :"a";
ALTER DATABASE :"otra" RENAME TO :"base";
COMMIT;
SQL
}
registrar "Deteniendo la aplicación para cambiar de base…"
servicio stop
if ! cambiar "$BASE" "$ANTERIOR" "$NUEVA"; then
  borrar_base "$NUEVA"
  servicio start
  morir "No se pudo cambiar de base: la actual sigue en su lugar (respaldada en $PREVIO)."
fi

registrar "Sincronizando el esquema de esta versión…"
if ! bash -c "$SINCRONIZAR_ESQUEMA"; then
  registrar "La sincronización falló: se vuelve a la base anterior."
  cambiar "$BASE" "${BASE}_fallida_$MARCA" "$ANTERIOR" || true
  servicio start
  morir "No se restauró: la base anterior sigue en su lugar."
fi

if [[ -n "$ADJUNTOS" ]]; then
  DESTINO="$(leer UPLOAD_DIR)"
  # La base ya está restaurada: si los adjuntos no se copian, se avisa y la aplicación arranca igual.
  if [[ -n "$DESTINO" ]]; then
    if mkdir -p "$DESTINO" && cp -a "$ADJUNTOS/." "$DESTINO/"; then registrar "Adjuntos devueltos a $DESTINO."
    else registrar "ATENCIÓN: los adjuntos no se pudieron devolver a $DESTINO: cópielos a mano desde el respaldo."; fi
  fi
fi
servicio start
registrar "Listo: la base se restauró desde $(basename "$ARCHIVO"). La que había quedó como «$ANTERIOR» y respaldada en $PREVIO; bórrela cuando confirme que todo está bien."
