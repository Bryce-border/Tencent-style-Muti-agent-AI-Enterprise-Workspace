$ErrorActionPreference = 'Stop'
$destination = Join-Path $PSScriptRoot '.env.r2'
function New-WorkspaceSecret {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $generator.GetBytes($bytes)
    $generator.Dispose()
    return [Convert]::ToHexString($bytes).ToLowerInvariant()
}
if (Test-Path -LiteralPath $destination) {
    $existing = [System.IO.File]::ReadAllText($destination)
    if ($existing -notmatch '(?m)^WORKSPACE_CONFIG_KEY=') {
        [System.IO.File]::AppendAllText($destination, "`nWORKSPACE_CONFIG_KEY=$(New-WorkspaceSecret)`n", [System.Text.UTF8Encoding]::new($false))
    }
    if ($existing -notmatch '(?m)^MINIO_ACCESS_KEY=') {
        [System.IO.File]::AppendAllText($destination, "MINIO_ACCESS_KEY=workspace$(New-WorkspaceSecret).Substring(0,8)`nMINIO_SECRET_KEY=$(New-WorkspaceSecret)`n", [System.Text.UTF8Encoding]::new($false))
    }
    Write-Output 'Existing credentials preserved; missing model encryption key initialized.'
    exit 0
}
$values = [ordered]@{
    MYSQL_PASSWORD = (New-WorkspaceSecret)
    MYSQL_ROOT_PASSWORD = (New-WorkspaceSecret)
    REDIS_PASSWORD = (New-WorkspaceSecret)
    WORKSPACE_JWT_SECRET = (New-WorkspaceSecret)
    WORKSPACE_INTERNAL_TOKEN = (New-WorkspaceSecret)
    WORKSPACE_CONFIG_KEY = (New-WorkspaceSecret)
    MINIO_ACCESS_KEY = ('workspace' + (New-WorkspaceSecret).Substring(0, 8))
    MINIO_SECRET_KEY = (New-WorkspaceSecret)
    BOOTSTRAP_USER = 'admin'
    BOOTSTRAP_PASSWORD = (New-WorkspaceSecret)
}
$lines = $values.GetEnumerator() | ForEach-Object { '{0}={1}' -f $_.Key,$_.Value }
[System.IO.File]::WriteAllLines($destination, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Output 'Created deploy/.env.r2 with generated credentials. Values were not logged.'
