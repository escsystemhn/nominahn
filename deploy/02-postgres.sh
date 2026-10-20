#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# NominaHN — base de datos
#
# Crea un rol NO superusuario y su base. Imprime la DATABASE_URL resultante
# para pegarla en .env.local.  Como root:
#
#   ssh root@IP 'bash -s' < 02-postgres.sh
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

ROL="nomina_app"
BASE="nominahn"   # en minúsculas a propósito: evita tener que citar el nombre

[[ $EUID -eq 0 ]] || { echo "Ejecuta como root." >&2; exit 1; }

CLAVE=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$ROL') THEN
    CREATE ROLE $ROL LOGIN PASSWORD '$CLAVE';
  ELSE
    ALTER ROLE $ROL PASSWORD '$CLAVE';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE $BASE OWNER $ROL'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$BASE') \gexec
REVOKE ALL ON DATABASE $BASE FROM PUBLIC;
SQL

# Desde PostgreSQL 15 el esquema `public` ya no otorga CREATE a PUBLIC: sin este
# cambio de propietario, `prisma db push` falla con "permission denied for schema public".
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$BASE" -c "ALTER SCHEMA public OWNER TO $ROL;"

cat <<FIN

  Base de datos lista. Pega esta línea en .env.local:

DATABASE_URL="postgresql://$ROL:$CLAVE@localhost:5432/$BASE?schema=public"

  (Esta clave no se guarda en ningún sitio. Cópiala ahora.)

FIN
