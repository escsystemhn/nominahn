# Despliegue de Gestión360 Nómina en DigitalOcean

Guía para dejar la aplicación en producción en un droplet Ubuntu 24.04 LTS, con
HTTPS, respaldos y tareas programadas. Sirve también para una demostración
(`MODO=demo`, al final). Corresponde a la opción B de la propuesta a Power Chicken
(`Propuesta Power Chicken.pdf`, en la raíz del proyecto).

## 0. En el panel de DigitalOcean (antes de los scripts)

La cuenta debe ser **del cliente**, con ESC System invitado como miembro del
equipo: así los datos y la facturación son suyos desde el primer día.

| Recurso | Configuración |
|---|---|
| Droplet | Ubuntu 24.04 LTS x64 · **Basic Regular 4 GB / 2 vCPU / 80 GB** (US$24/mes) · región **NYC3** · autenticación con **SSH key**, nunca contraseña · **Backups diarios** (+30 %) · **Monitoring** (gratis) |
| Spaces | Un bucket privado en NYC3 (US$5/mes) y una **Access Key** sólo para él. Es el destino de los respaldos cifrados. |
| Alertas | Monitoring → alertas de CPU > 80 %, memoria > 85 % y disco > 80 %. Uptime → **un** chequeo (el primero es gratis) a `https://nomina.sudominio.hn/api/estado`. |
| DNS | Un registro A del subdominio (`nomina.sudominio.hn`) a la IP del droplet, en el DNS del cliente. **Nunca el ápex de su dominio**: la cabecera HSTS lleva `includeSubDomains` con dos años de vigencia. |

**Correo:** DigitalOcean **bloquea los puertos 25, 465 y 587** en todos los droplets.
Crea una cuenta en un proveedor que acepte el **2525** (Brevo: `smtp-relay.brevo.com`,
con una *SMTP key*; gratis hasta 300 correos al día), autentica ahí el dominio del
remitente (registros SPF y DKIM en el DNS del cliente) y usa esos datos en el paso 4.

## 1. Preparar el servidor

```bash
ssh root@IP 'bash -s' < deploy/01-servidor.sh
```

Deja zona horaria de Honduras, 4 GB de swap, Node 22, **PostgreSQL 18 del
repositorio oficial** (la misma versión que el instalador de Windows y el
desarrollo: así un respaldo de un lado se restaura en el otro), Caddy, usuario
`deploy` sin privilegios, SSH sólo por clave, UFW (22/80/443), fail2ban y las
carpetas `/var/uploads` (adjuntos) y `/var/backups/gestion360` (respaldos locales).

> **Comprueba en otra terminal que entras con `ssh deploy@IP` antes de cerrar
> la sesión de root.** Si algo saliera mal, la consola web de DigitalOcean es la
> vía de rescate.

## 2. Base de datos

```bash
ssh deploy@IP 'sudo bash -s' < deploy/02-postgres.sh
```

Crea el rol `nomina_app` (sin privilegios de superusuario) y la base `nominahn`,
y **imprime la `DATABASE_URL` una sola vez**. Cópiala.

## 3. Subir el código

Desde PowerShell, en la raíz de `nominahn/`:

```powershell
.\deploy\subir.ps1 -Servidor deploy@IP
```

Excluye `node_modules`, `.next`, `.env.local` y todo lo que vive en la raíz del
proyecto, donde están `BD/` y `Datos.txt`. **Esos volcados tienen salarios, RTN y
cuentas bancarias reales: no deben salir de tu equipo.**

## 4. Configuración

```bash
ssh deploy@IP
cp ~/nominahn/deploy/env.produccion.example ~/nominahn/.env.local
nano ~/nominahn/.env.local     # rellenar; secretos NUEVOS
chmod 600 ~/nominahn/.env.local
```

`src/lib/env.ts` valida todo al arrancar y **aborta en producción** si falta algo.
Guarda `CIFRADO_KEY` fuera del servidor (en el gestor de contraseñas de ESC System):
sin ella, una base restaurada no puede leer las contraseñas que guarda cifradas.

## 5. Desplegar

Primera vez, en **producción** (base vacía):

```bash
ssh -t deploy@IP 'EMPRESA="Power Chicken" ADMIN_CORREO=rrhh@empresa.hn ADMIN_NOMBRE="Nombre Apellido" bash ~/nominahn/deploy/03-app.sh'
```

