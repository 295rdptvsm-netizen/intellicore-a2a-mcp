"""IntelliCore A2A client — Python 3.9+, standard library only.

One client for the three surfaces of https://a2a.intelliliving.kr:

    client = IntelliCoreA2A.trial().client      # free 25 credits, no card
    client.call("localizer.render", {"locale": "ja", "document": {...}})
    client.a2a("disclosure.inspect", {"url": "https://example.com"})
    client.mcp_run("pg_scan", {"url": "https://example.com"})

A successful call is charged; a call that fails upstream is not. A key that runs
out of credits raises InsufficientCredits, which carries the top-up options.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

DEFAULT_BASE = "https://a2a.intelliliving.kr"


class A2AError(Exception):
    def __init__(self, message, status=0, body=None, skill=None):
        super().__init__(message)
        self.status = status
        self.body = body
        self.skill = skill


class InsufficientCredits(A2AError):
    def __init__(self, body, skill=None):
        super().__init__("insufficient_credits", 402, body, skill)
        self.required = (body or {}).get("required")
        self.remaining = (body or {}).get("remaining")
        # [{"id", "name", "credits", "price", "payhip_url"}] — the gateway never charges a card.
        self.topup = (body or {}).get("topup") or []


class AuthenticationRequired(A2AError):
    def __init__(self, body):
        super().__init__("authentication_required", 401, body)
        err = (body or {}).get("error")
        data = err.get("data") if isinstance(err, dict) else None
        # The free-trial URL is only present on the MCP surface; REST 401s carry a plain string.
        self.trial_endpoint = (data or {}).get("free_trial")


class IntelliCoreA2A:
    def __init__(self, key=None, base_url=DEFAULT_BASE, timeout=45):
        self.key = key or ""
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    # ── self-service keys ────────────────────────────────────────────────────
    @classmethod
    def trial(cls, agent="python-client", base_url=DEFAULT_BASE, timeout=45):
        """POST /api/onboard/trial — 25 credits for 7 days, no card."""
        raw = cls(base_url=base_url, timeout=timeout)._request("POST", "/api/onboard/trial", {"agent": agent}, auth=False)
        return dict(raw, client=cls(key=raw["key"], base_url=base_url, timeout=timeout))

    @classmethod
    def claim(cls, code, base_url=DEFAULT_BASE, timeout=45):
        """POST /api/onboard/claim — purchase access code to key in one call."""
        raw = cls(base_url=base_url, timeout=timeout)._request("POST", "/api/onboard/claim", {"code": code}, auth=False)
        return dict(raw, client=cls(key=raw["key"], base_url=base_url, timeout=timeout))

    # ── transport ────────────────────────────────────────────────────────────
    def _request(self, method, path, body=None, auth=True):
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        req.add_header("content-type", "application/json")
        if auth and self.key:
            req.add_header("authorization", "Bearer " + self.key)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                payload = res.read().decode("utf-8")
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8")
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {"raw": raw}
            if err.code == 402:
                raise InsufficientCredits(parsed, (body or {}).get("skill") if isinstance(body, dict) else None) from None
            if err.code == 401:
                raise AuthenticationRequired(parsed) from None
            reason = parsed.get("error")
            if not isinstance(reason, str):
                reason = (reason or {}).get("message") or "http_%s" % err.code
            raise A2AError(reason, err.code, parsed) from None

    # ── surfaces ─────────────────────────────────────────────────────────────
    def catalog(self):
        return self._request("GET", "/v1/catalog", auth=False)

    def usage(self):
        return self._request("GET", "/v1/usage")

    def call(self, skill, input=None):
        """Plain HTTP POST /v1/call."""
        return self._request("POST", "/v1/call", {"skill": skill, "input": input or {}})

    def a2a(self, skill, input=None):
        """A2A 0.3.0 JSON-RPC message/send."""
        body = {
            "jsonrpc": "2.0",
            "id": "py_1",
            "method": "message/send",
            "params": {
                "message": {
                    "role": "user",
                    "messageId": "py_m1",
                    "parts": [{"kind": "data", "data": {"skill": skill, "input": input or {}}}],
                }
            },
        }
        out = self._request("POST", "/a2a", body)
        if out.get("error"):
            err = out["error"]
            if err.get("code") == -32002:
                raise InsufficientCredits(err.get("data") or {}, skill)
            raise A2AError(err.get("message") or "a2a_error", 200, out, skill)
        return out["result"]

    def mcp(self, method, params=None):
        """Raw MCP JSON-RPC against POST /mcp."""
        body = {"jsonrpc": "2.0", "id": "py_mcp_1", "method": method}
        if params is not None:
            body["params"] = params
        return self._request("POST", "/mcp", body)

    def tools(self):
        """MCP tools/list."""
        return (self.mcp("tools/list").get("result") or {}).get("tools") or []

    def mcp_run(self, name, arguments=None):
        """MCP tools/call -> {"text", "data", "is_error"}."""
        out = self.mcp("tools/call", {"name": name, "arguments": arguments or {}})
        if out.get("error"):
            if out["error"].get("code") == -32001:
                raise AuthenticationRequired(out)
            raise A2AError(out["error"].get("message") or "mcp_error", 200, out, name)
        result = out.get("result") or {}
        content = result.get("content") or [{}]
        return {"text": content[0].get("text", ""), "data": result.get("structuredContent"), "is_error": bool(result.get("isError"))}


__all__ = ["IntelliCoreA2A", "A2AError", "InsufficientCredits", "AuthenticationRequired", "DEFAULT_BASE"]
