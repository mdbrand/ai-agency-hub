import Link from "next/link";
import type { Metadata } from "next";
import { MVP_CATEGORIES } from "@/lib/brief";
import BriefView from "@/components/BriefView";

export const revalidate = 0;
export const metadata: Metadata = { robots: { index: false, follow: false } };

// Internal-only: compare all 4 MVP candidate categories side by side. This is
// NOT customer-facing -- the public site (/) is scoped to dressers/CSU only,
// the one locked product. This page exists so Rob can keep an eye on the
// other 3 candidates and decide if/when one becomes product #2, without
// implying to a customer that this is a multi-category platform today.
export default async function InternalPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const params = await searchParams;
  const category = params.category || MVP_CATEGORIES[0].key;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-6">
        <div className="text-xs uppercase tracking-wide text-amber-600 font-semibold">
          Internal only — category comparison, not customer-facing
        </div>
        <Link href="/" className="text-sm font-medium text-slate-500 hover:text-slate-900 transition">
          ← Public site
        </Link>
      </div>

      <nav className="flex flex-wrap gap-2 mb-8">
        {MVP_CATEGORIES.map((c) => (
          <Link
            key={c.key}
            href={`/internal?category=${encodeURIComponent(c.key)}`}
            className={`px-3 py-1.5 rounded-full text-sm border transition ${
              c.key === category
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
            }`}
          >
            {c.label}
            {c.key === MVP_CATEGORIES[0].key && (
              <span className="ml-1.5 text-xs opacity-60">(live product)</span>
            )}
          </Link>
        ))}
      </nav>

      <BriefView category={category} />

      <footer className="text-xs text-slate-400 border-t border-slate-200 pt-4 pb-8">
        Internal comparison view. Only {MVP_CATEGORIES[0].label} is sold today.
      </footer>
    </div>
  );
}
