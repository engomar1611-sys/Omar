$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'backend'
$node = Join-Path $root 'node.exe'
$service = Join-Path $root 'NewFeedERPService.exe'
$envFile = Join-Path $backend '.env'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'شغّل الإعداد بصلاحية مسؤول النظام.'
}
if (-not (Test-Path $node) -or -not (Test-Path $service) -or -not (Test-Path (Join-Path $backend 'node_modules')) -or -not (Test-Path (Join-Path $backend 'src\server.js'))) {
  throw 'ملفات تثبيت NEW FEED SUPERMARKET ERP غير مكتملة.'
}
$serviceExists = [bool](Get-Service -Name 'NewFeedERP' -ErrorAction SilentlyContinue)
if ($serviceExists) {
  Write-Host 'إيقاف خدمة النظام الحالية قبل التحديث...' -ForegroundColor Cyan
  & $service stop
  if ($LASTEXITCODE -ne 0) { throw 'تعذر إيقاف الخدمة الحالية.' }
}

Write-Host 'إعداد اتصال PostgreSQL 16' -ForegroundColor Cyan
$db = Read-Host 'DATABASE_URL (postgresql://user:password@127.0.0.1:5432/new_feed_erp)'
if ($db -notmatch '^postgres(ql)?://') { throw 'رابط قاعدة البيانات غير صحيح.' }

$portText = Read-Host 'منفذ API الداخلي [3000]'
if ([string]::IsNullOrWhiteSpace($portText)) { $portText = '3000' }
$port = 0
if (-not [int]::TryParse($portText, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
  throw 'المنفذ يجب أن يكون رقماً من 1 إلى 65535.'
}

function New-Secret([int]$bytes = 48) {
  $buffer = New-Object byte[] $bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return [BitConverter]::ToString($buffer).Replace('-', '').ToLowerInvariant()
}
$jwtSecret = New-Secret 48
$bootstrapSecret = New-Secret 32
$escapedDb = $db.Replace('"', '\"')
$envContent = @"
NODE_ENV=production
HOST=127.0.0.1
PORT=$port
DATABASE_URL="$escapedDb"
JWT_SECRET=$jwtSecret
BOOTSTRAP_SECRET=$bootstrapSecret
"@
[IO.File]::WriteAllText($envFile, $envContent, [Text.UTF8Encoding]::new($false))

Push-Location $backend
try {
  $env:DATABASE_URL = $db
  $env:JWT_SECRET = $jwtSecret
  $env:BOOTSTRAP_SECRET = $bootstrapSecret
  $env:PORT = [string]$port
  $env:HOST = '127.0.0.1'

  Write-Host 'اختبار اتصال PostgreSQL...' -ForegroundColor Cyan
  & $node --input-type=module -e "import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query('SELECT 1');await c.end();"
  if ($LASTEXITCODE -ne 0) { throw 'تعذر الاتصال بـ PostgreSQL.' }

  Write-Host 'تطبيق ترحيلات NEW FEED SUPERMARKET ERP...' -ForegroundColor Cyan
  & $node scripts/migrate.js
  if ($LASTEXITCODE -ne 0) { throw 'فشلت ترحيلات قاعدة البيانات.' }

  $userCount = (& $node --input-type=module -e "import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();const r=await c.query('SELECT COUNT(*)::int AS n FROM users');console.log(r.rows[0].n);await c.end();").Trim()
  if ($LASTEXITCODE -ne 0) { throw 'تعذر التحقق من حسابات المستخدمين.' }
} finally {
  Remove-Item Env:\DATABASE_URL,Env:\JWT_SECRET,Env:\BOOTSTRAP_SECRET,Env:\PORT,Env:\HOST -ErrorAction SilentlyContinue
  Pop-Location
}

if (-not $serviceExists) {
  & $service install
  if ($LASTEXITCODE -ne 0) { throw 'فشل تسجيل خدمة Windows.' }
}
& $service start
if ($LASTEXITCODE -ne 0) { throw 'تعذر تشغيل خدمة Windows.' }

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Seconds 2
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/ready" -TimeoutSec 3
    if ($health.status -eq 'ready' -and $health.database -eq 'connected') { $ready = $true; break }
  } catch { }
}
if (-not $ready) { throw 'الخدمة لم تؤكد جاهزية API وقاعدة البيانات. راجع سجل الخدمة.' }

Write-Host ''
Write-Host 'تم إعداد خدمة NEW FEED SUPERMARKET ERP وتشغيلها.' -ForegroundColor Green
Write-Host "API داخلي: http://127.0.0.1:$port"
Write-Host 'الخدمة مربوطة على loopback فقط. لا تفتح منفذ API على الإنترنت.'
Write-Host 'للوصول من أجهزة الموظفين: اضبط Reverse Proxy مثل Caddy على HTTPS بشهادة موثوقة، ثم وجّه التطبيق إلى رابط HTTPS.'
if ($port -ne 3000) { Write-Host "عدّل ReverseProxy.Caddyfile ليستخدم 127.0.0.1:$port بدلاً من 3000." -ForegroundColor Yellow }
if ($userCount -eq '0') {
  Write-Host ''
  Write-Host 'رمز تهيئة المدير الأول — احتفظ به واستخدمه مرة واحدة من شاشة إنشاء المدير:' -ForegroundColor Yellow
  Write-Host $bootstrapSecret -ForegroundColor White
  Write-Host 'أنشئ كلمة مرور قوية لا تقل عن 12 حرفاً. بعد إنشاء المدير، احذف BOOTSTRAP_SECRET من ملف backend\.env وأعد تشغيل الخدمة.'
} else {
  Write-Host 'توجد حسابات مستخدمين بالفعل؛ لم يتم إنشاء مدير جديد.' -ForegroundColor Yellow
}
Write-Host 'إدارة الخدمة من services.msc أو NewFeedERPService.exe status'
Read-Host 'اضغط Enter للإغلاق'
