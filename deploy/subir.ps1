<#
  NominaHN — envío del código al servidor desde Windows.

  Sube SÓLO la carpeta `nominahn/`, sin node_modules (los binarios nativos de
  sharp y Prisma son de Windows y no sirven en Linux), sin .next, sin .env.local
  y sin nada de lo que vive en la raíz del proyecto: el volcado de BD/ y
  Datos.txt contienen salarios, RTN y cuentas bancarias reales y NO deben salir
  de tu equipo.

      .\deploy\subir.ps1 -Servidor deploy@159.203.10.20
#>
param(
    [Parameter(Mandatory = $true)][string]$Servidor,
    [string]$Destino = "/home/deploy/nominahn"
)

$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $PSScriptRoot
$paquete = Join-Path $env:TEMP "nominahn.tgz"

$excluir = @(
    "--exclude=./node_modules", "--exclude=./.next", "--exclude=./.env.local",
    "--exclude=./.env", "--exclude=./tsconfig.tsbuildinfo", "--exclude=./.git",
    "--exclude=./var"
)

Write-Host "Empaquetando $app ..." -ForegroundColor Cyan
tar -czf $paquete @excluir -C $app .
if ($LASTEXITCODE -ne 0) { throw "Falló el empaquetado." }
"{0:N1} MB" -f ((Get-Item $paquete).Length / 1MB) | Write-Host

Write-Host "Enviando a $Servidor ..." -ForegroundColor Cyan
scp $paquete "${Servidor}:/tmp/nominahn.tgz"
if ($LASTEXITCODE -ne 0) { throw "Falló el envío." }

ssh $Servidor "mkdir -p '$Destino'; tar -xzf /tmp/nominahn.tgz -C '$Destino'; rm -f /tmp/nominahn.tgz; chmod +x '$Destino'/deploy/*.sh"
if ($LASTEXITCODE -ne 0) { throw "Falló la extracción en el servidor." }

Remove-Item $paquete -Force
Write-Host "`nCódigo en ${Destino}." -ForegroundColor Green
Write-Host "Ahora: ssh $Servidor 'bash $Destino/deploy/03-app.sh'"
