import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Arabic ERP browser interface has syntactically valid inline JavaScript', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)];
  assert.ok(scripts.length > 0, 'expected at least one inline script');
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script[1]), 'inline script must parse');
  }
});
