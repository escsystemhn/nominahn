# Respaldos de Gestión360 Nómina

Cómo se respalda la base, a dónde, cuánto se conserva, cómo se prueba que se puede
recuperar y cómo se restaura. Revisado el 2026-11-25.

## Las dos capas

| Capa | Qué hace | Dónde queda |
|---|---|---|
| **Copia de la instalación** (sólo Windows) | `pg_dump` diario a la 1:30 y antes de cada actualización o restauración | `C:\ProgramData\ESC System\Gestion360 Nomina\respaldos\` (sólo SYSTEM y Administradores). Conserva 14 diarios y 5 previos |
| **Configuración → Respaldos** (Windows y Linux) | La base y los adjuntos en un archivo, verificado, a uno o varios destinos | Disco local, disco extraíble, carpeta de red o nube S3 |

La copia de la instalación está en el **mismo equipo** que la base: no protege de una falla
del disco ni de un robo. Para eso está la segunda capa, con al menos un destino fuera del
equipo. Mientras el automático esté apagado, Inicio lo recuerda a quien administra respaldos.

## Configuración → Respaldos

Permiso **Respaldos** (`configuracion.respaldos`).

**El archivo**: `g360-nomina_AAAA-MM-DD_HHMMSS_automatico.tar.gz[.enc]`, con:

- `manifiesto.json`: versión, fecha, huella SHA-256 del volcado, conteos y cómo restaurar.
- `base/g360-nomina.dump`: `pg_dump -Fc`.
- `adjuntos/`: los documentos subidos (si se eligió).

Antes de enviarlo a ningún lado:

- se comprueba el volcado con `pg_restore --list`;
- se vuelve a leer el archivo completo;
- se compara la huella.

**Cifrado**: AES-256 en el formato estándar de OpenSSL (`openssl enc -d -aes-256-cbc -pbkdf2
-iter 100000 -md sha256`). Es **obligatorio para la nube y para el disco extraíble**. Guarde la
contraseña fuera del servidor: sin ella el respaldo no se abre y nadie puede recuperarla.

### Destinos

| Destino | Cómo se usa |
|---|---|
| **Disco local** | Una carpeta de otro disco interno. En Windows, `NT SERVICE\G360NominaApp` debe poder escribir. `respaldos-app\` ya lo tiene. |
| **Disco extraíble** | USB o disco externo (Windows), o una unidad o carpeta de red **montada** (Linux). Hay que conectarlo y pulsar **Preparar disco**: eso deja la marca `.g360-destino`. Sin esa marca, o con la de otro destino, o si la carpeta queda en el disco del sistema, **no se escribe**. Ese día el respaldo queda en los demás destinos y el historial lo marca «Parcial». |
| **Carpeta de red** (Windows) | `\\servidor\carpeta`, con usuario y contraseña (se conecta con `net use` y se desconecta al terminar). |
| **Nube S3** | Amazon S3, Backblaze B2, Wasabi, DigitalOcean Spaces, Cloudflare R2, MinIO. La subida va firmada con el SHA-256 del contenido. |

**Cada copia es atómica**: se escribe como `….parcial`, se compara su SHA-256 con el original y
recién entonces toma su nombre. Una copia cortada (luz, disco desconectado) no queda como
respaldo. Antes de copiar se revisa el espacio libre.

**Un destino que falla no detiene a los demás.**

### Cuánto se conserva (en cada destino)

Retención GFS, configurable. Por omisión:

| | Se conservan |
|---|---|
| Días | los automáticos de los **7** días más recientes |
| Semanas | el último de cada una de las **4** semanas más recientes (lunes a domingo) |
| Meses | el último de cada uno de los **12** meses más recientes |
| Manuales | los **5** más recientes, aparte |

- Los manuales no cuentan para los automáticos: una tanda de «Respaldar ahora» no borra los
  automáticos.
- Siempre queda el más reciente.
- Un archivo con nombre que no se entiende no se borra.

### Cuándo corre

- **Automático**: diario o semanal, a la hora elegida (hora de Honduras). Si el equipo estaba
  apagado, se hace al encenderlo. Si falla, se reintenta hasta 3 veces, con una hora entre
  cada intento.
- Lo dispara un cron que llama `POST /api/cron/respaldos` con `x-cron-secret`:
  - **Windows**: la tarea **Respaldos** cada 15 minutos, aparte de «Tareas del sistema», para
    no frenar relojes y SAP.
  - **Linux**: `*/15 * * * * deploy/cron.sh respaldos`, con su propio candado.
- **Respaldar ahora** corre en segundo plano: la pantalla muestra el avance y el respaldo
  sigue aunque se cierre.
- Un respaldo que quedó «en curso» por un corte se marca como interrumpido a las 3 horas.

### Avisos

A cada usuario activo con el permiso de respaldos le llega un **correo** y ve un pendiente en
**Inicio** cuando:

- un respaldo termina con error o parcial;
- pasan más de 26 horas (horario diario) u 8 días (semanal) sin uno bueno (este aviso, una vez
  por día);
- falla la prueba de restauración semanal.

Hace falta el correo saliente configurado (Configuración → Correo saliente).

## Prueba de restauración (cada domingo)

Restaura el último respaldo en una base aparte (`g360_prueba_restauracion`):

- con el rol de la aplicación y sin dueños ni permisos, igual que una restauración real;
- cuenta tablas, empleados y planillas, y los compara con lo anotado en el manifiesto;
- después **borra** la base de prueba.

El resultado sale en Configuración → Respaldos y, si falló, en Inicio y por correo.

- **Windows**: tarea **Prueba de restauracion**, los domingos a las 3:00. A mano, como
  administrador: `"C:\Program Files\ESC System\Gestion360 Nomina\probar-restauracion.cmd"`.
  Prueba el último respaldo de un disco local o extraíble; la contraseña de cifrado la lee de
  la configuración. Si no hay ninguno, prueba la copia diaria de la instalación.
- **Linux**: `0 3 * * 0 deploy/probar-restauracion.sh`. Prueba el último de `RESPALDOS_DIR`.
  Si van cifrados, la contraseña va en `~/.config/gestion360/respaldo-clave` (`chmod 600`).
  Si no hay ninguno, prueba el último «antes de desplegar» de `~/respaldos-despliegue`.

## Restaurar (sólo por comando)

Reemplaza toda la base, por eso no hay botón en la aplicación. En los dos sistemas:

1. Respalda la base actual (`antes-de-restaurar-….dump`).
2. Restaura en una base nueva (`<base>_restaurando`) **mientras la aplicación sigue
   funcionando**.
3. Detiene el servicio y cambia una base por la otra. La anterior queda como
   `<base>_anterior_<fecha>`.
4. Aplica el esquema de la versión instalada. Si eso falla, **vuelve a la base anterior**.
5. Devuelve los adjuntos y vuelve a iniciar el servicio.

Cuando confirme que todo está bien, borre `<base>_anterior_<fecha>`.

Si algo falla antes del cambio (contraseña equivocada, archivo dañado, huella que no coincide,
`pg_restore` con error), la base actual no se toca. Si falla el cambio mismo, los dos nombres
se cambian en una sola transacción: la base actual sigue en su lugar y el servicio vuelve a
iniciar.

**Mismo tipo de servidor.** La instalación de Windows lleva dentro de la base el registro de sus
migraciones (`_g360_migraciones`); un servidor Linux (kit `deploy/`) o Seenode sincroniza el
esquema con `db push` y no lo tiene. `restaurar.cmd` con un respaldo de Linux lo detecta al
aplicar las migraciones y vuelve a la base anterior sin perder nada (probado el 2026-11-25). Al
revés, `restaurar.sh` con un respaldo de Windows no está probado. Para pasar datos de un tipo de
servidor al otro, pida apoyo a ESC System.

### Windows (como administrador)

```bat
"C:\Program Files\ESC System\Gestion360 Nomina\restaurar.cmd" "D:\Respaldos\g360-nomina_2026-11-25_013000_automatico.tar.gz.enc"
```

Acepta `.tar.gz.enc`, `.tar.gz` o un `.dump` de la copia de la instalación. Si está cifrado,
usa la contraseña guardada en Configuración → Respaldos; si no la hay (otro servidor), la
pide sin mostrarla. El registro queda en `logs\respaldos.log`.

### Linux

```bash
~/nominahn/deploy/restaurar.sh /var/backups/gestion360/g360-nomina_2026-11-25_013000_automatico.tar.gz.enc
```

Pide la contraseña si está cifrado. También la toma de `RESPALDO_CLAVE` o de
`~/.config/gestion360/respaldo-clave`. El esquema se sincroniza con `npm run db:push` y
`npm run db:constraints`, como en un despliegue.

### A mano, en cualquier servidor (sin las herramientas)

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -in RESPALDO.tar.gz.enc -out RESPALDO.tar.gz
tar -xzf RESPALDO.tar.gz
createdb -U postgres -O ROL_DE_LA_APP BASE_NUEVA
pg_restore -U ROL_DE_LA_APP -d BASE_NUEVA --no-owner --no-privileges --exit-on-error base/g360-nomina.dump
```

