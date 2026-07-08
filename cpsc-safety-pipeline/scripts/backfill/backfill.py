#!/usr/bin/env python3
"""
One-time backfill: pull a year of SaferProducts.gov recall history, tag each
record with heuristic keyword rules, and upsert into the `recalls` table.

The tagging here is keyword-based, not the Claude enrichment pass described in
docs/BUILD_SPEC.md Section 4 -- it exists to get real annual frequency counts
across the 4 MVP candidate categories (Section 7) fast. Re-tag with the real
enrichment prompt once that's built.

Usage:
  python3 backfill.py [--days 366] [--dry-run]
"""
import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import date, timedelta

RECALL_API = "https://www.saferproducts.gov/RestWebServices/Recall"

HAZARD_RULES = [
    ("battery-ingestion", r"button.?cell|coin.?cell|batter(y|ies).*(ingest|swallow)|swallow.*batter"),
    ("drowning", r"drown|submerg"),
    ("entrapment", r"entrap|asphyxiat|strangul|suffocat"),
    ("tip-over", r"tip.?over|tipping"),
    ("choking", r"chok|small parts|aspirat"),
    ("burn", r"burn|scald|hot (water|steam|liquid)"),
    ("fire", r"\bfire\b|flame|ignit|overheat|explod"),
    ("laceration", r"laceration|\bcut(s)?\b|sharp edge"),
    ("fall", r"\bfall(s|ing)?\b|collapse"),
    ("electric-shock", r"\bshock\b|electrocut"),
]

PRODUCT_CATEGORY_RULES = [
    ("dresser/CSU", r"\bdresser|chest of drawers|clothing storage unit|\bCSU\b"),
    ("pool_drain_cover", r"drain cover|pool.*drain|spa.*drain|\bVGBA\b"),
    ("bed_rail", r"bed rail"),
    ("toy_battery", r"\btoy\b"),  # refined below once hazard_category is known
]

STANDARD_RULES = {
    "dresser/CSU": "Clothing Storage Units (STURDY Act)",
    "pool_drain_cover": "VGBA",
    "bed_rail": "Adult Portable Bed Rails",
}

RETAILER_RULES = [
    ("Amazon", r"\bamazon\b"),
    ("Walmart", r"\bwalmart\b"),
    ("Costco", r"\bcostco\b"),
    ("Target", r"\btarget\b"),
    ("Home Depot", r"home depot"),
    ("Wayfair", r"\bwayfair\b"),
]

DEATH_RE = re.compile(r"(\d+)\s*(?:reported\s+)?deaths?\b", re.I)
DEATH_WORD_RE = re.compile(r"\bdied\b|\bdeath(s)?\b|\bfatal(ity|ities)?\b", re.I)
DEATH_NEGATION_RE = re.compile(
    r"no (known )?(reported )?(deaths|fatalities)|deaths?\b.{0,20}(have not|has not|not been reported)",
    re.I,
)
INJURY_COUNT_RE = re.compile(r"(\d+)\s*(?:reported\s+)?injur", re.I)
UNITS_RE = re.compile(r"([\d,]+)")


def classify(pattern_list, text):
    for label, pattern in pattern_list:
        if re.search(pattern, text, re.I):
            return label
    return None


def parse_units(products):
    total = 0
    found = False
    for p in products or []:
        m = UNITS_RE.search(p.get("NumberOfUnits") or "")
        if m:
            total += int(m.group(1).replace(",", ""))
            found = True
    return total if found else None


def parse_death_count(narrative):
    """Only feed this the injury narrative, never the title -- CPSC titles all
    carry boilerplate "Risk of Serious Injury or Death" regardless of whether
    a death actually occurred, so scanning title text produces near-100% false
    positives."""
    if not narrative or DEATH_NEGATION_RE.search(narrative):
        return 0
    m = DEATH_RE.search(narrative)
    if m:
        return int(m.group(1))
    if DEATH_WORD_RE.search(narrative):
        return 1  # detected but no explicit count in the narrative
    return 0


def parse_injury_count(text):
    m = INJURY_COUNT_RE.search(text)
    return int(m.group(1)) if m else None


def clean_entity_name(name):
    return re.sub(r",?\s*of\s+[A-Za-z ,]+$", "", name).strip()


def classify_product_category(title, hazard_text, hazard_category):
    combined = f"{title} {hazard_text}"
    label = classify(PRODUCT_CATEGORY_RULES, combined)
    if label == "toy_battery" and hazard_category != "battery-ingestion":
        return None  # "toy" alone isn't one of our 4 candidates without the battery hazard
    return label


