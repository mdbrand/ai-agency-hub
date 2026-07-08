import { MVP_CATEGORIES } from "@/lib/brief";
import TopNav from "@/components/TopNav";
import BriefView from "@/components/BriefView";

export const revalidate = 0;

// The public site is scoped to the one locked MVP category (dressers/CSU) --
// no category switcher. This is the actual product being sold; the other 3
// candidate categories are comparison data for internal use, not additional
// products on offer. See /internal for the cross-category view.
export default async function Page() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <TopNav current="brief" />

      <BriefView category={MVP_CATEGORIES[0].key} />

      <footer className="text-xs text-slate-400 border-t border-slate-200 pt-4 pb-8">
        Data: CPSC / SaferProducts.gov, tagged by Claude. Internal preview — not the final subscriber-facing
        design.
      </footer>
    </div>
  );
}
