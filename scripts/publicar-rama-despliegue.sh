#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Publica el servidor ya compilado en la rama `seenode-deploy`.
#
# Lo llama .github/workflows/compilar-seenode.yml después de
# `node scripts/compilar-produccion.mjs`. Seenode sigue esa rama con
# Auto-deploy y sólo ARRANCA lo que hay en ella: no compila nada.
#
# La rama conserva su historia (un commit por despliegue): el rollback de
# Seenode consiste en elegir un commit anterior de la misma rama, y con un
# push --force no habría a cuál volver.
#
# Uso (desde nominahn/, en un clon con remoto `origin`):
#   bash scripts/publicar-rama-despliegue.sh
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

RAMA=seenode-deploy
DESTINO="${DESTINO_DESPLIEGUE:-/tmp/seenode-deploy}"
ORIGEN_SHA="$(git rev-parse --short HEAD)"
ORIGEN_MSG="$(git log -1 --format=%s)"

[[ -f .next/standalone/server.js ]] || { echo "✗ Falta .next/standalone/server.js: compile antes." >&2; exit 1; }

git worktree remove --force "$DESTINO" 2>/dev/null || rm -rf "$DESTINO"

if git ls-remote --exit-code --heads origin "$RAMA" >/dev/null 2>&1; then
  git fetch --depth=1 origin "$RAMA:refs/remotes/origin/$RAMA"
  git worktree add -B "$RAMA" "$DESTINO" "origin/$RAMA"
  # Se vacía y se vuelve a llenar: un archivo que ya no existe en la versión
  # nueva no debe quedarse de la anterior.
  find "$DESTINO" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
else
  # Primera vez: rama huérfana, sin la historia del código fuente.
  # (`worktree add --orphan` exige Git 2.42; así vale para cualquiera.)
  git worktree add --detach "$DESTINO"
  git -C "$DESTINO" checkout -q --orphan "$RAMA"
  git -C "$DESTINO" rm -rfq .
fi

mkdir -p "$DESTINO/.next" "$DESTINO/scripts"
cp -a .next/standalone "$DESTINO/.next/standalone"
cp scripts/iniciar-produccion.mjs "$DESTINO/scripts/"

cat > "$DESTINO/package.json" <<'JSON'
{
  "name": "nominahn-seenode",
  "private": true,
  "description": "Servidor compilado por GitHub Actions. No editar: se regenera en cada push a main.",
  "engines": { "node": ">=22.12.0 <25" },
  "scripts": { "start": "node --max-old-space-size=320 scripts/iniciar-produccion.mjs" }
}
JSON

cat > "$DESTINO/LEEME.md" <<EOF
# Rama generada automáticamente — no editar

Servidor standalone de NominaHN compilado desde \`main\` (${ORIGEN_SHA}) por
\`.github/workflows/compilar-seenode.yml\`. Seenode la despliega tal cual.
Cualquier cambio va en \`main\`; ver README-DEPLOY.md.
EOF

cd "$DESTINO"
# --force: algunos paquetes de node_modules traen su propio .gitignore y, sin
# él, Git dejaría fuera archivos que el servidor necesita.
git add --all --force .
if git diff --cached --quiet; then
  echo "Sin cambios respecto al último despliegue."
  exit 0
fi
git commit -q -m "Compilado de ${ORIGEN_SHA}: ${ORIGEN_MSG}"
git push origin "$RAMA"
echo "✓ Publicado en $RAMA: $(git rev-parse --short HEAD) (desde ${ORIGEN_SHA})"