Pide la contraseña del administrador sin mostrarla (al menos 10 caracteres, con
letras, números y un símbolo) y crea **sólo** la empresa, una sucursal, ese
administrador y la cuenta de soporte `soporte@esc-systemhn.com`, con su contraseña
temporal, que el sistema obliga a cambiar al entrar. **Ninguna cuenta de
demostración.** Es el mismo arranque que el instalador de Windows.

Después, en cada actualización (`subir.ps1` y luego):

```bash
ssh -t deploy@IP 'bash ~/nominahn/deploy/03-app.sh'
```

El script, en orden:

1. **Respalda la base** en `~/respaldos-despliegue/antes-<fecha>.dump` si ya tiene
   datos (se conservan los cinco últimos).
2. `npm ci` y el cliente de Prisma.
3. Muestra los **cambios de esquema** y los aplica con `db push` + triggers. Si un
   cambio borrara datos, `db push` se niega: se detiene ahí, con el respaldo hecho.
4. Base vacía: datos iniciales. Con usuarios: sólo pone al día los perfiles de acceso.
5. Compila, instala el servicio `nominahn` y lo reinicia.
6. Programa las tareas en el crontab de `deploy` (respaldos, relojes, SAP y
   evaluaciones, igual que el instalador de Windows) con `deploy/cron.sh`, que lee
   `CRON_SECRET` de `.env.local` en cada vuelta.
7. Comprueba que `/api/estado` responda.

## 6. HTTPS

```bash
sudo cp ~/nominahn/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/__DOMINIO__/nomina.sudominio.hn/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy pide el certificado a Let's Encrypt solo. El DNS debe estar propagado
antes o la emisión falla.

## 7. Antes de entregar (lista de verificación)

- [ ] `curl -I https://nomina.sudominio.hn/login` → 200 con `Strict-Transport-Security`.
- [ ] Entrar con **`soporte@esc-systemhn.com`** y cambiar su contraseña temporal **ya**:
      mientras no se cambie, quien la conozca entra con acceso total.
- [ ] Entrar con el administrador del cliente.
- [ ] **Configuración → Correo saliente**: puerto 2525 y enviar una prueba (comprobar que
      no llegue a no deseados).
- [ ] **Configuración → Respaldos**: activar el cifrado (guardar la contraseña con el
      cliente); destino **Nube (S3)** → proveedor *DigitalOcean Spaces*, región `nyc3`, el
      bucket y la Access Key; destino *Disco local* (`/var/backups/gestion360`) como
      segundo; automático diario; «Probar» cada destino y **«Respaldar ahora»**.
- [ ] `journalctl -t gestion360-cron -n 20` muestra las llamadas cada 5 minutos con 200.
- [ ] **Prueba de restauración** (ver abajo) en un droplet temporal, que después se destruye.

## Operación

```bash
sudo systemctl restart nominahn          # reiniciar
sudo journalctl -u nominahn -n 200       # registro de la aplicación
journalctl -t gestion360-cron -f         # tareas programadas
sudo apt update && sudo apt upgrade      # incluye PostgreSQL: las actualizaciones
                                         # automáticas sólo cubren a Ubuntu
```

### Restaurar un respaldo de Configuración → Respaldos

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -in ARCHIVO.tar.gz.enc -out r.tar.gz
mkdir r && tar -xzf r.tar.gz -C r        # manifiesto.json, base/, adjuntos/
sudo systemctl stop nominahn
pg_restore --clean --if-exists --no-owner -h localhost -U nomina_app -d nominahn r/base/g360-nomina.dump
rsync -a r/adjuntos/ /var/uploads/
sudo systemctl start nominahn
```

Con el `.env.local` original: la misma `CIFRADO_KEY` (ver paso 4).

## Demostración

`MODO=demo bash ~/nominahn/deploy/03-app.sh` siembra «Empresa Ejemplo S.A. de C.V.»
con empleados ficticios y las cuentas de prueba, que comparten `Admin1234!`
(publicada): en un servidor accesible desde internet, desactiva las que no vayas a
enseñar y restablece la clave de las demás desde `/usuarios`. Para una demo basta
el droplet de 2 GB (US$12/mes) sin backups.

**Al terminar, cerrar sin cargos:** `pg_dump` de lo que se haya capturado, **destruir
el droplet** (apagarlo no detiene el cobro) y revisar que no queden snapshots,
Spaces ni Reserved IPs sin asignar, que se cobran aparte.
