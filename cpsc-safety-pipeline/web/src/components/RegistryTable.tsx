"use client";

import { useMemo, useState } from "react";
import type { EntityProfile, RiskTier } from "@/lib/registry";

const TIER_STYLES: Record<RiskTier, string> = {
  Critical: "bg-red-100 text-red-800 border-red-300",
  High: "bg-orange-100 text-orange-800 border-orange-300",
  Elevated: "bg-amber-100 text-amber-800 border-amber-300",
  Standard: "bg-slate-100 text-slate-600 border-slate-300",
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function RegistryTable({ profiles }: { profiles: EntityProfile[] }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<RiskTier | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles.filter((p) => {
      if (tierFilter !== "all" && p.tier !== tierFilter) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [profiles, query, tierFilter]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search manufacturer or importer…"
          className="flex-1 min-w-[200px] border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
        />
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value as RiskTier | "all")}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="all">All tiers</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Elevated">Elevated</option>
          <option value="Standard">Standard</option>
        </select>
      </div>

      <div className="text-sm text-slate-500 mb-2">
        {filtered.length} of {profiles.length} entities
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
        <div className="grid grid-cols-[1fr_90px_70px_1fr_110px] gap-2 px-4 py-2 text-xs font-semibold text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
          <div>Entity</div>
          <div>Tier</div>
          <div>Recalls</div>
          <div>Categories</div>
          <div>Last recall</div>
        </div>
        {filtered.map((p) => (
          <div key={p.name} className="border-b border-slate-100 last:border-b-0">
            <button
              onClick={() => setExpanded(expanded === p.name ? null : p.name)}
              className="w-full text-left grid grid-cols-[1fr_90px_70px_1fr_110px] gap-2 px-4 py-3 text-sm hover:bg-slate-50 transition"
            >
              <div className="font-medium text-slate-900 truncate">{p.name}</div>
              <div>
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${TIER_STYLES[p.tier]}`}>
                  {p.tier}
                </span>
              </div>
              <div className="text-slate-600">{p.recallCount}</div>
              <div className="text-slate-500 truncate text-xs">{p.categories.join(", ") || "—"}</div>
              <div className="text-slate-500 text-xs">{fmtDate(p.lastSeen)}</div>
            </button>
            {expanded === p.name && (
              <div className="px-4 pb-3 space-y-1.5">
                {p.recalls.map((r) => (
                  <a
                    key={r.recall_id}
                    href={r.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-sm px-3 py-2 rounded bg-slate-50 hover:bg-slate-100 transition"
                  >
                    <span className="text-slate-800">{r.title}</span>
                    <span className="text-slate-400 text-xs block mt-0.5">
                      {fmtDate(r.recall_date)} · {r.product_category || "other"}
                      {r.death_count > 0 ? " · confirmed death(s)" : ""}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">No entities match.</div>
        )}
      </div>
    </div>
  );
}
