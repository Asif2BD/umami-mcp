import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, deriveKey, generateKey, verifyPkce, safeEqual, SealError } from '../dist/oauth/seal.js';
import { createHash } from 'node:crypto';

const key = deriveKey(generateKey());
const other = deriveKey(generateKey());
const now = Math.floor(Date.now() / 1000);
const identity = { url: 'https://a.example.com', username: 'u', password: 'p', mode: 'read', iat: now, exp: now + 3600 };

test('round-trips an identity', () => {
  const out = unseal(seal(identity, key), key);
  assert.equal(out.url, identity.url);
  assert.equal(out.password, 'p');
  assert.equal(out.mode, 'read');
});

test('the sealed token does not contain the plaintext password', () => {
  const token = seal({ ...identity, password: 'hunter2-unique-string' }, key);
  assert.ok(!token.includes('hunter2-unique-string'));
  assert.ok(!Buffer.from(token, 'utf8').toString('base64').includes('hunter2'));
});

test('a different key cannot decrypt', () => {
  assert.throws(() => unseal(seal(identity, key), other), SealError);
});

test('tampering is detected', () => {
  const parts = seal(identity, key).split('.');
  parts[2] = Buffer.from('tampered-body-content').toString('base64url');
  assert.throws(() => unseal(parts.join('.'), key), SealError);
});

test('expired tokens are rejected', () => {
  const stale = { ...identity, exp: now - 1 };
  assert.throws(() => unseal(seal(stale, key), key), /expired/);
});

test('wrong key and tampering give the same message, so it is not an oracle', () => {
  const a = (() => { try { unseal(seal(identity, key), other); } catch (e) { return e.message; } })();
  const parts = seal(identity, key).split('.');
  parts[3] = Buffer.from('bogusauthtag1234').toString('base64url');
  const b = (() => { try { unseal(parts.join('.'), key); } catch (e) { return e.message; } })();
  assert.equal(a, b);
});

test('malformed tokens are rejected', () => {
  for (const bad of ['', 'nope', 'v2.a.b.c', 'v1.a.b']) {
    assert.throws(() => unseal(bad, key), SealError);
  }
});

test('rejects weak key material', () => {
  assert.throws(() => deriveKey('short'), SealError);
});

test('PKCE S256 accepts the matching verifier only', () => {
  const verifier = 'a'.repeat(64);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  assert.ok(verifyPkce(verifier, challenge));
  assert.ok(!verifyPkce('b'.repeat(64), challenge));
});

test('PKCE rejects unknown methods', () => {
  assert.ok(!verifyPkce('x', 'y', 'S512'));
});

test('safeEqual compares correctly', () => {
  assert.ok(safeEqual('abc', 'abc'));
  assert.ok(!safeEqual('abc', 'abd'));
  assert.ok(!safeEqual('abc', 'abcd'));
});
