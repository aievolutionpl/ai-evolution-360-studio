param([ValidatePattern('^[J-Z]$')][string]$Drive = 'R')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (Test-Path "${Drive}:\") { throw "Dysk ${Drive}: jest zajęty. Wybierz wolną literę przez -Drive." }
& subst "${Drive}:" $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'Nie udało się utworzyć tymczasowego dysku.' }
try {
    $buildSource = "${Drive}:\toolchain\spirula-build-source"
    if (-not (Test-Path -LiteralPath $buildSource)) {
        & git clone --local (Join-Path $projectRoot 'vendor\spirula-studio') $buildSource
        if ($LASTEXITCODE -ne 0) { throw 'Klonowanie źródeł nie powiodło się.' }
    }
    $flags = @('-DSS_BACKEND=vulkan', '-DSS_ENABLE_PATENTED=ON', "-DVulkan_INCLUDE_DIR=${Drive}:/toolchain/Vulkan-Headers/include", "-DVulkan_LIBRARY=${Drive}:/toolchain/vulkan-1.lib")
    & "$buildSource\build_develop.bat" @flags
    if ($LASTEXITCODE -ne 0) { throw "Build zakończył się kodem $LASTEXITCODE" }
} finally {
    & subst "${Drive}:" /D
}
