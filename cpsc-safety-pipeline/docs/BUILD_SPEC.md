# CPSC Product-Safety Intelligence Pipeline — Build Spec

## What this is

A system that ingests U.S. Consumer Product Safety Commission (CPSC) recall data,
standards-development activity, and (pending) pre-recall incident reports; stores
it in a structured knowledge base; tags and scores each record for severity and
pattern membership; and generates a weekly actionable brief for subscribers in a
specific product category.

**The business model:** sell the weekly brief as a monthly subscription to small
manufacturers/importers who don't have in-house compliance staff, starting with
one narrow category (see "MVP Category Focus" below), priced around $199–299/mo.

**The core insight the system is built around:** the raw recall/standards data is
public and free. The value is (1) filtering it to one buyer's category, (2) tagging
it with structure CPSC doesn't hand you in clean form, (3) tracking it over time so
patterns become visible that no single record shows, and (4) turning that into one
specific action per week, not a report to read.

---

## 1. Data Sources (Ingestion Layer)

| Source | Type | URL / Access | Purpose |
|---|---|---|---|
| CPSC Recalls for Children RSS | RSS | `cpsc.gov/Newsroom/CPSC-RSS-Feed/Recalls-RSS/children` | Primary trigger — pre-filtered to juvenile products |
| CPSC All Recalls RSS | RSS | `cpsc.gov/Newsroom/CPSC-RSS-Feed/Recalls-RSS` | Superset, needed if categories expand beyond juvenile products |
| CPSC Public Calendar RSS | RSS | `cpsc.gov/Newsroom/CPSC-RSS-Feed/Public-Calendar-RSS` | Standards-development meetings — the predictive/leading-indicator signal |
| CPSC News Releases RSS | RSS | `cpsc.gov/Newsroom/CPSC-RSS-Feed/News-RSS` | Catches new mandatory standards taking effect (e.g. water beads, neck floats) |
| Federal Register API (CPSC-filtered) | JSON API | `federalregister.gov/api/v1/articles.json?conditions[agencies][]=consumer-product-safety-commission` | Full regulatory text behind standards changes |
| SaferProducts.gov Recall API | REST/JSON | `saferproducts.gov/RestWebServices/Recall?format=json` | Full structured recall record: units affected, injuries, manufacturer, importer, retailer, country, remedy — richer than any RSS feed |
| SaferProducts.gov Incident Report API | OData API | *Endpoint not yet confirmed — verify via saferproducts.gov/FAQs before building against it* | Pre-recall consumer complaints — the genuine leading-indicator dataset, since some incidents never become official recalls |
| CPSC Tip-Over Injury Statistics RSS | RSS | `cpsc.gov/Newsroom/CPSC-RSS-Feed/Injury-Statistics/105` | Supporting baseline data for the CSU/dresser category specifically |

