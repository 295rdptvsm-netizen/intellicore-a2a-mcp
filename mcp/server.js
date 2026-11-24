#!/usr/bin/env node
/**
 * IntelliCore A2A — MCP stdio bridge.
 *
 * For MCP clients that only speak stdio (Claude Desktop and friends): this
 * process speaks JSON-RPC over stdin/stdout and forwards tool calls to the hosted
 * MCP endpoint at https://a2a.intelliliving.kr/mcp, so the tool list is always
 * the live one and the credits are metered on the server.
 *
 * Setup
 *   export INTELLICORE_A2A_KEY=ek_...        # from POST /api/onboard/trial
 *   node mcp/server.js                       # or: node mcp/server.js --key=ek_...
 *
 * Nothing is logged to stdout except protocol messages; diagnostics go to stderr.
 */
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const argKey = args.find((a) => a.startsWith('--key='))?.slice(6);
const argBase = args.find((a) => a.startsWith('--base='))?.slice(7);
const KEY = argKey || process.env.INTELLICORE_A2A_KEY || '';
const BASE = (argBase || process.env.INTELLICORE_A2A_BASE || 'https://a2a.intelliliving.kr').replace(/\/$/, '');
const VERSION = '1.0.0';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

const log = (...parts) => process.stderr.write(`[intellicore-a2a] ${parts.join(' ')}\n`);
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

async function remote(method, params) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: `bridge_${Date.now()}`, method, ...(params ? { params } : {}) })
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed };
}

async function handle(msg) {
  const id = Object.prototype.hasOwnProperty.call(msg, 'id') ? msg.id : null;
  const method = String(msg.method || '');
  if (!msg.jsonrpc || msg.jsonrpc !== '2.0') return { jsonrpc: '2.0', id, error: { code: -32600, message: 'invalid_request' } };
  if (method.startsWith('notifications/')) return null;

  if (method === 'initialize') {
    const asked = String(msg.params?.protocolVersion || '');
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'intellicore-a2a-bridge', title: 'IntelliCore A2A Gateway (stdio bridge)', version: VERSION },
        instructions:
          'Metered skills from Intelli living, served through the hosted MCP endpoint. ' +
          'A free 25-credit key comes from POST /api/onboard/trial at ' + BASE + '.'
      }
    };
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };

  if (method === 'tools/list' || method === 'tools/call') {
    try {
      const out = await remote(method, msg.params);
      if (out.body?.error) return { jsonrpc: '2.0', id, error: out.body.error };
      if (out.body?.result) return { jsonrpc: '2.0', id, result: out.body.result };
      return { jsonrpc: '2.0', id, error: { code: -32603, message: `gateway_http_${out.status}` } };
    } catch (err) {
      return { jsonrpc: '2.0', id, error: { code: -32603, message: 'gateway_unreachable', data: { base: BASE, detail: String(err && err.message || err) } } };
    }
  }
  if (method === 'prompts/list') return { jsonrpc: '2.0', id, result: { prompts: [] } };
  if (method === 'resources/list') return { jsonrpc: '2.0', id, result: { resources: [] } };
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method_not_supported', data: { supported: ['initialize', 'ping', 'tools/list', 'tools/call'] } } };
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();

rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  queue = queue.then(async () => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse_error' } });
      return;
    }
    const out = await handle(msg);
    if (out) send(out);
  }).catch((err) => log('handler error:', String(err && err.stack || err)));
});

rl.on('close', () => {
  queue.finally(() => process.exit(0));
});

log(`bridge ready → ${BASE}/mcp${KEY ? '' : ' (no key yet: set INTELLICORE_A2A_KEY, or run `node examples/trial-key.mjs`)'}`);
