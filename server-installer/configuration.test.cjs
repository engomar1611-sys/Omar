const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const installer = fs.readFileSync(path.join(__dirname, 'configure-server.ps1'), 'utf8');
const proxy = fs.readFileSync(path.join(__dirname, 'ReverseProxy.Caddyfile'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, 'NewFeedERPService.xml'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'windows-installers.yml'), 'utf8');
const server = fs.readFileSync(path.join(root, 'backend', 'src', 'server.mjs'), 'utf8');
const app = fs.readFileSync(path.join(root, 'backend', 'src', 'app.mjs'), 'utf8');
const envConfig = fs.readFileSync(path.join(root, 'backend', 'src', 'config', 'env.mjs'), 'utf8');
const backendPackage = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'package.json'), 'utf8'));
const installerProject = fs.readFileSync(path.join(__dirname, 'ServerInstaller.iss'), 'utf8');

test('Windows installer binds NEW FEED ERP API to loopback only', () => {
  assert.match(installer, /^HOST=127\.0\.0\.1$/m);
  assert.doesNotMatch(installer, /HOST=0\.0\.0\.0/);
  assert.match(envConfig, /host: process\.env\.HOST \?\? '127\.0\.0\.1'/);
});

test('Windows installer protects the server environment file', () => {
  assert.match(installer, /icacls \$envFile \/inheritance:r/);
  assert.match(installer, /AUTH_JWT_SECRET=\$jwtSecret/);
  assert.doesNotMatch(installer, /\nJWT_SECRET=/);
  assert.match(envConfig, /authJwtSecret: process\.env\.AUTH_JWT_SECRET/);
});

test('Windows installer runs the NEW FEED ERP migrations and first-admin bootstrap', () => {
  assert.match(installer, /node_modules\\pg/);
  assert.match(installer, /src\\server\.mjs/);
  assert.match(installer, /scripts\\migrate\.mjs/);
  assert.match(installer, /scripts\\bootstrap-admin\.mjs/);
  assert.match(installer, /BOOTSTRAP_ADMIN_USERNAME/);
  assert.match(installer, /BOOTSTRAP_ADMIN_NAME/);
  assert.match(installer, /BOOTSTRAP_ADMIN_PASSWORD/);
  assert.match(installer, /Length -lt 14/);
  assert.match(installer, /\$service refresh/);
  assert.match(installer, /\$service install/);
  assert.match(backendPackage.scripts.migrate, /migrate\.mjs/);
  assert.match(backendPackage.scripts['bootstrap:admin'], /bootstrap-admin\.mjs/);
});

test('Windows service starts the NEW FEED ERP ESM API entrypoint', () => {
  assert.ok(service.includes('<arguments>src\\server.mjs</arguments>'));
  assert.ok(service.includes('<workingdirectory>%BASE%\\backend</workingdirectory>'));
  assert.match(server, /from '\.\/app\.mjs'/);
  assert.match(server, /validateConfig\(\)/);
  assert.match(app, /app\.get\('\/ready'/);
  assert.match(app, /service: 'new-feed-erp-api'/);
});

test('Windows build packages backend source, migrations and production dependencies, not supermarket ERP', () => {
  assert.match(workflow, /Push-Location backend/);
  assert.match(workflow, /npm install --omit=dev/);
  assert.match(workflow, /Copy-Item backend "\$payload\/backend" -Recurse/);
  assert.match(workflow, /backend\/src\/server\.mjs/);
  assert.match(workflow, /backend\/migrations/);
  assert.doesNotMatch(workflow, /NEW-FEED-SUPERMARKET-ERP/);
  assert.match(workflow, /NEW-FEED-ERP-Full-Source\.zip/);
  assert.match(workflow, /README\.md docs backend desktop server-installer scripts/);
  assert.doesNotMatch(workflow, /Package complete supermarket ERP/);
});

test('reverse proxy forwards HTTPS traffic only to the local NEW FEED ERP API listener', () => {
  assert.match(proxy, /tls internal/);
  assert.match(proxy, /reverse_proxy\s+127\.0\.0\.1:3000/);
  assert.doesNotMatch(proxy, /reverse_proxy\s+(?!127\.0\.0\.1)/);
});

test('server installer includes the service, configuration and reverse-proxy files', () => {
  assert.ok(installerProject.includes('NewFeedERPService.exe'));
  assert.ok(installerProject.includes('configure-server.ps1'));
  assert.ok(installerProject.includes('ReverseProxy.Caddyfile'));
});
