import { useEffect, useState, type RefObject } from "react";

/** The whole country, shown before anyone has a location. */
export const INDIA = { center: { lat: 22.6, lng: 79.0 }, zoom: 5 };

const API_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim();
// Advanced markers need a map ID. Google's demo ID works; set your own to style the map in Cloud Console.
const MAP_ID = String(import.meta.env.VITE_GOOGLE_MAPS_MAP_ID ?? "").trim() || "DEMO_MAP_ID";

const NO_KEY = "No Google Maps key. Set VITE_GOOGLE_MAPS_API_KEY for the dashboard and rebuild it.";
const KEY_REFUSED =
  "Google refused the Maps key. In Google Cloud, turn on the Maps JavaScript API and billing, and allow this site's address for the key.";

let loading: Promise<void> | null = null;
let keyRefused = false;
const refusalListeners = new Set<() => void>();

/** Loads the Maps JavaScript API once per page. */
function loadGoogleMaps(): Promise<void> {
  if (!API_KEY) return Promise.reject(new Error(NO_KEY));
  loading ??= new Promise<void>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>;
    // Google calls this when it refuses the key: wrong key, API or billing off, or site not allowed.
    w.gm_authFailure = () => {
      keyRefused = true;
      refusalListeners.forEach((notify) => notify());
    };
    const callback = "__movementTrackingMapsReady";
    w[callback] = () => {
      delete w[callback];
      resolve();
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key: API_KEY, v: "weekly", loading: "async", callback })}`;
    script.async = true;
    script.onerror = () => {
      script.remove();
      loading = null;
      reject(new Error("Google Maps could not load. Check the internet connection and refresh."));
    };
    document.head.append(script);
  }).then(async () => {
    await Promise.all([google.maps.importLibrary("maps"), google.maps.importLibrary("marker")]);
  });
  return loading;
}

/** A Google map in `ref`'s element; `map` is null until it exists, `error` says why it could not. */
export function useGoogleMap(ref: RefObject<HTMLDivElement | null>): { map: google.maps.Map | null; error: string } {
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let active = true;
    const onRefused = () => {
      if (active) setError(KEY_REFUSED);
    };
    refusalListeners.add(onRefused);
    if (keyRefused) onRefused();
    loadGoogleMaps().then(
      () => {
        if (!active) return;
        setMap(
          new google.maps.Map(el, {
            mapId: MAP_ID,
            center: INDIA.center,
            zoom: INDIA.zoom,
            gestureHandling: "greedy",
            clickableIcons: false,
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
            cameraControl: false,
            zoomControl: true,
            // Top left: the detail panel covers the right side.
            zoomControlOptions: { position: google.maps.ControlPosition.INLINE_START_BLOCK_START },
          }),
        );
      },
      (e: Error) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
      refusalListeners.delete(onRefused);
      setMap(null);
    };
  }, [ref]);

  return { map, error };
}

const fitTokens = new WeakMap<google.maps.Map, number>();

/**
 * Frames `points` inside `padding` without zooming in past `maxZoom`. fitBounds has no zoom limit of
 * its own, so the map's limit is set for the move and lifted once it settles.
 * Returns false when there is nothing to frame.
 */
export function fitMap(map: google.maps.Map, points: google.maps.LatLngLiteral[], padding: google.maps.Padding, maxZoom: number): boolean {
  if (!points.length) return false;
  const bounds = new google.maps.LatLngBounds();
  for (const p of points) bounds.extend(p);
  const token = (fitTokens.get(map) ?? 0) + 1;
  fitTokens.set(map, token);
  const release = () => {
    if (fitTokens.get(map) === token) map.setOptions({ maxZoom: null });
  };
  map.setOptions({ maxZoom });
  map.fitBounds(bounds, padding);
  google.maps.event.addListenerOnce(map, "idle", release);
  // An unchanged view never goes idle.
  setTimeout(release, 1500);
  return true;
}

export type Overlay = google.maps.marker.AdvancedMarkerElement | google.maps.Polyline;

/** Removes every overlay in `list` from the map and empties the list. */
export function clearOverlays(list: Overlay[]): void {
  for (const o of list) {
    if (o instanceof google.maps.Polyline) o.setMap(null);
    else o.map = null;
  }
  list.length = 0;
}

/** A round dot `size` px across, border included. */
export function mapDot(size: number, fill: string, border: string, borderWidth: number, opacity = 1): HTMLElement {
  const el = document.createElement("span");
  el.className = "map-dot";
  Object.assign(el.style, { width: `${size}px`, height: `${size}px`, background: fill, border: `${borderWidth}px solid ${border}`, opacity: String(opacity) });
  return el;
}

/** A marker centred on `position`, showing `label` on hover (a bold first line when `title` is set). */
export function htmlMarker(
  map: google.maps.Map,
  position: google.maps.LatLngLiteral,
  content: HTMLElement,
  label: { title?: string; text: string },
  zIndex: number,
  onClick?: () => void,
): google.maps.marker.AdvancedMarkerElement {
  const wrap = document.createElement("div");
  wrap.className = "map-marker";
  const tip = document.createElement("div");
  tip.className = "map-tip";
  if (label.title) {
    const strong = document.createElement("strong");
    strong.textContent = label.title;
    tip.append(strong, document.createElement("br"));
  }
  tip.append(label.text);
  wrap.append(content, tip);

  const marker = new google.maps.marker.AdvancedMarkerElement({ map, position, content: wrap, zIndex, gmpClickable: Boolean(onClick) });
  // Lift the hovered marker so its label is not hidden under its neighbours.
  wrap.addEventListener("mouseenter", () => (marker.zIndex = 10_000));
  wrap.addEventListener("mouseleave", () => (marker.zIndex = zIndex));
  if (onClick) marker.addEventListener("gmp-click", onClick);
  return marker;
}
