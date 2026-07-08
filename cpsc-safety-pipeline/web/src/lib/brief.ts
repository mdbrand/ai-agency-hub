import { sbGet } from "./supabase";

export interface Recall {
  recall_id: string;
  recall_date: string | null;
  title: string;
  url: string | null;
  hazard_category: string | null;
  standard_violated: string | null;
  product_category: string | null;
  units_affected: number | null;
  injury_count: number | null;
  death_count: number;
  manufacturer: string | null;
  importer: string | null;
  retailer_channel: string | null;
}

export const MVP_CATEGORIES = [
  { key: "dresser/CSU", label: "Dressers / Clothing Storage Units", standard: "STURDY Act" },
  { key: "bed_rail", label: "Adult Portable Bed Rails", standard: "16 CFR 1284 (Adult Portable Bed Rails)" },
  { key: "toy_battery", label: "Battery-Ingestion Toys", standard: "Reese's Law" },
  { key: "pool_drain_cover", label: "Pool / Spa Drain Covers", standard: "VGBA" },
] as const;

export type CategoryKey = (typeof MVP_CATEGORIES)[number]["key"];

export function severity(r: Recall): "High" | "Medium" | "Low" {
  if (r.death_count > 0) return "High";
  if ((r.injury_count ?? 0) > 0) return "Medium";
  if ((r.units_affected ?? 0) >= 5000) return "Medium";
  return "Low";
}

export function splitNames(field: string | null): string[] {
  return (field ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const RECALL_FIELDS =
  "recall_id,recall_date,title,url,hazard_category,standard_violated,product_category,units_affected,injury_count,death_count,manufacturer,importer,retailer_channel";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PatternLabel = "Active Crackdown" | "Building Pattern" | "Normal Activity" | "Quiet";

export interface PatternStatus {
  label: PatternLabel;
  emoji: string;
  headline: string;
  monthlyBaseline: number;
  last30Count: number;
  topStandard: string | null;
  topStandardShare: number; // 0-1, share of last-90-day recalls citing topStandard
}

/**
 * Plain-language read on "is something unusual happening right now" for a
 * category, built from two real signals a layman can't eyeball from a list of
 * recalls: (1) is the recent PACE above the historical monthly average, and
 * (2) are recent recalls CONCENTRATED on one standard/cause rather than
 * scattered. Both together = an active enforcement wave, not noise.
 */
function computePatternStatus(recalls: Recall[], last90: Recall[], standardCounts: [string, number][]): PatternStatus {
  const datedRecalls = recalls.filter((r) => r.recall_date);
  const oldest = datedRecalls.length
    ? Math.min(...datedRecalls.map((r) => new Date(r.recall_date!).getTime()))
    : Date.now();
  const monthsSpan = Math.max(1, (Date.now() - oldest) / (30 * DAY_MS));
  const monthlyBaseline = recalls.length / monthsSpan;

  const thirtyDaysAgo = Date.now() - 30 * DAY_MS;
  const last30Count = recalls.filter((r) => r.recall_date && new Date(r.recall_date).getTime() >= thirtyDaysAgo).length;

  const topEntry = standardCounts[0];
  const topStandard = topEntry ? topEntry[0] : null;
  const topStandardShare = last90.length > 0 && topEntry ? topEntry[1] / last90.length : 0;

  const pace = monthlyBaseline > 0 ? last30Count / monthlyBaseline : last30Count > 0 ? 2 : 0;
  const isAccelerating = pace >= 1.5;
  const isConcentrated = topStandardShare >= 0.6 && last90.length >= 2;
  const baselineTxt = monthlyBaseline.toFixed(1);

  if (last90.length === 0) {
    return {
      label: "Quiet",
      emoji: "⚪",
      headline: `Quiet stretch — no recalls here in the last 90 days (this category typically sees about ${baselineTxt}/month).`,
      monthlyBaseline,
      last30Count,
      topStandard,
      topStandardShare,
    };
  }

  if (isAccelerating && isConcentrated) {
    return {
      label: "Active Crackdown",
      emoji: "🔴",
      headline: `This category is in an active enforcement wave: ${last30Count} recall(s) in the last 30 days (typical pace is ~${baselineTxt}/month), and ${Math.round(topStandardShare * 100)}% of recent recalls cite the same standard — "${topStandard}." This isn't random, it's a targeted crackdown.`,
      monthlyBaseline,
      last30Count,
      topStandard,
      topStandardShare,
    };
  }

  if (isAccelerating || isConcentrated) {
    const headline = isAccelerating
      ? `More activity than usual: ${last30Count} recall(s) in the last 30 days vs. a typical ${baselineTxt}/month. Worth watching.`
      : `${Math.round(topStandardShare * 100)}% of recent recalls cite the same standard — "${topStandard}." Pace is normal, but this is a tight cluster worth watching.`;
    return { label: "Building Pattern", emoji: "🟡", headline, monthlyBaseline, last30Count, topStandard, topStandardShare };
  }

  if (pace <= 0.5) {
    return {
      label: "Quiet",
      emoji: "⚪",
      headline: `Quieter than usual — ${last30Count} recall(s) in the last 30 days vs. a typical ${baselineTxt}/month.`,
      monthlyBaseline,
      last30Count,
      topStandard,
      topStandardShare,
    };
  }

  return {
    label: "Normal Activity",
    emoji: "🟢",
    headline: `Nothing unusual right now — recall activity is in line with the yearly average (~${baselineTxt}/month).`,
    monthlyBaseline,
    last30Count,
    topStandard,
    topStandardShare,
  };
}

export async function getCategoryBrief(category: string) {
  const recalls = await sbGet<Recall[]>("recalls", {
    select: RECALL_FIELDS,
    product_category: `eq.${category}`,
    order: "recall_date.desc",
  });

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const last90 = recalls.filter((r) => r.recall_date && new Date(r.recall_date) >= ninetyDaysAgo);

  const standardCounts = new Map<string, number>();
  for (const r of last90) {
    const std = r.standard_violated || "(no standard named)";
    standardCounts.set(std, (standardCounts.get(std) ?? 0) + 1);
  }

  const entityCounts = new Map<string, number>();
  for (const r of recalls) {
    for (const name of [...splitNames(r.manufacturer), ...splitNames(r.importer)]) {
      entityCounts.set(name, (entityCounts.get(name) ?? 0) + 1);
    }
  }
  const repeatOffenders = [...entityCounts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1]);

  const sortedStandardCounts = [...standardCounts.entries()].sort((a, b) => b[1] - a[1]);

  return {
    category,
    recalls,
    last90Count: last90.length,
    standardCounts: sortedStandardCounts,
    repeatOffenders,
    deathCount: recalls.filter((r) => r.death_count > 0).length,
    totalCount: recalls.length,
    pattern: computePatternStatus(recalls, last90, sortedStandardCounts),
  };
}
