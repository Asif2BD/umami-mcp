/**
 * Records the README demo. Drives the real MCP server over stdio and prints
 * what an assistant does when you ask it about your traffic. Every number
 * shown is fetched live -- nothing here is staged.
 *
 *   node demo/demo.mjs <website-domain>
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const C = {
  dim: '\x1b[38;5;245m', ask: '\x1b[38;5;252m', tool: '\x1b[38;5;80m',
  val: '\x1b[38;5;114m', key: '\x1b[38;5;251m', bold: '\x1b[1m', off: '\x1b[0m',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (s = '') => process.stdout.write(s + '\n');

async function ask(question) {
  out();
  out(`  ${C.bold}${C.ask}${question}${C.off}`);
  await sleep(450);
}
async function tool(name, args) {
  const a = args ? `${C.dim} · ${args}${C.off}` : '';
  out(`  ${C.dim}↳${C.off} ${C.tool}${name}${C.off}${a}`);
  await sleep(320);
}
function row(label, value, width = 40) {
  const l = label.length > width ? label.slice(0, width - 1) + '…' : label.padEnd(width);
  out(`     ${C.key}${l}${C.off}  ${C.val}${value}${C.off}`);
}

const domain = process.argv[2] ?? 'aiscan.site';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: { ...process.env },
  stderr: 'ignore',
});
const client = new Client({ name: 'demo', version: '1.0.0' });
await client.connect(transport);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return JSON.parse(r.content[0].text);
};

const { tools } = await client.listTools();
const me = JSON.parse((await client.callTool({ name: 'umami_whoami', arguments: {} })).content[0].text);
await sleep(400);
out();
out(`  ${C.dim}connected as ${C.off}${C.key}${me.authenticatedAs}${C.off}` +
    `${C.dim} · mode ${C.off}${C.key}${me.serverMode}${C.off}` +
    `${C.dim} · ${tools.length} tools · destructive ops ${me.destructiveOperations}${C.off}`);

await ask(`"How is ${domain} doing this week?"`);
await tool('umami_list_websites');
const sites = await call('umami_list_websites', { pageSize: 100 });
const site = sites.data.find((w) => w.domain === domain) ?? sites.data[0];

await tool('umami_get_stats', 'period=7d');
const stats = await call('umami_get_stats', { websiteId: site.id, period: '7d' });
const delta = (now, before) =>
  before ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%` : '';
out();
row('visitors', `${stats.visitors}   ${C.dim}${delta(stats.visitors, stats.comparison?.visitors)}${C.off}`);
row('pageviews', `${stats.pageviews}   ${C.dim}${delta(stats.pageviews, stats.comparison?.pageviews)}${C.off}`);
row('visits', String(stats.visits));
await sleep(900);

await ask('"Which pages pulled the most people in?"');
await tool('umami_get_metrics', 'type=path · period=7d');
const paths = await call('umami_get_metrics', { websiteId: site.id, type: 'path', period: '7d', limit: 5 });
out();
for (const p of paths.data) { row(p.x, String(p.y)); await sleep(110); }
await sleep(900);

await ask('"And where did that traffic come from?"');
await tool('umami_get_metrics', 'type=referrer · period=7d');
const refs = await call('umami_get_metrics', { websiteId: site.id, type: 'referrer', period: '7d', limit: 4 });
out();
if (refs.data.length) { for (const r of refs.data) { row(r.x || '(direct)', String(r.y)); await sleep(110); } }
else row('(all direct)', '—');
await sleep(1400);

await client.close();
