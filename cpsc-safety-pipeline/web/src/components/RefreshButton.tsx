"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [summary, setSummary] = useState<string | null>(null);

  async function handleClick() {
    setState("loading");
    setSummary(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "refresh failed");
      setSummary(data.new > 0 ? `+${data.new} new` : "up to date");
      setState("done");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={state === "loading"}
      className="text-sm font-medium text-slate-500 hover:text-slate-900 transition disabled:opacity-50 disabled:cursor-wait"
      title="Check CPSC for new recalls right now (also runs automatically every hour)"
    >
      {state === "loading" ? "Checking…" : state === "done" ? `Refreshed (${summary})` : state === "error" ? "Refresh failed" : "↻ Refresh now"}
    </button>
  );
}
