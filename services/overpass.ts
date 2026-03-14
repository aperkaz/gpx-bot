import type {
  Coordinate,
  OverpassElement,
  OverpassResponse,
  PointOfInterest,
  PoiProcessor,
} from "./types.ts";
import { findDistanceAlongRoute } from "./geo.ts";

// ── Constants ────────────────────────────────────────────────────────────────

const OVERPASS_API = "https://overpass-api.de/api/interpreter";
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 2000;
const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 20;

// ── Query Building ───────────────────────────────────────────────────────────

/**
 * Build an Overpass QL query from generic tag filters.
 *
 * @param filters - Array of Overpass tag filter strings, e.g.:
 *   ['["amenity"="fuel"]', '["amenity"="drinking_water"]']
 * @param coords - Route coordinates for the "around" filter
 * @param radius - Search radius in meters
 */
export function buildOverpassQuery(
  filters: string[],
  coords: Coordinate[],
  radius: number,
): string {
  const coordStr = coords.map((c) => `${c.lat},${c.lon}`).join(",");

  const statements = filters
    .map((f) => `  node${f}(around:${radius},${coordStr});`)
    .join("\n");

  return `[out:json][timeout:60];
(
${statements}
);
out body;`;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429 || response.status >= 500) {
        if (attempt < retries) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          console.log(
            `  Overpass API returned ${response.status}, retrying in ${delay / 1000}s...`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }

      if (!response.ok) {
        throw new Error(
          `Overpass API error: ${response.status} ${response.statusText}`,
        );
      }

      return response;
    } catch (err) {
      if (attempt < retries) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(
          `  Request failed, retrying in ${delay / 1000}s... (${(err as Error).message})`,
        );
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }

  throw new Error("Max retries exceeded");
}

// ── Query Execution ──────────────────────────────────────────────────────────

/**
 * Query the Overpass API for POIs matching the given filters along a route.
 * Automatically batches long routes into chunks.
 */
export async function queryOverpass(
  filters: string[],
  coords: Coordinate[],
  radius: number,
): Promise<OverpassElement[]> {
  if (coords.length <= CHUNK_SIZE) {
    const query = buildOverpassQuery(filters, coords, radius);
    const response = await fetchWithRetry(OVERPASS_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    const data = (await response.json()) as OverpassResponse;
    return data.elements;
  }

  // Batch queries for long routes
  console.log(
    `  Route has ${coords.length} sample points, splitting into batches...`,
  );
  const allElements: OverpassElement[] = [];

  for (
    let start = 0;
    start < coords.length;
    start += CHUNK_SIZE - CHUNK_OVERLAP
  ) {
    const end = Math.min(start + CHUNK_SIZE, coords.length);
    const chunk = coords.slice(start, end);

    const batchNum =
      Math.floor(start / (CHUNK_SIZE - CHUNK_OVERLAP)) + 1;
    const totalBatches = Math.ceil(
      coords.length / (CHUNK_SIZE - CHUNK_OVERLAP),
    );
    console.log(`  Querying batch ${batchNum}/${totalBatches}...`);

    const query = buildOverpassQuery(filters, chunk, radius);
    const response = await fetchWithRetry(OVERPASS_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    const data = (await response.json()) as OverpassResponse;
    allElements.push(...data.elements);

    // Rate-limit between batches
    if (end < coords.length) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  return allElements;
}

// ── Processing ───────────────────────────────────────────────────────────────

/**
 * Deduplicate Overpass elements by ID and convert to PointOfInterest[],
 * enriched with distance-along-route and classified/described by the provided processor.
 */
export function processElements(
  elements: OverpassElement[],
  routeCoords: Coordinate[],
  cumDist: number[],
  processor: PoiProcessor,
): PointOfInterest[] {
  // Deduplicate by OSM node ID
  const seen = new Set<number>();
  const unique: OverpassElement[] = [];

  for (const el of elements) {
    if (!seen.has(el.id)) {
      seen.add(el.id);
      unique.push(el);
    }
  }

  // Convert to PointOfInterest
  const pois: PointOfInterest[] = unique.map((el) => {
    const tags = el.tags ?? {};
    const poiType = processor.classify(tags);
    const name = tags["name"] || processor.defaultName(poiType);
    const description = processor.buildDescription(tags);
    const distanceAlongRoute = findDistanceAlongRoute(
      { lat: el.lat, lon: el.lon },
      routeCoords,
      cumDist,
    );

    return {
      id: el.id,
      lat: el.lat,
      lon: el.lon,
      name,
      poiType,
      description,
      distanceAlongRoute,
    };
  });

  // Sort by distance along route
  pois.sort((a, b) => a.distanceAlongRoute - b.distanceAlongRoute);

  return pois;
}
