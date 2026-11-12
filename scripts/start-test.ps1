[CmdletBinding()]
param([int]$Port = 3000)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop غير مثبت أو غير موجود في PATH.' }
docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'يلزم Docker Compose v2.' }
function New-UrlSafeSecret([int]$Bytes = 48) {
  $buffer = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+','-').Replace('/','_')
}
function Convert-SecureToPlain([Security.SecureString]$Value) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
if (-not (Test-Path '.env')) {
  $envText = @('POSTGRES_PASSWORD=' + (New-UrlSafeSecret 24),'AUTH_JWT_SECRET=' + (New-UrlSafeSecret 48),'APP_PORT=' + $Port) -join "`n"
  Set-Content -Path '.env' -Value $envText -Encoding ASCII
  Write-Host 'تم إنشاء .env محلياً بمفاتيح عشوائية. لا تشارك هذا الملف.' -ForegroundColor Green
} else { Write-Host 'سيتم استخدام إعدادات .env الحالية.' }
docker compose up --build -d
if ($LASTEXITCODE -ne 0) { throw 'فشل تشغيل الخدمات. راجع docker compose logs.' }
$firstRun = Read-Host 'هل هذه قاعدة بيانات اختبار جديدة وتحتاج إنشاء أول مدير؟ اكتب Y للموافقة'
if ($firstRun -match '^(Y|y)$') {
  $username = Read-Host 'اسم مستخدم المدير (افتراضي admin)'
  if ([string]::IsNullOrWhiteSpace($username)) { $username = 'admin' }
  $displayName = Read-Host 'اسم المدير الظاهر (افتراضي مدير النظام)'
  if ([string]::IsNullOrWhiteSpace($displayName)) { $displayName = 'مدير النظام' }
  $secure = Read-Host 'كلمة مرور المدير (14 حرفاً على الأقل)' -AsSecureString
  $password = Convert-SecureToPlain $secure
  if ($password.Length -lt 14) { throw 'كلمة المرور يجب ألا تقل عن 14 حرفاً.' }
  docker compose exec -T -e "BOOTSTRAP_ADMIN_USERNAME=$username" -e "BOOTSTRAP_ADMIN_NAME=$displayName" -e "BOOTSTRAP_ADMIN_PASSWORD=$password" api npm run bootstrap:admin
  if ($LASTEXITCODE -ne 0) { throw 'فشل إنشاء المدير الأول. لا تعاود المحاولة قبل مراجعة حالة قاعدة البيانات.' }
  $password = $null
  Write-Host 'تم إنشاء المدير. احتفظ بكلمة المرور في مكان آمن.' -ForegroundColor Green
} else { Write-Host 'تم تخطي إنشاء المدير؛ استخدم بيانات مستخدم موجود.' -ForegroundColor Yellow }
$base = "http://localhost:$Port"
$ready = $false
for ($i=0; $i -lt 30; $i++) {
  try { $response = Invoke-RestMethod "$base/ready" -TimeoutSec 3; if ($response.status -eq 'ready') { $ready = $true; break } }
  catch { Start-Sleep -Seconds 2 }
}
if (-not $ready) { docker compose logs --tail 80 api; throw 'الخدمة لم تصل إلى حالة ready.' }
Write-Host "NEW FEED ERP جاهز للاختبار: $base" -ForegroundColor Green
Write-Host "افتح الرابط من متصفح Windows. لأجهزة الشبكة استخدم IP الخادم والمنفذ $Port مع ضبط الجدار الناري."
Write-Host 'تنبيه: هذه حزمة Web/API للاختبار، وليست مثبت Windows مستقل أو إعداد HTTPS إنتاجي.'
