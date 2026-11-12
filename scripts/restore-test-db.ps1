[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BackupFile)
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$resolved=(Resolve-Path $BackupFile).Path
$confirm=Read-Host 'تحذير: ستُحذف قاعدة الاختبار الحالية بالكامل. اكتب RESTORE للتأكيد'
if ($confirm -cne 'RESTORE') { throw 'تم إلغاء الاستعادة.' }
docker compose stop api
if ($LASTEXITCODE -ne 0) { throw 'تعذر إيقاف API.' }
docker compose exec -T postgres dropdb -U newfeed --if-exists newfeed_erp
if ($LASTEXITCODE -ne 0) { throw 'تعذر حذف قاعدة الاختبار.' }
docker compose exec -T postgres createdb -U newfeed newfeed_erp
if ($LASTEXITCODE -ne 0) { throw 'تعذر إنشاء قاعدة الاختبار.' }
$command='docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U newfeed -d newfeed_erp < "'+$resolved+'"'
cmd.exe /d /s /c $command
if ($LASTEXITCODE -ne 0) { throw 'فشلت استعادة SQL.' }
docker compose start api
if ($LASTEXITCODE -ne 0) { throw 'تعذر إعادة تشغيل API.' }
Write-Host 'تمت الاستعادة. تحقق من /ready وسجل الدخول.' -ForegroundColor Green
