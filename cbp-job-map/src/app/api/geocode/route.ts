import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/geocode";

// Geocode a free-text start address for the route planner.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  try {
    const coords = await geocodeAddress(q);
    if (!coords) {
      return NextResponse.json({ error: "Couldn't find that address" }, { status: 404 });
    }
    return NextResponse.json({ lat: coords.lat, lng: coords.lng, label: q });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Geocoding failed" },
      { status: 500 }
    );
  }
}
