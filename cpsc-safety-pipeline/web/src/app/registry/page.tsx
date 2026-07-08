import { getEntityRegistry } from "@/lib/registry";
import RegistryTable from "@/components/RegistryTable";
import TopNav from "@/components/TopNav";

export const revalidate = 0;

export default async function RegistryPage() {
  const profiles = await getEntityRegistry();
  const critical = profiles.filter((p) => p.tier === "Critical").length;
  const high = profiles.filter((p) => p.tier === "High").length;
  const repeatOffenders = profiles.filter((p) => p.recallCount >= 2).length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <TopNav current="registry" />

      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Entity Risk Registry</h1>
        <p className="text-slate-600 mt-1 text-sm">
          {profiles.length} manufacturers/importers on record · {repeatOffenders} repeat offenders ·{" "}
          {critical} Critical · {high} High
        </p>
      </header>

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6 text-sm text-slate-600">
        <span className="font-semibold text-slate-800">Methodology: </span>
        <span className="text-red-700 font-medium">Critical</span> = at least one recall involved a reported
        death. <span className="text-orange-700 font-medium">High</span> = 3+ recalls all-time, or 2+ with at
        least one injury. <span className="text-amber-700 font-medium">Elevated</span> = 2 recalls, no
        confirmed injury. <span className="text-slate-500 font-medium">Standard</span> = 1 recall on record.
        Cross-category recalls count toward the same entity — a company flagged in dressers and toys shows up
        once with both categories listed.
      </div>

      <RegistryTable profiles={profiles} />

      <footer className="text-xs text-slate-400 border-t border-slate-200 pt-4 pb-8 mt-8">
        Data: CPSC / SaferProducts.gov, entity names normalized and tagged by Claude. Internal preview.
      </footer>
    </div>
  );
}
