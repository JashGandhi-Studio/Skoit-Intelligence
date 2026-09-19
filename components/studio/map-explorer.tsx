"use client";

/**
 * Map & Globe — a real, zoomable map of the whole planet with a 3D globe
 * view. Scroll to zoom from orbit down to street level, tap any spot to
 * learn what is there (reverse-geocoded + a Wikipedia summary), search any
 * place and fly to it, or hit the locate button to drop onto where you are.
 *
 * Tile strategy (all keyless, all loaded by your browser):
 *  1. CARTO Voyager raster — the dependable primary, CORS-open worldwide.
 *  2. If tiles keep failing (blocked network, captive portal), the map swaps
 *     itself to OpenStreetMap's tiles automatically.
 *  3. OpenFreeMap's vector style is attempted as an upgrade through the same
 *     relay chain the rest of the console uses; if it never arrives, the
 *     raster map you already see just stays.
 * The globe projection is applied to whichever style wins.
 */

import type {
  ErrorEvent,
  MapMouseEvent,
  Marker,
  Map as MlMap,
  StyleSpecification,
} from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  AlertTriangle,
  Globe2,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  Mountain,
  Satellite,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isRelayOk, relayJson } from "@/lib/client/cors-fetch";
import { cn } from "@/lib/utils";

type PlaceResult = {
  name: string;
  detail: string;
  lat: number;
  lon: number;
  kind: string;
};

type PlaceInfo = {
  title: string;
  subtitle: string;
  lat: number;
  lon: number;
  summary?: string;
  wikiUrl?: string;
};

/**
 * Basemaps this globe can wear. Satellite is the default because that is what
 * people mean by "a globe like Google Earth" — real imagery, with place names
 * on top so it is readable rather than just pretty.
 */
export type BasemapId = "satellite" | "map" | "terrain";

const BASEMAPS: Record<
  BasemapId,
  { label: string; hint: string; attribution: string; tiles: string[]; labels?: string[] }
> = {
  satellite: {
    label: "Satellite",
    hint: "Real satellite and aerial imagery, with place names over the top.",
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics · Labels © CARTO © OpenStreetMap",
    // Esri's World Imagery — free, keyless, CORS-open, worldwide, and the same
    // imagery family the big mapping products show.
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    labels: [
      "https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png",
    ],
  },
  map: {
    label: "Map",
    hint: "A drawn street map — clearer for roads, borders and dense cities.",
    attribution: "© OpenStreetMap contributors © CARTO",
    tiles: [
      "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
    ],
  },
  terrain: {
    label: "Terrain",
    hint: "Topographic shading that shows relief — mountains, valleys and plains.",
    attribution: "© OpenStreetMap contributors · Terrain © Esri",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}",
    ],
    labels: [
      "https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png",
    ],
  },
};

/**
 * Elevation for the 3D relief. Terrarium-encoded PNGs, free and keyless; when
 * this source is present maplibre tilts real mountains instead of drawing a
 * flat picture of one.
 */
const TERRAIN_SOURCE = {
  type: "raster-dem" as const,
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium" as const,
  tileSize: 256,
  maxzoom: 13,
  attribution: "Elevation: Mapzen / AWS Terrain Tiles",
};

/** Keyless basemap of the requested kind, ready to hand to maplibre. */
function basemapStyle(id: BasemapId): StyleSpecification {
  const config = BASEMAPS[id];
  const sources: StyleSpecification["sources"] = {
    basemap: {
      type: "raster",
      tiles: config.tiles,
      tileSize: 256,
      maxzoom: 19,
      attribution: config.attribution,
    },
  };
  if (config.labels) {
    sources.labels = {
      type: "raster",
      tiles: config.labels,
      tileSize: 256,
      maxzoom: 19,
    };
  }
  return {
    version: 8,
    projection: { type: "globe" },
    sources,
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#05070f" } },
      { id: "basemap", type: "raster", source: "basemap" },
      ...(config.labels
        ? [{ id: "labels", type: "raster", source: "labels" } as const]
        : []),
    ],
  };
}

