# 错题本 - 手机访问服务（在本文件夹启动一个静态文件服务器）
# 用法：双击「手机访问.bat」，或右键"使用 PowerShell 运行"本文件
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8080

$listener = New-Object System.Net.HttpListener
try {
    $listener.Prefixes.Add("http://+:$port/")
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "端口 $port 启动失败：可能是端口被占用，或需要点击防火墙"允许"。"
    Write-Host "请关闭占用程序后重试，或右键以管理员身份运行。"
    Read-Host "按回车键退出"
    exit 1
}

# 获取本机局域网 IPv4 地址
$ip = $null
try {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Sort-Object InterfaceMetric -ErrorAction SilentlyContinue |
        Select-Object -First 1).IPAddress
} catch { }
if (-not $ip) { $ip = '电脑IP地址' }

Write-Host ""
Write-Host "=========================================="
Write-Host "  错题本服务已启动！"
Write-Host "  请确保手机与电脑连接同一个 WiFi"
Write-Host ""
Write-Host "  手机浏览器访问:  http://$ip`:$port/"
Write-Host "  本机也可以访问:  http://localhost:$port/"
Write-Host "=========================================="
Write-Host ""
Write-Host "  保持本窗口开着，用完直接关闭窗口即可停止"
Write-Host ""

$types = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.txt'  = 'text/plain; charset=utf-8'
}

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
        $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
        if ($path -eq '/') { $path = '/index.html' }
        $rel = $path -replace '/', '\'
        $file = [IO.Path]::GetFullPath((Join-Path $root $rel.TrimStart('\')))

        if (-not $file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $file -PathType Leaf)) {
            $ctx.Response.StatusCode = 404
            $bytes = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
        } else {
            $ext = [IO.Path]::GetExtension($file).ToLower()
            if ($types.ContainsKey($ext)) { $ctx.Response.ContentType = $types[$ext] }
            else { $ctx.Response.ContentType = 'application/octet-stream' }
            $bytes = [IO.File]::ReadAllBytes($file)
        }
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        try { $ctx.Response.StatusCode = 500 } catch { }
    } finally {
        try { $ctx.Response.Close() } catch { }
    }
}
