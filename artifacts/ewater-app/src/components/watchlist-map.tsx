import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

// Fix Leaflet default icon URLs broken by Vite bundling
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function makeIcon(color: "green" | "amber" | "gray") {
  const colours: Record<string, string> = {
    green: "#22c55e",
    amber: "#f59e0b",
    gray:  "#94a3b8",
  };
  const fill = colours[color];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">
    <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24S24 21 24 12C24 5.373 18.627 0 12 0z" fill="${fill}" stroke="white" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="5" fill="white" fill-opacity="0.85"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [24, 36],
    iconAnchor: [12, 36],
    popupAnchor: [0, -38],
  });
}

const icons = {
  green: makeIcon("green"),
  amber: makeIcon("amber"),
  gray: makeIcon("gray"),
};

function hasFlag(flags: string | null | undefined, flag: string) {
  if (!flags) return false;
  return flags.toLowerCase().split(",").some((f) => f.trim().toLowerCase().includes(flag.toLowerCase()));
}

export interface MapAsset {
  id: string;
  name: string;
  location?: string | null;
  isOnline?: boolean | null;
  waterSystemName?: string | null;
  rawData?: { healthFlags?: string } | null;
}

function FitBounds({ assets }: { assets: MapAsset[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    const points = assets
      .map((a) => parseLatLng(a.location))
      .filter((p): p is [number, number] => p !== null);

    if (points.length === 0 || fitted.current) return;
    fitted.current = true;

    if (points.length === 1) {
      map.setView(points[0]!, 14);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 });
    }
  }, [assets, map]);

  return null;
}

function parseLatLng(location?: string | null): [number, number] | null {
  if (!location) return null;
  const parts = location.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length < 2 || parts.some(isNaN)) return null;
  return [parts[0]!, parts[1]!];
}

export function WatchlistMap({ assets, className }: { assets: MapAsset[]; className?: string }) {
  const mappable = assets.filter((a) => parseLatLng(a.location) !== null);

  if (mappable.length === 0) {
    return (
      <div className={cn("flex items-center justify-center bg-muted rounded-xl text-sm text-muted-foreground", className)}>
        No location data for watchlist assets
      </div>
    );
  }

  const center = parseLatLng(mappable[0]!.location) ?? [0, 0];

  return (
    <MapContainer
      center={center}
      zoom={10}
      className={cn("rounded-xl z-0", className)}
      style={{ background: "#e8e8e8" }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />

      <FitBounds assets={mappable} />

      {mappable.map((asset) => {
        const pos = parseLatLng(asset.location)!;
        const flags = asset.rawData?.healthFlags;
        const warn = hasFlag(flags, "tamper") || hasFlag(flags, "lowbattery") || hasFlag(flags, "low battery");
        const iconKey: "green" | "amber" | "gray" = warn ? "amber" : asset.isOnline ? "green" : "gray";

        return (
          <Marker key={asset.id} position={pos} icon={icons[iconKey]}>
            <Popup>
              <div className="min-w-[140px]">
                <p className="font-semibold text-sm leading-tight">{asset.name}</p>
                {asset.waterSystemName && (
                  <p className="text-xs text-gray-500 mt-0.5">{asset.waterSystemName}</p>
                )}
                <p className="text-xs mt-1">
                  <span className={cn(
                    "font-medium",
                    warn ? "text-amber-600" : asset.isOnline ? "text-green-600" : "text-gray-400",
                  )}>
                    {warn ? "Alert" : asset.isOnline ? "Online" : "Offline"}
                  </span>
                </p>
                <a
                  href={`/assets/${asset.id}`}
                  className="block mt-2 text-xs text-blue-600 underline"
                >
                  View asset →
                </a>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
