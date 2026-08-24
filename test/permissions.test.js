import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed } from '../dist/tools/common.js';
import { allTools } from '../dist/tools/index.js';

const cfg = (mode, allowDestructive = false) => ({ mode, allowDestructive });
const names = (c) => allTools.filter((t) => isAllowed(t, c)).map((t) => t.name);

test('read mode exposes no write or admin tool', () => {
  const allowed = allTools.filter((t) => isAllowed(t, cfg('read')));
  assert.ok(allowed.length > 0);
  assert.ok(allowed.every((t) => t.tier === 'read'));
});

test('privilege is strictly increasing', () => {
  const r = names(cfg('read')), w = names(cfg('write')), a = names(cfg('admin'));
  assert.ok(r.every((n) => w.includes(n)), 'write must be a superset of read');
  assert.ok(w.every((n) => a.includes(n)), 'admin must be a superset of write');
});

test('destructive tools stay hidden until explicitly enabled', () => {
  const withoutFlag = names(cfg('admin', false));
  const withFlag = names(cfg('admin', true));
  const destructive = allTools.filter((t) => t.destructive).map((t) => t.name);
  assert.ok(destructive.length > 0, 'there should be destructive tools to gate');
  for (const n of destructive) {
    assert.ok(!withoutFlag.includes(n), `${n} must be hidden without the destructive flag`);
    assert.ok(withFlag.includes(n), `${n} should appear once the flag is set`);
  }
});

test('every destructive tool requires a typed confirmation field', () => {
  for (const t of allTools.filter((x) => x.destructive)) {
    const keys = Object.keys(t.schema);
    assert.ok(keys.some((k) => k.startsWith('confirm')), `${t.name} needs a confirm* parameter`);
  }
});

test('tool names are unique and namespaced', () => {
  const names = allTools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'duplicate tool name');
  assert.ok(names.every((n) => n.startsWith('umami_')));
});
