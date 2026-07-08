#!/usr/bin/env python3
"""
The real tagging extraction pass (docs/BUILD_SPEC.md Section 4): a Claude API
call per recall that fills hazard_category, standard_violated,
product_category, retailer_channel, death_count, and injury_count from the raw
title / hazard text / injury narrative already sitting in the `recalls` table.

This replaces the keyword-heuristic tagging in scripts/backfill/backfill.py,
which was only ever meant to get real base-rate counts to pick the MVP
category (done -- dressers/CSUs, see BUILD_SPEC.md Section 7).

Requires ANTHROPIC_API_KEY in the environment.

Usage:
  python3 tag_recall.py --sample 50          # compare Claude vs. heuristic tags, no writes
  python3 tag_recall.py --sample 50 --write  # also upsert Claude's tags back into `recalls`
  python3 tag_recall.py --category "dresser/CSU" --all --write
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from urllib.parse import quote

ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
MODEL = "claude-haiku-4-5-20251001"

TAG_TOOL = {
    "name": "tag_recall",
    "description": (
        "Extract structured safety tags from a CPSC recall record. Only use "
        "information present in the supplied text -- do not infer facts that "
        "aren't stated."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "hazard_categories": {
                "type": "array",
                "description": (
                    "ALL hazards named in the text, not just the first one -- "
                    "e.g. STURDY Act dresser recalls virtually always cite "
                    "both 'tip-over' and 'entrapment' together, not one or "
                    "the other."
                ),
                "items": {
                    "type": "string",
                    "enum": [
                        "tip-over", "entrapment", "choking", "battery-ingestion",
                        "drowning", "burn", "fire", "laceration", "fall",
                        "electric-shock", "strangulation", "poisoning",
                        "suffocation", "crash", "other",
                    ],
                },
                "minItems": 1,
            },
            "standard_violated": {
                "type": "string",
                "description": (
                    "The specific mandatory/voluntary standard named in the "
                    "text, e.g. 'Clothing Storage Units (STURDY Act)', "
                    "'VGBA', 'Toy Standard — magnets', 'Toy Standard — "
                    "battery/Reese's Law', 'Bicycle Helmets', 'Adult Portable "
                    "Bed Rails'. Empty string if none is named."
                ),
            },
            "product_category": {
                "type": "string",
                "description": (
                    "Short product-type label. Use 'dresser/CSU', "
                    "'pool_drain_cover', 'bed_rail', or 'toy_battery' when it "
                    "matches one of those; otherwise a short freeform label "
                    "(e.g. 'stroller', 'space heater')."
                ),
            },
            "retailer_channel": {
                "type": "string",
                "enum": ["Amazon", "Walmart", "Costco", "Target", "Home Depot", "Wayfair", "other", "unknown"],
            },
            "death_count": {
                "type": "integer",
                "description": (
                    "Deaths ACTUALLY reported in the injury narrative. CPSC "
                    "recall titles all carry boilerplate 'Risk of Serious "
                    "Injury or Death' regardless of outcome -- ignore that "
                    "phrase entirely and only count deaths the narrative "
                    "states really happened. 0 if none reported."
                ),
            },
            "injury_count": {
                "type": ["integer", "null"],
                "description": "Injuries actually reported as a number in the narrative, or null if not stated as a number.",
            },
        },
        "required": ["hazard_categories", "standard_violated", "product_category", "retailer_channel", "death_count", "injury_count"],
    },
}


def load_env(path):
    env = dict(os.environ)
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env.setdefault(k, v)
    return env


def supabase_get(supabase_url, service_key, table, params):
    query = "&".join(f"{k}={quote(str(v), safe='.,()')}" for k, v in params.items())
    url = f"{supabase_url}/rest/v1/{table}?{query}"
    req = urllib.request.Request(url, headers={
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def supabase_upsert(supabase_url, service_key, table, rows):
    if not rows:
        return
    url = f"{supabase_url}/rest/v1/{table}"
    req = urllib.request.Request(url, data=json.dumps(rows).encode("utf-8"), method="POST", headers={
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


def call_claude(api_key, record, model=MODEL):
    raw = record.get("raw_json") or {}
    retailers = "; ".join(r.get("Name", "") for r in raw.get("Retailers") or []) or "(not stated)"
    prompt = (
        f"Title: {record['title']}\n"
        f"Hazard text: {record.get('hazard_text') or '(none)'}\n"
        f"Injury narrative: {record.get('injury_narrative') or '(none reported)'}\n"
        f"Sold at / retailers: {retailers}"
    )
    body = json.dumps({
        "model": model,
        "max_tokens": 300,
        "tools": [TAG_TOOL],
        "tool_choice": {"type": "tool", "name": "tag_recall"},
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")
    req = urllib.request.Request(ANTHROPIC_API, data=body, method="POST", headers={
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    for block in result["content"]:
        if block["type"] == "tool_use":
            return block["input"]
    raise RuntimeError(f"no tool_use block in response: {result}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=50, help="total records to test, mixing MVP category + others")
    parser.add_argument("--category", default="dresser/CSU")
    parser.add_argument("--all", action="store_true", help="tag every recall, not just a sample")
    parser.add_argument("--write", action="store_true", help="upsert Claude's tags back into `recalls`")
    parser.add_argument("--model", default=MODEL)
    args = parser.parse_args()

    env = load_env(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
    supabase_url = env["SUPABASE_URL"]
    service_key = env["SUPABASE_SERVICE_ROLE_KEY"]
    api_key = env.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ANTHROPIC_API_KEY not set (env or .env) -- required to call Claude.", file=sys.stderr)
        sys.exit(1)

    fields = "recall_id,title,hazard_text,injury_narrative,hazard_category,standard_violated,product_category,retailer_channel,death_count,injury_count,raw_json"

    if args.all:
        records = supabase_get(supabase_url, service_key, "recalls", {"select": fields})
    else:
        mvp_records = supabase_get(supabase_url, service_key, "recalls", {
            "select": fields, "product_category": f"eq.{args.category}",
        })
        remaining = max(0, args.sample - len(mvp_records))
        other_records = supabase_get(supabase_url, service_key, "recalls", {
            "select": fields, "product_category": "eq.other",
            "order": "recall_date.desc", "limit": remaining,
        }) if remaining else []
        records = mvp_records + other_records

    print(f"Tagging {len(records)} recalls with {args.model} ...\n")

    updates = []
    agree = {"hazard_category": 0, "product_category": 0, "standard_violated": 0, "retailer_channel": 0}
    death_changed = 0

    for i, r in enumerate(records, 1):
        try:
            tags = call_claude(api_key, r, model=args.model)
        except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError) as e:
            print(f"  ! [{i}/{len(records)}] {r['recall_id']} failed: {e}", file=sys.stderr)
            continue

        hazard_list = tags.pop("hazard_categories", [])
        tags["hazard_category"] = ",".join(hazard_list)

        for field in agree:
            if field == "hazard_category":
                match = (r.get("hazard_category") or "") in hazard_list
            else:
                match = (r.get(field) or "") == (tags.get(field) or "")
            if match:
                agree[field] += 1
        if (r.get("death_count") or 0) != (tags.get("death_count") or 0):
            death_changed += 1

        flag = "" if (r.get("product_category") or "") == tags.get("product_category") else "  <- product_category changed"
        print(f"  [{i}/{len(records)}] {r['recall_id']}: {r['title'][:70]}")
        print(f"      heuristic: {r.get('product_category')!r} / {r.get('hazard_category')!r} / deaths={r.get('death_count')}")
        print(f"      claude:    {tags.get('product_category')!r} / {tags.get('hazard_category')!r} / deaths={tags.get('death_count')}{flag}")

        updates.append({"recall_id": r["recall_id"], **tags})

    total = len(records)
    print("\n--- Agreement vs. heuristic tagging ---")
    for field, n in agree.items():
        print(f"  {field:20s} {n}/{total} ({100*n//total if total else 0}%)")
    print(f"  death_count changed  {death_changed}/{total}")

    if args.write:
        print(f"\nUpserting {len(updates)} tag updates into Supabase ...")
        supabase_upsert(supabase_url, service_key, "recalls", updates)
        print("Done.")
    else:
        print("\n(dry run -- pass --write to save these tags to the DB)")


if __name__ == "__main__":
    main()
