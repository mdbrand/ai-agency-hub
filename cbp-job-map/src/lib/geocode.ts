import fs from "fs";
import path from "path";

const CACHE_PATH = path.join(process.cwd(), "data", "geocode-cache.json");

type Coords = { lat: number; lng: number } | null;

let cache: Record<string, Coords> | null = null;

function loadCache(): Record<string, Coords> {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    cache = {};
  }
  return cache!;
}

function persistCache() {
  // Only useful in local dev — Vercel's filesystem is read-only at runtime,
  // so in production this is a no-op that fails silently and we fall back
  // to in-memory memoization for the life of the warm lambda instance.
  if (process.env.NODE_ENV !== "development") return;
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // ignore
  }
}

function normalize(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

// US Census geocoder — primary lookup. Free, no API key, full US house-number
// coverage, and tolerant of minor misspellings (it fuzzy-matches street and
// city names, e.g. "Redonod Beach" -> "Redondo Beach"). US addresses only.
async function censusLookup(address: string): Promise<Coords> {
  const params = new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    format: "json",
  });
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "cbp-job-map/1.0 (internal job-tracking map)" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const match = data?.result?.addressMatches?.[0];
    if (!match) return null;
    // Census returns x = longitude, y = latitude.
    return { lat: match.coordinates.y, lng: match.coordinates.x };
  } catch {
    return null;
  }
}

let lastRequestAt = 0;

async function nominatimLookup(address: string): Promise<Coords> {
  // Nominatim's usage policy caps free usage at ~1 req/sec and requires a
  // descriptive User-Agent. We throttle here since cache misses should be rare.
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastRequestAt = Date.now();

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    address
  )}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "cbp-job-map/1.0 (internal job-tracking map)",
    },
  });

  if (!res.ok) return null;

  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) return null;

  const { lat, lon } = results[0];
  return { lat: parseFloat(lat), lng: parseFloat(lon) };
}

// Strip unit/apartment/suite designators so a unit address falls back to its
// main street address (e.g. "230 S Guadalupe Ave #5" -> "230 S Guadalupe Ave",
// "15628 1/2 Larch Ave" -> "15628 Larch Ave"). Nominatim often can't resolve
// the unit-level address, but the building geocodes fine.
function stripUnit(address: string): string {
  let s = address;
  // "unit b", "apt 3", "suite 200", "ste 4", "# 5", "#5"
  s = s.replace(/[,\s]+(unit|apartment|apt|suite|ste|#)\s*\.?\s*[a-z0-9-]+/gi, "");
  // fractional unit between street number and name, e.g. "15628 1/2 Larch"
  s = s.replace(/(\d)\s+\d+\/\d+\s+/g, "$1 ");
  return s.replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
}

export async function geocodeAddress(address: string): Promise<Coords> {
  if (!address) return null;
  const key = normalize(address);
  const c = loadCache();

  if (key in c) return c[key];

  // Census first (best US coverage + typo tolerance), then Nominatim as backup.
  let coords = (await censusLookup(address)) || (await nominatimLookup(address));

  // Last resort: drop any unit designator and retry the main street address.
  if (!coords) {
    const main = stripUnit(address);
    if (main && normalize(main) !== key) {
      coords = (await censusLookup(main)) || (await nominatimLookup(main));
    }
  }

  c[key] = coords;
  persistCache();
  return coords;
}

export async function geocodeAddresses(addresses: string[]): Promise<Record<string, Coords>> {
  const result: Record<string, Coords> = {};
  for (const address of addresses) {
    result[address] = await geocodeAddress(address);
  }
  return result;
}
