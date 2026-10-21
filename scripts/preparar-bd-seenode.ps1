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
function Si([string]$pregunta) { (Read-Host "$pregunta (s/n)").Trim().ToLower() -in @('s', 'si', 'sí') }
function Paso([string]$texto) { Write-Host "`n=== $texto ===" -ForegroundColor Cyan }

try {
  Write-Host "`nNominaHN - preparar la base de datos de Seenode" -ForegroundColor Cyan
  Write-Host "Seenode -> Databases -> tu base -> Connection -> formato URI -> host PUBLICO -> show password."
  Write-Host "Copia la linea completa (empieza con postgres://). Al pegarla aqui no se ve nada: es normal.`n"

  $uri = Secreto 'Pega la URI publica y pulsa Enter'
  if ($uri -notmatch '^postgres(ql)?://') { throw 'Eso no parece una URI de Seenode: debe empezar con postgres://' }
  $env:DATABASE_URL_REMOTA = $uri
  $uri = $null

  Paso '1. Revisar (solo lee la base)'
  node scripts/preparar-bd-remota.mjs revisar
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer la base. Revisa el mensaje de arriba.' }

  if (Si "`nCrear las tablas ahora?") {
    Paso '2. Aplicar el esquema'
    node scripts/preparar-bd-remota.mjs aplicar
    if ($LASTEXITCODE -ne 0) { throw 'No se aplico el esquema. Revisa el mensaje de arriba.' }

    if ((Test-Path 'prisma/esquema-aplicado.txt') -and (Si "`nSubir la huella del esquema a GitHub ahora?")) {
      Paso '3. Subir la huella'
      git add prisma/esquema-aplicado.txt
      git commit -m 'Esquema aplicado en Seenode'
      git push
      if ($LASTEXITCODE -ne 0) { throw 'No se pudo subir a GitHub. Revisa el mensaje de arriba.' }
    }
  }

  if (Si "`nSembrar los datos de demostracion (empresa, cuentas por rol, 16 empleados y planillas)?") {
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
