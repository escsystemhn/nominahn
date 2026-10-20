#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# NominaHN — despliegue de la aplicación
#
# Se ejecuta como el usuario `deploy`, desde el propio servidor, y es
# reejecutable: sirve tanto para el primer despliegue como para actualizar.
#
#   ssh deploy@IP 'bash ~/nominahn/deploy/03-app.sh'
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP"

log() { printf '\n\033[1;32m▸ %s\033[0m\n' "$*"; }
abortar() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -ne 0 ]] || abortar "NO ejecutes esto como root: la app corre como usuario sin privilegios."

# ─── Configuración ──────────────────────────────────────────────────────────
# prisma.config.ts, prisma/seed.ts y prisma/sql/apply.ts cargan `.env.local`
# explícitamente con dotenv. El archivo debe llamarse así, no `.env`.
[[ -f .env.local ]] || abortar ".env.local no existe en $APP — créalo antes (ver deploy/README.md)."
chmod 600 .env.local

for clave in DATABASE_URL AUTH_URL NEXTAUTH_SECRET CRON_SECRET CIFRADO_KEY SMTP_HOST SMTP_USER SMTP_PASS SMTP_FROM UPLOAD_DIR; do
  grep -qE "^${clave}=.+" .env.local || abortar "Falta $clave en .env.local (src/lib/env.ts aborta el arranque sin ella)."
done
grep -qE '^TZ="?America/Tegucigalpa"?' .env.local || abortar 'TZ debe ser exactamente "America/Tegucigalpa".'

# ─── Dependencias ───────────────────────────────────────────────────────────
# `npm ci` en el servidor, nunca copiar node_modules: sharp y los binarios de
# Prisma son nativos y los de Windows no funcionan en Linux.
log "Instalando dependencias"
npm ci

log "Generando el cliente de Prisma"
npx prisma generate

# ─── Base de datos ──────────────────────────────────────────────────────────
# El proyecto no usa migraciones: sincroniza con `db push` y aplica después los
# índices parciales y triggers que Prisma no sabe declarar (prisma/sql/apply.ts).
log "Sincronizando el esquema"
npm run db:push

log "Aplicando índices y triggers"
npm run db:constraints

if [[ "${SEMBRAR:-si}" == "si" ]]; then
  log "Sembrando datos de demostración"
  npm run db:seed
fi

# ─── Compilación ────────────────────────────────────────────────────────────
# El límite de heap evita que el build se lleve toda la RAM del droplet y active
# al OOM killer antes de poder tocar la swap.
log "Compilando (esto tarda varios minutos)"
NODE_OPTIONS="--max-old-space-size=1536" npm run build

# ─── Servicio ───────────────────────────────────────────────────────────────
log "Instalando el servicio systemd"
sudo install -m 644 deploy/nominahn.service /etc/systemd/system/nominahn.service
sudo sed -i "s|__APP__|$APP|g; s|__USER__|$(id -un)|g" /etc/systemd/system/nominahn.service
sudo systemctl daemon-reload
sudo systemctl enable nominahn
sudo systemctl restart nominahn

sleep 5
sudo systemctl --no-pager --lines=20 status nominahn || true

cat <<FIN

  Listo. Comprueba:
    curl -I http://127.0.0.1:3009/login
    sudo journalctl -u nominahn -f

FIN
