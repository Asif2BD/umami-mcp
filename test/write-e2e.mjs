import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)];
  })
);
const transport = new StdioClientTransport({
  command: process.execPath, args: ['dist/index.js'],
  env: { ...process.env, ...env, UMAMI_MCP_MODE: 'admin', UMAMI_MCP_ALLOW_DESTRUCTIVE: 'true' },
  stderr: 'pipe',
});
const client = new Client({ name: 'write-e2e', version: '1.0.0' });
await client.connect(transport);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text ?? '';
  if (r.isError) return { err: t };
  try { return { ok: JSON.parse(t) }; } catch { return { ok: t }; }
};

const domain = `mcp-selftest-${Date.now()}.invalid`;
const created = await call('umami_create_website', { name: 'MCP self-test (safe to delete)', domain });
console.log('1. create   ->', created.ok ? `id=${created.ok.id} domain=${created.ok.domain}` : 'ERR ' + created.err);
const id = created.ok?.id;
if (!id) { await client.close(); process.exit(1); }

const got = await call('umami_get_website', { websiteId: id });
console.log('2. read back->', got.ok?.domain === domain ? 'domain matches' : 'MISMATCH');

const upd = await call('umami_update_website', { websiteId: id, name: 'MCP self-test (renamed)' });
const after = await call('umami_get_website', { websiteId: id });
console.log('3. update   ->', after.ok?.name === 'MCP self-test (renamed)' ? 'name updated' : 'FAILED: ' + JSON.stringify(upd.err ?? after.ok?.name));

const wrong = await call('umami_delete_website', { websiteId: id, confirmDomain: 'not-the-right-domain.com' });
console.log('4. guard    ->', wrong.err ? 'refused mismatched confirmDomain' : 'GUARD FAILED - DELETED WITHOUT MATCH');

const del = await call('umami_delete_website', { websiteId: id, confirmDomain: domain });
console.log('5. delete   ->', del.ok?.deleted ? 'deleted with correct confirmDomain' : 'ERR ' + del.err);

const gone = await call('umami_get_website', { websiteId: id });
console.log('6. verify   ->', gone.err || !gone.ok?.id ? 'confirmed gone' : 'STILL EXISTS');
await client.close();
