import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)];
  })
);
const mode = process.argv[3] ?? 'read';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: { ...process.env, ...env, UMAMI_MCP_MODE: mode },
  stderr: 'pipe',
});
const client = new Client({ name: 'e2e', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`MODE=${mode} -> ${tools.length} tools exposed`);
console.log('  ' + tools.map(t => t.name.replace('umami_', '')).join(', '));

async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  if (r.isError) return { err: text.slice(0, 160) };
  try { return { ok: JSON.parse(text) }; } catch { return { ok: text.slice(0, 160) }; }
}

if (mode === 'read') {
  const who = await call('umami_whoami', {});
  console.log('\nwhoami:', JSON.stringify(who.ok ?? who.err));

  const list = await call('umami_list_websites', { pageSize: 3 });
  const sites = list.ok?.data ?? [];
  console.log(`list_websites: ${list.ok?.count} total, sample:`, sites.slice(0,2).map(s => s.domain));

  const wid = sites[0]?.id;
  if (wid) {
    const stats = await call('umami_get_stats', { websiteId: wid, period: '30d' });
    console.log('get_stats:', JSON.stringify(stats.ok ? {pv: stats.ok.pageviews, v: stats.ok.visitors} : stats.err));

    const metrics = await call('umami_get_metrics', { websiteId: wid, period: '30d', type: 'path', limit: 3 });
    console.log('get_metrics(path):', JSON.stringify(metrics.ok?.data ?? metrics.err));

    const utm = await call('umami_report_utm', { websiteId: wid, period: '30d' });
    console.log('report_utm keys:', utm.ok ? Object.keys(utm.ok.data) : utm.err);

    const rt = await call('umami_get_realtime', { websiteId: wid });
    console.log('realtime:', rt.ok ? `countries=${JSON.stringify(rt.ok.countries)}` : rt.err);

    const snip = await call('umami_get_tracking_snippet', { websiteId: wid });
    console.log('snippet:', snip.ok?.snippet ?? snip.err);

    const bad = await call('umami_get_stats', { websiteId: wid, period: 'banana' });
    console.log('bad period ->', bad.err ? 'rejected: ' + bad.err.slice(0, 90) : 'UNEXPECTEDLY OK');
  }
}
await client.close();