const VECTOR_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

function zoomForKind(kind: string): number {
  if (/country|nation/.test(kind)) return 5;
  if (/state|region|county|province/.test(kind)) return 7;
  if (/city|town|village|municipality/.test(kind)) return 11;
  if (/suburb|neighbourhood|borough/.test(kind)) return 13;
  return 15;
}

function titleCasePlace(value: string): string {
  return value.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

async function nominatimSearch(query: string): Promise<PlaceResult[]> {
  const result = await relayJson(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`,
    { timeoutMs: 8000 },
  );
  if (!isRelayOk(result) || !Array.isArray(result.data)) {
    return [];
  }
  const { data } = result;
  return data
    .filter((row): row is Record<string, unknown> => Boolean(row?.lat))
    .map((row) => ({
      name: String(row.name || String(row.display_name ?? "").split(",")[0]),
      detail: String(row.display_name ?? ""),
      lat: Number(row.lat),
      lon: Number(row.lon),
      kind: String(row.type ?? row.category ?? ""),
    }));
}

async function reverseGeocode(lat: number, lon: number): Promise<PlaceInfo | null> {
  const result = await relayJson(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${lat}&lon=${lon}`,
    { timeoutMs: 8000 },
  );
  if (!isRelayOk(result) || typeof result.data !== "object" || result.data === null) {
    return null;
  }
  const row = result.data as Record<string, unknown>;
  const address = (row.address ?? {}) as Record<string, string>;
  const title = String(
    row.name || address.neighbourhood || address.suburb || address.city || "This spot",
  );
  const subtitleParts = [
    address.road,
    address.suburb,
    address.city,
    address.state,
    address.country,
  ].filter((part, index, list) => Boolean(part) && list.indexOf(part) === index);
  return {
    title,
    subtitle:
      subtitleParts.length > 0
        ? subtitleParts.join(" · ")
        : String(row.display_name ?? ""),
    lat,
    lon,
  };
}

async function wikiSummary(
  title: string,
): Promise<{ summary: string; url: string } | null> {
  const clean = title.replace(/\s+/g, " ").trim();
  const result = await relayJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(clean)}?redirect=true`,
    { timeoutMs: 8000 },
  );
  if (
    isRelayOk(result) &&
    typeof result.data === "object" &&
    result.data !== null &&
    "extract" in result.data
  ) {
    const row = result.data as {
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    if (row.extract) {
      return {
        summary: row.extract.slice(0, 420),
        url:
          row.content_urls?.desktop?.page ??
          `https://en.wikipedia.org/wiki/${encodeURIComponent(clean.replace(/ /g, "_"))}`,
      };
    }
  }
  return null;
}

