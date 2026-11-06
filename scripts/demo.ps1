# One-click demo on this PC.
#   .\scripts\demo.ps1          start everything (each service in its own window), check health, open /demo
#   .\scripts\demo.ps1 -Stop    stop everything
#   .\scripts\demo.ps1 -Lan     also serve phones on the same Wi-Fi (kill switch at http://<this-pc>:3001/freeze)
param([switch]$Stop, [switch]$Lan)

$root = Split-Path $PSScriptRoot -Parent
$ports = @{ bridge = 8546; proxy = 8547; agent = 8787; app = 3001 }

function Stop-Port($port) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false -ErrorAction SilentlyContinue }
}

if ($Stop) {
  $ports.Values | ForEach-Object { Stop-Port $_ }
  Write-Host "Stopped bridge, proxy, agent and app."
  return
}

. (Join-Path $root "env.ps1") | Out-Null
$ports.Values | ForEach-Object { Stop-Port $_ }

function Start-Service($name, $dir, $command) {
  $title = "Kusari - $name"
  $full = "`$Host.UI.RawUI.WindowTitle = '$title'; . '$root\env.ps1'; Set-Location '$root\$dir'; $command"
  Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $full | Out-Null
  Write-Host "started $name"
}

$bridgeHost = if ($Lan) { "`$env:ANON_BRIDGE_HOST='0.0.0.0'; " } else { "" }
Start-Service "Anon-RPC bridge :8546" "reader" "$($bridgeHost)npm run bridge"
Start-Service "leak proxy :8547" "proxy" "node server.mjs"
Start-Service "app :3001" "app" "npm run dev"

function Wait-Url($label, $url, $seconds) {
  for ($i = 0; $i -lt $seconds; $i++) {
    try { $null = Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 3; Write-Host "  ok  $label"; return $true } catch { Start-Sleep 1 }
  }
  Write-Host "  FAIL $label ($url)" -ForegroundColor Red; return $false
}

Write-Host "`nwaiting for services..."
$bridgeOk = Wait-Url "Anon-RPC bridge (Nox worker boots in ~6-10 s)" "http://127.0.0.1:8546/metrics" 90
$null = Wait-Url "leak proxy" "http://127.0.0.1:8547/log" 30
# the agent reads through the bridge, so start it once the bridge is up
Start-Service "agent :8787" "agent" "npm start"
$null = Wait-Url "agent" "http://127.0.0.1:8787/status" 60
$null = Wait-Url "app" "http://localhost:3001/demo" 120

Write-Host "`npre-flight:"
Set-Location (Join-Path $root "agent")
node ../scripts/check-env.mjs | Select-String -Pattern "AGENT_PRIVATE_KEY|OWNER_PRIVATE_KEY|GEMINI_API_KEY|All set|to fix"
if ($bridgeOk) { node src/ens-policy.ts show 2>$null | Select-Object -Last 1 }
$m = try { Invoke-RestMethod http://127.0.0.1:8546/metrics -TimeoutSec 3 } catch { $null }
if ($m) { Write-Host "  bridge: $($m.transport), boot $($m.bootMs) ms, restarts $($m.restarts)" }

if ($Lan) {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.' } | Select-Object -First 1).IPAddress
  Write-Host "`nphone kill switch: http://$($ip):3001/freeze  (open it in MetaMask's in-app browser with the owner wallet)"
}
Write-Host "`nopening http://localhost:3001/demo"
Start-Process "http://localhost:3001/demo"
