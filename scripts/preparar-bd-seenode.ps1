# ═══════════════════════════════════════════════════════════════════════════
# Asistente para preparar la base de Seenode desde Windows.
#
#   powershell -ExecutionPolicy Bypass -File scripts\preparar-bd-seenode.ps1
#
# Pide la URI (sin mostrarla en pantalla) y, preguntando antes de cada paso:
#   1. muestra el SQL pendiente          (npm run db:remota -- revisar)
#   2. crea tablas, índices y triggers   (npm run db:remota -- aplicar)
#   3. sube la huella del esquema a GitHub
#   4. siembra los datos de demostración (npm run db:remota -- sembrar ...)
#
# Hace lo mismo que los comandos de README-DEPLOY.md, sección 6.2, sin tener
# que editar la URI dentro de un comando (y sin que quede en el historial de
# PowerShell). Al terminar borra las variables de la sesión.
# ═══════════════════════════════════════════════════════════════════════════
# Sin $ErrorActionPreference = 'Stop': en PowerShell 5.1 convertiría en error los
# avisos que Prisma escribe por stderr aunque todo salga bien. Cada paso se
# comprueba con $LASTEXITCODE.
Set-Location (Split-Path $PSScriptRoot -Parent) -ErrorAction Stop

function Secreto([string]$pregunta) {
  $s = Read-Host $pregunta -AsSecureString
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}
function Confirmar([string]$pregunta) { (Read-Host "$pregunta (s/n)").Trim().ToLower() -in @('s', 'si', 'sí') }
function Paso([string]$texto) { Write-Host "`n=== $texto ===" -ForegroundColor Cyan }

try {
  Write-Host "`nNominaHN - preparar la base de datos de Seenode" -ForegroundColor Cyan
  Write-Host "Abre en Seenode: Databases -> tu base -> pestana Connection -> pulsa 'show password'."
  Write-Host "Si ves una linea que empieza con postgres:// (formato URI), pegala aqui."
  Write-Host "Si no la encuentras, deja esto vacio y pulsa Enter: te pido los datos uno por uno."
  Write-Host "(Lo que pegues en las preguntas ocultas no se ve en pantalla: es normal.)`n"

  $uri = Secreto 'URI que empieza con postgres:// (o Enter para dar los datos sueltos)'
  if (-not $uri) {
    Write-Host "`nCopia cada dato de la pestana Connection. Si hay dos hosts, usa el PUBLICO (el que NO dice private/internal ni empieza con 10.)."
    $servidor = (Read-Host 'host').Trim()
    $puerto = (Read-Host 'port (Enter si es 5432)').Trim()
    if (-not $puerto) { $puerto = '5432' }
    $usuario = (Read-Host 'username').Trim()
    $clave = Secreto 'password'
    $base = (Read-Host 'database (el nombre, p. ej. db_...)').Trim()
    if (-not ($servidor -and $usuario -and $clave -and $base)) { throw 'Falta alguno de los datos (host, username, password o database).' }
    # EscapeDataString: una clave con @, :, / o # rompería la URI si fuera tal cual.
    $uri = "postgres://$([uri]::EscapeDataString($usuario)):$([uri]::EscapeDataString($clave))@${servidor}:$puerto/$([uri]::EscapeDataString($base))"
    $clave = $null
  }
  if ($uri -notmatch '^postgres(ql)?://') { throw 'Eso no parece una URI de Seenode: debe empezar con postgres://' }
  $env:DATABASE_URL_REMOTA = $uri
  $uri = $null

  Paso '1. Revisar (solo lee la base)'
  node scripts/preparar-bd-remota.mjs revisar
  if ($LASTEXITCODE -ne 0 -and $env:DATABASE_URL_REMOTA -notmatch 'sslmode=') {
    # Muchos PostgreSQL gestionados sólo aceptan conexiones cifradas desde fuera.
    if (Confirmar "`nNo se pudo conectar. Probar de nuevo exigiendo SSL (sslmode=require)?") {
      $separador = if ($env:DATABASE_URL_REMOTA.Contains('?')) { '&' } else { '?' }
      $env:DATABASE_URL_REMOTA = "$($env:DATABASE_URL_REMOTA)${separador}sslmode=require"
      Paso '1. Revisar de nuevo, con SSL'
      node scripts/preparar-bd-remota.mjs revisar
    }
  }
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer la base. Revisa el mensaje de arriba.' }

  if (Confirmar "`nCrear las tablas ahora?") {
    Paso '2. Aplicar el esquema'
    node scripts/preparar-bd-remota.mjs aplicar
    if ($LASTEXITCODE -ne 0) { throw 'No se aplico el esquema. Revisa el mensaje de arriba.' }

    if ((Test-Path 'prisma/esquema-aplicado.txt') -and (Confirmar "`nSubir la huella del esquema a GitHub ahora?")) {
      Paso '3. Subir la huella'
      git add prisma/esquema-aplicado.txt
      git commit -m 'Esquema aplicado en Seenode'
      git push
      if ($LASTEXITCODE -ne 0) { throw 'No se pudo subir a GitHub. Revisa el mensaje de arriba.' }
    }
  }

  if (Confirmar "`nSembrar los datos de demostracion (empresa, cuentas por rol, 16 empleados y planillas)?") {
    Write-Host 'La clave de las cuentas de demostracion: 10+ caracteres con letra, numero y simbolo.'
    $c1 = Secreto 'Clave para las cuentas de demostracion'
    $c2 = Secreto 'Repitela'
    if ($c1 -ne $c2) { throw 'Las claves no coinciden.' }
    $env:SEED_DEMO_PASSWORD = $c1
    $c1 = $null; $c2 = $null
    Paso '4. Sembrar'
    node scripts/preparar-bd-remota.mjs sembrar demo-con-datos
    if ($LASTEXITCODE -ne 0) { throw 'No se sembraron los datos. Revisa el mensaje de arriba.' }
    Write-Host "`nIMPORTANTE: arriba sale UNA sola vez la clave temporal de admin@nominahn.hn. Anotala." -ForegroundColor Yellow
  }

  Write-Host "`nListo." -ForegroundColor Green
}
catch {
  Write-Host "`n$($_.Exception.Message)" -ForegroundColor Red
}
finally {
  Remove-Item Env:DATABASE_URL_REMOTA, Env:SEED_DEMO_PASSWORD -ErrorAction SilentlyContinue
}
