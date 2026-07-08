# CPSC Product-Safety Intelligence Pipeline

Ingests CPSC recall/standards data, tags and scores it, and generates a weekly
actionable brief sold as a subscription to small manufacturers/importers.

Full spec: [docs/BUILD_SPEC.md](docs/BUILD_SPEC.md)

## View it

**https://cpsc-brief.vercel.app** — a live weekly-brief-style view of the real
data (switch between the 4 MVP candidate categories via the tabs). Deployed
from `web/`, same pattern as [cbp-job-map](../cbp-job-map/README.md) (Next.js on
Vercel, project `mdbrands-projects/cpsc-brief`). This is an early internal
preview, not the final subscriber-facing design.

**https://cpsc-brief.vercel.app/registry** — the Entity Risk Registry: every
manufacturer/importer across all recalls, deduplicated (CPSC's raw company-name
strings vary between recalls for the same company -- typos, missing commas,
inconsistent "of <city>" suffixes -- `web/src/lib/registry.ts` normalizes these
before grouping), tiered Critical/High/Elevated/Standard by recall history and
severity, searchable, with drill-down to each entity's specific recalls. This
is the first proprietary layer built on top of the raw CPSC data -- see the
"Proprietary data layer" section below.

## Status

**MVP category locked: Clothing Storage Units / Dressers (STURDY Act).** Chosen
from a real full-year backfill (31 recalls/year, ~3x the next candidate, riding
an active mandatory-standard enforcement wave) — see BUILD_SPEC.md Section 7.
512+ real recalls are loaded in Supabase and tagged by the real Claude enrichment
pass (not just the heuristic backfill tagging). The Entity Risk Registry is
live.

**Live ingestion is running.** A Vercel Cron job (`web/vercel.json` →
`/api/cron/ingest`) polls the SaferProducts.gov Recall API hourly, tags
genuinely new recalls with Claude, and upserts them into Supabase — see
"Automated ingestion" below. The site itself has no cache (`revalidate = 0`),
so once a recall lands in the DB it's live immediately. CPSC has no
push/webhook mechanism, so hourly polling is the closest real equivalent to
"refreshed anytime something is published."

**No n8n.** Decided to keep all orchestration in this repo (plain scripts +
whatever scheduler we wire up) rather than a separate n8n instance — the build
spec's Section 2 describes an n8n-based design, but that's superseded by this
decision.

**SaferProducts.gov Incident Report API: confirmed it doesn't exist.**
Researched thoroughly (see BUILD_SPEC.md open items) — there's no public
REST API for individual incident/complaint reports, only for recalls. The
closest substitute (NEISS injury-surveillance data) is annual aggregate
estimates with no manufacturer names, not the leading-indicator data the spec
wanted. Dropped rather than built against a bot-walled search UI.

## Proprietary data layer

The raw CPSC/SaferProducts.gov data is free and public — the business only
works if we add real structure on top of it. What's built so far:

- **Claude tagging pass** (`scripts/enrichment/tag_recall.py`) — hazard
  categories (often multiple per recall), the specific standard violated,
  product category, retailer channel, and an accurate death/injury count read
  from the narrative text, not CPSC's generic "Risk of Serious Injury or
  Death" title boilerplate.
- **Entity Risk Registry** (`web/src/lib/registry.ts`, `/registry`) —
  normalizes CPSC's inconsistent raw company-name strings so the same company
  groups into one entity instead of splintering into near-duplicates (this
  was a real bug caught during testing — Vive Health's two bed-rail recalls
  were showing as two separate first-time offenders until the name
  normalization was fixed), then tiers each entity Critical/High/Elevated/
  Standard by recall history and severity.
- **Pattern alerts and category baselines** (`web/src/lib/brief.ts`) —
  trailing-90-day cluster counts and repeat-offender detection scoped to a
  subscriber's category, computed live from the tagged data.

