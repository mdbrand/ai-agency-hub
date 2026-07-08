# Enrichment

Two passes, run per spec Section 4:

1. **Tagging extraction** — a Claude API call per new `recalls` row that fills
   `hazard_category`, `standard_violated`, `product_category`, `retailer_channel`
   from the raw hazard text and title. Most of these fields are near-verbatim in
   CPSC's own title strings, so this should be a tight, deterministic parsing
   prompt, not open-ended reasoning.
2. **Pattern detection** — queries against the trailing 90-day window:
   - same `standard_violated` 3+ times → cluster alert
   - same `entity_name` 2+ times across any table → repeat-offender alert
   - `death_count` > 0 → automatic severity escalation
   - a `standards_calendar` topic reaching its effective date, cross-referenced
     against `recalls.product_category` → countdown alert

Not yet implemented. Build and test the tagging prompt against ~50 real records
before wiring it into the ingestion pipeline (spec open items).
