# Global News Hub - 서버 자동 시작 스크립트
# 작업 스케줄러가 오전 6:30에 이 파일을 실행합니다.

# PC 완전 부팅 대기
Start-Sleep -Seconds 20

# pm2에 저장된 프로세스 복구
pm2 resurrect 2>$null

Start-Sleep -Seconds 5

# 이미 실행 중이면 재시작, 아니면 시작
pm2 restart it-news 2>$null
if ($LASTEXITCODE -ne 0) {
    Set-Location "C:\KDS\it-news"
    pm2 start server.js --name it-news
    pm2 save
}
