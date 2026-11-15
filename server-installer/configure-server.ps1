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
if (-not (Test-Path $node) -or
    -not (Test-Path $service) -or
    -not (Test-Path (Join-Path $backend 'node_modules\pg')) -or
    -not (Test-Path (Join-Path $backend 'src\server.mjs')) -or
    -not (Test-Path (Join-Path $backend 'migrations')) -or
    -not (Test-Path (Join-Path $backend 'scripts\migrate.mjs')) -or
    -not (Test-Path (Join-Path $backend 'scripts\bootstrap-admin.mjs'))) {
  throw 'ملفات تثبيت NEW FEED ERP غير مكتملة. أعد استخراج المثبت الصحيح.'
}

$serviceExists = [bool](Get-Service -Name 'NewFeedERP' -ErrorAction SilentlyContinue)
if ($serviceExists) {
  Write-Host 'إيقاف خدمة NEW FEED ERP الحالية قبل إعادة الإعداد...' -ForegroundColor Cyan
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
$escapedDb = $db.Replace('"', '\"')
$envContent = @"
NODE_ENV=production
HOST=127.0.0.1
PORT=$port
DATABASE_URL="$escapedDb"
AUTH_JWT_SECRET=$jwtSecret
TLS_CERT_FILE=
TLS_KEY_FILE=
LOG_LEVEL=info
"@
[IO.File]::WriteAllText($envFile, $envContent, [Text.UTF8Encoding]::new($false))
$proxyFile = Join-Path $root 'ReverseProxy.Caddyfile'
if (Test-Path $proxyFile) {
  $proxyContent = [IO.File]::ReadAllText($proxyFile)
  $proxyContent = [regex]::Replace($proxyContent, 'reverse_proxy\s+127\.0\.0\.1:\d+', "reverse_proxy 127.0.0.1:$port")
  [IO.File]::WriteAllText($proxyFile, $proxyContent, [Text.UTF8Encoding]::new($false))
}
& icacls $envFile /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'تعذر حماية ملف إعدادات السيرفر الذي يحتوي على بيانات الاتصال.' }

Push-Location $backend
try {
  $env:DATABASE_URL = $db
  $env:AUTH_JWT_SECRET = $jwtSecret
  $env:PORT = [string]$port
  $env:HOST = '127.0.0.1'
  $env:NODE_ENV = 'production'

  Write-Host 'اختبار اتصال PostgreSQL...' -ForegroundColor Cyan
  & $node --input-type=module -e "import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query('SELECT 1');await c.end();"
  if ($LASTEXITCODE -ne 0) { throw 'تعذر الاتصال بـ PostgreSQL.' }

  Write-Host 'تطبيق ترحيلات قاعدة بيانات NEW FEED ERP...' -ForegroundColor Cyan
  & $node scripts/migrate.mjs
  if ($LASTEXITCODE -ne 0) { throw 'فشلت ترحيلات قاعدة بيانات NEW FEED ERP.' }

  $userCount = (& $node --input-type=module -e "import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();const r=await c.query('SELECT COUNT(*)::int AS n FROM users');console.log(r.rows[0].n);await c.end();").Trim()
  if ($LASTEXITCODE -ne 0) { throw 'تعذر التحقق من حسابات المستخدمين.' }

  if ($userCount -eq '0') {
    Write-Host ''
    Write-Host 'إنشاء مدير النظام الأول في NEW FEED ERP' -ForegroundColor Cyan
    $bootstrapUsername = Read-Host 'اسم مستخدم المدير (3-80 حرفاً: a-z, 0-9, . _ -)'
    $bootstrapName = Read-Host 'الاسم الظاهر للمدير'
    $securePassword = Read-Host 'كلمة مرور المدير (14 حرفاً على الأقل)' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
      $bootstrapPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
      if ($bootstrapPassword.Length -lt 14) { throw 'كلمة مرور المدير يجب ألا تقل عن 14 حرفاً.' }
      $env:BOOTSTRAP_ADMIN_USERNAME = $bootstrapUsername
      $env:BOOTSTRAP_ADMIN_NAME = $bootstrapName
      $env:BOOTSTRAP_ADMIN_PASSWORD = $bootstrapPassword
      & $node scripts/bootstrap-admin.mjs
      if ($LASTEXITCODE -ne 0) { throw 'فشل إنشاء مدير النظام الأول.' }
    } finally {
      Remove-Item Env:\BOOTSTRAP_ADMIN_USERNAME,Env:\BOOTSTRAP_ADMIN_NAME,Env:\BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
      if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
      $bootstrapPassword = $null
      $securePassword = $null
    }
  } else {
    Write-Host 'توجد حسابات مستخدمين بالفعل؛ لم يتم إنشاء مدير جديد.' -ForegroundColor Yellow
  }
} finally {
  Remove-Item Env:\DATABASE_URL,Env:\AUTH_JWT_SECRET,Env:\PORT,Env:\HOST,Env:\NODE_ENV -ErrorAction SilentlyContinue
  Pop-Location
}

if (-not $serviceExists) {
  & $service install
  if ($LASTEXITCODE -ne 0) { throw 'فشل تسجيل خدمة Windows.' }
}
& $service start
if ($LASTEXITCODE -ne 0) { throw 'تعذر تشغيل خدمة NEW FEED ERP.' }

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Seconds 2
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/ready" -TimeoutSec 3
    if ($health.status -eq 'ready' -and $health.database -eq 'connected') { $ready = $true; break }
  } catch { }
}
if (-not $ready) { throw 'خدمة NEW FEED ERP لم تؤكد جاهزية API وقاعدة البيانات. راجع سجل الخدمة.' }

Write-Host ''
Write-Host 'تم إعداد خدمة NEW FEED ERP وتشغيلها.' -ForegroundColor Green
Write-Host "API داخلي: http://127.0.0.1:$port"
Write-Host 'الخدمة مربوطة على loopback فقط. لا تفتح منفذ API على الإنترنت.'
Write-Host 'للوصول من أجهزة الموظفين: اضبط Reverse Proxy مثل Caddy على HTTPS بشهادة موثوقة، ثم وجّه تطبيق الموظف إلى رابط HTTPS.'
if ($port -ne 3000) { Write-Host "عدّل ReverseProxy.Caddyfile ليستخدم 127.0.0.1:$port بدلاً من 3000." -ForegroundColor Yellow }
Write-Host 'إعدادات الاتصال محفوظة في backend\.env مع تقييد صلاحيات قراءتها إلى SYSTEM وAdministrators.'
Write-Host 'إدارة الخدمة من services.msc أو NewFeedERPService.exe status'
Read-Host 'اضغط Enter للإغلاق'
