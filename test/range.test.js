import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRange } from '../dist/tools/common.js';

const NOW = Date.UTC(2026, 7, 25, 12, 0, 0);
const DAY = 86_400_000;

test('defaults to the last 7 days', () => {
  const r = resolveRange({}, NOW);
  assert.equal(r.endAt, NOW);
  assert.equal(r.startAt, NOW - 7 * DAY);
});

test('parses relative units', () => {
  assert.equal(resolveRange({ period: '24h' }, NOW).startAt, NOW - DAY);
  assert.equal(resolveRange({ period: '30d' }, NOW).startAt, NOW - 30 * DAY);
});

test('today starts at midnight UTC', () => {
  assert.equal(resolveRange({ period: 'today' }, NOW).startAt, Date.UTC(2026, 7, 25));
});

test('explicit timestamps win over period', () => {
  const r = resolveRange({ period: '7d', startAt: 1000, endAt: 2000 }, NOW);
  assert.deepEqual(r, { startAt: 1000, endAt: 2000 });
});

test('rejects an inverted explicit range', () => {
  assert.throws(() => resolveRange({ startAt: 2000, endAt: 1000 }, NOW), /endAt must be/);
});

test('rejects nonsense rather than silently returning the wrong window', () => {
  assert.throws(() => resolveRange({ period: 'banana' }, NOW), /Unrecognised period/);
});