`--no-owner --no-privileges`: en otro servidor el rol original puede no existir; así los
objetos quedan del rol que restaura.

## Unidades montadas en Linux (USB, CIFS, NFS)

Móntelas con `nofail` para que el servidor arranque sin ellas, y agréguelas como **Disco
extraíble** en la carpeta montada. Si un día no está montada, la carpeta queda vacía en el
disco del sistema: sin la marca, el respaldo no escribe ahí.

```fstab
# Carpeta compartida de Windows o NAS (las credenciales en un archivo de root, chmod 600)
//nas01/respaldos  /mnt/respaldos  cifs  credentials=/root/.nas,uid=deploy,gid=deploy,nofail,x-systemd.automount  0 0
# NFS
nas01:/respaldos   /mnt/respaldos  nfs   nofail,x-systemd.automount  0 0
```

## Variables de entorno

| Variable | Para qué |
|---|---|
| `PG_BIN_DIR` | Carpeta de `pg_dump` y `pg_restore` (el instalador de Windows la escribe). Si falta, se buscan las rutas habituales y el PATH. |
| `RESPALDOS_DIR` | Carpeta propuesta como «Disco local». La aplicación arma el respaldo en `RESPALDOS_DIR/.tmp`. |
| `RESPALDOS_TMP` | Opcional: dónde armarlo, si conviene otro disco. Hace falta el doble del tamaño de la base, más los adjuntos. |
| `CIFRADO_KEY` | Cifra en la base las contraseñas de red y de nube y la de cifrado de los respaldos. No la cambie una vez en uso. |
| `CRON_SECRET` | Protege `/api/cron/respaldos`. |
| `UPLOAD_DIR` | Los adjuntos que entran en el respaldo y que se devuelven al restaurar. |
