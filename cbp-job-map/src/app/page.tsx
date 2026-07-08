"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Job } from "@/lib/types";
import type { StartPoint } from "@/components/JobMap";

const JobMap = dynamic(() => import("@/components/JobMap"), { ssr: false });

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

interface RouteResult {
  order: string[];
  orderedStops: { id: string; lat: number; lng: number }[];
  geometry: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
}

function miles(m: number): string {
  return (m / 1609.34).toFixed(1);
}

function hms(sec: number): string {
  const h = Math.floor(sec / 3600);
  const min = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

export default function Home() {
  const [month, setMonth] = useState(currentMonth());
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Route planner state
  const [start, setStart] = useState<StartPoint | null>(null);
  const [addressInput, setAddressInput] = useState("");
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Reset loading/error on each month/status change — intentional, not a smell.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    fetch(`/api/jobs?month=${month}&status=${statusFilter}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          setJobs([]);
        } else {
          setJobs(data.jobs);
          // Drop any selected stops that aren't in the new result set.
          setSelectedIds((prev) => {
            const ids = new Set<string>(data.jobs.map((j: Job) => j.id));
            const next = new Set([...prev].filter((id) => ids.has(id)));
            return next;
          });
          setRoute(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [month, statusFilter]);

  const located = useMemo(() => jobs.filter((j) => j.lat != null && j.lng != null), [jobs]);
  const jobsById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  function useMyLocation() {
    setStartError(null);
    if (!navigator.geolocation) {
      setStartError("Geolocation isn't available in this browser.");
      return;
    }
    setStartBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStart({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "My location" });
        setStartBusy(false);
      },
      (err) => {
        setStartError(err.message || "Couldn't get your location.");
        setStartBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function setAddressStart() {
    const q = addressInput.trim();
    if (!q) return;
    setStartBusy(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.error) {
        setStartError(data.error);
      } else {
        setStart({ lat: data.lat, lng: data.lng, label: q });
      }
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Geocoding failed");
    } finally {
      setStartBusy(false);
    }
  }

  function toggleStop(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setRoute(null);
  }

  async function buildRoute() {
    setRouteError(null);
    if (!start) {
      setRouteError("Set a start location first.");
      return;
    }
    const stops = located
      .filter((j) => selectedIds.has(j.id))
      .map((j) => ({ id: j.id, lat: j.lat as number, lng: j.lng as number }));
    if (stops.length === 0) {
      setRouteError("Select at least one job site.");
      return;
    }
    setRouteBusy(true);
    try {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, stops, roundtrip: true }),
      });
      const data = await res.json();
      if (data.error) setRouteError(data.error);
      else setRoute(data);
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : "Routing failed");
    } finally {
      setRouteBusy(false);
    }
  }

  function clearRoute() {
    setRoute(null);
    setSelectedIds(new Set());
  }

  const googleMapsUrl = useMemo(() => {
    if (!start || !route) return null;
    // Hand Google the actual street ADDRESSES (not coordinates) for each stop —
    // Google geocodes them itself and lands on the right house. Passing raw
    // lat/lng makes Google snap to the nearest known address, which can be a
    // different (wrong) house on a nearby street.
    const startTerm =
      start.label && start.label !== "My location"
        ? start.label // user typed an address — use it directly
        : `${start.lat},${start.lng}`; // GPS location — coords are correct here
    const stopTerms = route.order
      .map((id) => jobsById.get(id)?.address)
      .filter((a): a is string => Boolean(a));

    const params = new URLSearchParams({
      api: "1",
      origin: startTerm,
      destination: startTerm, // round trip back to start
      travelmode: "driving",
    });
    if (stopTerms.length) params.set("waypoints", stopTerms.join("|"));
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }, [start, route, jobsById]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px 20px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fff",
          zIndex: 10,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>CBP Job Map</h1>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          Month
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 8px" }}
          />
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "completed")}
            style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 8px" }}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </label>

        <div style={{ marginLeft: "auto", fontSize: 13, color: "#6b7280" }}>
          {loading ? "Loading…" : `${jobs.length} job${jobs.length === 1 ? "" : "s"}`}
        </div>
      </header>

      {error && (
        <div style={{ padding: 12, background: "#fee2e2", color: "#991b1b", fontSize: 14 }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <aside
          style={{
            width: 330,
            borderRight: "1px solid #e5e7eb",
            background: "#fafafa",
            overflowY: "auto",
            padding: 16,
            fontSize: 14,
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px" }}>Plan a route</h2>

          {/* Start location */}
          <div style={{ marginBottom: 6 }}>
            <button
              onClick={useMyLocation}
              disabled={startBusy}
              style={btnStyle(false)}
            >
              📍 Use my location
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setAddressStart()}
              placeholder="…or type a start address"
              style={{
                flex: 1,
                border: "1px solid #d1d5db",
                borderRadius: 6,
                padding: "6px 8px",
                fontSize: 13,
              }}
            />
            <button onClick={setAddressStart} disabled={startBusy} style={btnStyle(false)}>
              Set
            </button>
          </div>
          {start && (
            <div style={{ fontSize: 13, color: "#065f46", marginBottom: 6 }}>
              ★ Start: {start.label}
            </div>
          )}
          {startError && (
            <div style={{ fontSize: 13, color: "#991b1b", marginBottom: 6 }}>{startError}</div>
          )}

          {/* Route actions */}
          <div style={{ display: "flex", gap: 6, margin: "10px 0" }}>
            <button onClick={buildRoute} disabled={routeBusy} style={btnStyle(true)}>
              {routeBusy ? "Routing…" : `Build route (${selectedIds.size})`}
            </button>
            <button onClick={clearRoute} style={btnStyle(false)}>
              Clear
            </button>
          </div>
          {routeError && (
            <div style={{ fontSize: 13, color: "#991b1b", marginBottom: 6 }}>{routeError}</div>
          )}

          {/* Route summary */}
          {route && (
            <div
              style={{
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 8,
                padding: 10,
                marginBottom: 10,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {miles(route.distanceMeters)} mi · {hms(route.durationSeconds)} driving
              </div>
              <ol style={{ margin: "6px 0 8px", paddingLeft: 18 }}>
                {route.order.map((id) => {
                  const j = jobsById.get(id);
                  return (
                    <li key={id} style={{ marginBottom: 2 }}>
                      {j?.customer || id}
                      <div style={{ fontSize: 12, color: "#6b7280" }}>{j?.address}</div>
                    </li>
                  );
                })}
              </ol>
              {googleMapsUrl && (
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    background: "#1a73e8",
                    color: "#fff",
                    borderRadius: 6,
                    fontSize: 13,
                    textDecoration: "none",
                  }}
                >
                  Open in Google Maps →
                </a>
              )}
            </div>
          )}

          {/* Job checklist */}
          <h3 style={{ fontSize: 13, fontWeight: 700, margin: "12px 0 6px", color: "#374151" }}>
            Job sites ({located.length})
          </h3>
          {located.map((j) => (
            <label
              key={j.id}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                padding: "5px 0",
                borderBottom: "1px solid #eee",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(j.id)}
                onChange={() => toggleStop(j.id)}
                style={{ marginTop: 3 }}
              />
              <span>
                <span style={{ fontWeight: 500 }}>{j.customer}</span>
                <span style={{ display: "block", fontSize: 12, color: "#6b7280" }}>
                  {j.address}
                </span>
              </span>
            </label>
          ))}
        </aside>

        <div style={{ flex: 1, position: "relative" }}>
          <JobMap
            jobs={jobs}
            selectedIds={selectedIds}
            routeOrder={route?.order}
            routeGeometry={route?.geometry}
            start={start}
            onToggleStop={toggleStop}
          />
        </div>
      </div>
    </div>
  );
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    fontSize: 13,
    borderRadius: 6,
    border: primary ? "none" : "1px solid #d1d5db",
    background: primary ? "#2563eb" : "#fff",
    color: primary ? "#fff" : "#374151",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
