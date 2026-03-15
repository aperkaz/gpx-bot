import type { PointOfInterest, WaypointType } from "./types.ts";
import {
  routeLength,
  downsampleRoute,
  cumulativeDistances,
} from "./geo.ts";
import { parseGpxFromString } from "./gpx.ts";
import { queryOverpass, processElements } from "./overpass.ts";
import { t, type Locale } from "./i18n.ts";

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_SAMPLE_POINTS = 400;

// ── Waypoint Registry ────────────────────────────────────────────────────────

export const WAYPOINT_TYPES: Record<string, WaypointType> = {
  water: {
    key: "water",
    label: "💧 Water",
    filters: [
      '["amenity"="drinking_water"]',
      '["amenity"="water_point"]',
      '["man_made"="water_tap"]["drinking_water"="yes"]',
      '["natural"="spring"]["drinking_water"="yes"]',
      '["amenity"="fountain"]["drinking_water"="yes"]',
    ],
    processor: {
      classify(tags) {
        if (tags["amenity"] === "drinking_water") return "Drinking Water";
        if (tags["amenity"] === "water_point") return "Water Point";
        if (tags["man_made"] === "water_tap") return "Water Tap";
        if (tags["natural"] === "spring") return "Spring";
        if (tags["amenity"] === "fountain") return "Fountain";
        return "Water Source";
      },
      buildDescription(tags) {
        const parts: string[] = [];
        if (tags["operator"]) parts.push(`Operator: ${tags["operator"]}`);
        if (tags["opening_hours"])
          parts.push(`Hours: ${tags["opening_hours"]}`);
        if (tags["description"]) parts.push(tags["description"]);
        if (tags["note"]) parts.push(`Note: ${tags["note"]}`);
        if (tags["access"] && tags["access"] !== "yes")
          parts.push(`Access: ${tags["access"]}`);
        if (tags["fee"] === "yes") parts.push("Fee required");
        if (tags["bottle"] === "yes") parts.push("Bottle refill available");
        if (tags["wheelchair"] === "yes") parts.push("Wheelchair accessible");
        return parts.join(". ");
      },
      defaultName(poiType) {
        return poiType;
      },
    },
  },

  fuel: {
    key: "fuel",
    label: "⛽️ Fuel",
    filters: ['["amenity"="fuel"]'],
    processor: {
      classify(_tags) {
        return "Gas Station";
      },
      buildDescription(tags) {
        const parts: string[] = [];
        if (tags["brand"]) parts.push(`Brand: ${tags["brand"]}`);
        if (tags["operator"]) parts.push(`Operator: ${tags["operator"]}`);
        if (tags["opening_hours"])
          parts.push(`Hours: ${tags["opening_hours"]}`);
        const fuels: string[] = [];
        if (tags["fuel:diesel"] === "yes") fuels.push("Diesel");
        if (tags["fuel:octane_95"] === "yes") fuels.push("Octane 95");
        if (tags["fuel:octane_98"] === "yes") fuels.push("Octane 98");
        if (tags["fuel:lpg"] === "yes") fuels.push("LPG");
        if (tags["fuel:cng"] === "yes") fuels.push("CNG");
        if (tags["fuel:e85"] === "yes") fuels.push("E85");
        if (tags["fuel:e10"] === "yes") fuels.push("E10");
        if (tags["fuel:HGV_diesel"] === "yes") fuels.push("HGV Diesel");
        if (fuels.length > 0) parts.push(`Fuel: ${fuels.join(", ")}`);
        if (tags["description"]) parts.push(tags["description"]);
        if (tags["note"]) parts.push(`Note: ${tags["note"]}`);
        if (tags["access"] && tags["access"] !== "yes")
          parts.push(`Access: ${tags["access"]}`);
        if (tags["payment:cash"] === "yes") parts.push("Cash accepted");
        if (tags["payment:credit_cards"] === "yes")
          parts.push("Credit cards accepted");
        if (tags["self_service"] === "yes") parts.push("Self-service");
        if (tags["wheelchair"] === "yes") parts.push("Wheelchair accessible");
        return parts.join(". ");
      },
      defaultName(poiType) {
        return poiType;
      },
    },
  },
};

