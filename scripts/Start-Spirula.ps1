$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $projectRoot 'toolchain\spirula-build-source\build_vulkan\spirula.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    $exe = Join-Path $projectRoot 'toolchain\spirula\spirula.exe'
}
if (-not (Test-Path -LiteralPath $exe)) { throw 'Brak lokalnej instalacji Spirula.' }
Write-Host 'AI Evolution Polska — uruchamianie oryginalnego Spirula Studio'
Start-Process -FilePath $exe
