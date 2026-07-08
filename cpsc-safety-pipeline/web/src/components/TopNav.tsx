import Link from "next/link";
import RefreshButton from "./RefreshButton";

export default function TopNav({ current }: { current: "brief" | "registry" }) {
  const linkClass = (active: boolean) =>
    `text-sm font-medium transition ${active ? "text-slate-900" : "text-slate-500 hover:text-slate-900"}`;

  return (
    <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-6">
      <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
        CPSC Product-Safety Intelligence
      </div>
      <nav className="flex items-center gap-5">
        <Link href="/" className={linkClass(current === "brief")}>
          Weekly Brief
        </Link>
        <Link href="/registry" className={linkClass(current === "registry")}>
          Entity Risk Registry
        </Link>
        <RefreshButton />
      </nav>
    </div>
  );
}
