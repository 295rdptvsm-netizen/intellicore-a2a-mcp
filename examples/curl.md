# curl in 60 seconds

Everything below uses one key. Get a free one (25 credits, no card):

```bash
KEY=$(curl -s -X POST https://a2a.intelliliving.kr/api/onboard/trial \
  -H 'content-type: application/json' -d '{"agent":"curl"}' | sed -E 's/.*"key":"([^"]+)".*/\1/')
echo "$KEY"
```

## Plain HTTP

```bash
curl -s https://a2a.intelliliving.kr/v1/call \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"skill":"localizer.render","input":{"locale":"ja","document":{"title":"Pricing"}}}'
```

## A2A (JSON-RPC message/send)

```bash
curl -s https://a2a.intelliliving.kr/a2a \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","messageId":"m1","parts":[{"kind":"data","data":{"skill":"disclosure.inspect","input":{"url":"https://example.com"}}}]}}}'
```

## MCP

```bash
curl -s https://a2a.intelliliving.kr/mcp \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -s https://a2a.intelliliving.kr/mcp \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"pg_scan","arguments":{"url":"https://example.com","profile":"kr-pg"}}}'
```

## Balance, catalog, discovery

```bash
curl -s https://a2a.intelliliving.kr/v1/usage   -H "authorization: Bearer $KEY"
curl -s https://a2a.intelliliving.kr/v1/catalog
curl -s https://a2a.intelliliving.kr/mcp.json
curl -s https://a2a.intelliliving.kr/llms.txt
```

A `402` means "buy credits", not "retry". Only a successful upstream call is charged.
