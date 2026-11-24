// Free trial key → first paid-style call → MCP tool call. Run: node examples/trial-and-call.mjs
import { IntelliCoreA2A } from '../sdk/node/intellicore-a2a.js';

// 1. 25 credits, 7 days, no card. Repeating this on the same network returns the
//    same 25 credits for the rest of the UTC day, so it is safe to run twice.
const trial = await IntelliCoreA2A.trial({ agent: 'readme-example' });
console.log('trial key:', `${trial.key.slice(0, 12)}…`, '| credits:', trial.credits, '| expires:', trial.expires_at);

const client = trial.client;

// 2. What can I call, and what does it cost?
const catalog = await client.catalog();
console.log('skills:', catalog.skills.map((s) => `${s.id} (${s.credits} cr)`).join(', '));

// 3. Plain HTTP call.
try {
  const out = await client.call('localizer.render', {
    locale: 'ja',
    document: { title: 'Pricing', price: { amount_minor: 2900, currency: 'USD' } }
  });
  console.log('call ok:', out.credits_charged, 'credits charged,', out.remaining, 'left');
  console.log(JSON.stringify(out.result).slice(0, 240), '…');
} catch (err) {
  if (err.name === 'InsufficientCredits') {
    console.log('out of credits →', err.topup.map((p) => `${p.name} ${p.price.display} ${p.payhip_url ?? ''}`.trim()).join(' | '));
  } else {
    throw err;
  }
}

// 4. The same skill over MCP (what an MCP client sees).
const tools = await client.tools();
console.log('mcp tools:', tools.map((t) => t.name).join(', '));
const tool = await client.mcpRun('disclosure_inspect', { url: 'https://example.com' });
console.log('mcp call isError:', tool.isError, '| charged:', tool.data?.credits_charged);

// 5. A2A JSON-RPC, for clients that speak the A2A protocol.
const task = await client.a2a('localizer.render', { locale: 'ja', document: { title: 'Pricing' } });
console.log('a2a task:', task.kind, task.status?.state);

const me = await client.usage();
console.log('balance:', me.remaining, 'of', me.credits, 'credits left on plan', me.plan);
