$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:8765'
$status = Invoke-RestMethod "$url/api/health" -TimeoutSec 3
if ($status.product -ne 'AI Evolution 360 Studio') { throw 'Pod tym adresem nie dziala 360 Studio.' }
Invoke-RestMethod "$url/api/shutdown" -Method Post -Headers @{'X-Studio-Token'=$status.token} -ContentType 'application/json' -Body '{}' | Out-Null
Write-Host 'Zatrzymywanie studia i jego aktywnego zadania.'
