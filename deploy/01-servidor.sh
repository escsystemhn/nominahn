#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# NominaHN — preparación del servidor Ubuntu 24.04 LTS
#
# Se ejecuta UNA VEZ, como root, sobre un droplet recién creado.
# Deja el sistema endurecido y con Node 22, PostgreSQL 16 y Caddy instalados,
# pero NO despliega la aplicación: de eso se encarga 02-app.sh.
#
#   ssh root@IP 'bash -s' < 01-servidor.sh
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

USUARIO="${USUARIO:-deploy}"

log() { printf '\n\033[1;32m▸ %s\033[0m\n' "$*"; }
abortar() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || abortar "Ejecuta este script como root."

# ─── Zona horaria ───────────────────────────────────────────────────────────
# src/lib/env.ts EXIGE TZ=America/Tegucigalpa: los cálculos de planilla dependen
# de ello y la app no arranca en producción si no coincide.
log "Zona horaria → America/Tegucigalpa"
timedatectl set-timezone America/Tegucigalpa

# ─── Swap ───────────────────────────────────────────────────────────────────
# `next build` de Next 16 pide del orden de 2 GB. En un droplet de 2 GB sin swap
# el build muere con OOM a mitad de compilación.
if ! swapon --show | grep -q .; then
  log "Creando 4 GB de swap"
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
else
  log "Ya hay swap configurada — se deja como está"
fi

# ─── Paquetes base ──────────────────────────────────────────────────────────
log "Actualizando el sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install ufw fail2ban unattended-upgrades postgresql postgresql-contrib \
                   debian-keyring debian-archive-keyring apt-transport-https \
                   curl gnupg ca-certificates rsync

# ─── Node 22 LTS ────────────────────────────────────────────────────────────
# next@16 declara engines.node >= 20.9. Se usa 22 LTS por soporte largo.
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  log "Instalando Node.js 22 LTS"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

# ─── Caddy (TLS automático) ─────────────────────────────────────────────────
if ! command -v caddy >/dev/null; then
  log "Instalando Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

# ─── Usuario de la aplicación ───────────────────────────────────────────────
# Sin contraseña: sólo se entra por clave SSH. La app NUNCA corre como root.
if ! id -u "$USUARIO" >/dev/null 2>&1; then
  log "Creando usuario $USUARIO"
  adduser --disabled-password --gecos "" "$USUARIO"
  usermod -aG sudo "$USUARIO"
fi

install -d -m 700 -o "$USUARIO" -g "$USUARIO" "/home/$USUARIO/.ssh"
if [[ -f /root/.ssh/authorized_keys ]]; then
  cp /root/.ssh/authorized_keys "/home/$USUARIO/.ssh/authorized_keys"
  chown "$USUARIO:$USUARIO" "/home/$USUARIO/.ssh/authorized_keys"
  chmod 600 "/home/$USUARIO/.ssh/authorized_keys"
fi

# ─── sudo ───────────────────────────────────────────────────────────────────
# El usuario se crea sin contraseña, así que `sudo` no tendría forma de pedirla.
# Como además vamos a cerrar el acceso de root por SSH, sin esta regla el droplet
# se quedaría sin ninguna vía de administración salvo la consola web de
# DigitalOcean. Es la misma concesión que hace cloud-init con el usuario por
# defecto de las imágenes de nube: aceptable aquí porque sólo se entra con clave
# SSH y fail2ban vigila el puerto 22.
if [[ ! -f "/etc/sudoers.d/90-$USUARIO" ]]; then
  log "Concediendo sudo sin contraseña a $USUARIO"
  echo "$USUARIO ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$USUARIO"
  chmod 440 "/etc/sudoers.d/90-$USUARIO"
  visudo -c -q || abortar "sudoers inválido: revisa /etc/sudoers.d/90-$USUARIO"
fi

# ─── SSH ────────────────────────────────────────────────────────────────────
# Guarda de seguridad: no desactivamos la contraseña si el usuario no tiene una
# clave con la que entrar. Cerrar los dos caminos a la vez deja el droplet
# inaccesible salvo por la consola web de DigitalOcean.
if [[ -s "/home/$USUARIO/.ssh/authorized_keys" ]]; then
  log "Endureciendo SSH (sólo clave, sin root)"
  cat > /etc/ssh/sshd_config.d/99-nominahn.conf <<CONF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers $USUARIO
MaxAuthTries 3
X11Forwarding no
CONF
  sshd -t && systemctl restart ssh
  echo "  ✓ Comprueba AHORA en otra terminal: ssh $USUARIO@<IP>"
else
  echo "  ! $USUARIO no tiene authorized_keys: se deja SSH como estaba."
  echo "  ! Copia tu clave y vuelve a ejecutar antes de exponer el servidor."
fi

# ─── Cortafuegos ────────────────────────────────────────────────────────────
# PostgreSQL (5432) queda deliberadamente fuera: sólo escucha en localhost.
log "Configurando UFW"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (redirección y ACME)'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
ufw status verbose

# ─── fail2ban ───────────────────────────────────────────────────────────────
# En Ubuntu 24.04 ya no existe /var/log/auth.log: sin backend=systemd la jaula
# sshd arranca pero no lee nada y no banea a nadie.
log "Configurando fail2ban"
cat > /etc/fail2ban/jail.local <<'CONF'
[DEFAULT]
backend = systemd
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

# ─── Actualizaciones de seguridad automáticas ───────────────────────────────
log "Activando actualizaciones de seguridad desatendidas"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

# ─── PostgreSQL ─────────────────────────────────────────────────────────────
log "Configurando PostgreSQL para escuchar sólo en localhost"
PGCONF=$(sudo -u postgres psql -tAc 'SHOW config_file;')
sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" "$PGCONF"
systemctl restart postgresql
systemctl enable postgresql

# ─── Directorio privado de adjuntos ─────────────────────────────────────────
# src/lib/uploads.ts los guarda FUERA de public/ y los sirve por
# /api/uploads/[nombre], que verifica sesión. El directorio no debe ser legible
# por otros usuarios del sistema.
install -d -m 750 -o "$USUARIO" -g "$USUARIO" /var/uploads

log "Servidor listo."
cat <<FIN

  Siguiente paso, desde tu equipo Windows:
    1. deploy/subir.ps1        → envía el código (sin secretos ni datos reales)
    2. crear /home/$USUARIO/nominahn/.env.local
    3. ssh $USUARIO@IP 'bash ~/nominahn/deploy/03-app.sh'

FIN
