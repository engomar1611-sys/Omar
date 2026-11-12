$ErrorActionPreference='Stop'
$root=$PSScriptRoot;$backend=Join-Path $root 'backend';$node=Join-Path $root 'node.exe';$service=Join-Path $root 'NewFeedERPService.exe'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'شغّل الإعداد بصلاحية مسؤول النظام.'}
if(-not(Test-Path $node)-or-not(Test-Path $service)-or-not(Test-Path (Join-Path $backend 'node_modules'))){throw 'ملفات التثبيت غير مكتملة.'}
Write-Host 'أدخل رابط PostgreSQL 16' -ForegroundColor Cyan
$db=Read-Host 'DATABASE_URL (postgresql://user:password@127.0.0.1:5432/newfeed_erp)'
if($db -notmatch '^postgres(ql)?://'){throw 'رابط قاعدة البيانات غير صحيح.'}
$p=Read-Host 'منفذ التطبيق [3000]';if(!$p){$p='3000'};$port=0
if(-not [int]::TryParse($p,[ref]$port) -or $port -lt 1 -or $port -gt 65535){throw 'المنفذ غير صحيح.'}
$secret=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(48)).ToLowerInvariant()
$escaped=$db.Replace('"','\"')
@"
NODE_ENV=production
HOST=0.0.0.0
PORT=$port
DATABASE_URL="$escaped"
AUTH_JWT_SECRET=$secret
LOG_LEVEL=info
"@ | Set-Content -Path (Join-Path $backend '.env') -Encoding utf8
Push-Location $backend
try {
  $env:DATABASE_URL=$db;$env:AUTH_JWT_SECRET=$secret;$env:PORT=[string]$port
  & $node --input-type=module -e "import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query('SELECT 1');await c.end();"
  if($LASTEXITCODE -ne 0){throw 'تعذر الاتصال بـ PostgreSQL.'}
  & $node scripts/migrate.mjs
  if($LASTEXITCODE -ne 0){throw 'فشلت ترحيلات قاعدة البيانات.'}
  $count=& $node --input-type=module -e "import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();const r=await c.query('SELECT COUNT(*)::int AS n FROM users');console.log(r.rows[0].n);await c.end();"
  if($LASTEXITCODE -ne 0){throw 'تعذر التحقق من المستخدمين.'}
  if(($count | Out-String).Trim() -eq '0'){
    $u=Read-Host 'اسم المستخدم الأول';$n=Read-Host 'اسم المدير';$s=Read-Host 'كلمة مرور المدير (14 حرفاً على الأقل)' -AsSecureString
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try{$pw=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
    if($pw.Length -lt 14){throw 'كلمة المرور أقل من 14 حرفاً.'}
    $env:BOOTSTRAP_ADMIN_USERNAME=$u;$env:BOOTSTRAP_ADMIN_NAME=$n;$env:BOOTSTRAP_ADMIN_PASSWORD=$pw
    & $node scripts/bootstrap-admin.mjs
    if($LASTEXITCODE -ne 0){throw 'فشل إنشاء المدير الأول.'}
    Remove-Item Env:\BOOTSTRAP_ADMIN_USERNAME,Env:\BOOTSTRAP_ADMIN_NAME,Env:\BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    $pw=$null
  } else {Write-Host 'توجد حسابات بالفعل؛ تم تخطي إنشاء المدير.' -ForegroundColor Yellow}
} finally {
  Remove-Item Env:\DATABASE_URL,Env:\AUTH_JWT_SECRET,Env:\PORT -ErrorAction SilentlyContinue
  Pop-Location
}
& $service install
if($LASTEXITCODE -ne 0){throw 'فشل تسجيل خدمة Windows.'}
& $service start
if($LASTEXITCODE -ne 0){throw 'تعذر تشغيل خدمة Windows.'}
try {New-NetFirewallRule -DisplayName 'NEW FEED ERP API' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Domain,Private -ErrorAction Stop | Out-Null}
catch {Write-Warning 'أضف المنفذ يدوياً في Windows Firewall.'}
Write-Host "تم إعداد الخادم. العنوان المحلي: http://localhost:$port" -ForegroundColor Green
Write-Host 'تنبيه: يلزم Reverse Proxy وشهادة HTTPS موثوقة قبل اتصال الموظفين عبر الشبكة.'
Read-Host 'اضغط Enter للإغلاق'
