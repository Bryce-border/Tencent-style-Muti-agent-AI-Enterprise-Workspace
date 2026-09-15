$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$logDir = Join-Path $root '.tools'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logFile = Join-Path $logDir 'desktop-startup.log'
$started = $false
Push-Location (Join-Path $root 'deploy')
try {
    $ErrorActionPreference = 'Continue'
    docker info --format '{{.ServerVersion}}' *> $logFile
    if ($LASTEXITCODE -ne 0) { throw '请先启动 Docker Desktop。' }
    docker compose --env-file .env.r2 -f docker-compose.yml -f docker-compose.r2.yml up -d *>> $logFile
    if ($LASTEXITCODE -ne 0) { throw '服务启动失败，请查看 .tools/desktop-startup.log。' }
    $started = $true
} catch {
    $_.Exception.Message | Out-File -FilePath $logFile -Append -Encoding utf8
} finally { $ErrorActionPreference = 'Stop'; Pop-Location }
$appExe = Join-Path $root 'apps/desktop/dist/EnterpriseWorkspace-win32-x64/EnterpriseWorkspace.exe'
if (!(Test-Path -LiteralPath $appExe)) { throw '桌面应用尚未打包。请在 apps/desktop 执行 npm run package。' }
if ($started) {
    $deadline = (Get-Date).AddSeconds(45)
    do {
        try { Invoke-WebRequest -UseBasicParsing 'http://localhost:8080/health' -TimeoutSec 3 | Out-Null; break }
        catch { Start-Sleep -Seconds 2 }
    } while ((Get-Date) -lt $deadline)
}
# Open the offline help too when Docker failed, so a hidden shortcut never fails silently.
Start-Process -FilePath $appExe
