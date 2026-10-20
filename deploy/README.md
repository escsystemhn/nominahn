# Despliegue de NominaHN — demo de 30 días en DigitalOcean

Guía para dejar la aplicación corriendo en un droplet Ubuntu 24.04 LTS, con
HTTPS, y poder retirarla sin dejar cargos abiertos.

## Antes de empezar

| Decisión | Recomendación |
|---|---|
| Droplet | Basic Regular, **2 GB / 1 vCPU / 50 GB — $12/mes** |
| Imagen | Ubuntu 24.04 LTS x64 |
| Autenticación | **SSH key**, nunca contraseña |
| Extras | Sin backups (+20 %), sin Managed Postgres ($15/mes), Monitoring sí (gratis) |

DigitalOcean factura por hora con tope mensual: 30 días = $12, o **$0 si usas el
crédito de bienvenida**. Ojo — **apagar el droplet no detiene el cobro**; sólo
destruirlo lo detiene.

Necesitas además un nombre de dominio apuntando a la IP del droplet. Por orden
de preferencia: un subdominio del cliente (`demo.cliente.hn`), un subdominio
gratuito de DuckDNS, o un dominio propio. **Nunca el ápex de un dominio real
del cliente**: la cabecera HSTS de `next.config.ts` lleva `includeSubDomains`
con dos años de vigencia.

---

## Paso 1 — Preparar el servidor

```bash
ssh root@IP 'bash -s' < deploy/01-servidor.sh
```

Deja el sistema con zona horaria de Honduras, 4 GB de swap, Node 22, PostgreSQL
16, Caddy, usuario `deploy` sin privilegios, SSH sólo por clave, UFW (22/80/443)
y fail2ban.

> **Comprueba en otra terminal que entras con `ssh deploy@IP` antes de cerrar
> la sesión de root.** Si algo saliera mal, la consola web de DigitalOcean es la
> vía de rescate.

## Paso 2 — Base de datos

```bash
ssh deploy@IP 'sudo bash -s' < deploy/02-postgres.sh
```

> Desde el paso 1 el acceso de root por SSH queda cerrado: todo lo
> administrativo se hace como `deploy` con `sudo`.

Crea el rol `nomina_app` (sin privilegios de superusuario) y la base `nominahn`,
y **imprime la `DATABASE_URL` una sola vez**. Cópiala.

## Paso 3 — Subir el código

Desde PowerShell, en la raíz de `nominahn/`:

```powershell
.\deploy\subir.ps1 -Servidor deploy@IP
```

Excluye `node_modules`, `.next` y `.env.local`, y no toca la raíz del proyecto,
donde viven `BD/` y `Datos.txt`. **Ese volcado tiene salarios, RTN y cuentas
bancarias reales: no debe salir de tu equipo.**

## Paso 4 — Configuración

```bash
ssh deploy@IP
cp ~/nominahn/deploy/env.produccion.example ~/nominahn/.env.local
nano ~/nominahn/.env.local     # rellenar; secretos NUEVOS
chmod 600 ~/nominahn/.env.local
```

`src/lib/env.ts` valida todo al arrancar y **aborta en producción** si falta
algo. `SMTP_*` no es opcional aunque no vayas a enviar correo.

## Paso 5 — Desplegar

```bash
ssh deploy@IP 'bash ~/nominahn/deploy/03-app.sh'
```

Instala dependencias, genera el cliente de Prisma, hace `db push` + los triggers
de `prisma/sql/`, siembra datos de demostración, compila e instala el servicio.

Para actualizar más adelante: `subir.ps1` y de nuevo `03-app.sh`, esta vez con
`SEMBRAR=no bash ~/nominahn/deploy/03-app.sh` para no volver a sembrar.

## Paso 6 — HTTPS

```bash
sudo cp ~/nominahn/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/__DOMINIO__/demo.tudominio.hn/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy pide el certificado a Let's Encrypt solo. El DNS debe estar propagado
antes o la emisión falla.

## Paso 7 — Verificar

```bash
curl -I https://demo.tudominio.hn/login     # 200 + Strict-Transport-Security
sudo systemctl status nominahn
sudo journalctl -u nominahn -f
```

---

## Endurecimiento propio de la demo

1. **Cambia las contraseñas de las cuentas de demostración.** Las seis de
   `Datos.txt` comparten `Admin1234!`, que está publicada en este mismo archivo:
   en un servidor accesible desde internet eso se adivina al primer intento.
   Desactiva desde `/usuarios` las que no vayas a enseñar y restablece la clave
   de las demás — el sistema genera una temporal por cuenta y obliga a cambiarla
   al entrar.

   El **administrador** no comparte esa contraseña: `npm run db:seed` le genera
   una aleatoria que imprime UNA vez al crearlo. Si no la anotaste, restablécela
   desde `/usuarios` con otra cuenta que tenga el permiso «Restablecer
   contraseñas».
2. **Datos sintéticos, no reales.** `npm run db:seed` crea "Empresa Ejemplo
   S.A. de C.V." con empleados ficticios. Es lo que debe ver el cliente.
3. **Restringe el acceso** si conoces la IP de salida del cliente: el bloque
   `@ajenos` del `Caddyfile` lo deja en dos líneas.
4. **Vigila lo público:** `/evaluar` y `/api/evaluar` lo son por diseño
   (`src/proxy.ts`), y `/api/cron/evaluaciones`, `/api/cron/biometrico` y
   `/api/cron/sap` sólo están protegidos por `CRON_SECRET`.

## Operación

```bash
sudo systemctl restart nominahn          # reiniciar
sudo journalctl -u nominahn -n 200       # últimos registros
pg_dump -U nomina_app -h localhost nominahn > ~/respaldo.sql
```

Si la integración con SAP Business One está activa, un cron recoge los
asientos que quedaron pendientes por un fallo de red (`crontab -e`):

```cron
*/5 * * * * curl -s -o /dev/null -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3009/api/cron/sap
```

## Día 30 — cerrar sin cargos

1. `pg_dump` de lo que el cliente haya capturado y descargarlo por `scp`.
2. **Destruir el droplet** en el panel (no basta con apagarlo).
3. Revisar que no queden **snapshots** ni **Reserved IPs** sin asociar: ambos se
   siguen cobrando por su cuenta.
