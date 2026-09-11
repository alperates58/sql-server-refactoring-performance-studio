# SQL Server Refactoring & Performance Studio - PowerShell Başlatıcı
Set-Location -Path $PSScriptRoot

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  SQL Server Refactoring & Performance Studio" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Sunucu baslatiliyor..." -ForegroundColor Green
Write-Host "Tarayıcınız otomatik açılmazsa: http://localhost:3000 veya http://127.0.0.1:3000" -ForegroundColor Yellow
Write-Host ""

Start-Process "http://localhost:3000"
node server.js
