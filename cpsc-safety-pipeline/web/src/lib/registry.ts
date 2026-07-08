import { sbGet } from "./supabase";
import { splitNames } from "./brief";

export interface EntityRecall {
  recall_id: string;
  recall_date: string | null;
  title: string;
  url: string | null;
  product_category: string | null;
  death_count: number;
  injury_count: number | null;
}

export type RiskTier = "Critical" | "High" | "Elevated" | "Standard";

export interface EntityProfile {
  name: string;
  tier: RiskTier;
  recallCount: number;
  categories: string[];
  firstSeen: string | null;
  lastSeen: string | null;
  hasDeath: boolean;
  hasInjury: boolean;
  recalls: EntityRecall[];
}

/**
 * Tier methodology (shown to customers verbatim -- keep this in sync with any
 * copy on the registry page):
 *   Critical  -- at least one of their recalls involved a reported death
 *   High      -- 3+ recalls all-time, or 2+ recalls with at least one injury
 *   Elevated  -- 2 recalls all-time (repeat offender, no confirmed injury)
 *   Standard  -- 1 recall on record
 */
function tierFor(recallCount: number, hasDeath: boolean, hasInjury: boolean): RiskTier {
  if (hasDeath) return "Critical";
  if (recallCount >= 3 || (recallCount >= 2 && hasInjury)) return "High";
  if (recallCount >= 2) return "Elevated";
  return "Standard";
}

const TIER_RANK: Record<RiskTier, number> = { Critical: 3, High: 2, Elevated: 1, Standard: 0 };

/**
 * CPSC's raw company names carry a trailing ", of <city>, <state/country>"
 * location suffix that varies between recalls for the SAME company -- typos
 * ("of of Naples Florida" vs "of Naples, Florida"), missing commas, etc. Strip
 * it so the same company groups into one entity instead of splintering into
 * near-duplicates that each look like a first-time offender.
 */
function normalizeName(name: string): string {
  return name.replace(/,?\s+of(\s+of)?\s+[A-Za-z.,'\s]+$/i, "").trim();
}

const FIELDS =
  "recall_id,recall_date,title,url,product_category,manufacturer,importer,death_count,injury_count";

export async function getEntityRegistry(): Promise<EntityProfile[]> {
  const recalls = await sbGet<
    (EntityRecall & { manufacturer: string | null; importer: string | null })[]
  >("recalls", { select: FIELDS, order: "recall_date.desc" });

  const byName = new Map<
    string,
    { categories: Set<string>; dates: string[]; recalls: EntityRecall[] }
  >();

  for (const r of recalls) {
    const names = [...splitNames(r.manufacturer), ...splitNames(r.importer)];
    const entry: EntityRecall = {
      recall_id: r.recall_id,
      recall_date: r.recall_date,
      title: r.title,
      url: r.url,
      product_category: r.product_category,
      death_count: r.death_count,
      injury_count: r.injury_count,
    };
    const normalized = new Set(names.map(normalizeName).filter(Boolean));
    for (const name of normalized) {
      if (!byName.has(name)) {
        byName.set(name, { categories: new Set(), dates: [], recalls: [] });
      }
      const bucket = byName.get(name)!;
      if (r.product_category) bucket.categories.add(r.product_category);
      if (r.recall_date) bucket.dates.push(r.recall_date);
      bucket.recalls.push(entry);
    }
  }

  const profiles: EntityProfile[] = [];
  for (const [name, bucket] of byName) {
    const hasDeath = bucket.recalls.some((r) => r.death_count > 0);
    const hasInjury = bucket.recalls.some((r) => (r.injury_count ?? 0) > 0);
    const sortedDates = [...bucket.dates].sort();
    profiles.push({
      name,
      tier: tierFor(bucket.recalls.length, hasDeath, hasInjury),
      recallCount: bucket.recalls.length,
      categories: [...bucket.categories].sort(),
      firstSeen: sortedDates[0] ?? null,
      lastSeen: sortedDates[sortedDates.length - 1] ?? null,
      hasDeath,
      hasInjury,
      recalls: bucket.recalls,
    });
  }

  profiles.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.recallCount - a.recallCount || a.name.localeCompare(b.name));
  return profiles;
}
