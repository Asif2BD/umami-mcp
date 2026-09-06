import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRedirectUri, requiresPkce, RedirectUriError } from '../dist/oauth/redirect.js';

test('accepts the private-use scheme desktop MCP clients actually use', () => {
  // The exact URI Cursor sends. Rejecting this locked Cursor out entirely.
  assert.equal(classifyRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback'), 'private-use');
  assert.equal(classifyRedirectUri('vscode://ms-vscode.mcp/callback'), 'private-use');
  assert.equal(classifyRedirectUri('com.example.app:/oauth2redirect'), 'private-use');
});

test('accepts https and loopback', () => {
  assert.equal(classifyRedirectUri('https://claude.ai/api/mcp/auth_callback'), 'https');
  assert.equal(classifyRedirectUri('http://127.0.0.1:9999/cb'), 'loopback');
  assert.equal(classifyRedirectUri('http://localhost:8080/cb'), 'loopback');
});

test('still rejects plaintext http to a remote host', () => {
  assert.throws(() => classifyRedirectUri('http://evil.example.com/cb'), RedirectUriError);
});

test('rejects schemes that can execute or read local data', () => {
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'blob:x', 'about:blank']) {
    assert.throws(() => classifyRedirectUri(u), RedirectUriError, u);
  }
});

test('rejects a scheme with nothing to call back to', () => {
  assert.throws(() => classifyRedirectUri('cursor://'), RedirectUriError);
});

test('rejects non-URLs', () => {
  assert.throws(() => classifyRedirectUri('not a url'), RedirectUriError);
});

test('PKCE is mandatory for private-use and loopback, optional for https', () => {
  assert.equal(requiresPkce('private-use'), true);
  assert.equal(requiresPkce('loopback'), true);
  assert.equal(requiresPkce('https'), false);
});
