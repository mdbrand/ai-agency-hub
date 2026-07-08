/**
 * Scheduled ingestion: poll SaferProducts.gov for recalls published since the
 * last run, tag genuinely new ones with Claude (same methodology as
 * scripts/enrichment/tag_recall.py), and upsert into `recalls`. Triggered by
 * Vercel Cron (see ../../vercel.json) hitting /api/cron/ingest.
 *
 * CPSC has no push/webhook mechanism -- polling on a schedule is the closest
 * available approximation of "refreshed anytime something is published."
 */

const RECALL_API = "https://www.saferproducts.gov/RestWebServices/Recall";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

// Overlaps well past the cron interval so a missed run or CPSC backdating a
// publish date never silently drops a recall -- upserts on recall_id make
// re-processing already-known recalls a no-op.
const LOOKBACK_DAYS = 14;

interface RawRecall {
  RecallNumber: number;
  RecallDate?: string;
  Title?: string;
  URL?: string;
  Products?: { NumberOfUnits?: string }[];
  Injuries?: { Name?: string }[];
  Manufacturers?: { Name?: string }[];
  Importers?: { Name?: string }[];
  Retailers?: { Name?: string }[];
  ManufacturerCountries?: { Country?: string }[];
  Hazards?: { Name?: string }[];
  RemedyOptions?: { Option?: string }[];
}

const TAG_TOOL = {
  name: "tag_recall",
  description:
    "Extract structured safety tags from a CPSC recall record. Only use information present in the supplied text -- do not infer facts that aren't stated.",
  input_schema: {
    type: "object",
    properties: {
      hazard_categories: {
        type: "array",
        description:
          "ALL hazards named in the text, not just the first one -- e.g. STURDY Act dresser recalls virtually always cite both 'tip-over' and 'entrapment' together, not one or the other.",
        items: {
          type: "string",
          enum: [
            "tip-over", "entrapment", "choking", "battery-ingestion", "drowning", "burn", "fire",
            "laceration", "fall", "electric-shock", "strangulation", "poisoning", "suffocation", "crash", "other",
          ],
        },
        minItems: 1,
      },
      standard_violated: {
        type: "string",
        description:
          "The specific mandatory/voluntary standard named in the text, e.g. 'Clothing Storage Units (STURDY Act)', 'VGBA', 'Toy Standard — magnets', \"Toy Standard — battery/Reese's Law\", 'Bicycle Helmets', 'Adult Portable Bed Rails'. Empty string if none is named.",
      },
      product_category: {
        type: "string",
        description:
          "Short product-type label. Use 'dresser/CSU', 'pool_drain_cover', 'bed_rail', or 'toy_battery' when it matches one of those; otherwise a short freeform label (e.g. 'stroller', 'space heater').",
      },
      retailer_channel: {
        type: "string",
        enum: ["Amazon", "Walmart", "Costco", "Target", "Home Depot", "Wayfair", "other", "unknown"],
      },
      death_count: {
        type: "integer",
        description:
          "Deaths ACTUALLY reported in the injury narrative. CPSC recall titles all carry boilerplate 'Risk of Serious Injury or Death' regardless of outcome -- ignore that phrase entirely and only count deaths the narrative states really happened. 0 if none reported.",
      },
      injury_count: {
        type: ["integer", "null"],
        description: "Injuries actually reported as a number in the narrative, or null if not stated as a number.",
      },
    },
    required: ["hazard_categories", "standard_violated", "product_category", "retailer_channel", "death_count", "injury_count"],
  },
};

function joinNames(items: { Name?: string }[] | undefined): string {
  return (items ?? []).map((i) => i.Name).filter(Boolean).join("; ");
}

function parseUnits(products: { NumberOfUnits?: string }[] | undefined): number | null {
  let total = 0;
  let found = false;
  for (const p of products ?? []) {
    const m = (p.NumberOfUnits ?? "").match(/([\d,]+)/);
    if (m) {
      total += parseInt(m[1].replace(/,/g, ""), 10);
      found = true;
    }
  }
  return found ? total : null;
}

