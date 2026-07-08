import { NextRequest, NextResponse } from "next/server";
import { fetchAllJobs } from "@/lib/monday";
import { geocodeAddress } from "@/lib/geocode";
import crewSizesRaw from "../../../../data/crew-sizes.json";

const crewSizes: Record<string, number | null> = crewSizesRaw as unknown as Record<
  string,
  number | null
>;

const DONE_STATUSES = new Set(["Done"]);
const EXCLUDED_STATUSES = new Set(["Cancelled"]);

function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59));
  return { start, end };
}

function overlaps(jobStart: string | null, jobEnd: string | null, rangeStart: Date, rangeEnd: Date): boolean {
  if (!jobStart) return false;
  const s = new Date(jobStart);
  const e = jobEnd ? new Date(jobEnd) : s;
  return s <= rangeEnd && e >= rangeStart;
}

function inRange(dateStr: string | null, rangeStart: Date, rangeEnd: Date): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= rangeStart && d <= rangeEnd;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const statusFilter = searchParams.get("status") || "all"; // all | active | completed

  let jobs;
  try {
    jobs = await fetchAllJobs();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch jobs from Monday.com" },
      { status: 500 }
    );
  }

  const { start, end } = monthRange(month);

  const filtered = jobs.filter((job) => {
    if (EXCLUDED_STATUSES.has(job.status)) return false;

    const isDone = DONE_STATUSES.has(job.status);
    if (statusFilter === "active" && isDone) return false;
    if (statusFilter === "completed" && !isDone) return false;

    // Completed jobs are pinned to the month they actually finished in
    // (their end date), not every month their timeline happened to touch.
    // Active jobs use overlap, since "active this month" means in progress
    // at any point during it.
    if (isDone) return inRange(job.endDate, start, end);
    return overlaps(job.startDate, job.endDate, start, end);
  });

  const withDetails = await Promise.all(
    filtered.map(async (job) => {
      const coords = await geocodeAddress(job.address);
      return {
        ...job,
        crewSize: job.crewLeader ? crewSizes[job.crewLeader] ?? null : null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      };
    })
  );

  return NextResponse.json({ month, jobs: withDetails });
}
