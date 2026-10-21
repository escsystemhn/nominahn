# Despliegue en Seenode — prueba de 7 días y primer mes

Guía para publicar NominaHN en [Seenode](https://seenode.com/es) con **un
servicio web Basic** (0,5 GB RAM, 0,2 CPU, 750 MB de disco) y **una base de
datos PostgreSQL Basic** (1 GB, 20 conexiones), push-to-deploy desde GitHub y
HTTPS automático en `*.seenode.app`.

> Para un VPS propio está `deploy/README.md` (DigitalOcean). Para la red local
> del cliente, el instalador de Windows (`../instalador/`).

---

## 1. Arquitectura

```
git push main ─▶ GitHub Actions (gratis, 7 GB RAM)
                 ¿esquema aplicado? · tsc · vitest · npm audit · next build (standalone)
                 └─▶ commit en la rama  seenode-deploy
                                         │ Auto-deploy
                                         ▼
Navegador ─HTTPS─▶ <servicio>.seenode.app ─▶ Servicio web Basic (Node 22)
                   (Let's Encrypt)            node scripts/iniciar-produccion.mjs
                                              └─ Next.js: páginas + /api
                                                     │ red privada
                                                     ▼
                                              PostgreSQL Basic (18.4)
```

- **Un solo servicio.** Next.js sirve pantallas y API desde el mismo proceso.
  No hay frontend y backend separados que repartir: la prueba cubre justo un
  servicio y una base, y alcanza.
- **Sin CORS.** Al ser el mismo origen, la API no emite cabeceras
  `Access-Control-*`; ningún otro sitio puede leer sus respuestas. Las
  escrituras desde otro origen se rechazan (403) en `src/proxy.ts`.
- **Se compila en GitHub, no en Seenode.** `next build` necesita ~2 GB de RAM
  (sección 2). Seenode no documenta cuánta memoria tiene su build; si es la de
  la instancia, nunca terminaría. GitHub compila, y Seenode sólo arranca lo que
  hay en la rama `seenode-deploy`. Bonus: si fallan los tipos, las pruebas o
  hay una vulnerabilidad crítica, no se despliega nada.
- **El despliegue nunca toca la base.** Ni el build ni el arranque ejecutan
  `db push` ni semillas. El esquema se aplica a mano desde tu equipo
  (sección 6), después de revisar el SQL. Para que no se te pase, `aplicar`
  deja una huella del esquema en `prisma/esquema-aplicado.txt` y el workflow
  **no despliega** si el esquema del push no coincide con ella (sección 9).

---

## 2. ¿Cabe en el plan Basic? (medido el 2026-10-20)

Contenedores Linux con los límites del plan (512 MB sin swap, 0,2 CPU), a
partir de un clon con exactamente lo que `.gitignore` deja subir:

| Recurso | Límite | Medido | ¿Cabe? |
|---|---|---|---|
| RAM al arrancar | 512 MB | 175 MB | ✅ |
| RAM tras 25 pantallas + exportar PDF/Excel | 512 MB | 284 MB (pico) | ✅ |
| RAM con 13 peticiones simultáneas (3 exportaciones de planilla) | 512 MB | 290 MB (pico), todas 200, máx. 3,8 s | ✅ |
| Disco de la app | 750 MB | 149 MB (servidor standalone: 93 MB) | ✅ |
| Base de datos con la demo completa | 1 GB | 12 MB | ✅ |
| Conexiones a la base | 20 | 10 (pool de `pg`) | ✅ |
| CPU 0,2: login / páginas / PDF | — | 1,3 s / 0,05–0,7 s / 0,5 s | ✅ aceptable |
| **`next build`** | 512 MB | **~2 GB**: muere por memoria con 512 MB y con 1,5 GB | ❌ → se compila en GitHub |
| `node_modules` completo | 750 MB | 1,1 GB | ❌ → no se despliega; el standalone lleva sólo lo necesario |

Holgura: ~220 MB de RAM para un equipo pequeño de RRHH. Un reporte muy grande
(cientos de empleados en PDF) es lo que más memoria pide; `--max-old-space-size=320`
hace que Node libere antes de llegar al límite.

### Costo de un mes

| Concepto | Precio | Mes 1 con la prueba (7 días gratis + 23 pagados) | Mes completo pagado |
|---|---|---|---|
| Servicio web Basic | USD 4/mes (≈ 0,13/día) | ≈ USD 3,00 | USD 4,00 |
| PostgreSQL Basic | USD 4/mes (≈ 0,13/día) | ≈ USD 3,00 | USD 4,00 |
| GitHub Actions (repo privado, plan Free) | 2 000 min/mes incluidos; cada despliegue ≈ 3–5 min | USD 0 | USD 0 |
| Tráfico | Seenode no lo cobra aparte | USD 0 | USD 0 |
| **Total** | | **≈ USD 6** | **USD 8** |
| *Opcional:* volumen de 5 GB para archivos subidos | USD 2,50/mes | +≈ 1,90 | +2,50 |
| *Opcional:* dominio propio | según el registrador | — | — |

- Seenode cobra en **créditos prepagados**, descontados por día de uso. La
  recarga mínima es de **USD 10** (también 25, 50 y 100); los créditos no
  vencen. Una recarga de USD 10 cubre el primer mes con margen.
- No hace falta pasar a Standard (USD 7/mes, 1 GB): la app usa menos de 300 MB.
- La página de precios no menciona impuestos; Stripe podría añadirlos según el
  país de facturación.

---

## 3. Decisiones antes de empezar

| Decisión | Opciones | Recomendación |
|---|---|---|
| **Qué datos ve la demo** | `instalacion`: catálogos y una cuenta de administrador. `demo`: empresa de ejemplo y cuentas por rol. `demo-con-datos`: además 16 empleados, 7 planillas, asistencia y talento. | `demo-con-datos` para enseñar el producto; `instalacion` si el cliente carga lo suyo. |
| **Archivos subidos** (CV, documentos) | El disco de Seenode es **efímero**: se pierden en cada reinicio o despliegue. Un volumen cuesta USD 2,50/mes y no consta que la prueba lo cubra. | Para la prueba, aceptar la pérdida y avisarlo. |
| **Dominio** | `https://<servicio>.seenode.app` (incluido) o uno propio. | El de Seenode para la prueba; propio si pasa a uso real (resuelve el riesgo R3). |

**Nunca** uses `../BD/` ni `../Datos.txt`: tienen salarios, RTN, identidades y
cuentas bancarias reales. Las semillas generan datos ficticios.

---

## 4. Validar en tu equipo antes del push

En PowerShell, dentro de `nominahn/`:

```powershell
npm ci
npx prisma generate                               # Prisma 7 no genera el cliente al instalar
node scripts/huella-esquema.mjs verificar         # ¿el esquema que vas a subir ya está aplicado?
npx tsc --noEmit                                  # tipos (el build de producción no los revisa)
npx vitest run                                    # 904 pruebas
npm audit --omit=dev --audit-level=critical       # lo mismo que bloquea el workflow
npx eslint .
```

Compilación idéntica a la de GitHub Actions (Linux, valores de relleno, a
partir de lo **confirmado** en Git; necesita Docker y ~2 GB libres):

```powershell
$tar = "$HOME\nominahn-ci.tar"
git archive HEAD -o $tar
$c = docker create -e TZ=America/Tegucigalpa -e DATABASE_URL=postgresql://c:c@127.0.0.1:1/c `
  -e NEXTAUTH_SECRET=compilacion-compilacion-compilacion-0000 -e AUTH_URL=https://compilacion.invalid `
  -e CRON_SECRET=compilacion-compilacion-0000 -e CIFRADO_KEY=compilacion-compilacion-compilacion-0000 `
  -e UPLOAD_DIR=/tmp/c -e MAX_FILE_SIZE=5242880 node:22-bookworm `
  bash -c "mkdir -p /app && tar -xf /tmp/src.tar -C /app && cd /app && npm ci --no-audit --no-fund && node scripts/compilar-produccion.mjs"
docker cp $tar "${c}:/tmp/src.tar"
docker start -a $c
docker rm $c; Remove-Item $tar
```

Debe terminar en `✓ Listo` (≈ 1 min). Se usa `docker cp` y no `-v` porque
Docker Desktop se cuelga montando un archivo bajo una ruta corta de Windows
como `EDBINL~1`. No compiles en tu propia carpeta con
`npm run build:prod`: Next copiaría tu `.env.local` al standalone (el script
lo detecta y se detiene) y tu `.env.local` no tiene `CIFRADO_KEY`.

---

## 5. Repositorio en GitHub

El repositorio nace en **`nominahn/`**, no en la carpeta de arriba: ahí viven
`BD/`, `Datos.txt`, los PDF, el video y el instalador, y el `.gitignore` de esa
raíz ignora `*.sql`, lo que dejaría fuera los triggers de `prisma/sql/`.

```powershell
cd "C:\Users\Edbin Lainez\Documents\NominaHN\nominahn"
git init -b main
git add -A
git status --short | Select-String "\.env|\.pem|\.key|\.dump|\.log"   # sólo debe salir .env.example
git commit -m "Preparar despliegue en Seenode"
```

Crea en GitHub un repositorio **privado** vacío (sin README ni .gitignore):

```powershell
git remote add origin https://github.com/<tu-usuario>/nominahn.git
git push -u origin main
```

En **Actions** verás correr «Compilar para Seenode» (≈ 4 min). Al terminar,
existe la rama `seenode-deploy`. En este primer push saldrá el aviso
**«Esquema sin registrar»**: es normal, la base todavía no existe. Desde el
primer `aplicar` (sección 6.2) el aviso pasa a ser un bloqueo. Si el paso «Publicar» falla con 403, ve a
**Settings → Actions → General → Workflow permissions** y elige **Read and
write permissions**: el flujo necesita escribir esa rama.

---

## 6. Base de datos PostgreSQL Basic

### 6.1 Crearla

1. **Databases → Create database → PostgreSQL 18** (el panel ofreció 18.6),
   instancia **Basic**. (La prueba de 7 días empieza al crear la primera base o
   app: crea las dos el mismo día.)
2. Pestaña **Connection** → **show password**. Muestra host, port, database,
   username y password (y, según el formato elegido, la URI). En la base
   probada sólo aparecía un host, el público
   (`up-de-fra1-postgresql-4.db.run-on-seenode.com`, puerto 11550), y sirve
   tanto para tu equipo como para el servicio web.

**La base sólo acepta conexiones cifradas** («no pg_hba.conf entry … no
encryption») y firma con una CA propia. Toda URI hacia ella termina en
`?sslmode=require&uselibpqcompat=true`: sin `uselibpqcompat`, la librería `pg`
(la de la app, las semillas y los triggers) trata `require` como verificación
completa del certificado y falla. El asistente lo añade solo.

### 6.2 Esquema y datos iniciales (desde tu equipo)

La URL va en `DATABASE_URL_REMOTA`, **no** en `.env.local` (que apunta a tu
base real de desarrollo); el script se niega a trabajar contra `localhost`.

**Lo más fácil** es el asistente: pide la URI sin mostrarla, y pregunta antes de
revisar, aplicar, subir la huella y sembrar.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\preparar-bd-seenode.ps1
```

Si prefieres los comandos sueltos:

```powershell
$env:DATABASE_URL_REMOTA = '<URI PÚBLICA de la pestaña Connection>'

npm run db:remota -- revisar      # sólo lee: muestra el SQL pendiente (69 tablas la 1.ª vez)
npm run db:remota -- aplicar      # db push SIN aceptar pérdida de datos + índices y triggers

# aplicar dejó la huella del esquema: súbela (sin ella el workflow no exige nada)
git add prisma/esquema-aplicado.txt
git commit -m "Esquema aplicado en Seenode"
git push

# Demo: cuentas por rol con una clave propia (nunca Admin1234! en internet)
$env:SEED_DEMO_PASSWORD = '<10+ caracteres con letra, número y símbolo>'
npm run db:remota -- sembrar demo-con-datos      # o: sembrar demo

# …o instalación limpia: una sola cuenta de administrador
# $env:SEED_ADMIN_EMAIL = 'admin@suempresa.hn'; $env:SEED_ADMIN_PASSWORD = '<clave fuerte>'
# $env:SEED_EMPRESA_NOMBRE = 'Nombre de la empresa'
# npm run db:remota -- sembrar instalacion

Remove-Item Env:DATABASE_URL_REMOTA, Env:SEED_DEMO_PASSWORD, Env:SEED_ADMIN_PASSWORD -ErrorAction SilentlyContinue
```

`aplicar` y `sembrar` piden escribir el nombre de la base para confirmar.

En modo demo, `admin@nominahn.hn` recibe una clave aleatoria que se imprime
**una sola vez** en tu terminal y obliga a cambiarla al entrar: anótala. Las
demás cuentas (`rrhh@`, `contador@`, `gerente@`, `supervisor@`, `auditor@`,
`empleado@nominahn.hn` y, con datos, `empleado.sps@` y `supervisor.sps@`) usan
`SEED_DEMO_PASSWORD`.

> Si la conexión falla por SSL o `pg_hba.conf`, falta
> `?sslmode=require&uselibpqcompat=true` al final de la URI. Si sale «Can't
> reach database server» (P1001) después de que `revisar` funcionó, fue un
> corte de red: el script reintenta solo hasta 3 veces.

---

## 7. Servicio web

**Web → Create web service → Git repository → GitHub** → autoriza el acceso al
repositorio privado → `nominahn`.

| Campo | Valor |
|---|---|
| Branch | **`seenode-deploy`** (no `main`) |
| Language | **Node 22** |
| Root directory | vacío |
| Build command | `node -v` (ya viene compilado; no instales nada) |
| Start command | `node --max-old-space-size=320 scripts/iniciar-produccion.mjs` |
| Port | **80** (igual que la variable `PORT`) |
| Instance | **Basic** |

Carga las variables (sección 8) **antes** de **Create instance**; si el
formulario no lo permite, el primer arranque fallará con
`[arranque] … Falta …`: cárgalas en **Envs**, **Apply changes**, y listo (no
hace falta recompilar).

Después: **Settings → Auto-deploy → activado**. Desde ahí, cada `git push` a
`main` → Actions → `seenode-deploy` → despliegue.

Por qué así:

- El arranque usa `node` directo y no `npm run`: npm se quedaría como proceso
  padre gastando ~50 MB de los 512. `--max-old-space-size=320` hace que Node
  libere memoria antes del límite del contenedor.
- **Seenode no inyecta `PORT`**: enruta al número del campo *Port*. El script de
  arranque se niega a iniciar si falta `PORT` y fija `HOSTNAME=0.0.0.0`.

### Alternativa: compilar en Seenode (no verificada)

Si Seenode confirma que su build tiene **2 GB o más** de RAM, se puede omitir
GitHub Actions: rama `main`, build command
`npm ci && node scripts/compilar-produccion.mjs --liberar-espacio`, mismo start
command. Con 512 MB el build queda colgado y termina por memoria (probado).

---

## 8. Variables de entorno

Pestaña **Envs** → **Import from .env** (un `*` al final de la clave la marca
secreta) o fila por fila con **Secret**. Secretos **nuevos**, nunca los de
desarrollo:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # NEXTAUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # CIFRADO_KEY
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"      # CRON_SECRET
```

| Variable | Valor | Secreta |
|---|---|---|
| `TZ` | `America/Tegucigalpa` (literal) | no |
| `PORT` | `80` (el número del campo *Port*) | no |
| `DATABASE_URL` | URI de la base terminada en `?sslmode=require&uselibpqcompat=true` (host privado si el panel lo muestra; si no, el público) | **sí** |
| `AUTH_URL` | `https://<servicio>.seenode.app` | no |
| `NEXTAUTH_URL` | igual que `AUTH_URL` | no |
| `NEXTAUTH_SECRET` | 32 bytes base64 | **sí** |
| `CIFRADO_KEY` | 32 bytes hex. **No la cambies después**: lo cifrado con ella dejaría de leerse | **sí** |
| `CRON_SECRET` | 24 bytes hex | **sí** |
| `UPLOAD_DIR` | `/tmp/nominahn-uploads` (efímero; `/data/uploads` con volumen) | no |
| `MAX_FILE_SIZE` | `5242880` | no |
| `SMTP_*` | opcional; mejor desde la app (Configuración → Correo saliente) | `SMTP_PASS` sí |

**No definas `NODE_ENV`**: el servidor standalone ya la fija.

Si falta o sobra algo, el proceso termina al arrancar y **Logs → Runtime** dice
qué, por ejemplo:
`[arranque] Configuración de entorno inválida: · CIFRADO_KEY: requerida en producción…`

Cambiar una variable y pulsar **Apply changes** reinicia con la misma imagen.

---

## 9. Verificar, logs y rollback

```powershell
$URL = "https://<servicio>.seenode.app"
curl.exe -s "$URL/api/estado"     # {"ok":true,"empresa":"…"}
curl.exe -sI "$URL/login"         # 200 + cabeceras de seguridad
```

| Necesito… | Dónde |
|---|---|
| Ver por qué no se compiló | GitHub → **Actions** → la ejecución fallida |
| Ver por qué no arranca o se cae | Seenode → **Logs → Runtime** (`[arranque]`, `[audit]`, `[auth]`) |
| Ver peticiones | **Logs → Request** (hasta 14 días) |
| Reiniciar sin redeploy | **Restart service** |
| Volver a la versión anterior | desplegar un commit anterior de `seenode-deploy` (cada uno dice de qué commit de `main` salió) |

### Actualizar

| Qué cambias | Qué haces |
|---|---|
| Sólo código | `git push`. Nada más. |
| `prisma/schema.prisma` o `prisma/sql/` | respaldo manual de la base → `npm run db:remota -- revisar` → `aplicar` → `git add` del cambio **y** de `prisma/esquema-aplicado.txt` → `git push` |
| Una variable de entorno | **Envs → Apply changes** (reinicia sin push) |
| Semillas | nunca; sólo la primera vez |

Migrar va **antes** del push: agregar tablas o columnas no molesta al código
viejo que sigue corriendo, pero el código nuevo sí necesita que existan. Si
lo olvidas, el workflow se detiene en «Esquema aplicado en Seenode» con los
comandos exactos, y no se despliega nada. Si un cambio borra o renombra una
columna, `aplicar` se detiene sin tocar la base (Prisma no acepta pérdida de
datos): ese caso se planifica aparte.

**El rollback no toca la base.** Volver a un commit anterior de
`seenode-deploy` con un esquema más nuevo suele funcionar si el cambio fue
aditivo; si no, restaura el respaldo que hiciste antes de `aplicar` (Basic: 3
manuales al día; guarda los 7 últimos).

Los logs no llevan secretos ni datos de nómina: Prisma usa en producción el
formato de error mínimo (sin argumentos de la consulta) y los intentos de
acceso fallidos van a la tabla `AuditLog`.

---

## 10. Dominio propio (opcional)

1. **Domains → Add custom domain** → p. ej. `nomina.suempresa.hn` → **Get DNS config**.
2. Crea el **CNAME** que indica el panel (en Cloudflare, *DNS only*).
3. **Verify domain** (≈10 min, hasta 24 h). Seenode emite el certificado.
4. Cambia `AUTH_URL` y `NEXTAUTH_URL` al dominio nuevo → **Apply changes**.
   Mientras convivan, pon el otro en `ORIGENES_PERMITIDOS=https://<servicio>.seenode.app`.

Usa un **subdominio**, nunca el dominio principal del cliente: HSTS lleva
`includeSubDomains` por dos años.

---

## 11. Fin de la prueba

- La prueba no pide tarjeta. Al vencer, los servicios se suspenden hasta cargar
  créditos; sin créditos en ~7 días pueden borrarse.
- Para conservar lo capturado, antes del día 7:
  `pg_dump "<URI PÚBLICA>" -Fc -f "$HOME\respaldos\nominahn-seenode.dump"`
  (fuera del repositorio).
- Para cerrar del todo: borra el servicio y la base en el panel y revoca el
  acceso de Seenode en GitHub (Settings → Applications).

---

## 12. Plan de pruebas después del desplegar

| # | Qué | Cómo | Esperado |
|---|---|---|---|
| 1 | Salud | `curl.exe -s "$URL/api/estado"` | `{"ok":true,…}` |
| 2 | HTTPS | abrir `https://<servicio>.seenode.app` y luego `http://…` | candado válido; por http, redirige a https o no responde (Seenode no documenta cuál), nunca sirve la app en claro |
| 3 | Cabeceras | `curl.exe -sI "$URL/login"` | `content-security-policy`, `strict-transport-security`, `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy`, `permissions-policy`; **sin** `x-powered-by` |
| 4 | Variables | **Logs → Runtime** | `Ready` y ningún `[arranque]` |
| 5 | Base de datos | entrar y abrir Empleados y Planillas | datos de la semilla |
| 6 | Login | cuenta de la sección 6.2 | entra; el admin pasa por Mi cuenta a cambiar la clave |
| 7 | Clave publicada | `rrhh@nominahn.hn` / `Admin1234!` | **no** entra |
| 8 | Bloqueo por cuenta | 5 claves erróneas a una cuenta | la 6.ª, aun correcta, no entra en 15 min |
| 9 | Cookie | DevTools → Application → Cookies | `__Secure-authjs.session-token`: HttpOnly, Secure, SameSite=Lax, caduca ≈ 8 h |
| 10 | CSRF | `curl.exe -s -o NUL -w "%{http_code}" -X POST -H "Origin: https://otra.seenode.app" "$URL/api/mi-cuenta/password"` | `403` |
| 11 | Sin CORS | `curl.exe -sI -H "Origin: https://otra.seenode.app" "$URL/api/estado"` | ninguna cabecera `access-control-*` |
| 12 | API sin sesión | `curl.exe -s -o NUL -w "%{http_code}" "$URL/api/empleados"` | `302` (al login) |
| 13 | Cron protegido | `curl.exe -s -o NUL -w "%{http_code}" -X POST "$URL/api/cron/sap"` | `401` |
| 14 | Exportar | Reportes → Empleados activos → PDF y Excel | descargan; el servicio no se reinicia |
| 15 | Logs limpios | **Logs → Runtime** tras las pruebas | sin contraseñas, tokens ni datos de empleados |
| 16 | Memoria | métricas del servicio tras usarla un rato | por debajo de ~300 MB; sin reinicios |
| 17 | Base | panel de la base | muy por debajo de 1 GB |

En la consola del navegador verás `CSP … script-src eval` al cargar: es zod
comprobando si puede usar `eval`; lo bloquea la CSP y sigue sin él. Es esperado.

---

## 13. Seguridad

### Riesgos encontrados (por severidad)

| # | Severidad | Riesgo | Estado |
|---|---|---|---|
| R1 | Crítica | Next.js 16.3.1: ejecución remota sin autenticación en el optimizador de imágenes (GHSA-2xp9-vwfh-vxw4), RCE en `next/og`, SSRF del optimizador y envenenamiento de caché | **Corregido**: Next 16.3.8, sharp 0.35.5 |
| R2 | Alta | Cuentas de demostración con `Admin1234!`, publicada: en una URL de internet cualquiera entra como RRHH | **Corregido**: `SEED_DEMO_PASSWORD` obligatoria para sembrar fuera; verificado que `Admin1234!` no entra |
| R3 | Alta | `seenode.app` no está en la Public Suffix List: otra app de Seenode es «mismo sitio» y `SameSite=Lax` no frena su CSRF | **Corregido**: el proxy rechaza escrituras con `Origin` ajeno (403). Residual: fijación de sesión por cookie de dominio padre; lo cierra un dominio propio |
| R4 | Alta | Sesión de 30 días (valor por omisión de next-auth): una cookie robada valía un mes | **Corregido**: 8 h, renovada con el uso |
| R5 | Alta (disponibilidad) | El build necesita ~2 GB; en la instancia Basic no termina | **Mitigado**: compila GitHub Actions |
| R6 | Media | Login sin límite por IP; cada intento escribía en `AuditLog` (puede llenar la base de 1 GB) y el contador en memoria crecía sin tope | **Corregido**: 20 fallos/15 min por IP sin escribir auditoría; barrido de claves caducadas |
| R7 | Media | Sin CSP global; `X-Powered-By` expuesto | **Corregido** (CSP sin nonces: ver R13) |
| R8 | Media | La configuración se validaba en la primera petición, no al arrancar; `CIFRADO_KEY` no se exigía | **Corregido**: `instrumentation.ts` termina el proceso con el motivo |
| R9 | Media | Errores de Prisma con los argumentos de la consulta (salarios, identidades) en logs y en algunos `e.message` devueltos | **Corregido**: `errorFormat: "minimal"` en producción |
| R10 | Media | `.gitignore` excluía `.env.example` y no cubría claves, certificados ni volcados | **Corregido** |
| R11 | Media | Archivos subidos en disco efímero: se pierden al reiniciar | **Decisión tuya** (volumen USD 2,50/mes) |
| R12 | Media | Dependencias con avisos altos/moderados sin parche compatible: nodemailer (DoS en `addressparser`, se corrige en 10.x), prisma 7.9.1 (deepmerge-ts, mysql2, fast-uri: CLI), tedious fijado en 20.3.3 (sprintf-js), exceljs→uuid | **Sugerido**: prisma y @prisma/client 7.10.1; tedious 20.3.8 en `overrides`; nodemailer 10 con las pruebas de `send.test.ts` |
| R13 | Baja | CSP con `'unsafe-inline'`: limita lo que hace un script inyectado, no lo impide. No se encontró ningún `dangerouslySetInnerHTML` | Aceptado; nonces si algún día se exige |
| R14 | Baja | `x-cron-secret` se compara con `!==` (no en tiempo constante) | Sugerido: `timingSafeEqual` |
| R15 | Baja | `/api/biometrico/dispositivos` sólo exige sesión: cualquier rol ve las IP de los relojes | Pendiente previo |
| R16 | Baja | Un administrador puede apuntar SAP, SMTP o un reloj a cualquier host (SSRF por diseño, incluida la red privada de Seenode) | Aceptado: sólo administradores |
| R17 | Informativa | El límite de intentos vive en memoria: se reinicia con cada despliegue | Aceptado para una instancia |
| R18 | Baja | La conexión a la base va cifrada, pero sin verificar el certificado del servidor (CA propia de Seenode, cuyo nombre no coincide con el host): un intermediario en la red podría suplantarlo | Aceptado para la prueba; para producción, pedir a Seenode su CA y usar `sslmode=verify-ca` con `sslrootcert` |
| R19 | Media | La contraseña de la base se compartió en una conversación de chat al desplegar | **Pendiente**: cambiarla con **Change password** y actualizar `DATABASE_URL` en Envs |

Revisado sin hallazgos: inyección SQL (sólo Prisma, sin `$queryRawUnsafe`),
comandos (un único `execFile` con argumentos fijos, sólo en la edición
instalable), path traversal (nombres de archivo validados contra UUID), XSS,
redirecciones abiertas (todas a rutas fijas), subidas (lista blanca de
extensiones, firma PDF en el portal público), contraseñas (bcrypt costo 12,
política de complejidad), endpoints de depuración, documentación interactiva o
métricas (no existen), CORS (no se emite). Secretos en el código: ninguno; el
único con valores reales es `.env.local`, que no se sube. No hay historial de
Git que revisar (el proyecto no era un repositorio).

### Checklist previo a producción

| | Punto |
|---|---|
| ✅ | HTTPS automático (Seenode) + HSTS |
| ✅ | Puerto por `PORT`, escucha en `0.0.0.0`, sin `localhost` ni puertos fijos |
| ✅ | Build y arranque de producción probados con los límites del plan |
| ✅ | `.env.example` completo y sin valores; `.gitignore` reforzado; `.gitattributes` |
| ✅ | Validación estricta de variables al arrancar |
| ✅ | Migraciones manuales, con vista previa y confirmación; `db push` sin aceptar pérdida de datos |
| ✅ | El workflow no despliega código cuyo esquema no esté aplicado en la base |
| ✅ | CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy |
| ✅ | CSRF por `Origin`; sin CORS |
| ✅ | Cookies HttpOnly/Secure/SameSite=Lax; sesión de 8 h; revalidación cada 5 min |
| ✅ | Límite de intentos por cuenta y por IP; portal de empleo con límite propio |
| ✅ | Errores de Prisma sin datos en producción |
| ✅ | Next.js sin vulnerabilidades críticas; el workflow bloquea las nuevas |
| ✅ | Secretos sólo en Envs de Seenode; el workflow no usa ninguno |
| ⬜ | Crear el repositorio privado, la base y el servicio; cargar Envs (secciones 5–8) |
| ⬜ | Actualizaciones de dependencias sugeridas (R12) |
| 🔶 | Volumen para archivos subidos (R11) |
| 🔶 | Datos de la demo: `instalacion`, `demo` o `demo-con-datos` |
| 🔶 | Dominio propio antes de un uso real (R3) |
| 🔶 | Correo saliente real o ninguno durante la prueba |
| 🔶 | Crons (SAP, evaluaciones, relojes): Seenode no los trae; para la prueba no hacen falta |

✅ implementado · ⬜ falta · 🔶 decisión tuya
