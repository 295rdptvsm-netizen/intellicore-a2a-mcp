/**
 * IntelliCore A2A client — zero dependencies, Node 18+ (global fetch).
 *
 * One client for the three surfaces of https://a2a.intelliliving.kr:
 *   call()     plain HTTP  POST /v1/call
 *   a2a()      A2A 0.3.0   POST /a2a   (JSON-RPC message/send)
 *   mcpRun()   MCP         POST /mcp   (JSON-RPC tools/call)
 *
 * Get a free 25-credit sandbox key with `IntelliCoreA2A.trial()` — no card, no
 * signup. A successful call is charged; a call that fails upstream is not.
 */

export class A2AError extends Error {
  constructor(message, { status = 0, body = null, skill = null } = {}) {
    super(message);
    this.name = 'A2AError';
    this.status = status;
    this.body = body;
    this.skill = skill;
  }
}

export class InsufficientCredits extends A2AError {
  constructor(body, skill) {
    super('insufficient_credits', { status: 402, body, skill });
    this.name = 'InsufficientCredits';
    this.required = body?.required ?? null;
    this.remaining = body?.remaining ?? null;
    /** [{ id, name, credits, price, payhip_url }] — the gateway never charges a card itself. */
    this.topup = body?.topup ?? [];
  }
}

export class AuthenticationRequired extends A2AError {
  constructor(body) {
    super('authentication_required', { status: 401, body });
    this.name = 'AuthenticationRequired';
    this.trialEndpoint = body?.error?.data?.free_trial ?? null;
  }
}

const DEFAULT_BASE = 'https://a2a.intelliliving.kr';

export class IntelliCoreA2A {
  /**
   * @param {object} options
   * @param {string} options.key        Agent key, `ek_...`.
   * @param {string} [options.baseUrl]  Defaults to https://a2a.intelliliving.kr
   * @param {number} [options.timeoutMs]
   */
  constructor({ key, baseUrl = DEFAULT_BASE, timeoutMs = 45_000, fetchImpl = globalThis.fetch } = {}) {
    this.key = key || '';
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  /** POST /api/onboard/trial — 25 credits, 7 days, no card. */
  static async trial({ agent = 'node-client', baseUrl = DEFAULT_BASE, ...rest } = {}) {
    const client = new IntelliCoreA2A({ baseUrl, ...rest });
    const data = await client.request('POST', '/api/onboard/trial', { agent }, { auth: false });
    return { ...data, client: new IntelliCoreA2A({ key: data.key, baseUrl: client.baseUrl, ...rest }) };
  }

  /** POST /api/onboard/claim — turn a purchase access code into a key in one call. */
  static async claim({ code, baseUrl = DEFAULT_BASE, ...rest } = {}) {
    const client = new IntelliCoreA2A({ baseUrl, ...rest });
    const data = await client.request('POST', '/api/onboard/claim', { code }, { auth: false });
    return { ...data, client: new IntelliCoreA2A({ key: data.key, baseUrl: client.baseUrl, ...rest }) };
  }

  async request(method, path, body, { auth = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(auth && this.key ? { authorization: `Bearer ${this.key}` } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (res.status === 402) throw new InsufficientCredits(parsed, body?.skill ?? null);
    if (res.status === 401) throw new AuthenticationRequired(parsed);
    if (!res.ok) throw new A2AError(parsed?.error || `http_${res.status}`, { status: res.status, body: parsed });
    return parsed;
  }

  /** Skills, packs and the trial terms. */
  catalog() {
    return this.request('GET', '/v1/catalog', undefined, { auth: false });
  }

  /** Plan, quota, charged and remaining credits for this key. */
  usage() {
    return this.request('GET', '/v1/usage');
  }

  /** Plain HTTP call. Throws InsufficientCredits when the key is out of credits. */
  call(skill, input = {}) {
    return this.request('POST', '/v1/call', { skill, input });
  }

  /** A2A 0.3.0 JSON-RPC message/send. Returns the JSON-RPC task. */
  async a2a(skill, input = {}) {
    const out = await this.request('POST', '/a2a', {
      jsonrpc: '2.0',
      id: `sdk_${Date.now()}`,
      method: 'message/send',
      params: { message: { role: 'user', messageId: `m_${Date.now()}`, parts: [{ kind: 'data', data: { skill, input } }] } }
    });
    if (out?.error) {
      const code = out.error.code;
      if (code === -32002) throw new InsufficientCredits(out.error.data ?? {}, skill);
      throw new A2AError(out.error.message || 'a2a_error', { status: 200, body: out, skill });
    }
    return out.result;
  }

  /** Raw MCP JSON-RPC call against /mcp. */
  mcp(method, params = undefined) {
    return this.request('POST', '/mcp', { jsonrpc: '2.0', id: `sdk_${Date.now()}`, method, ...(params ? { params } : {}) });
  }

  /** MCP tools/list — tool names, descriptions and JSON Schemas. */
  async tools() {
    const out = await this.mcp('tools/list');
    return out.result?.tools ?? [];
  }

  /**
   * MCP tools/call. Returns { text, data, isError }.
   * A short balance comes back as isError with the top-up options in data.
   */
  async mcpRun(name, args = {}) {
    const out = await this.mcp('tools/call', { name, arguments: args });
    if (out?.error) {
      if (out.error.code === -32001) throw new AuthenticationRequired(out);
      throw new A2AError(out.error.message || 'mcp_error', { status: 200, body: out, skill: name });
    }
    const result = out.result ?? {};
    return { text: result.content?.[0]?.text ?? '', data: result.structuredContent ?? null, isError: Boolean(result.isError) };
  }
}

export default IntelliCoreA2A;