// ── Public API ───────────────────────────────────────────────────────────────

/** Resolve "both" into all registered keys, or return the single key as an array */
export function resolveTypeKeys(type: string): string[] {
  if (type === "both") return Object.keys(WAYPOINT_TYPES);
  return [type];
}

/** Build a human-readable label from one or more type keys */
export function labelForTypes(typeKeys: string[]): string {
  return typeKeys.map((k) => WAYPOINT_TYPES[k].label).join(" & ");
}

/** Result of processing a GPX route for waypoints */
export type RouteSearchResult = {
  pois: PointOfInterest[];
  totalKm: string;
  /** Number of POIs found per waypoint key */
  countsByType: Record<string, number>;
};

/**
 * Find POIs of the given types along a GPX route.
 *
 * Parses the GPX, downsamples the route, queries Overpass for each
 * waypoint type in parallel, and returns a merged + sorted POI list.
 */
export async function findPoisAlongRoute(
  typeKeys: string[],
  gpxXml: string,
  radius: number,
): Promise<RouteSearchResult> {
  const coords = parseGpxFromString(gpxXml);
  const totalDist = routeLength(coords);
  const totalKm = (totalDist / 1000).toFixed(1);

  const sampled = downsampleRoute(coords, MAX_SAMPLE_POINTS);
  const cumDist = cumulativeDistances(coords);

  // Query all requested types in parallel
  const results = await Promise.all(
    typeKeys.map(async (key) => {
      const wt = WAYPOINT_TYPES[key];
      const elements = await queryOverpass(wt.filters, sampled, radius);
      const pois = processElements(elements, coords, cumDist, wt.processor);
      return { key, pois };
    }),
  );

  const countsByType: Record<string, number> = {};
  for (const { key, pois } of results) {
    countsByType[key] = pois.length;
  }

  const pois = results
    .flatMap((r) => r.pois)
    .sort((a, b) => a.distanceAlongRoute - b.distanceAlongRoute);

  return { pois, totalKm, countsByType };
}

/**
 * Build a brief text summary of the search results.
 * Counts are broken down per waypoint type when multiple types were queried.
 */
export function buildSummary(
  result: RouteSearchResult,
  typeKeys: string[],
  radius: number,
  locale: Locale = "en",
): string {
  const { pois, totalKm, countsByType } = result;
  const radiusKm = (radius / 1000).toFixed(0);

  // Get localized type label(s)
  let typeLabel: string;
  if (typeKeys.length === 1) {
    const key = typeKeys[0];
    const waypointLabel = key === "water" 
      ? t("water_label", locale) 
      : key === "fuel" 
        ? t("fuel_label", locale)
        : WAYPOINT_TYPES[key].label;
    typeLabel = waypointLabel.toLowerCase();
  } else {
    typeLabel = locale === "es" ? "puntos de interés" : "points of interest";
  }

  if (pois.length === 0) {
    return t("summary_empty", locale)
      .replace("{type}", typeLabel)
      .replace("{radius}", radiusKm)
      .replace("{distance}", totalKm);
  }

  const closestKm = (pois[0].distanceAlongRoute / 1000).toFixed(1);
  const furthestKm = (pois[pois.length - 1].distanceAlongRoute / 1000).toFixed(1);

  let summary = t("summary_found", locale)
    .replace("{count}", String(pois.length))
    .replace("{type}", typeLabel)
    .replace("{distance}", totalKm)
    .replace("{radius}", radiusKm);

  summary += "\n" + t("summary_closest", locale)
    .replace("{closest}", closestKm)
    .replace("{furthest}", furthestKm);

  if (typeKeys.length > 1) {
    const counts = typeKeys
      .map((key) => {
        const label = key === "water"
          ? t("water_label", locale)
          : key === "fuel"
            ? t("fuel_label", locale)
            : WAYPOINT_TYPES[key].label;
        return `${label}: ${countsByType[key] ?? 0}`;
      })
      .join(", ");
    summary += `\n${counts}.`;
  }

  return summary;
}
