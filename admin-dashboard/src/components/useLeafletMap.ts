import { useEffect, useState, type RefObject } from "react";
import L from "leaflet";

export const INDIA = { center: [22.6, 79.0] as L.LatLngTuple, zoom: 5 };

/** A Leaflet map with OpenStreetMap tiles in `ref`'s element; null until it exists. */
export function useLeafletMap(ref: RefObject<HTMLDivElement | null>): L.Map | null {
  const [map, setMap] = useState<L.Map | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const m = L.map(el, { zoomControl: true }).setView(INDIA.center, INDIA.zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(m);
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(el);
    setMap(m);
    return () => {
      resize.disconnect();
      m.remove();
      setMap(null);
    };
  }, [ref]);

  return map;
}

/** Escapes text for Leaflet tooltips and popups, which take HTML. */
export const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
