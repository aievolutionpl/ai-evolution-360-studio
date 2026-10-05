param([switch]$NoBrowser, [ValidateRange(1024,65535)][int]$Port = 8765)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$url = "http://127.0.0.1:$Port"
$status = $null
try { $status = Invoke-RestMethod "$url/api/health" -TimeoutSec 2 } catch {}
if ($status -and $status.product -ne 'AI Evolution 360 Studio') { throw "Port $Port zajmuje inna aplikacja." }
if (-not $status) {
    $node = (Get-Command node -ErrorAction Stop).Source
    $logDir = Join-Path $projectRoot 'workspace\app-logs'
    New-Item -ItemType Directory -Force $logDir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $previousStudioPort = $env:STUDIO_PORT
    try {
        $env:STUDIO_PORT = [string]$Port
        Start-Process -FilePath $node -ArgumentList @('services/server.mjs') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "$stamp.log") -RedirectStandardError (Join-Path $logDir "$stamp-error.log") | Out-Null
    } finally { $env:STUDIO_PORT = $previousStudioPort }
    for ($i=0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        try { $status = Invoke-RestMethod "$url/api/health" -TimeoutSec 1; if ($status.product -eq 'AI Evolution 360 Studio') { break } } catch {}
    }
    if ($status.product -ne 'AI Evolution 360 Studio') { throw "Nie udalo sie uruchomic aplikacji. Sprawdz logi: $logDir" }
}
if (-not $NoBrowser) { Start-Process $url }
Write-Host "AI Evolution 360 Studio dziala: $url"
