# IntelliCore A2A — SDK + MCP connector

Metered skills from [Intelli living](https://intelliliving.kr), callable by AI agents
over **three** surfaces with **one bearer key**:

| Surface | Endpoint | Protocol |
|---|---|---|
| Plain HTTP | `POST https://a2a.intelliliving.kr/v1/call` | JSON in, JSON out |
| A2A | `POST https://a2a.intelliliving.kr/a2a` | JSON-RPC `message/send` (A2A 0.3.0) |
| MCP | `POST https://a2a.intelliliving.kr/mcp` | Streamable HTTP (MCP `2025-06-18`) |

A successful call is charged in prepaid credits. A call that fails upstream is **not**
charged. A call without enough credits answers `402` with top-up links — the gateway
never charges a card itself.

This repository holds the Node SDK, the Python SDK, the MCP stdio bridge and runnable
examples. There is no build step and there are no dependencies.

---

## 1. Get a key in one request (no card, no signup)

```bash
KEY=$(curl -s -X POST https://a2a.intelliliving.kr/api/onboard/trial \
  -H 'content-type: application/json' -d '{"agent":"my-agent"}' \
  | sed -E 's/.*"key":"([^"]+)".*/\1/')
```

25 credits, valid 7 days, five skill calls. The key is derived from your network and the
UTC day, so calling the endpoint again returns **the same** 25 credits instead of a new
allowance — safe to retry, useless to farm. Rate limit: 6 requests / 10 minutes / IP.

```bash
curl -s https://a2a.intelliliving.kr/v1/call \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"skill":"localizer.render","input":{"locale":"ja","document":{"title":"Pricing"}}}'
```

## 2. Or plug it into an MCP client

```bash
claude mcp add --transport http intellicore-a2a https://a2a.intelliliving.kr/mcp \
  --header "authorization: Bearer $KEY"
```

Or in a config file (see [`.mcp.json`](./.mcp.json)):

```json
{
  "mcpServers": {
    "intellicore-a2a": {
      "type": "http",
      "url": "https://a2a.intelliliving.kr/mcp",
      "headers": { "authorization": "Bearer ek_..." }
    }
  }
}
```

Clients that only speak stdio (Claude Desktop and friends) use the bridge in
[`mcp/server.js`](./mcp/server.js), which forwards to the hosted endpoint:

```json
{
  "mcpServers": {
    "intellicore-a2a": {
      "command": "node",
      "args": ["/absolute/path/to/intellicore-a2a-mcp/mcp/server.js"],
      "env": { "INTELLICORE_A2A_KEY": "ek_..." }
    }
  }
}
```

Tools an MCP client sees:

| Tool | Skill | Credits | What it does |
|---|---|---:|---|
| `disclosure_inspect` | `disclosure.inspect` | 5 | Inspect a page for AI disclosure, generated-output labels and machine-readable marks |
| `pg_scan` | `pg.scan` | 5 | Score a checkout page against 28 Korean PG and global MoR review rules |
| `localizer_render` | `localizer.render` | 5 | Localize money, tax, dates, disclaimers and refund wording into an approved locale pack |

MCP tool names use underscores; the dotted skill ids still work in `tools/call`.

## 3. Node SDK

```bash
npm install github:295rdptvsm-netizen/intellicore-a2a-mcp
```

```js
import { IntelliCoreA2A } from 'intellicore-a2a';

const { client } = await IntelliCoreA2A.trial({ agent: 'my-agent' });

const out = await client.call('disclosure.inspect', { url: 'https://example.com' });
console.log(out.credits_charged, out.remaining, out.result);

// the same skill as an MCP client would call it
const tool = await client.mcpRun('disclosure_inspect', { url: 'https://example.com' });

// or over A2A
const task = await client.a2a('localizer.render', { locale: 'ja', document: { title: 'Pricing' } });
```

`IntelliCoreA2A({ key, baseUrl })` also takes an existing key. Errors are typed:
`InsufficientCredits` (with `.topup`), `AuthenticationRequired`, `A2AError`.

## 4. Python SDK

```bash
pip install ./sdk/python         # or: pip install git+https://github.com/295rdptvsm-netizen/intellicore-a2a-mcp#subdirectory=sdk/python
```

```python
from intellicore_a2a import IntelliCoreA2A

trial = IntelliCoreA2A.trial(agent="my-agent")
client = trial["client"]

print(client.call("disclosure.inspect", {"url": "https://example.com"}))
print(client.mcp_run("localizer_render", {"locale": "ja", "document": {"title": "Pricing"}}))
```

Standard library only (`urllib`), Python 3.9+.

## 5. Buying credits and self-service onboarding

Credit packs and their current prices are listed at
[`/v1/catalog`](https://a2a.intelliliving.kr/v1/catalog). A purchase gives you an access
code; one call turns it into a key:

```bash
curl -s -X POST https://a2a.intelliliving.kr/api/onboard/claim \
  -H 'content-type: application/json' -d '{"code":"A2-XXXXX-XXXXX-XXXXX"}'
```

A payment platform can also confirm a purchase server-to-server:

```bash
BODY='{"event_id":"evt_1","type":"payment.completed","plan_id":"pack_500"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -s -X POST https://a2a.intelliliving.kr/api/onboard/paid \
  -H "x-il-billing-signature: sha256=$SIG" -H 'content-type: application/json' -d "$BODY"
```

The response carries the buyer's key. A retried event for the same `event_id` returns the
same key, so a webhook retry never creates a second entitlement. Timestamped
signatures (`t=<unix>,v1=<hex>`) are accepted with a 300-second window.

## 6. Error model

| Status | Meaning | What an agent should do |
|---|---|---|
| `401` | Missing or invalid key | Get a trial key (`POST /api/onboard/trial`) or a purchase key |
| `402` | Not enough credits — **nothing was charged** | Buy a pack from `topup[].payhip_url`, then retry with the new key |
| `429` | Rate limited | Back off; the body says the window |
| `502` | Upstream engine failed — **nothing was charged** | Retry later |

Over A2A the same conditions are JSON-RPC errors `-32600` (auth), `-32002` (payment,
with `data.topup`) and `-32603` (upstream). Over MCP, `tools/call` answers
`isError: true` with the `402` body in `structuredContent`.

## 7. Discovery documents

Everything an agent needs is public and machine-readable:

| Document | URL |
|---|---|
| A2A agent card (0.3.0) | https://a2a.intelliliving.kr/.well-known/agent-card.json |
| Agent manifest | https://a2a.intelliliving.kr/agent-manifest.json |
| MCP server card | https://a2a.intelliliving.kr/mcp.json |
| OpenAPI 3.0.3 | https://a2a.intelliliving.kr/openapi.json |
| llms.txt | https://a2a.intelliliving.kr/llms.txt |
| Skills and packs | https://a2a.intelliliving.kr/v1/catalog |

## 8. Repository layout

```
sdk/node/intellicore-a2a.js     Node client (fetch, zero deps)
sdk/python/intellicore_a2a.py   Python client (urllib, zero deps)
mcp/server.js                   MCP stdio bridge → hosted /mcp
examples/trial-and-call.mjs     Node end-to-end example
examples/trial_and_call.py      Python end-to-end example
examples/trial-key.mjs          prints a fresh trial key
examples/curl.md                every surface with curl
examples/claude_desktop_config.json
agent.json                      A2A client configuration example
test/smoke.mjs                  live smoke test (npm test)
```

Run the smoke test (it issues its own trial key if you do not pass one):

```bash
npm test
```

## Security

The gateway stores no key material it does not need: a key is a signed token that
carries its plan, quota and expiry, so there is no key table to leak. Secrets are never
sent to this repository. To report a vulnerability, open a private security advisory on
this repository rather than a public issue.

## License

MIT — see [LICENSE](./LICENSE).
