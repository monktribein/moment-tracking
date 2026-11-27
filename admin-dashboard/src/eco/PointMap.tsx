import { useEffect, useRef } from "react";
import { htmlMarker, mapDot, useGoogleMap } from "../components/useGoogleMap";
import { coordsText, mapsUrl } from "../format";

/** One GPS check-in on a Google map (reuses the tracking map loader), with a plain link as fallback. */
export default function PointMap({ lat, lng, label, accuracy }: { lat: number; lng: number; label: string; accuracy?: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const { map, error } = useGoogleMap(ref);

  useEffect(() => {
    if (!map) return;
    const position = { lat, lng };
    map.setCenter(position);
    map.setZoom(16);
    const marker = htmlMarker(map, position, mapDot(18, "#f97316", "#fff", 3), { title: label, text: accuracy ? `±${Math.round(accuracy)} m` : coordsText(lat, lng) }, 10);
    const circle = accuracy ? new google.maps.Circle({ map, center: position, radius: accuracy, strokeColor: "#1e40af", strokeOpacity: 0.5, strokeWeight: 1, fillColor: "#1e40af", fillOpacity: 0.08 }) : null;
    return () => {
      marker.map = null;
      circle?.setMap(null);
    };
  }, [map, lat, lng, label, accuracy]);

  return (
    <div>
      <div style={{ position: "relative", height: 300, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
        <div ref={ref} className="map" />
        {error && (
          <div className="map-error">
            {error}
          </div>
        )}
      </div>
      <p className="cell-sub">
        {coordsText(lat, lng)}
        {accuracy ? ` · accuracy ±${Math.round(accuracy)} m` : ""} ·{" "}
        <a href={mapsUrl(lat, lng)} target="_blank" rel="noreferrer">
          Open in Google Maps
        </a>
      </p>
    </div>
  );
}
