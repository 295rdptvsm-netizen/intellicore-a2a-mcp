#!/usr/bin/env python3
"""Free trial key -> first call -> MCP tool call. Run: python3 examples/trial_and_call.py"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk", "python"))

from intellicore_a2a import IntelliCoreA2A, InsufficientCredits  # noqa: E402


def main() -> None:
    # 25 credits, 7 days, no card. The same network receives the same 25 credits
    # until the UTC day ends, so running this twice does not create a new balance.
    trial = IntelliCoreA2A.trial(agent="readme-example")
    print("trial key:", trial["key"][:12] + "…", "| credits:", trial["credits"], "| expires:", trial["expires_at"])
    client = trial["client"]

    catalog = client.catalog()
    print("skills:", ", ".join("%s (%s cr)" % (s["id"], s["credits"]) for s in catalog["skills"]))

    try:
        out = client.call("localizer.render", {"locale": "ja", "document": {"title": "Pricing"}})
        print("call ok:", out["credits_charged"], "credits charged,", out["remaining"], "left")
    except InsufficientCredits as err:
        print("out of credits ->", ", ".join(p["name"] for p in err.topup))

    print("mcp tools:", ", ".join(t["name"] for t in client.tools()))
    tool = client.mcp_run("disclosure_inspect", {"url": "https://example.com"})
    print("mcp call is_error:", tool["is_error"], "| charged:", (tool["data"] or {}).get("credits_charged"))

    task = client.a2a("localizer.render", {"locale": "ja", "document": {"title": "Pricing"}})
    print("a2a task:", task.get("kind"), (task.get("status") or {}).get("state"))

    me = client.usage()
    print("balance:", me["remaining"], "of", me["credits"], "credits left on plan", me["plan"])


if __name__ == "__main__":
    main()
