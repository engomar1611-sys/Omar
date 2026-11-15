const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const installer = fs.readFileSync(path.join(__dirname, 'configure-server.ps1'), 'utf8');
const proxy = fs.readFileSync(path.join(__dirname, 'ReverseProxy.Caddyfile'), 'utf8');

test('Windows installer binds the API to loopback only', () => {
  assert.match(installer, /^HOST=127\.0\.0\.1$/m);
  assert.doesNotMatch(installer, /HOST=0\.0\.0\.0/);
});

test('Windows installer does not expose the API port through Windows Firewall', () => {
  assert.doesNotMatch(installer, /New-NetFirewallRule.*NEW FEED ERP API/i);
});

test('reverse proxy forwards HTTPS traffic only to the local API listener', () => {
  assert.match(proxy, /reverse_proxy\s+127\.0\.0\.1:3000/);
  assert.doesNotMatch(proxy, /reverse_proxy\s+(?!127\.0\.0\.1)/);
});

const service = fs.readFileSync(path.join(__dirname, 'NewFeedERPService.xml'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'windows-installers.yml'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'NEW-FEED-SUPERMARKET-ERP', 'apps', 'api', 'src', 'server.js'), 'utf8');
const installerProject = fs.readFileSync(path.join(__dirname, 'ServerInstaller.iss'), 'utf8');

test('Windows service runs the supermarket ERP API entrypoint', () => {
  assert.ok(service.includes('<arguments>src\\server.js</arguments>'));
  assert.ok(service.includes('<workingdirectory>%BASE%\\backend</workingdirectory>'));
  assert.ok(workflow.includes('NEW-FEED-SUPERMARKET-ERP/apps/api/src'));
  assert.ok(!workflow.includes('Copy-Item backend/src'));
});

test('employee client readiness contract is implemented by the supermarket API', () => {
  assert.ok(api.includes('app.get("/ready"'));
  assert.ok(api.includes('status: "ready", database: "connected"'));
});

test('server installer includes HTTPS reverse proxy configuration', () => {
  assert.ok(installerProject.includes('ReverseProxy.Caddyfile'));
  assert.ok(installer.includes('JWT_SECRET='));
  assert.ok(installer.includes('BOOTSTRAP_SECRET='));
  assert.ok(installer.includes('scripts/migrate.js'));
});
