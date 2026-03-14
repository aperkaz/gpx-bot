import type { Coordinate } from "./types.ts";

// ── Constants ────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;

// ── Core Functions ───────────────────────────────────────────────────────────

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance between two coordinates in meters */
export function haversine(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Compute cumulative distances along a route (in meters) */
export function cumulativeDistances(coords: Coordinate[]): number[] {
  const distances = [0];
  for (let i = 1; i < coords.length; i++) {
    distances.push(distances[i - 1] + haversine(coords[i - 1], coords[i]));
  }
  return distances;
}

/** Total route length in meters */
export function routeLength(coords: Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine(coords[i - 1], coords[i]);
  }
  return total;
}

/** Downsample a route to at most maxPoints, preserving shape via distance-based sampling */
export function downsampleRoute(
  coords: Coordinate[],
  maxPoints: number,
): Coordinate[] {
  if (coords.length <= maxPoints) return coords;

  const totalLen = routeLength(coords);
  const threshold = totalLen / maxPoints;

  const sampled: Coordinate[] = [coords[0]];
  let accumulated = 0;

  for (let i = 1; i < coords.length; i++) {
    accumulated += haversine(coords[i - 1], coords[i]);
    if (accumulated >= threshold) {
      sampled.push(coords[i]);
      accumulated = 0;
    }
  }

  // Always include the last point
  const last = coords[coords.length - 1];
  const sampledLast = sampled[sampled.length - 1];
  if (sampledLast.lat !== last.lat || sampledLast.lon !== last.lon) {
    sampled.push(last);
  }

  return sampled;
}

/**
 * Find the distance along the route to the closest point to a given coordinate.
 */
export function findDistanceAlongRoute(
  point: Coordinate,
  routeCoords: Coordinate[],
  cumDist: number[],
): number {
  let minDist = Infinity;
  let bestIdx = 0;

  for (let i = 0; i < routeCoords.length; i++) {
    const d = haversine(point, routeCoords[i]);
    if (d < minDist) {
      minDist = d;
      bestIdx = i;
    }
  }

  return cumDist[bestIdx];
}
