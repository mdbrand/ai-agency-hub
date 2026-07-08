import { NextResponse } from "next/server";
import { runIngest } from "@/lib/ingest";

export const maxDuration = 60;

// Manual trigger for the same ingestion the hourly cron runs (see
// /api/cron/ingest). No secret required -- it's idempotent (upserts on
// recall_id) and costs at most a few cents in Claude calls even if spammed,
// since it only tags genuinely new recalls.
export async function POST() {
  try {
    const result = await runIngest();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
