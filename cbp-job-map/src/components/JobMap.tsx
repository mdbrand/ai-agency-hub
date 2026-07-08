"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Job } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  Done: "#6b7280",
  "Working on it": "#ffcb00",
  Stuck: "#bb3354",
  Scheduled: "#5559df",
  "Final $ Needed": "#9d50dd",
  "Survey Ready": "#fdab3d",
  "To Be Scheduled": "#66ccff",
  "Touch Ups Needed": "#cab641",
  Warranty: "#ff6d3b",
};

export interface StartPoint {
  lat: number;
  lng: number;
  label: string;
}

function makeIcon(color: string, order?: number) {
  const inner =
    order != null
      ? `<span style="color:#fff;font-size:11px;font-weight:700;line-height:22px;">${order}</span>`
      : "";
  const size = order != null ? 22 : 18;
  return L.divIcon({
    className: "",
    html: `<div style="
      width: ${size}px; height: ${size}px; border-radius: 50%;
      background: ${color}; border: 2px solid white; text-align:center;
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    ">${inner}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function startIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 26px; height: 26px; border-radius: 50% 50% 50% 0;
      background: #111827; border: 3px solid white; transform: rotate(-45deg);
      box-shadow: 0 1px 5px rgba(0,0,0,0.5);
    "><span style="display:block;transform:rotate(45deg);color:#fff;font-size:13px;line-height:22px;text-align:center;">★</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });
}

const DEFAULT_CENTER: [number, number] = [33.85, -118.35];

// Pan/zoom the map to fit the route (or selected stops) whenever they change.
function FitBounds({
  points,
}: {
  points: [number, number][];
}) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [points, map]);
  return null;
}

interface Props {
  jobs: Job[];
  selectedIds?: Set<string>;
  routeOrder?: string[]; // job ids in optimized visiting order
  routeGeometry?: [number, number][]; // [lng, lat] pairs from OSRM
  start?: StartPoint | null;
  onToggleStop?: (id: string) => void;
}

export default function JobMap({
  jobs,
  selectedIds,
  routeOrder,
  routeGeometry,
  start,
  onToggleStop,
}: Props) {
  const located = jobs.filter((j) => j.lat != null && j.lng != null);

  // Leaflet wants [lat, lng]; OSRM geometry is [lng, lat].
  const routeLine: [number, number][] = (routeGeometry ?? []).map(([lng, lat]) => [lat, lng]);

  const orderIndex = new Map<string, number>();
  routeOrder?.forEach((id, i) => orderIndex.set(id, i + 1));

  const fitPoints: [number, number][] =
    routeLine.length > 0
      ? routeLine
      : located
          .filter((j) => selectedIds?.has(j.id))
          .map((j) => [j.lat as number, j.lng as number]);

  return (
    <MapContainer center={DEFAULT_CENTER} zoom={11} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds points={fitPoints} />

      {routeLine.length > 0 && (
        <Polyline positions={routeLine} pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.75 }} />
      )}

      {start && (
        <Marker position={[start.lat, start.lng]} icon={startIcon()}>
          <Popup>
            <strong>Start / End</strong>
            <br />
            {start.label}
          </Popup>
        </Marker>
      )}

      {located.map((job) => {
        const selected = selectedIds?.has(job.id);
        const order = orderIndex.get(job.id);
        const color = selected ? "#2563eb" : STATUS_COLORS[job.status] || "#888";
        return (
          <Marker
            key={job.id}
            position={[job.lat as number, job.lng as number]}
            icon={makeIcon(color, order)}
          >
            <Popup>
              <div style={{ minWidth: 210 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{job.customer}</div>
                <div style={{ marginBottom: 4 }}>{job.address}</div>
                <div style={{ fontSize: 13, color: "#444", lineHeight: 1.5 }}>
                  <div><strong>Status:</strong> {job.status}</div>
                  <div><strong>Job type:</strong> {job.jobType || "—"}</div>
                  <div>
                    <strong>Dates:</strong>{" "}
                    {job.startDate || "—"}
                    {job.endDate && job.endDate !== job.startDate ? ` – ${job.endDate}` : ""}
                  </div>
                  <div><strong>Crew leader:</strong> {job.crewLeader || "Unassigned"}</div>
                  <div><strong>Crew size:</strong> {job.crewSize ?? "n/a"}</div>
                  {job.phone && (
                    <div>
                      <strong>Phone:</strong> <a href={`tel:${job.phone}`}>{job.phone}</a>
                    </div>
                  )}
                  {job.email && (
                    <div>
                      <strong>Email:</strong> <a href={`mailto:${job.email}`}>{job.email}</a>
                    </div>
                  )}
                </div>
                {onToggleStop && (
                  <button
                    onClick={() => onToggleStop(job.id)}
                    style={{
                      marginTop: 8,
                      padding: "4px 10px",
                      fontSize: 13,
                      borderRadius: 6,
                      border: "1px solid #2563eb",
                      background: selected ? "#2563eb" : "#fff",
                      color: selected ? "#fff" : "#2563eb",
                      cursor: "pointer",
                    }}
                  >
                    {selected ? "✓ In route" : "Add to route"}
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
