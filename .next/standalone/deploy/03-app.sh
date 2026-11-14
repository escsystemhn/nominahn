#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Gestión360 Nómina — despliegue y actualización de la aplicación
#
# Se ejecuta como el usuario `deploy`, desde el propio servidor, y es
# reejecutable: sirve tanto para el primer despliegue como para actualizar.
#
#   Producción, primera vez (pide la contraseña del administrador sin mostrarla):
#     ssh -t deploy@IP 'EMPRESA="Power Chicken" ADMIN_CORREO=rrhh@empresa.hn \
#                       ADMIN_NOMBRE="Nombre Apellido" bash ~/nominahn/deploy/03-app.sh'
#   Actualizar (cualquier modo):
#     ssh -t deploy@IP 'bash ~/nominahn/deploy/03-app.sh'
#   Demostración con datos ficticios y cuentas de prueba:
#     ssh -t deploy@IP 'MODO=demo bash ~/nominahn/deploy/03-app.sh'
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP"

MODO="${MODO:-produccion}"
PUERTO=3009
CORREO_SOPORTE="soporte@esc-systemhn.com"

log() { printf '\n\033[1;32m▸ %s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
abortar() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -ne 0 ]] || abortar "NO ejecutes esto como root: la app corre como usuario sin privilegios."
[[ "$MODO" == "produccion" || "$MODO" == "demo" ]] || abortar "MODO debe ser «produccion» o «demo»."

# ─── Configuración ──────────────────────────────────────────────────────────
# prisma.config.ts, prisma/seed.ts y prisma/sql/apply.ts cargan `.env.local`
# explícitamente con dotenv. El archivo debe llamarse así, no `.env`.
[[ -f .env.local ]] || abortar ".env.local no existe en $APP — créalo a partir de deploy/env.produccion.example."
chmod 600 .env.local

for clave in DATABASE_URL AUTH_URL NEXTAUTH_SECRET CRON_SECRET CIFRADO_KEY SMTP_HOST SMTP_USER SMTP_PASS SMTP_FROM UPLOAD_DIR; do
  grep -qE "^${clave}=.+" .env.local || abortar "Falta $clave en .env.local (src/lib/env.ts aborta el arranque sin ella)."
done
grep -qE '^TZ="?America/Tegucigalpa"?' .env.local || abortar 'TZ debe ser exactamente "America/Tegucigalpa".'
if grep -qE '^SMTP_PORT="?(25|465|587)"?$' .env.local; then
  aviso "SMTP_PORT es 25, 465 o 587: DigitalOcean bloquea esos puertos y los comprobantes no saldrán. Usa 2525."
fi

