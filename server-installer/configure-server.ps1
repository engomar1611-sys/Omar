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
if (-not (Test-Path $node) -or -not (Test-Path $service) -or -not (Test-Path (Join-Path $backend 'node_modules'))) {
  throw 'ملفات التثبيت غير مكتملة.'
}
$serviceExists = [bool](Get-Service -Name 'NewFeedERP' -ErrorAction SilentlyContinue)
if ($serviceExists) {
  Write-Host 'إيقاف خدمة النظام الحالية قبل التحديث...' -ForegroundColor Cyan
  & $service stop
  if ($LASTEXITCODE -ne 0) { throw 'تعذر إيقاف الخدمة الحالية.' }
}

Write-Host 'إعداد اتصال PostgreSQL 16' -ForegroundColor Cyan
$db = Read-Host 'DATABASE_URL (postgresql://user:password@127.0.0.1:5432/newfeed_erp)'
if ($db -notmatch '^postgres(ql)?://') { throw 'رابط قاعدة البيانات غير صحيح.' }

$portText = Read-Host 'منفذ التطبيق [3000]'
if ([string]::IsNullOrWhiteSpace($portText)) { $portText = '3000' }
$port = 0
if (-not [int]::TryParse($portText, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
  throw 'المنفذ يجب أن يكون رقماً من 1 إلى 65535.'
}

$randomBytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
$secret = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
$escapedDb = $db.Replace('"', '\"')
$envContent = @"
NODE_ENV=production
HOST=127.0.0.1
PORT=$port
DATABASE_URL="$escapedDb"
AUTH_JWT_SECRET=$secret
LOG_LEVEL=info
"@
[IO.File]::WriteAllText($envFile, $envContent, [Text.UTF8Encoding]::new($false))

Push-Location $backend
try {
  $env:DATABASE_URL = $db
  $env:AUTH_JWT_SECRET = $secret
  $env:PORT = [string]$port

  Write-Host 'اختبار اتصال PostgreSQL...' -ForegroundColor Cyan
  & $node --input-type=module -e "import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query('SELECT 1');await c.end();"
  if ($LASTEXITCODE -ne 0) { throw 'تعذر الاتصال بـ PostgreSQL.' }

  Write-Host 'تطبيق ترحيلات قاعدة البيانات...' -ForegroundColor Cyan
  & $node scripts/migrate.mjs
  if ($LASTEXITCODE -ne 0) { throw 'فشلت ترحيلات قاعدة البيانات.' }

  $userCount = (& $node --input-type=module -e "import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();const r=await c.query('SELECT COUNT(*)::int AS n FROM users');console.log(r.rows[0].n);await c.end();").Trim()
  if ($LASTEXITCODE -ne 0) { throw 'تعذر التحقق من المستخدمين.' }

  if ($userCount -eq '0') {
    Write-Host 'إنشاء أول مدير للنظام' -ForegroundColor Cyan
    $username = Read-Host 'اسم المستخدم الأول'
    $displayName = Read-Host 'اسم المدير'
    $securePassword = Read-Host 'كلمة مرور المدير (14 حرفاً على الأقل)' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try { $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if ($adminPassword.Length -lt 14) { throw 'كلمة المرور يجب ألا تقل عن 14 حرفاً.' }

    $env:BOOTSTRAP_ADMIN_USERNAME = $username
    $env:BOOTSTRAP_ADMIN_NAME = $displayName
    $env:BOOTSTRAP_ADMIN_PASSWORD = $adminPassword
    & $node scripts/bootstrap-admin.mjs
    if ($LASTEXITCODE -ne 0) { throw 'فشل إنشاء المدير الأول.' }
    Remove-Item Env:\BOOTSTRAP_ADMIN_USERNAME,Env:\BOOTSTRAP_ADMIN_NAME,Env:\BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    $adminPassword = $null
  } else {
    Write-Host 'توجد حسابات بالفعل؛ تم تخطي إنشاء المدير الأول.' -ForegroundColor Yellow
  }
} finally {
  Remove-Item Env:\DATABASE_URL,Env:\AUTH_JWT_SECRET,Env:\PORT -ErrorAction SilentlyContinue
  Pop-Location
}

if (-not $serviceExists) {
  & $service install
  if ($LASTEXITCODE -ne 0) { throw 'فشل تسجيل خدمة Windows.' }
}
& $service start
if ($LASTEXITCODE -ne 0) { throw 'تعذر تشغيل خدمة Windows.' }

Write-Host ''
Write-Host 'تم إعداد خدمة NEW FEED ERP Server.' -ForegroundColor Green
Write-Host "عنوان API الداخلي: http://127.0.0.1:$port (محلي فقط)"
Write-Host 'لم يتم فتح منفذ API على الشبكة. انشر Caddy/Reverse Proxy على 80 و443 مع شهادة موثوقة قبل ربط أجهزة الموظفين.'
Write-Host 'إدارة الخدمة من services.msc أو NewFeedERPService.exe status'
Read-Host 'اضغط Enter للإغلاق'
