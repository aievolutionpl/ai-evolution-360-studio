$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
foreach ($command in @('git','node','npm','ffmpeg','ffprobe')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Missing prerequisite in PATH: $command" }
}
if ([int]((& node -p 'process.versions.node').Split('.')[0]) -lt 22) { throw 'Node.js 22+ is required.' }
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
$dependencies = @(
    @{name='splat-transform'; url='https://github.com/playcanvas/splat-transform.git'; ref='afbc281d765d50185f6182f23abd9c6720b3b998'},
    @{name='supersplat-viewer'; url='https://github.com/playcanvas/supersplat-viewer.git'; ref='733ad5743a718c840960eab7656f45446d8370f1'}
)
New-Item -ItemType Directory -Force (Join-Path $root 'vendor') | Out-Null
foreach ($dep in $dependencies) {
    $path = Join-Path $root "vendor/$($dep.name)"
    if (-not (Test-Path $path)) {
        Invoke-Checked git @('clone',$dep.url,$path)
        Invoke-Checked git @('-C',$path,'checkout','--detach',$dep.ref)
    }
    $head = & git -C $path rev-parse HEAD
    if ($head -ne $dep.ref) { throw "Unexpected revision at $path. Install the documented revision manually." }
    if (& git -C $path status --porcelain) { throw "Modified dependency at $path; setup will not overwrite it." }
    Push-Location $path
    try { Invoke-Checked npm @('ci'); Invoke-Checked npm @('run','build') } finally { Pop-Location }
}
Invoke-Checked npm @('install','--prefix',(Join-Path $root 'vendor/panorama'),'--save-exact','pannellum@2.5.6','--ignore-scripts','--no-audit','--no-fund')
$engineDir = Join-Path $root 'toolchain/spirula'
if (-not (Test-Path (Join-Path $engineDir 'spirula.exe'))) {
    New-Item -ItemType Directory -Force $engineDir | Out-Null
    $zip = Join-Path $engineDir 'release.zip'
    Invoke-WebRequest 'https://github.com/harry7557558/spirula-studio/releases/download/v2026.9.24/spirula-2026.9.24-windows-vulkan-x86_64.zip' -OutFile $zip
    $expected = '93EB5022C370EB826FF266167DC715013A342EC45D8ED35E13E70BA38BAEAA1E'
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $expected) { throw 'Spirula archive checksum mismatch.' }
    Expand-Archive -LiteralPath $zip -DestinationPath $engineDir
    if (-not (Test-Path (Join-Path $engineDir 'spirula.exe'))) { throw 'Unexpected Spirula archive layout.' }
}
Write-Host 'Setup complete. Run START-STUDIO.cmd.'
