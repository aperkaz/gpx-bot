import { readFileSync, writeFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { gpx } from "@tmcw/togeojson";
import type { Coordinate, PointOfInterest, GpxOutputConfig } from "./types.ts";

// ── GPX Parsing ──────────────────────────────────────────────────────────────

/** Parse a GPX file and extract all track coordinates */
export function parseGpx(filePath: string): Coordinate[] {
  const xml = readFileSync(filePath, "utf-8");
  const dom = new DOMParser().parseFromString(xml, "text/xml");
  const geojson = gpx(dom);

  const coords: Coordinate[] = [];

  for (const feature of geojson.features) {
    const geom = feature.geometry;
    if (!geom) continue;

    if (geom.type === "LineString") {
      for (const [lon, lat] of geom.coordinates) {
        coords.push({ lat, lon });
      }
    } else if (geom.type === "MultiLineString") {
      for (const line of geom.coordinates) {
        for (const [lon, lat] of line) {
          coords.push({ lat, lon });
        }
      }
    }
  }

  if (coords.length === 0) {
    console.error("Error: No track points found in GPX file");
    process.exit(1);
  }

  return coords;
}

// ── XML Utilities ────────────────────────────────────────────────────────────

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── GPX Output ───────────────────────────────────────────────────────────────

/** Generate a GPX file with points of interest as waypoints */
export function generateGpx(
  pois: PointOfInterest[],
  config: GpxOutputConfig,
): string {
  const now = new Date().toISOString();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="hydrate"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(config.name)}</name>
    <desc>${escapeXml(config.description)}</desc>
    <time>${now}</time>
  </metadata>
`;

  for (const poi of pois) {
    const distKm = (poi.distanceAlongRoute / 1000).toFixed(1);
    const desc = poi.description
      ? `${escapeXml(poi.description)}. At ~${distKm}km along route.`
      : `At ~${distKm}km along route.`;

    xml += `  <wpt lat="${poi.lat}" lon="${poi.lon}">
    <name>${escapeXml(poi.name)}</name>
    <desc>${desc}</desc>
    <type>${escapeXml(poi.poiType)}</type>
    <sym>${escapeXml(config.defaultSymbol)}</sym>
  </wpt>
`;
  }

  xml += `</gpx>
`;

  return xml;
}

/** Write a GPX string to a file */
export function writeGpx(filePath: string, gpxContent: string): void {
  writeFileSync(filePath, gpxContent, "utf-8");
}
