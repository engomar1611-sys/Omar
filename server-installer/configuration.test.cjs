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
