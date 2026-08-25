import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, assertPublicTarget, BlockedTargetError } from '../dist/oauth/ssrf.js';

test('recognises loopback and private IPv4', () => {
  for (const ip of ['127.0.0.1','127.1.2.3','10.0.0.5','172.16.0.1','172.31.255.255',
                    '192.168.1.1','169.254.169.254','0.0.0.0','100.64.0.1','224.0.0.1']) {
    assert.ok(isPrivateAddress(ip), `${ip} should be private`);
  }
});

test('allows genuine public IPv4', () => {
  for (const ip of ['8.8.8.8','1.1.1.1','23.95.213.126','172.32.0.1','192.169.0.1']) {
    assert.ok(!isPrivateAddress(ip), `${ip} should be public`);
  }
});

test('recognises private IPv6, including IPv4-mapped', () => {
  for (const ip of ['::1','::','fe80::1','fc00::1','fd12::3','::ffff:127.0.0.1','::ffff:10.0.0.1']) {
    assert.ok(isPrivateAddress(ip), `${ip} should be private`);
  }
});

test('rejects plaintext http outright', async () => {
  await assert.rejects(() => assertPublicTarget('http://example.com'), BlockedTargetError);
});

test('rejects loopback and private literals', async () => {
  for (const u of ['https://127.0.0.1:18007','https://localhost','https://10.0.0.5',
                   'https://169.254.169.254','https://[::1]']) {
    await assert.rejects(() => assertPublicTarget(u), BlockedTargetError, u);
  }
});

test('rejects internal-looking hostnames', async () => {
  for (const u of ['https://foo.localhost','https://db.internal','https://metadata.google.internal']) {
    await assert.rejects(() => assertPublicTarget(u), BlockedTargetError, u);
  }
});

test('rejects a hostname that resolves to loopback', async () => {
  // localtest.me and friends resolve to 127.0.0.1 by design.
  await assert.rejects(() => assertPublicTarget('https://localtest.me'), BlockedTargetError);
});

test('accepts a real public host', async () => {
  await assertPublicTarget('https://example.com');
});

test('rejects malformed input', async () => {
  await assert.rejects(() => assertPublicTarget('not a url'), BlockedTargetError);
});