def fetch_recalls(start_date, end_date):
    url = f"{RECALL_API}?format=json&RecallDateStart={start_date}&RecallDateEnd={end_date}"
    req = urllib.request.Request(url, headers={"User-Agent": "cpsc-safety-pipeline-backfill/0.1"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def transform(record):
    title = record.get("Title") or ""
    hazards = record.get("Hazards") or []
    hazard_text = "; ".join(h.get("Name", "") for h in hazards)
    injuries = record.get("Injuries") or []
    injury_narrative = "; ".join(i.get("Name", "") for i in injuries)

    hazard_category = classify(HAZARD_RULES, f"{title} {hazard_text}") or "other"
    product_category = classify_product_category(title, hazard_text, hazard_category)
    standard_violated = STANDARD_RULES.get(product_category, "")

    manufacturers = [m["Name"] for m in record.get("Manufacturers") or [] if m.get("Name")]
    importers = [m["Name"] for m in record.get("Importers") or [] if m.get("Name")]
    retailers_text = "; ".join(r.get("Name", "") for r in record.get("Retailers") or [])
    retailer_channel = classify(RETAILER_RULES, retailers_text) or ("other" if retailers_text else None)
    countries = [c.get("Country", "") for c in record.get("ManufacturerCountries") or []]
    remedy_type = "; ".join(r.get("Option", "") for r in record.get("RemedyOptions") or []) or None

    return {
        "recall_id": str(record["RecallNumber"]),
        "recall_date": (record.get("RecallDate") or "")[:10] or None,
        "title": title,
        "url": record.get("URL"),
        "hazard_text": hazard_text,
        "hazard_category": hazard_category,
        "standard_violated": standard_violated,
        "product_category": product_category or "other",
        "units_affected": parse_units(record.get("Products")),
        "injury_count": parse_injury_count(injury_narrative),
        "death_count": parse_death_count(injury_narrative),
        "injury_narrative": injury_narrative or None,
        "remedy_type": remedy_type,
        "manufacturer": "; ".join(manufacturers) or None,
        "importer": "; ".join(importers) or None,
        "retailer_channel": retailer_channel,
        "country_of_manufacture": "; ".join(countries) or None,
        "raw_json": record,
    }, manufacturers + importers


def load_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k] = v
    return env


def upsert_rows(supabase_url, service_key, table, rows, batch_size=200):
    if not rows:
        return
    endpoint = f"{supabase_url}/rest/v1/{table}"
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        body = json.dumps(batch).encode("utf-8")
        req = urllib.request.Request(endpoint, data=body, method="POST", headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            print(f"  ! upsert failed for batch {i}-{i+len(batch)}: {e.code} {e.read().decode()[:500]}", file=sys.stderr)
            raise
        print(f"  upserted {table} rows {i + 1}-{i + len(batch)} of {len(rows)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=366)
    parser.add_argument("--dry-run", action="store_true", help="fetch + classify only, skip DB writes")
    args = parser.parse_args()

    env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    env = load_env(env_path)

    end = date.today()
    start = end - timedelta(days=args.days)
    print(f"Fetching recalls {start} to {end} ...")
    records = fetch_recalls(start.isoformat(), end.isoformat())
    print(f"Fetched {len(records)} recalls.")

    rows = []
    entity_stats = defaultdict(lambda: {"first_seen": None, "count": 0, "categories": set()})
    category_counts = defaultdict(int)
    standard_counts = defaultdict(int)
    death_flagged = 0

    for record in records:
        row, entity_names = transform(record)
        rows.append(row)
        category_counts[row["product_category"]] += 1
        if row["standard_violated"]:
            standard_counts[row["standard_violated"]] += 1
        if row["death_count"] > 0:
            death_flagged += 1
        for raw_name in entity_names:
            name = clean_entity_name(raw_name)
            if not name:
                continue
            stats = entity_stats[name]
            stats["count"] += 1
            stats["categories"].add(row["product_category"])
            if row["recall_date"] and (stats["first_seen"] is None or row["recall_date"] < stats["first_seen"]):
                stats["first_seen"] = row["recall_date"]

    entity_rows = [
        {
            "entity_name": name,
            "aliases": [],
            "first_seen_date": stats["first_seen"],
            "recall_count": stats["count"],
            "categories": sorted(c for c in stats["categories"] if c),
        }
        for name, stats in entity_stats.items()
    ]

    print("\n--- Frequency counts by product_category (all recalls, incl. non-MVP-candidate) ---")
    for cat, n in sorted(category_counts.items(), key=lambda x: -x[1]):
        print(f"  {cat:20s} {n}")

    print("\n--- MVP candidate categories (spec Section 7) ---")
    for cat in ["dresser/CSU", "pool_drain_cover", "bed_rail", "toy_battery"]:
        print(f"  {cat:20s} {category_counts.get(cat, 0)}")

    print(f"\nRecalls with a detected death mention: {death_flagged}")
    print(f"Unique manufacturers/importers seen: {len(entity_rows)}")
    print(f"Repeat offenders (recall_count >= 2): {sum(1 for e in entity_rows if e['recall_count'] >= 2)}")

    if args.dry_run:
        print("\n--dry-run set, skipping DB writes.")
        return

    supabase_url = env["SUPABASE_URL"]
    service_key = env["SUPABASE_SERVICE_ROLE_KEY"]

    print(f"\nUpserting {len(rows)} recalls into Supabase ...")
    upsert_rows(supabase_url, service_key, "recalls", rows)

    print(f"\nUpserting {len(entity_rows)} entities into Supabase ...")
    upsert_rows(supabase_url, service_key, "entities", entity_rows)

    print("\nDone.")


if __name__ == "__main__":
    main()
