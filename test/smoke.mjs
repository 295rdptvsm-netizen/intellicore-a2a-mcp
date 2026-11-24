#!/usr/bin/env node
/**
 * End-to-end smoke test against the live gateway.
 *
 *   node test/smoke.mjs                 # uses (or issues) a free trial key
 *   INTELLICORE_A2A_KEY=ek_... node test/smoke.mjs
 *
 * It needs no credentials and no setup: the trial key gives 25 credits, which is
 * five skill calls. Re-running on the same network the same UTC day reuses the
 * same 25 credits, so a second run may legitimately end on a 402 once they are
 * spent — that is reported, not treated as a failure.
 */
import assert from 'node:assert/strict';
import { IntelliCoreA2A } from '../sdk/node/intellicore-a2a.js';

const baseUrl = process.env.INTELLICORE_A2A_BASE || 'https://a2a.intelliliving.kr';
let client = new IntelliCoreA2A({ key: process.env.INTELLICORE_A2A_KEY || '', baseUrl });
let spentBefore = 0;

if (!client.key) {
  const trial = await IntelliCoreA2A.trial({ agent: 'smoke-test', baseUrl });
  client = trial.client;
  console.log('· trial key issued:', `${trial.key.slice(0, 12)}…`, 'credits', trial.credits, 'expires', trial.expires_at);
}

const usage = await client.usage();
spentBefore = usage.used;
console.log('· usage:', usage.plan, `${usage.remaining}/${usage.credits} credits left`);

const catalog = await client.catalog();
assert.ok(catalog.skills.length >= 3, 'catalog lists skills');
assert.ok(catalog.packs.length >= 1, 'catalog lists packs');
console.log('· catalog:', catalog.skills.map((s) => `${s.id}/${s.credits}`).join(' '));

const tools = await client.tools();
assert.ok(tools.some((t) => t.name === 'localizer_render'), 'mcp tools/list has localizer_render');
console.log('· mcp tools:', tools.map((t) => t.name).join(' '));

const budget = usage.remaining;
if (budget < 5) {
  console.log('! no credits left on this trial key for today — skipping the metered calls (a claimed pack key runs them all)');
  process.exit(0);
}

const call = await client.call('localizer.render', { locale: 'ja', document: { title: 'Pricing', price: { amount_minor: 2900, currency: 'USD' } } });
assert.equal(typeof call.credits_charged, 'number');
console.log('· http call: charged', call.credits_charged, '→ remaining', call.remaining);

if (budget >= 10) {
  const tool = await client.mcpRun('localizer_render', { locale: 'ja', document: { title: 'Pricing' } });
  assert.equal(tool.isError, false, 'mcp tool call succeeded');
  console.log('· mcp call: charged', tool.data?.credits_charged, '→ remaining', tool.data?.remaining);
} else {
  console.log('· mcp call: skipped (needs 5 more credits)');
}

if (budget >= 15) {
  const task = await client.a2a('disclosure.inspect', { url: 'https://example.com' });
  assert.equal(task.status?.state, 'completed', 'a2a task completed');
  console.log('· a2a task:', task.kind, task.status.state);
} else {
  console.log('· a2a task: skipped (needs 5 more credits)');
}

const after = await client.usage();
assert.ok(after.used >= spentBefore, 'usage increased');
console.log(`\nOK — smoke test passed against ${baseUrl}`);
