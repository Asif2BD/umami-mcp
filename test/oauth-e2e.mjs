/**
 * Drives the whole OAuth flow against a locally-started server, then makes a
 * real MCP call with the resulting token.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';

const envFile = process.argv[2];
const creds = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)];
  })
);

const PORT = 39337;
const ISSUER = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['dist/index.js'], {
  env: {
    ...process.env,
    UMAMI_MCP_ENV_FILE: '/nonexistent-on-purpose',
    UMAMI_URL: '', UMAMI_USERNAME: '', UMAMI_PASSWORD: '',
    UMAMI_MCP_OAUTH: 'true',
    UMAMI_MCP_TRANSPORT: 'http',
    UMAMI_MCP_ISSUER: ISSUER,
    UMAMI_MCP_TOKEN_KEY: randomBytes(32).toString('base64url'),
    UMAMI_MCP_HOST: '127.0.0.1',
    UMAMI_MCP_PORT: String(PORT),
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
child.stderr.on('data', d => { if (process.env.VERBOSE) process.stderr.write(d); });

const ok = (label, cond, extra = '') =>
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${label}${extra ? '  ' + extra : ''}`);

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${ISSUER}/health`)).ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

try {
  ok('server starts in OAuth mode with no credentials', await waitReady());

  const meta = await (await fetch(`${ISSUER}/.well-known/oauth-authorization-server`)).json();
  ok('publishes authorization-server metadata',
     meta.authorization_endpoint === `${ISSUER}/authorize` && meta.code_challenge_methods_supported.includes('S256'));

  const prm = await (await fetch(`${ISSUER}/.well-known/oauth-protected-resource`)).json();
  ok('publishes protected-resource metadata', prm.resource === ISSUER);

  const unauth = await fetch(`${ISSUER}/mcp`, { method: 'POST', headers: {'content-type':'application/json'}, body: '{}' });
  ok('rejects unauthenticated /mcp with 401 + WWW-Authenticate',
     unauth.status === 401 && (unauth.headers.get('www-authenticate') || '').includes('resource_metadata'));

  const redirectUri = 'http://localhost:9999/callback';
  const reg = await (await fetch(`${ISSUER}/register`, {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: 'Flow Test' }),
  })).json();
  ok('dynamic client registration', Boolean(reg.client_id && reg.client_secret));

  const badReg = await fetch(`${ISSUER}/register`, {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({ redirect_uris: ['http://evil.example.com/cb'] }),
  });
  ok('rejects non-HTTPS non-loopback redirect_uri', badReg.status === 400);

  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authUrl = new URL(`${ISSUER}/authorize`);
  authUrl.searchParams.set('client_id', reg.client_id);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', 'xyz123');

  const pageRes = await fetch(authUrl);
  const page = await pageRes.text();
  ok('renders consent page', page.includes('Connect your Umami') && page.includes('account password'));

  // A bare form-action 'self' lets the POST through but makes the browser block
  // the 302 that follows it, so Connect appears to do nothing.
  const csp = pageRes.headers.get('content-security-policy') || '';
  const redirectOrigin = new URL(redirectUri).origin;
  ok('CSP form-action allows the redirect target',
     csp.includes('form-action') && csp.includes(redirectOrigin), `(${csp.split('form-action')[1] || ''})`);

  const form = (over = {}) => new URLSearchParams({
    client_id: reg.client_id, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz123',
    umami_url: creds.UMAMI_URL, umami_username: creds.UMAMI_USERNAME,
    umami_password: creds.UMAMI_PASSWORD, mode: 'read', ...over,
  });

  const wrong = await fetch(`${ISSUER}/authorize`, {
    method: 'POST', headers: {'content-type':'application/x-www-form-urlencoded'},
    body: form({ umami_password: 'definitely-not-the-password' }).toString(), redirect: 'manual',
  });
  ok('bad credentials do not mint a code', wrong.status === 200 && (await wrong.text()).includes('rejected'));

  const granted = await fetch(`${ISSUER}/authorize`, {
    method: 'POST', headers: {'content-type':'application/x-www-form-urlencoded'},
    body: form().toString(), redirect: 'manual',
  });
  const loc = new URL(granted.headers.get('location'));
  const code = loc.searchParams.get('code');
  ok('valid credentials redirect with a code', granted.status === 302 && Boolean(code) && loc.searchParams.get('state') === 'xyz123');

  const badPkce = await fetch(`${ISSUER}/token`, {
    method: 'POST', headers: {'content-type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({ grant_type:'authorization_code', code, client_id: reg.client_id,
      client_secret: reg.client_secret, redirect_uri: redirectUri, code_verifier: 'wrong-verifier' }).toString(),
  });
  ok('wrong PKCE verifier is rejected', badPkce.status === 400);

  // That failed attempt consumed the code, so get a fresh one.
  const g2 = await fetch(`${ISSUER}/authorize`, {
    method: 'POST', headers: {'content-type':'application/x-www-form-urlencoded'},
    body: form().toString(), redirect: 'manual',
  });
  const code2 = new URL(g2.headers.get('location')).searchParams.get('code');

  const tok = await (await fetch(`${ISSUER}/token`, {
    method: 'POST', headers: {'content-type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({ grant_type:'authorization_code', code: code2, client_id: reg.client_id,
      client_secret: reg.client_secret, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
  })).json();
  ok('token exchange succeeds', Boolean(tok.access_token) && tok.token_type === 'Bearer');
  ok('token does not leak the password', !tok.access_token.includes(creds.UMAMI_PASSWORD));

  const replay = await fetch(`${ISSUER}/token`, {
    method: 'POST', headers: {'content-type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({ grant_type:'authorization_code', code: code2, client_id: reg.client_id,
      client_secret: reg.client_secret, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
  });
  ok('authorization code is single-use', replay.status === 400);

  const mcp = async (body) => {
    const r = await fetch(`${ISSUER}/mcp`, {
      method: 'POST',
      headers: { 'content-type':'application/json', accept:'application/json, text/event-stream',
                 authorization: `Bearer ${tok.access_token}` },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    const line = text.split('\n').find(l => l.startsWith('data: '));
    return JSON.parse(line ? line.slice(6) : text);
  };

  const init = await mcp({ jsonrpc:'2.0', id:1, method:'initialize',
    params:{ protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{name:'flow-test',version:'1'} }});
  ok('MCP initialize over OAuth', init.result?.serverInfo?.name === 'umami-mcp');

  const tools = await mcp({ jsonrpc:'2.0', id:2, method:'tools/list', params:{} });
  const names = (tools.result?.tools ?? []).map(t => t.name);
  ok('tools listed for the authenticated user', names.length > 0, `(${names.length} tools)`);
  ok('destructive tools are never exposed over OAuth',
     !names.some(n => /delete|reset/.test(n)));

  const call = await mcp({ jsonrpc:'2.0', id:3, method:'tools/call',
    params:{ name:'umami_whoami', arguments:{} }});
  const who = JSON.parse(call.result.content[0].text);
  ok('real tool call reaches the user\'s own Umami', who.authenticatedAs === creds.UMAMI_USERNAME,
     `(as ${who.authenticatedAs}, mode ${who.serverMode})`);

  const sites = await mcp({ jsonrpc:'2.0', id:4, method:'tools/call',
    params:{ name:'umami_list_websites', arguments:{} }});
  const list = JSON.parse(sites.result.content[0].text);
  ok('returns real data', list.count > 0, `(${list.count} websites)`);

  const forged = await fetch(`${ISSUER}/mcp`, {
    method:'POST', headers:{ 'content-type':'application/json', authorization:'Bearer v1.aaa.bbb.ccc' },
    body: JSON.stringify({ jsonrpc:'2.0', id:5, method:'tools/list', params:{} }),
  });
  ok('forged token is rejected', forged.status === 401);
} finally {
  child.kill();
}
