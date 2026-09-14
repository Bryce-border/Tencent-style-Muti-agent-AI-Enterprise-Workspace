param([string]$JdkHome = $env:JAVA_HOME)
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path $PSScriptRoot -Parent
$originalJava = $env:JAVA_HOME
$originalPath = $env:Path
if (-not $JdkHome) { throw 'Pass -JdkHome with an installed Java 21 JDK path.' }
try {
    $env:JAVA_HOME = $JdkHome
    $env:Path = "$JdkHome\bin;$originalPath"
    $version = (& java -version 2>&1 | Out-String)
    if ($version -notmatch 'version "21\.') { throw 'Java 21 is required. The system default was not changed.' }
    & (Join-Path $PSScriptRoot 'init-r2-env.ps1')
    if (-not (Test-Path (Join-Path $PSScriptRoot '.env'))) {
        Copy-Item (Join-Path $PSScriptRoot '.env.example') (Join-Path $PSScriptRoot '.env')
    }
    Push-Location (Join-Path $workspaceRoot 'services/java')
    try {
        & mvn "-Dmaven.repo.local=$workspaceRoot/.tools/m2" -B -ntp package
        if ($LASTEXITCODE -ne 0) { throw 'Java build failed.' }
    } finally { Pop-Location }
    Push-Location (Join-Path $workspaceRoot 'apps/workspace')
    try {
        if (-not (Test-Path 'node_modules')) {
            & npm ci --cache "$workspaceRoot/.tools/npm-cache" --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
        }
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    } finally { Pop-Location }
    Write-Output 'Artifacts built. Start Docker using the two Compose files and .env.r2.'
} finally {
    $env:JAVA_HOME = $originalJava
    $env:Path = $originalPath
}
