const test=require('node:test'),assert=require('node:assert/strict');const {normalizeServerUrl}=require('./config.cjs');
test('accepts HTTPS and removes trailing slash',()=>assert.equal(normalizeServerUrl('https://erp.example.com:3000/'),'https://erp.example.com:3000'));
test('allows HTTP only on loopback',()=>{assert.equal(normalizeServerUrl('http://localhost:3000'),'http://localhost:3000');assert.throws(()=>normalizeServerUrl('http://192.168.1.10:3000'),/HTTPS/);});
test('rejects credentials, query and fragments',()=>{assert.throws(()=>normalizeServerUrl('https://u:p@erp.example.com'));assert.throws(()=>normalizeServerUrl('https://erp.example.com/?token=x'));assert.throws(()=>normalizeServerUrl('https://erp.example.com/#home'));});
test('rejects malformed values',()=>{assert.throws(()=>normalizeServerUrl(''));assert.throws(()=>normalizeServerUrl('not a url'));});