async function fetchRecentRecalls(): Promise<RawRecall[]> {
  const end = new Date();
  const start = new Date(end.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = `${RECALL_API}?format=json&RecallDateStart=${fmt(start)}&RecallDateEnd=${fmt(end)}`;
  const res = await fetch(url, { headers: { "User-Agent": "cpsc-safety-pipeline-ingest/0.1" } });
  if (!res.ok) throw new Error(`Recall API fetch failed: ${res.status}`);
  return res.json();
}

async function getKnownRecallIds(supabaseUrl: string, serviceKey: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const inList = ids.map((id) => `"${id}"`).join(",");
  const res = await fetch(`${supabaseUrl}/rest/v1/recalls?select=recall_id&recall_id=in.(${inList})`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) throw new Error(`Supabase lookup failed: ${res.status}`);
  const rows: { recall_id: string }[] = await res.json();
  return new Set(rows.map((r) => r.recall_id));
}

async function tagWithClaude(apiKey: string, record: RawRecall) {
  const hazardText = joinNames(record.Hazards);
  const injuryNarrative = joinNames(record.Injuries);
  const retailers = joinNames(record.Retailers) || "(not stated)";
  const prompt = [
    `Title: ${record.Title ?? ""}`,
    `Hazard text: ${hazardText || "(none)"}`,
    `Injury narrative: ${injuryNarrative || "(none reported)"}`,
    `Sold at / retailers: ${retailers}`,
  ].join("\n");

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      tools: [TAG_TOOL],
      tool_choice: { type: "tool", name: "tag_recall" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude tagging failed: ${res.status} ${await res.text()}`);
  const result = await res.json();
  const block = result.content.find((b: { type: string }) => b.type === "tool_use");
  if (!block) throw new Error("no tool_use block in Claude response");
  return { ...block.input, hazardText, injuryNarrative } as {
    hazard_categories: string[];
    standard_violated: string;
    product_category: string;
    retailer_channel: string;
    death_count: number;
    injury_count: number | null;
    hazardText: string;
    injuryNarrative: string;
  };
}

async function upsertRecalls(supabaseUrl: string, serviceKey: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const res = await fetch(`${supabaseUrl}/rest/v1/recalls`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert failed: ${res.status} ${await res.text()}`);
}

export interface IngestResult {
  fetched: number;
  new: number;
  tagged: string[];
  errors: string[];
}

export async function runIngest(): Promise<IngestResult> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anthropicKey = process.env.ANTHROPIC_API_KEY!;

  const recent = await fetchRecentRecalls();
  const knownIds = await getKnownRecallIds(supabaseUrl, serviceKey, recent.map((r) => String(r.RecallNumber)));
  const fresh = recent.filter((r) => !knownIds.has(String(r.RecallNumber)));

  const rows: Record<string, unknown>[] = [];
  const tagged: string[] = [];
  const errors: string[] = [];

  for (const record of fresh) {
    try {
      const tags = await tagWithClaude(anthropicKey, record);
      rows.push({
        recall_id: String(record.RecallNumber),
        recall_date: (record.RecallDate ?? "").slice(0, 10) || null,
        title: record.Title ?? "",
        url: record.URL ?? null,
        hazard_text: tags.hazardText || null,
        hazard_category: tags.hazard_categories.join(","),
        standard_violated: tags.standard_violated,
        product_category: tags.product_category || "other",
        units_affected: parseUnits(record.Products),
        injury_count: tags.injury_count,
        death_count: tags.death_count,
        injury_narrative: tags.injuryNarrative || null,
        remedy_type: joinNames((record.RemedyOptions ?? []).map((r) => ({ Name: r.Option }))) || null,
        manufacturer: joinNames(record.Manufacturers) || null,
        importer: joinNames(record.Importers) || null,
        retailer_channel: tags.retailer_channel,
        country_of_manufacture: joinNames((record.ManufacturerCountries ?? []).map((c) => ({ Name: c.Country }))) || null,
        raw_json: record,
      });
      tagged.push(String(record.RecallNumber));
    } catch (e) {
      errors.push(`${record.RecallNumber}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await upsertRecalls(supabaseUrl, serviceKey, rows);

  return { fetched: recent.length, new: fresh.length, tagged, errors };
}
