# GlobalNewsHub - 오전 10시 백업 시작 스크립트
# 서버가 실행 중이지 않을 때만 시작 (7시 30분 시작 실패 대비)

Start-Sleep -Seconds 10

try {
    $jsonOutput = pm2 jlist 2>$null
    $processes = $jsonOutput | ConvertFrom-Json
    $running = $processes | Where-Object { $_.name -eq 'it-news' -and $_.pm2_env.status -eq 'online' }
} catch {
    $running = $null
}

if (-not $running) {
    Write-Host "[Fallback 10시] it-news 미실행 확인 → 서버 시작"
    pm2 resurrect 2>$null
    Start-Sleep -Seconds 5
    pm2 restart it-news 2>$null
    if ($LASTEXITCODE -ne 0) {
        Set-Location "C:\KDS\it-news"
        pm2 start server.js --name it-news
        pm2 save
    }
} else {
    Write-Host "[Fallback 10시] it-news 이미 실행 중 → 건너뜀"
}