leer() { grep -E "^$1=" .env.local | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'; }

# La conexión, para psql y pg_dump, por variables PG* y no en la línea de
# comandos: así la contraseña no aparece en `ps`. libpq no acepta `?schema=`.
mapfile -t PARTES < <(node -e '
  const u = new URL(process.argv[1]);
  for (const v of [u.hostname, u.port || "5432", u.username, u.password, u.pathname.slice(1)]) console.log(decodeURIComponent(v));
' "$(leer DATABASE_URL)")
[[ ${#PARTES[@]} -eq 5 ]] || abortar "DATABASE_URL no se pudo leer."
export PGHOST="${PARTES[0]}" PGPORT="${PARTES[1]}" PGUSER="${PARTES[2]}" PGPASSWORD="${PARTES[3]}" PGDATABASE="${PARTES[4]}"
unset PARTES
psql -tAc 'select 1' >/dev/null || abortar "No se pudo conectar a la base con DATABASE_URL."

# ─── 1. Respaldo antes de tocar nada ────────────────────────────────────────
# Si la base ya tiene datos, se respalda antes de cambiar el esquema o el código.
# Es aparte de Configuración → Respaldos: éste es el «antes de actualizar».
if [[ "$(psql -tAc "select to_regclass('public.\"User\"') is not null")" == "t" ]]; then
  DIR_PREVIOS="$HOME/respaldos-despliegue"
  install -d -m 700 "$DIR_PREVIOS"
  PREVIO="$DIR_PREVIOS/antes-$(date +%Y%m%d-%H%M%S).dump"
  log "Respaldando la base antes de actualizar → $PREVIO"
  pg_dump -Fc -f "$PREVIO"
  chmod 600 "$PREVIO"
  # Se conservan los cinco más recientes.
  ls -1t "$DIR_PREVIOS"/antes-*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f --
fi

# ─── 2. Dependencias ────────────────────────────────────────────────────────
# `npm ci` en el servidor, nunca copiar node_modules: sharp y los binarios de
# Prisma son nativos y los de Windows no funcionan en Linux.
log "Instalando dependencias"
npm ci

log "Generando el cliente de Prisma"
npx prisma generate

# ─── 3. Esquema de la base ──────────────────────────────────────────────────
# El proyecto no usa migraciones: sincroniza con `db push` y aplica después los
# índices parciales y triggers que Prisma no sabe declarar (prisma/sql/apply.ts).
# Si un cambio borrara datos, `db push` se niega sin una terminal que lo confirme:
# entonces se detiene aquí, con el respaldo del paso 1 ya hecho.
log "Cambios de esquema"
CAMBIOS="$(npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script 2>/dev/null | grep -vE 'injected env|^\s*$' || true)"
if grep -qiE 'empty migration' <<<"$CAMBIOS" || [[ -z "$CAMBIOS" ]]; then
  echo "  Sin cambios."
else
  echo "  $(grep -cE '^(CREATE|ALTER|DROP)' <<<"$CAMBIOS" || true) sentencias. Destructivas:"
  grep -E '^\s*DROP|DROP COLUMN|TRUNCATE' <<<"$CAMBIOS" | sed 's/^/    /' || echo "    ninguna"
fi
npm run db:push

log "Aplicando índices y triggers"
npm run db:constraints

# ─── 4. Datos iniciales ─────────────────────────────────────────────────────
USUARIOS="$(psql -tAc 'select count(*) from "User"')"
NUEVA=no
if [[ "$USUARIOS" == "0" ]]; then
  NUEVA=si
  if [[ "$MODO" == "demo" ]]; then
    log "Base vacía: sembrando datos de DEMOSTRACIÓN (empresa y empleados ficticios)"
    npm run db:seed
  else
    # Como el instalador de Windows: un administrador con la clave que elige
    # quien instala, la cuenta de soporte de ESC System (clave temporal que se
    # cambia al entrar) y NINGUNA cuenta de demostración.
    [[ -n "${EMPRESA:-}" && -n "${ADMIN_CORREO:-}" ]] \
      || abortar "Base vacía: indica EMPRESA y ADMIN_CORREO (y si quieres ADMIN_NOMBRE). Ver la cabecera de este script."
    if [[ -z "${ADMIN_CLAVE:-}" ]]; then
      [[ -t 0 ]] || abortar "Hace falta una terminal para escribir la contraseña: conéctate con «ssh -t»."
      read -rsp "  Contraseña del administrador ($ADMIN_CORREO): " ADMIN_CLAVE; echo
      read -rsp "  Repítela: " REPETIDA; echo
      [[ "$ADMIN_CLAVE" == "$REPETIDA" ]] || abortar "Las contraseñas no coinciden."
      unset REPETIDA
    fi
    log "Base vacía: creando la empresa, el administrador y la cuenta de soporte"
    SEED_INSTALACION=1 SEED_EMPRESA_NOMBRE="$EMPRESA" SEED_ADMIN_NOMBRE="${ADMIN_NOMBRE:-}" \
      SEED_ADMIN_EMAIL="$ADMIN_CORREO" SEED_ADMIN_PASSWORD="$ADMIN_CLAVE" npm run db:seed
    unset ADMIN_CLAVE
  fi
else
  # Actualización: sólo pone al día los perfiles de sistema (permisos nuevos).
  log "Base con $USUARIOS usuarios: se ponen al día los perfiles de acceso"
  SEED_SOLO_PERFILES=1 npm run db:seed
fi

# ─── 5. Compilación ─────────────────────────────────────────────────────────
# El límite de heap evita que el build se lleve toda la RAM del droplet y active
# al OOM killer antes de poder tocar la swap.
log "Compilando (esto tarda varios minutos)"
NODE_OPTIONS="--max-old-space-size=1536" npm run build

# ─── 6. Servicio ────────────────────────────────────────────────────────────
log "Instalando el servicio systemd"
sudo install -m 644 deploy/nominahn.service /etc/systemd/system/nominahn.service
sudo sed -i "s|__APP__|$APP|g; s|__USER__|$(id -un)|g" /etc/systemd/system/nominahn.service
sudo systemctl daemon-reload
sudo systemctl enable nominahn
sudo systemctl restart nominahn

# ─── 7. Tareas programadas ──────────────────────────────────────────────────
# Respaldos automáticos, relojes, SAP y recordatorios de evaluaciones. Se
# reemplazan sólo las líneas marcadas: lo demás del crontab se respeta.
log "Programando las tareas (crontab de $(id -un))"
chmod 755 deploy/cron.sh
{
  crontab -l 2>/dev/null | grep -v 'gestion360-tarea' || true
  echo "*/5 * * * * $APP/deploy/cron.sh biometrico sap respaldos # gestion360-tarea"
  echo "15 6 * * * $APP/deploy/cron.sh evaluaciones # gestion360-tarea"
} | crontab -
crontab -l | grep 'gestion360-tarea' | sed 's/^/  /'

# ─── 8. Verificación ────────────────────────────────────────────────────────
log "Esperando a que la aplicación responda"
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${PUERTO}/api/estado" 2>/dev/null | grep -q '"ok":true'; then
    echo "  ✓ http://127.0.0.1:${PUERTO}/api/estado responde"
    break
  fi
  sleep 2
done
curl -fsS --max-time 3 "http://127.0.0.1:${PUERTO}/api/estado" 2>/dev/null | grep -q '"ok":true' \
  || { sudo systemctl --no-pager --lines=30 status nominahn || true; abortar "La aplicación no responde: revisa  sudo journalctl -u nominahn -n 200"; }

cat <<FIN

  Listo ($MODO).
    Registro de la app:     sudo journalctl -u nominahn -f
    Tareas programadas:     journalctl -t gestion360-cron -f
FIN
if [[ "$NUEVA" == "si" && "$MODO" == "produccion" ]]; then
  cat <<FIN

  Instalación nueva. Antes de entregar el sistema:
    1. Entra con $CORREO_SOPORTE y su contraseña temporal: el sistema
       pide cambiarla. Hazlo YA: mientras no se cambie, quien la conozca entra.
    2. Configuración → Respaldos: destino en Spaces (cifrado) y automático diario.
    3. Configuración → Correo saliente → enviar una prueba.
FIN
fi
