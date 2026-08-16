# 備援用：Windows 內建 PowerShell 靜態伺服器（不需安裝 Python 或 Node.js）
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$prefix = "http://localhost:8080/"
$types = @{ ".html"="text/html; charset=utf-8"; ".js"="text/javascript; charset=utf-8";
            ".css"="text/css; charset=utf-8"; ".json"="application/json; charset=utf-8";
            ".png"="image/png"; ".jpg"="image/jpeg"; ".svg"="image/svg+xml"; ".ico"="image/x-icon" }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() }
catch {
  Write-Host ""
  Write-Host "Could not start the server on $prefix" -ForegroundColor Red
  Write-Host "Try running this file as Administrator, or install Python / Node.js." -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 1
}
Write-Host "Serving $root  ->  $prefix   (close this window to stop)"

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($rel -eq "/") { $rel = "/index.html" }
    $file = Join-Path $root ($rel.TrimStart("/") -replace "/", "\")
    if ((Test-Path $file -PathType Leaf) -and $file.StartsWith($root)) {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("Not found: $rel")
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $ctx.Response.Close()
  } catch { }
}
