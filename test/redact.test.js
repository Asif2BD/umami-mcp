import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerSecrets, redact, _resetSecrets } from '../dist/redact.js';

test('masks a registered secret anywhere in the string', () => {
  _resetSecrets();
  registerSecrets('sup3rs3cret-password');
  const out = redact('login failed for sup3rs3cret-password at host');
  assert.ok(!out.includes('sup3rs3cret-password'));
  assert.ok(out.includes('[redacted]'));
});

test('ignores very short values to avoid mangling ordinary text', () => {
  _resetSecrets();
  registerSecrets('abc');
  assert.equal(redact('abc def'), 'abc def');
});

test('masks password fields in JSON even when not registered', () => {
  _resetSecrets();
  assert.ok(!redact('{"username":"u","password":"hunter2xyz"}').includes('hunter2xyz'));
});

test('masks bearer tokens', () => {
  _resetSecrets();
  const out = redact('authorization: Bearer abc123DEF456ghi789');
  assert.ok(!out.includes('abc123DEF456ghi789'));
});

test('masks bare JWTs', () => {
  _resetSecrets();
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig';
  assert.ok(!redact(`token=${jwt}`).includes(jwt));
});
