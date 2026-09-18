# Regenerate application assets from the user's source logo; no Python packages needed.
$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path $PSScriptRoot -Parent
$source = Join-Path $workspaceRoot 'images/application icon.png'
Copy-Item -LiteralPath $source -Destination (Join-Path $workspaceRoot 'apps/workspace/public/application-icon.png')
$version = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.Substring(0, 16).ToLowerInvariant()
$iconUrl = "/application-icon.png?v=$version"
[System.IO.File]::WriteAllText((Join-Path $workspaceRoot 'apps/workspace/src/branding.ts'), "// Updated by deploy/sync-icons.ps1 when the source logo changes.`nexport const applicationIcon = `"$iconUrl`";`n")
$indexPath = Join-Path $workspaceRoot 'apps/workspace/index.html'
$indexHtml = [System.IO.File]::ReadAllText($indexPath)
[System.IO.File]::WriteAllText($indexPath, ($indexHtml -replace '/application-icon\.png(?:\?v=[a-f0-9]+)?', $iconUrl))
Add-Type -AssemblyName System.Drawing
$logo = [System.Drawing.Image]::FromFile($source)
$images = [System.Collections.Generic.List[byte[]]]::new()
$sizes = @(16, 24, 32, 48, 64, 128, 256)
try {
    foreach ($size in $sizes) {
        $bitmap = [System.Drawing.Bitmap]::new($size, $size)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $stream = [System.IO.MemoryStream]::new()
        try {
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($logo, 0, 0, $size, $size)
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            $images.Add($stream.ToArray())
        } finally { $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
    }
    $file = [System.IO.File]::Create((Join-Path $workspaceRoot 'apps/desktop/application.ico'))
    $writer = [System.IO.BinaryWriter]::new($file)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
        $offset = 6 + 16 * $sizes.Count
        for ($i = 0; $i -lt $sizes.Count; $i++) {
            $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
            $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
            $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset)
            $offset += $images[$i].Length
        }
        foreach ($bytes in $images) { $writer.Write($bytes) }
    } finally { $writer.Dispose(); $file.Dispose() }
} finally { $logo.Dispose() }
Write-Output 'Updated browser PNG and multi-resolution Windows ICO from images/application icon.png.'