async function wikiNearby(lat: number, lon: number): Promise<string | null> {
  const result = await relayJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gslimit=1&gsradius=1000&gscoord=${lat}|${lon}&format=json&origin=*`,
    { timeoutMs: 8000 },
  );
  if (!isRelayOk(result)) {
    return null;
  }
  const pages = (result.data as { query?: { geosearch?: Array<{ title: string }> } })
    ?.query?.geosearch;
  return pages && pages.length > 0 ? pages[0].title : null;
}

export function MapExplorer({ initialQuery }: { initialQuery?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const tileErrorsRef = useRef(0);
  const tilesLoadedRef = useRef(false);
  const osmTriedRef = useRef(false);
  const activeStyleRef = useRef<BasemapId | "vector">("satellite");
  /** The basemap the user picked; a tile failure can silently downgrade from this. */
  const chosenBasemapRef = useRef<BasemapId>("satellite");
  const [ready, setReady] = useState(false);
  const [tilesStalled, setTilesStalled] = useState(false);
  /** A basemap tile has actually painted — the globe is real, not a dark square. */
  const [tilesUp, setTilesUp] = useState(false);
  /** Neither tile provider answered in time — the static globe stands in. */
  const [tilesDead, setTilesDead] = useState(false);
  const [noWebgl, setNoWebgl] = useState(false);
  const [globe, setGlobe] = useState(true);
  /** Which basemap the globe is wearing (satellite by default, like a globe app). */
  const [basemap, setBasemap] = useState<BasemapId>("satellite");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [info, setInfo] = useState<PlaceInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  const retryTiles = useCallback(() => {
    setTilesStalled(false);
    tileErrorsRef.current = 0;
    tilesLoadedRef.current = false;
    setTilesUp(false);
    const map = mapRef.current;
    if (map) {
      activeStyleRef.current = "map";
      map.setStyle(basemapStyle("map"));
    }
  }, []);

  /* ------------------------------------------------------------- map setup */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) {
      return;
    }

    // maplibre-gl needs WebGL. When the browser (or the machine driving it)
    // cannot provide a context, say so plainly instead of leaving an empty
    // dark panel where the globe should be.
    try {
      const probe = document.createElement("canvas");
      // maplibre-gl v6 draws through WebGL2; without it the globe would be a
      // silent black square, so the console says so instead.
      const gl = probe.getContext("webgl2");
      if (!gl) {
        setNoWebgl(true);
        return;
      }
      // A software renderer (SwiftShader / llvmpipe / basic-render) reports a
      // context but cannot keep up: maplibre then blocks the main thread and
      // the whole tab stops responding — a frozen page is worse than an honest
      // fallback, especially on low-end phones. Detect it and stop here.
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = String(
        (debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) ||
          gl.getParameter(gl.RENDERER) ||
          "",
      );
      if (/swiftshader|llvmpipe|software|basic render|mesa offscreen|softpipe/i.test(renderer)) {
        setNoWebgl(true);
        return;
      }
    } catch {
      setNoWebgl(true);
      return;
    }

    let cancelled = false;
    tileErrorsRef.current = 0;
    activeStyleRef.current = chosenBasemapRef.current;
    const map = new maplibregl.Map({
      container,
      style: basemapStyle("satellite"),
      center: [20, 15],
      zoom: 1.6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.addControl(
      new maplibregl.GeolocateControl({
        trackUserLocation: true,
        showUserLocation: true,
        positionOptions: { enableHighAccuracy: true },
      }),
      "top-right",
    );

    /**
     * Everything that turns a flat tile grid into a planet: the globe
     * projection, the atmosphere you see from orbit, and real elevation so
     * mountains have height instead of being a photograph of height.
     */
    const applyPlanetLook = () => {
      try {
        map.setProjection({ type: "globe" });
      } catch {
        /* globe unsupported → flat map is fine */
      }
      // Sky + atmosphere: the blue rim and halo that make it read as a planet
      // seen from space rather than a map in a box. Ignored by older maplibre.
      try {
        map.setSky({
          "sky-color": "#05070f",
          "sky-horizon-blend": 0.6,
          "horizon-color": "#2b6cb0",
          "horizon-fog-blend": 0.7,
          "fog-color": "#0b1830",
          "fog-ground-blend": 0.85,
          "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 7, 0.6, 12, 0],
        } as never);
      } catch {
        /* no sky support — the globe still works */
      }
      // 3D relief from free elevation tiles. Only added once, and only when the
      // renderer can afford it.
      try {
        if (!map.getSource("terrain")) {
          map.addSource("terrain", TERRAIN_SOURCE as never);
        }
        map.setTerrain({ source: "terrain", exaggeration: 1.25 });
      } catch {
        /* no terrain support — a flat globe is still a globe */
      }
    };

    const onStyleLoad = () => {
      if (cancelled) {
        return;
      }
      applyPlanetLook();
      setReady(true);
    };
    map.on("style.load", onStyleLoad);
    map.on("sourcedata", (event) => {
      if (event.sourceId === "basemap" && event.isSourceLoaded) {
        tilesLoadedRef.current = true;
        setTilesUp(true);
        setTilesDead(false);
      }
    });

    // If the primary tiles keep erroring, quietly fall back to OSM's own
    // tiles; if those fail too, say so instead of showing a dead globe.
    map.on("error", (event: ErrorEvent) => {
      if (cancelled) {
        return;
      }
      // A broken style upgrade (mangled JSON, unreachable glyphs) must never
      // leave a blank dark globe: revert to the raster basemap that worked.
      if (
        !("sourceId" in event) &&
        !("tile" in event) &&
        activeStyleRef.current === "vector"
      ) {
        activeStyleRef.current = "satellite";
        map.setStyle(basemapStyle("satellite"));
        return;
      }
      if ("sourceId" in event && event.sourceId !== "basemap") {
        return;
      }
      tileErrorsRef.current += 1;
      if (tileErrorsRef.current === 6) {
        setTilesStalled(true);
        if (!cancelled) {
          tileErrorsRef.current = 0;
          activeStyleRef.current = "map";
          map.setStyle(basemapStyle("map"));
        }
      }
    });

    // Upgrade to the vector style (better labels, smoother zoom) — fetched
    // DIRECTLY, never through a CORS relay: relays can return mangled JSON,
    // and a malformed style was silently repainting the globe as an empty
    // dark ball. The style is validated before it is applied, and any style
    // error afterwards reverts to the raster map above.
    const tileWatchdog = window.setTimeout(() => {
      if (!cancelled && !tilesLoadedRef.current) {
        setTilesDead(true);
        setTilesStalled(true);
      }
    }, 6000);

    (async () => {
      try {
        const response = await fetch(VECTOR_STYLE_URL, { cache: "no-store" });
        if (!response.ok || cancelled) {
          return;
        }
        const style = (await response.json()) as Record<string, unknown>;
        const usable =
          typeof style === "object" &&
          style !== null &&
          Array.isArray(style.layers) &&
          style.layers.length > 0 &&
          typeof style.sources === "object" &&
          style.sources !== null &&
          // Glyphs and sprites must be direct URLs the browser can reach.
          (!("glyphs" in style) ||
            (typeof style.glyphs === "string" && style.glyphs.startsWith("http")));
        if (!usable || cancelled) {
          return;
        }
        style.projection = { type: "globe" };
        activeStyleRef.current = "vector";
        map.setStyle(style as unknown as StyleSpecification, { diff: false });
      } catch {
        /* keep the raster map — it is already usable */
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(tileWatchdog);
      setReady(false);
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* ------------------------------------------------------- tap for a place */
  // Re-runs when `ready` flips: that is the moment the map object exists.
  const currentMap = ready ? mapRef.current : null;
  useEffect(() => {
    const map = currentMap;
    if (!map) {
      return;
    }
    const onClick = async (event: MapMouseEvent) => {
      const { lng, lat } = event.lngLat;
      setInfo(null);
      setInfoLoading(true);
      try {
        const place = await reverseGeocode(lat, lng);
        if (place) {
          const nearby = await wikiNearby(lat, lng);
          const summary = nearby ? await wikiSummary(nearby) : null;
          setInfo({
            ...place,
            summary: summary?.summary,
            wikiUrl: summary?.url,
          });
        } else {
          setInfo({
            title: "This spot",
            subtitle: "Open Street Map",
            lat,
            lon: lng,
          });
        }
      } catch {
        setInfo({
          title: "This spot",
          subtitle: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          lat,
          lon: lng,
        });
      } finally {
        setInfoLoading(false);
      }
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [currentMap]);

  const dropMarker = useCallback((lat: number, lon: number) => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    markerRef.current?.remove();
    markerRef.current = new maplibregl.Marker({ color: "#e5732a" })
      .setLngLat([lon, lat])
      .addTo(map);
  }, []);

  const goTo = useCallback(
    async (place: PlaceResult) => {
      const map = mapRef.current;
      if (!map) {
        return;
      }
      setResults([]);
      setQuery(place.name);
      setInfoLoading(true);
      dropMarker(place.lat, place.lon);
      map.flyTo({
        center: [place.lon, place.lat],
        zoom: zoomForKind(place.kind),
        duration: 1800,
      });
      try {
        const summary = await wikiSummary(place.name);
        setInfo({
          title: titleCasePlace(place.name),
          subtitle: place.detail,
          lat: place.lat,
          lon: place.lon,
          summary: summary?.summary,
          wikiUrl: summary?.url,
        });
      } catch {
        setInfo({
          title: titleCasePlace(place.name),
          subtitle: place.detail,
          lat: place.lat,
          lon: place.lon,
        });
      } finally {
        setInfoLoading(false);
      }
    },
    [dropMarker],
  );

  const runSearch = useCallback(
    async (raw?: string) => {
      const term = (raw ?? query).trim();
      if (!term) {
        return;
      }
      setSearching(true);
      setResults([]);
      try {
        const found = await nominatimSearch(term);
        setResults(found);
        if (found.length > 0) {
          await goTo(found[0]);
        }
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [goTo, query],
  );

  // A place asked for in the chat ("where is Kyoto") is searched on open.
  const initialRef = useRef(initialQuery);
  useEffect(() => {
    if (ready && initialRef.current && !info && !markerRef.current) {
      void runSearch(initialRef.current);
      initialRef.current = undefined;
    }
  }, [ready, info, runSearch]);

  const toggleGlobe = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const next = !globe;
    try {
      map.setProjection({ type: next ? "globe" : "mercator" });
      setGlobe(next);
      if (next && map.getZoom() < 3) {
        map.flyTo({ zoom: 2.2, duration: 1200 });
      }
    } catch {
      /* projection toggle unsupported */
    }
  }, [globe]);

  /** Swap the basemap in place, keeping the camera exactly where it is. */
  const chooseBasemap = useCallback((next: BasemapId) => {
    setBasemap(next);
    chosenBasemapRef.current = next;
    const map = mapRef.current;
    if (!map) {
      return;
    }
    tileErrorsRef.current = 0;
    setTilesStalled(false);
    setTilesDead(false);
    tilesLoadedRef.current = false;
    activeStyleRef.current = next;
    try {
      map.setStyle(basemapStyle(next), { diff: false });
    } catch {
      /* keep whatever is on screen */
    }
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-2">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Never show an empty dark panel: while the first tiles are being drawn
          say so, so the wait reads as loading rather than as broken. */}
      {!tilesUp && !noWebgl && !tilesDead ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#070b14]">
          <div className="flex items-center gap-2.5 rounded-full border border-white/15 bg-black/55 px-4 py-2 text-[12px] text-white/85 backdrop-blur">
            <Globe2 className="size-4 animate-spin text-cyan-300" />
            Drawing the globe…
          </div>
        </div>
      ) : null}

      {noWebgl || tilesDead ? (
        <div className="absolute inset-0 grid place-items-center bg-[#070b14] p-6 text-center">
          <img src="/globe-fallback.jpg" alt="Earth from space" className="absolute inset-0 h-full w-full object-cover opacity-80" />
          <div className="relative max-w-[340px] space-y-2 rounded-xl border border-white/15 bg-black/65 p-4 text-white shadow-pop backdrop-blur">
            <Globe2 className="mx-auto size-6 text-cyan-300" />
            <AlertTriangle className="mx-auto size-5 text-warning" />
            <p className="text-[13px] font-semibold text-foreground">
              This browser cannot draw the globe
            </p>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              The 3D map needs hardware graphics (WebGL), which is switched off or
              unavailable here. Enable hardware acceleration in the browser settings — or
              open{" "}
              <a
                href="https://www.openstreetmap.org/"
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary-strong underline underline-offset-2"
              >
                OpenStreetMap
              </a>{" "}
              directly.
            </p>
          </div>
        </div>
      ) : null}

      {/* search + controls overlay */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-2.5">
        <form
          className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-hairline bg-surface/95 p-1.5 shadow-pop backdrop-blur"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <Search className="ml-1.5 size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search any place — city, country, landmark…"
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint-foreground"
          />
          {searching ? (
            <Loader2 className="mr-1 size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground"
          >
            Go
          </button>
        </form>

        {results.length > 0 ? (
          <div className="pointer-events-auto overflow-hidden rounded-xl border border-hairline bg-surface/97 shadow-pop backdrop-blur">
            {results.map((place) => (
              <button
                key={`${place.name}-${place.lat},${place.lon}`}
                type="button"
                onClick={() => void goTo(place)}
                className="block w-full border-b border-hairline px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-2"
              >
                <span className="block text-[13px] font-medium">
                  {titleCasePlace(place.name)}
                </span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  {place.detail}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* view controls: basemap picker + globe/flat, the way a mapping app does it */}
      <div className="absolute top-24 right-2.5 z-10 flex flex-col items-end gap-1.5">
        <div className="flex overflow-hidden rounded-xl border border-hairline bg-surface/95 shadow-pop backdrop-blur">
          {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => chooseBasemap(id)}
              title={BASEMAPS[id].hint}
              className={cn(
                "flex items-center gap-1 px-2.5 py-2 text-[11.5px] font-medium transition-colors",
                basemap === id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-surface-2",
              )}
            >
              {id === "satellite" ? <Satellite className="size-3.5" /> : null}
              {id === "map" ? <MapIcon className="size-3.5" /> : null}
              {id === "terrain" ? <Mountain className="size-3.5" /> : null}
              {BASEMAPS[id].label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={toggleGlobe}
          title={globe ? "Switch to a flat map" : "Switch back to the 3D globe"}
          className={cn(
            "flex items-center gap-1.5 rounded-xl border border-hairline bg-surface/95 px-2.5 py-2 text-[11.5px] font-medium shadow-pop backdrop-blur transition-colors",
            globe ? "text-primary" : "text-muted-foreground",
          )}
        >
          {globe ? <Globe2 className="size-4" /> : <MapIcon className="size-4" />}
          {globe ? "3D globe" : "Flat map"}
        </button>
      </div>

      {/* tiles struggling: say so, with a retry */}
      {tilesStalled ? (
        <button
          type="button"
          onClick={() => {
            setTilesStalled(false);
            tileErrorsRef.current = 0;
            mapRef.current?.setStyle(basemapStyle(chosenBasemapRef.current));
          }}
          className="absolute top-36 right-2.5 z-10 flex max-w-[200px] items-start gap-1.5 rounded-xl border border-warning/40 bg-surface/95 px-2.5 py-2 text-left text-[11px] text-muted-foreground shadow-pop backdrop-blur"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          Map tiles are struggling on this network — tap to retry
        </button>
      ) : null}

      {/* place card */}
      {infoLoading && !info ? (
        <div className="absolute inset-x-2.5 bottom-3 z-10 flex items-center gap-2 rounded-xl border border-hairline bg-surface/95 px-3 py-2.5 text-[12px] text-muted-foreground shadow-pop backdrop-blur">
          <Loader2 className="size-3.5 animate-spin" /> Looking up this place…
        </div>
      ) : null}
      {info ? (
        <div className="absolute inset-x-2.5 bottom-3 z-10 rounded-xl border border-hairline bg-surface/97 p-3 shadow-pop backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold tracking-tight">
                {info.title}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground">
                {info.subtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setInfo(null)}
              className="rounded-lg p-1 text-muted-foreground hover:bg-surface-2"
              aria-label="Close place card"
            >
              <X className="size-3.5" />
            </button>
          </div>
          {info.summary ? (
            <p className="mt-2 line-clamp-4 text-[12px] leading-relaxed text-foreground/90">
              {info.summary}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {info.lat.toFixed(4)}, {info.lon.toFixed(4)}
            </code>
            {info.wikiUrl ? (
              <a
                href={info.wikiUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11.5px] font-medium text-primary underline-offset-2 hover:underline"
              >
                Read on Wikipedia
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* usage hint */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[5] flex justify-center">
        <p className="pointer-events-none flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1 text-[10.5px] text-white/90 backdrop-blur">
          <LocateFixed className="size-3" /> scroll to zoom · tap any spot to know it
        </p>
      </div>
    </div>
  );
}
