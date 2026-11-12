[CmdletBinding()]
param([string]$OutputDirectory = '.\backups')
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$file=(Resolve-Path $OutputDirectory).Path + "\NEW-FEED-$stamp.sql"
$command='docker compose exec -T postgres pg_dump -U newfeed -d newfeed_erp --no-owner --no-acl > "'+$file+'"'
cmd.exe /d /s /c $command
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $file) -or (Get-Item $file).Length -lt 100) { throw 'فشل النسخ الاحتياطي.' }
Write-Host "تم إنشاء نسخة SQL: $file" -ForegroundColor Green