- **Plain-language pattern status** (`web/src/lib/brief.ts` `computePatternStatus`)
  — turns raw counts into a layman-readable label (🔴 Active Crackdown / 🟡
  Building Pattern / 🟢 Normal Activity / ⚪ Quiet) by combining recent pace vs.
  the category's historical monthly baseline with whether recent recalls are
  concentrated on one standard. This is both the "enforcement-wave scoring"
  and "category baseline benchmarking" ideas from earlier discussion, merged
  into one signal rather than two separate jargon-heavy numbers.

## Automated ingestion

`web/src/lib/ingest.ts`, triggered hourly by Vercel Cron (`web/vercel.json`,
path `/api/cron/ingest`):

1. Pulls the last 14 days of recalls from the SaferProducts.gov Recall API
   (overlapping window so a missed run or backdated publish never drops a
   recall — upserts on `recall_id` make reprocessing a no-op)
2. Diffs against what's already in Supabase to find genuinely new recalls
3. Tags only the new ones with Claude (same methodology as
   `scripts/enrichment/tag_recall.py`)
4. Upserts into `recalls`

The route is protected by a `CRON_SECRET` bearer token (Vercel sends this
automatically on cron-triggered requests once the env var is set) — verified
it 401s on unauthenticated requests. Needs `ANTHROPIC_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` set as Vercel env vars (already
done for the `cpsc-brief` project). To trigger manually:

```bash
curl https://cpsc-brief.vercel.app/api/cron/ingest -H "Authorization: Bearer $CRON_SECRET"
```

## Layout

- `docs/BUILD_SPEC.md` — full build spec (sources, schema, tagging rules, brief format, MVP category candidates)
- `supabase/migrations/` — knowledge base schema (`recalls`, `standards_calendar`, `entities`, `incident_reports`)
- `scripts/backfill/` — one-time SaferProducts.gov full-history pull, used to pick the MVP category from real base rates
- `scripts/ingestion/` — superseded by `web/src/lib/ingest.ts` + Vercel Cron (see "Automated ingestion" above); kept for the standards-calendar RSS polling that isn't built yet
- `scripts/enrichment/` — the tagging extraction pass (hazard_category, standard_violated, product_category, retailer_channel) and pattern-detection queries (clusters, repeat offenders, countdown watch)
- `web/` — the live brief view + registry + automated ingestion (Next.js, deployed to Vercel as `cpsc-brief`)

## Database

Has its **own** Supabase project — `cpsc-safety-pipeline` (ref `ypxsjarauqenphjpdqsx`,
us-east-2), separate from the `Quo SMS` project linked in the repo's top-level
`supabase/` directory. Already linked in this folder; schema (`0001_init_schema.sql`)
is pushed.

Connection details are in `.env` (gitignored). `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` still need to be filled in from the dashboard:
Project Settings > API — https://supabase.com/dashboard/project/ypxsjarauqenphjpdqsx/settings/api

To push future schema changes:

```bash
cd cpsc-safety-pipeline
supabase db push
```

## Next steps (in build order)

1. ~~Create the Supabase project, run the migration~~ done
2. ~~Write `scripts/backfill/` and pick the MVP category~~ done — dressers/CSUs
3. ~~Build and test the real tagging prompt~~ done, run against all 512 recalls
4. ~~Confirm the SaferProducts.gov Incident Report API endpoint~~ done — no public API exists, dropped
5. ~~Build the weekly brief as a live view~~ done — `/` and `/registry`
6. ~~Build the proprietary layer out further~~ done — plain-language pattern
   status (enforcement-wave + baseline benchmarking merged into one signal)
7. ~~Wire up scheduled ingestion for new recalls~~ done — hourly Vercel Cron,
   no n8n
8. Standards-calendar ingestion (Public Calendar + News Releases RSS) so
   "Countdown watch" stops being a placeholder
9. Customer discovery — get the live brief in front of real small dresser/CSU
   importers and see if anyone will actually pay before building further
