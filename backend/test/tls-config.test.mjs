import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHttpsOptions } from '../src/config/tls.mjs';

test('HTTP mode remains available when no TLS files are configured', () => {
  assert.equal(loadHttpsOptions({}), undefined);
});

test('TLS certificate and key must be configured together', () => {
  assert.throws(
    () => loadHttpsOptions({ tlsCertFile: 'server.crt' }),
    /must be configured together/
  );
  assert.throws(
    () => loadHttpsOptions({ tlsKeyFile: 'server.key' }),
    /must be configured together/
  );
});

test('loads the configured certificate and private key as buffers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'newfeed-tls-'));
  const certFile = join(directory, 'server.crt');
  const keyFile = join(directory, 'server.key');
  try {
    writeFileSync(certFile, 'test certificate');
    writeFileSync(keyFile, 'test private key');

    const options = loadHttpsOptions({ tlsCertFile: certFile, tlsKeyFile: keyFile });
    assert.deepEqual(options.cert, readFileSync(certFile));
    assert.deepEqual(options.key, readFileSync(keyFile));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fails clearly when a configured TLS file cannot be read', () => {
  assert.throws(
    () => loadHttpsOptions({ tlsCertFile: 'missing.crt', tlsKeyFile: 'missing.key' }),
    /ENOENT/
  );
});
