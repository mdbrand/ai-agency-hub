import { Job } from "./types";

const BOARD_ID = process.env.MONDAY_BOARD_ID || "736219870";
const API_URL = "https://api.monday.com/v2";

const COLUMN_IDS = [
  "person",
  "status",
  "timeline",
  "location",
  "text3",
  "job_type",
  "phone",
  "text0",
];

interface ColumnValue {
  id: string;
  text: string | null;
  value: string | null;
}

interface RawItem {
  id: string;
  name: string;
  column_values: ColumnValue[];
}

function col(item: RawItem, id: string): ColumnValue | undefined {
  return item.column_values.find((c) => c.id === id);
}

function parseTimeline(item: RawItem): { start: string | null; end: string | null } {
  const tl = col(item, "timeline");
  if (!tl?.value) return { start: null, end: null };
  try {
    const parsed = JSON.parse(tl.value);
    return { start: parsed.from ?? null, end: parsed.to ?? null };
  } catch {
    return { start: null, end: null };
  }
}

async function fetchPage(cursor: string | null): Promise<{ items: RawItem[]; cursor: string | null }> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    throw new Error("MONDAY_API_TOKEN is not set");
  }

  const query = `
    query ($boardId: ID!, $cursor: String, $columnIds: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: 100, cursor: $cursor) {
          cursor
          items {
            id
            name
            column_values(ids: $columnIds) {
              id
              text
              value
            }
          }
        }
      }
    }
  `;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      "API-Version": "2024-10",
    },
    body: JSON.stringify({
      query,
      variables: { boardId: BOARD_ID, cursor, columnIds: COLUMN_IDS },
    }),
    // Always hit Monday live — caller decides how the response is cached.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Monday API error: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Monday API GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  const page = json.data?.boards?.[0]?.items_page;
  return { items: page?.items ?? [], cursor: page?.cursor ?? null };
}

export async function fetchAllJobs(): Promise<Job[]> {
  const jobs: Job[] = [];
  let cursor: string | null = null;

  do {
    const page = await fetchPage(cursor);
    for (const item of page.items) {
      const { start, end } = parseTimeline(item);
      jobs.push({
        id: item.id,
        code: item.name,
        customer: col(item, "text3")?.text || item.name,
        address: col(item, "location")?.text || "",
        crewLeader: col(item, "person")?.text || null,
        crewSize: null,
        phone: col(item, "phone")?.text || null,
        email: col(item, "text0")?.text || null,
        jobType: col(item, "job_type")?.text || null,
        status: col(item, "status")?.text || "Unknown",
        startDate: start,
        endDate: end,
        lat: null,
        lng: null,
      });
    }
    cursor = page.cursor;
  } while (cursor);

  return jobs;
}
