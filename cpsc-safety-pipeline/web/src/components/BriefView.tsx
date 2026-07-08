import { getCategoryBrief, MVP_CATEGORIES, severity, type Recall, type PatternLabel } from "@/lib/brief";

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function severityBadge(s: "High" | "Medium" | "Low") {
  const styles: Record<string, string> = {
    High: "bg-red-100 text-red-800 border-red-300",
    Medium: "bg-amber-100 text-amber-800 border-amber-300",
    Low: "bg-slate-100 text-slate-600 border-slate-300",
  };
  return `inline-block shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold border ${styles[s]}`;
}

const PATTERN_STYLES: Record<PatternLabel, string> = {
  "Active Crackdown": "bg-red-100 text-red-800 border-red-300",
  "Building Pattern": "bg-amber-100 text-amber-800 border-amber-300",
  "Normal Activity": "bg-emerald-100 text-emerald-800 border-emerald-300",
  Quiet: "bg-slate-100 text-slate-600 border-slate-300",
};

function actionFor(
  meta: (typeof MVP_CATEGORIES)[number],
  data: { deathCount: number; standardCounts: [string, number][]; pattern: { label: PatternLabel; topStandard: string | null } }
) {
  const topStandard = data.standardCounts[0];
  if (data.deathCount > 0) {
    return `A confirmed-death recall exists in this category's history. If you sell ${meta.label.toLowerCase()}, check whether your product line has ever been flagged for the same hazard and confirm current compliance with ${meta.standard} before the week is out.`;
  }
  if (data.pattern.label === "Active Crackdown") {
    return `This is an active enforcement wave, not a coincidence. If you sell ${meta.label.toLowerCase()}, re-verify your current SKUs against ${meta.standard} this week — regulators are clearly focused here right now.`;
  }
  if (topStandard) {
    return `${topStandard[1]} recall(s) in the last 90 days cite "${topStandard[0]}." If you sell ${meta.label.toLowerCase()}, re-verify your current SKUs against ${meta.standard} this week.`;
  }
  return `No new recalls in the last 90 days for this category. Use the quiet window to audit your current SKUs against ${meta.standard}.`;
}

function actionUrgency(data: { deathCount: number; pattern: { label: PatternLabel } }): {
  tag: string;
  card: string;
  tagStyle: string;
} {
  if (data.deathCount > 0) {
    return { tag: "Urgent", card: "bg-red-50 border-red-300", tagStyle: "bg-red-600 text-white" };
  }
  if (data.pattern.label === "Active Crackdown") {
    return { tag: "Time-sensitive", card: "bg-orange-50 border-orange-300", tagStyle: "bg-orange-600 text-white" };
  }
  if (data.pattern.label === "Building Pattern") {
    return { tag: "Worth doing", card: "bg-amber-50 border-amber-300", tagStyle: "bg-amber-600 text-white" };
  }
  return { tag: "Routine check", card: "bg-blue-50 border-blue-200", tagStyle: "bg-blue-600 text-white" };
}

export default async function BriefView({ category }: { category: string }) {
  const meta = MVP_CATEGORIES.find((c) => c.key === category) ?? MVP_CATEGORIES[0];
  const data = await getCategoryBrief(category);
  const action = actionFor(meta, data);
  const urgency = actionUrgency(data);

  return (
    <>
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Weekly Brief</div>
        <h1 className="text-2xl font-bold mt-1 text-slate-900">{meta.label}</h1>
        <p className="text-slate-600 mt-1 text-sm">
          {data.totalCount} recalls on record · {meta.standard}
        </p>
      </header>

      <section className="mb-10">
        <div className={`border-2 rounded-xl p-5 ${urgency.card}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${urgency.tagStyle}`}>
              {urgency.tag}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Do this this week</span>
          </div>
          <p className="text-lg font-medium text-slate-900 leading-snug">{action}</p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3 text-slate-900">Why</h2>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-semibold border ${PATTERN_STYLES[data.pattern.label]}`}
            >
              <span>{data.pattern.emoji}</span>
              {data.pattern.label}
            </span>
          </div>
          <p className="text-sm text-slate-700">{data.pattern.headline}</p>

          {data.standardCounts.length > 0 && (
            <details className="mt-3 pt-3 border-t border-slate-100">
              <summary className="text-sm font-medium text-slate-700 cursor-pointer">
                What&rsquo;s behind this (last 90 days)
              </summary>
              <ul className="mt-2 text-sm text-slate-600 list-disc list-inside">
                {data.standardCounts.map(([std, n]) => (
                  <li key={std}>
                    {n}x citing &ldquo;{std}&rdquo;
                  </li>
                ))}
              </ul>
            </details>
          )}
          {data.repeatOffenders.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <div className="text-sm font-medium text-slate-700">Repeat offenders (2+ recalls, all-time)</div>
              <ul className="mt-1 text-sm text-slate-600 list-disc list-inside">
                {data.repeatOffenders.slice(0, 5).map(([name, n]) => (
                  <li key={name}>
                    {name} — {n} recalls
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3 text-slate-900">Countdown watch</h2>
        <div className="bg-white border border-slate-200 rounded-lg p-4 text-sm text-slate-500">
          Not tracked yet — standards-calendar ingestion (CPSC Public Calendar + News Releases RSS) hasn&rsquo;t
          been built. See BUILD_SPEC.md Section 2.
        </div>
      </section>

      <details className="mb-12 group">
        <summary className="text-lg font-semibold text-slate-900 cursor-pointer list-none flex items-center gap-2 select-none">
          <span className="text-slate-400 text-sm transition-transform group-open:rotate-90">▶</span>
          This week&rsquo;s hits
          <span className="text-sm font-normal text-slate-400">
            ({data.recalls.length} recall{data.recalls.length === 1 ? "" : "s"} — click to expand)
          </span>
        </summary>
        <div className="space-y-3 mt-3">
          {data.recalls.slice(0, 10).map((r: Recall) => {
            const s = severity(r);
            return (
              <a
                key={r.recall_id}
                href={r.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="block bg-white border border-slate-200 rounded-lg p-4 hover:border-slate-300 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium text-slate-900">{r.title}</div>
                  <span className={severityBadge(s)}>{s}</span>
                </div>
                <div className="text-sm text-slate-500 mt-1">
                  {fmtDate(r.recall_date)} · {r.manufacturer || "unknown manufacturer"} ·{" "}
                  {r.retailer_channel || "unknown channel"}
                  {r.units_affected ? ` · ${r.units_affected.toLocaleString()} units` : ""}
                </div>
              </a>
            );
          })}
          {data.recalls.length === 0 && (
            <div className="text-slate-500 text-sm">No recalls on record yet for this category.</div>
          )}
        </div>
      </details>
    </>
  );
}
