# Python SDK

```bash
pip install intellicore-a2a            # once published
pip install ./sdk/python               # from a clone
```

```python
from intellicore_a2a import IntelliCoreA2A, InsufficientCredits

trial = IntelliCoreA2A.trial(agent="my-agent")   # 25 credits, 7 days, no card
client = trial["client"]

print(client.call("disclosure.inspect", {"url": "https://example.com"}))
print(client.usage()["remaining"])

try:
    client.call("localizer.render", {"locale": "ja", "document": {"title": "Pricing"}})
except InsufficientCredits as err:
    print("top up:", [p["name"] for p in err.topup])
```

Methods: `trial()`, `claim(code)`, `catalog()`, `usage()`, `call(skill, input)`,
`a2a(skill, input)`, `tools()`, `mcp(method, params)`, `mcp_run(name, arguments)`.
Standard library only, Python 3.9+.
