# 폰/아이패드(같은 와이파이) 접속용 — 방화벽에서 3000 포트 열기.
# 관리자 권한이 필요합니다(UAC 창이 뜨면 "예"). 한 번만 실행하면 됩니다.
$rule = "shopping-shorts web 3000"
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Write-Host "관리자 권한으로 다시 실행합니다. 창이 뜨면 '예'를 누르세요..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$PSCommandPath`""
    exit
}
netsh advfirewall firewall delete rule name="$rule" 2>$null | Out-Null
netsh advfirewall firewall add rule name="$rule" dir=in action=allow protocol=TCP localport=3000 profile=any | Out-Null

# 이 PC의 와이파이/랜 IP 자동 감지해서 안내
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' } |
    Select-Object -First 1 -ExpandProperty IPAddress)
Write-Host ""
Write-Host "완료! 폰/아이패드(같은 와이파이)에서 아래 주소로 접속하세요:" -ForegroundColor Green
if ($ip) { Write-Host "    http://${ip}:3000" -ForegroundColor Cyan }
else     { Write-Host "    http://<이 PC의 IP>:3000  (실행 창에 뜬 Network 주소)" -ForegroundColor Cyan }
Write-Host ""
Read-Host "엔터를 누르면 닫힙니다"