**Note on RSS vs. API:** RSS feeds are the trigger ("something new happened").
The SaferProducts.gov Recall API is the enrichment call ("here's everything about
what happened"). Use RSS to detect new items, then hit the API for the full record.

---

## 2. Orchestration Layer

Build in n8n (already in use for other workflows).

- **Daily poll:** Recalls for Children RSS + All Recalls RSS → detect new items →
  trigger enrichment workflow per new item.
- **Weekly poll:** Public Calendar RSS + News Releases RSS → detect new standards
  activity → trigger "countdown watch" logic (see Section 5).
- **Monthly sweep:** Federal Register API, filtered to CPSC → catch anything RSS
  missed, especially final rules with effective dates.
- **On-demand backfill:** one-time script pulling the full SaferProducts.gov Recall
  API history (paginated by date) to seed the knowledge base with real annual base
  rates before the MVP category is finalized.

---

## 3. Storage — Knowledge Base Schema

Recommend Supabase or Airtable (both have native n8n nodes; Supabase preferred if
Claude Code is doing real schema/query work, Airtable if Rob wants to eyeball
records directly).

### Table: `recalls`
| Field | Type | Notes |
|---|---|---|
| recall_id | text (PK) | CPSC RecallNumber |
| recall_date | date | |
| title | text | |
| url | text | Link to full CPSC recall page |
| hazard_text | text | Raw hazard description |
| hazard_category | text | Tagged: tip-over, entrapment, choking, battery-ingestion, drowning, burn, fire, laceration, etc. |
| standard_violated | text | Tagged: e.g. "Clothing Storage Units (STURDY Act)", "VGBA", "Toy Standard — magnets", "Toy Standard — battery/Reese's Law", "Bicycle Helmets", "Adult Portable Bed Rails" |
| product_category | text | Tagged: dresser/CSU, pool drain cover, toy, bike helmet, bed rail, infant sleep product, etc. |
| units_affected | integer | |
| injury_count | integer | |
| death_count | integer | Explicit field — this is a severity escalation flag |
| injury_narrative | text | Raw text, e.g. "two deaths reported" |
| remedy_type | text | refund / repair / replace |
| manufacturer | text | |
| importer | text | |
| retailer_channel | text | Tagged: Amazon, Walmart, Costco, direct-import, etc. — this is the targeting field |
| country_of_manufacture | text | |
| raw_json | jsonb | Full original API response, for reprocessing later |

### Table: `standards_calendar`
| Field | Type | Notes |
|---|---|---|
| event_date | date | |
| committee | text | e.g. "ASTM F15.42" |
| topic | text | |
| meeting_type | text | task group / working group / full committee |
| source_url | text | |
| related_product_category | text | Tag to link back to `recalls.product_category` |

### Table: `entities`
| Field | Type | Notes |
|---|---|---|
| entity_name | text (PK) | Normalized manufacturer/importer name |
| aliases | text[] | Catches name variants |
| first_seen_date | date | |
| recall_count | integer | Auto-incremented — surfaces repeat offenders (e.g. PandaEar) |
| categories | text[] | Which product categories this entity has been recalled in |

### Table: `incident_reports` (pending endpoint confirmation)
| Field | Type | Notes |
|---|---|---|
| report_id | text (PK) | |
| report_date | date | |
| product_category | text | |
| hazard_description | text | |
| manufacturer_named | text | |
| became_recall | boolean | Set true if later matched to a `recalls` row — this is the leading-indicator signal |

---

## 4. Enrichment / Tagging Layer

For every new `recalls` row, run an extraction pass (Claude API call, small and
cheap per record) that fills in the tagged fields from the raw hazard text and
title. Most fields (standard violated, channel, hazard category) are already
near-verbatim in CPSC's own title strings — this is closer to structured parsing
than open-ended reasoning, so keep the prompt tight and deterministic rather than
freeform.

After tagging, run pattern detection against the trailing 90-day window:
- Same `standard_violated` appearing 3+ times → cluster alert
- Same `entity_name` appearing 2+ times across any table → repeat-offender alert
- `death_count` > 0 → automatic severity escalation regardless of category
- A `standards_calendar` topic reaching an effective date, cross-referenced against
  `recalls.product_category` → countdown alert

---

## 5. Decision / Output Layer — the actionable format (v0, expect to refine)

This is the part Rob deferred — here's a concrete starting template so the
pipeline has something to build toward. Refine after seeing real subscriber
reactions, don't leave it undefined.

**Weekly brief per subscribed category, four fixed sections:**

1. **This week's hits** — new recalls in the subscriber's category, each flagged
   High/Medium/Low by injury/death presence and unit count.
2. **Pattern alert** — any cluster detected in the trailing 90 days (e.g. "3 pool
   drain cover recalls citing VGBA in the last 3 weeks, all Amazon-sold, all under
   400 units — this is a live enforcement wave").
3. **Countdown watch** — any standard reaching its effective date within 90 days
   that touches this category, pulled from `standards_calendar` + News Releases.
4. **One action** — a single specific thing to check on the subscriber's own
   product line this week, tied to whichever of 1–3 is highest severity.

---

## 6. Delivery Layer

- Weekly email digest generated from the DB (n8n → email node, or a simple
  templated send).
- Format the four sections above; keep it skimmable, not a report.
- Eventually: Slack delivery as an alternative channel for subscribers who prefer it.

---

## 7. MVP Category Focus

Based on real data pulled from the live SaferProducts.gov API (not just newsletter
snippets), four validated clusters exist right now within juvenile/child-adjacent
products:

1. **Clothing storage units / dressers** — tip-over/entrapment, STURDY Act
2. **Battery-ingestion / Reese's Law** — toys with accessible button-cell batteries (most frequent cluster in the sample pulled)
3. **VGBA pool/spa drain covers** — entrapment/drowning, tight repeat cluster of small Amazon importers
4. **Adult portable bed rails** — entrapment/asphyxiation, just escalated to confirmed deaths (Vive Health)

Before locking the single MVP category, pull a full year of data (Section 2,
on-demand backfill) and get real annual frequency counts across these four —
three weeks of data is not enough to pick the final wedge, only enough to know
these four are real.

### Decision: Clothing Storage Units / Dressers (STURDY Act)

Backfill run 2026-07-02 over the trailing year (2025-07-01 to 2026-07-02, 512
total CPSC recalls) gave real annual frequency counts across the 4 candidates:

| Category | Recalls/year |
|---|---|
| **Dressers/CSUs (STURDY Act)** | **31** |
| Adult portable bed rails | 23 |
| Battery-ingestion toys (Reese's Law) | 11 |
| VGBA pool/spa drain covers | 10 |

Dressers/CSUs is the volume leader (~3x drain covers) and it's a live mandatory-
standard enforcement wave (STURDY Act took effect and CPSC/manufacturers are
recalling non-compliant units continuously), not a sporadic incident cluster —
matches the business model's bet on riding an active enforcement wave rather
than a thin, occasional one. Bed rails was the close second and has the sharper
severity story (2 recalls, including Vive Health's confirmed deaths), worth
revisiting as the second category once the first subscriber base is proven out.

Counts came from keyword-heuristic tagging (`scripts/backfill/backfill.py`),
spot-checked against raw titles — solid for base-rate counting, but not the
real enrichment pass; see Section 4 and the open item below.

---

## 8. Customer / Business Layer (not part of the technical build, but the pipeline should support it)

- Stripe subscription, gated access to the weekly brief
- Customer selects their product category(ies) at signup
- Founding rate ~$199/mo for first 15–20 subscribers, ~$299/mo standard after
- Sample report (built from real historical data, not hypothetical) as the sales
  asset for outreach

---

## Open items before/during build

- [ ] Confirm exact SaferProducts.gov Incident Report API endpoint and auth requirements
- [x] Decide Supabase vs. Airtable for the knowledge base — Supabase
- [x] Run the full-year backfill and pick the final MVP category from real base rates — Dressers/CSUs (STURDY Act), see Section 7
- [ ] Build and test the tagging extraction prompt against a sample of ~50 real records
- [ ] Draft the weekly brief template as an actual email/HTML layout
