import { NextRequest, NextResponse } from "next/server";

interface Pt {
  id: string;
  lat: number;
  lng: number;
}

interface Body {
  start: { lat: number; lng: number };
  stops: Pt[];
  roundtrip?: boolean;
}

// Compute an optimized driving route through the selected stops, starting at
// `start`. Uses the public OSRM "trip" service (solves the traveling-salesman
// ordering). Free, no API key. Returns the route geometry, the optimized stop
// order, and total distance/time.
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { start, stops } = body;
  const roundtrip = body.roundtrip !== false; // default true

  if (!start || !Array.isArray(stops) || stops.length === 0) {
    return NextResponse.json({ error: "Need a start and at least one stop" }, { status: 400 });
  }

  // OSRM coordinate order is lng,lat. Start is always the first coordinate.
  const coords = [start, ...stops].map((p) => `${p.lng},${p.lat}`).join(";");
  const params = new URLSearchParams({
    source: "first",
    roundtrip: roundtrip ? "true" : "false",
    geometries: "geojson",
    overview: "full",
  });
  // For a one-way trip we must tell OSRM the destination is the last visited
  // point; "any" lets it choose, which is what we want when not round-tripping.
  if (!roundtrip) params.set("destination", "any");

  const url = `https://router.project-osrm.org/trip/v1/driving/${coords}?${params}`;

  let data;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Routing service error: ${res.status}` },
        { status: 502 }
      );
    }
    data = await res.json();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Routing request failed" },
      { status: 502 }
    );
  }

  if (data.code !== "Ok" || !data.trips?.[0]) {
    return NextResponse.json(
      { error: `Could not build a route (${data.code ?? "unknown"})` },
      { status: 502 }
    );
  }

  const trip = data.trips[0];
  // waypoints[] is parallel to the input coords. Index 0 = start; 1..n = stops.
  // waypoint_index is each point's position in the optimized visiting order.
  const wps = data.waypoints as { waypoint_index: number }[];
  const orderedStops = stops
    .map((s, i) => ({ stop: s, order: wps[i + 1].waypoint_index }))
    .sort((a, b) => a.order - b.order)
    .map((o) => o.stop);

  return NextResponse.json({
    // GeoJSON LineString coords are [lng, lat]; the client flips them for Leaflet.
    geometry: trip.geometry.coordinates as [number, number][],
    order: orderedStops.map((s) => s.id),
    orderedStops,
    distanceMeters: trip.distance as number,
    durationSeconds: trip.duration as number,
  });
}
