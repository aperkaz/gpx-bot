import { parseArgs } from "./services/cli.ts";
import { routeLength, downsampleRoute, cumulativeDistances } from "./services/geo.ts";
import { parseGpx, generateGpx, writeGpx } from "./services/gpx.ts";
import { queryOverpass, processElements } from "./services/overpass.ts";
import type { PoiProcessor, PointOfInterest } from "./services/types.ts";

// ── Configuration ────────────────────────────────────────────────────────────

const MAX_SAMPLE_POINTS = 400;

const OVERPASS_FILTERS = [
  '["amenity"="drinking_water"]',
  '["amenity"="water_point"]',
  '["man_made"="water_tap"]["drinking_water"="yes"]',
  '["natural"="spring"]["drinking_water"="yes"]',
  '["amenity"="fountain"]["drinking_water"="yes"]',
];

const processor: PoiProcessor = {
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
    if (tags["opening_hours"]) parts.push(`Hours: ${tags["opening_hours"]}`);
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
};

// ── Console Summary ──────────────────────────────────────────────────────────

function printSummary(sources: PointOfInterest[]): void {
  if (sources.length === 0) {
    console.log("\nNo drinkable water sources found along the route.");
    return;
  }

  console.log(`\nFound ${sources.length} water source(s):\n`);
  console.log(
    "  #  | km    | Type             | Name                           | Coordinates",
  );
  console.log(
    "  ---|-------|------------------|--------------------------------|-------------------------",
  );

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const num = String(i + 1).padStart(3);
    const km = (src.distanceAlongRoute / 1000).toFixed(1).padStart(5);
    const type = src.poiType.padEnd(16);
    const name = (src.name.length > 30
      ? src.name.slice(0, 27) + "..."
      : src.name
    ).padEnd(30);
    const coord = `${src.lat.toFixed(5)}, ${src.lon.toFixed(5)}`;

    console.log(`  ${num} | ${km} | ${type} | ${name} | ${coord}`);
  }

  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { inputFile, radius, outputFile } = parseArgs({
    scriptName: "hydrate",
    description: "Find drinkable water sources along a GPX route",
    defaultSuffix: "-water",
    defaultRadius: 1000,
  });

  console.log(`\nhydrate - Finding drinkable water along your route\n`);
  console.log(`  Input:  ${inputFile}`);
  console.log(`  Radius: ${radius}m`);
  console.log(`  Output: ${outputFile}`);

  // 1. Parse GPX
  console.log("\n[1/4] Parsing GPX file...");
  const coords = parseGpx(inputFile);
  const totalDist = routeLength(coords);
  console.log(
    `  Found ${coords.length} track points (${(totalDist / 1000).toFixed(1)} km)`,
  );

  // 2. Downsample
  console.log("\n[2/4] Preparing route for query...");
  const sampled = downsampleRoute(coords, MAX_SAMPLE_POINTS);
  console.log(
    `  Using ${sampled.length} sample points for Overpass API query`,
  );

  if (sampled.length > 800) {
    console.log("  Warning: Very long route - query may take a while");
  }

  // 3. Query Overpass API
  console.log("\n[3/4] Querying OpenStreetMap for water sources...");
  const elements = await queryOverpass(OVERPASS_FILTERS, sampled, radius);
  console.log(`  Received ${elements.length} raw results from Overpass API`);

  // 4. Process and output
  console.log("\n[4/4] Processing results...");
  const cumDist = cumulativeDistances(coords);
  const sources = processElements(elements, coords, cumDist, processor);

  printSummary(sources);

  const gpxOutput = generateGpx(sources, {
    name: "Drinkable Water Sources",
    description: `Water sources found within ${radius}m of the route using OpenStreetMap data`,
    defaultSymbol: "Drinking Water",
  });
  writeGpx(outputFile, gpxOutput);
  console.log(`Water sources written to: ${outputFile}`);
}

main().catch((err) => {
  console.error(`\nFatal error: ${(err as Error).message}`);
  process.exit(1);
});
