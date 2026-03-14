import { parseArgs } from "./services/cli.ts";
import { routeLength, downsampleRoute, cumulativeDistances } from "./services/geo.ts";
import { parseGpx, generateGpx, writeGpx } from "./services/gpx.ts";
import { queryOverpass, processElements } from "./services/overpass.ts";
import type { PoiProcessor, PointOfInterest } from "./services/types.ts";

// ── Configuration ────────────────────────────────────────────────────────────

const MAX_SAMPLE_POINTS = 400;

const OVERPASS_FILTERS = [
  '["amenity"="fuel"]',
];

const processor: PoiProcessor = {
  classify(tags) {
    return "Gas Station";
  },

  buildDescription(tags) {
    const parts: string[] = [];
    if (tags["brand"]) parts.push(`Brand: ${tags["brand"]}`);
    if (tags["operator"]) parts.push(`Operator: ${tags["operator"]}`);
    if (tags["opening_hours"]) parts.push(`Hours: ${tags["opening_hours"]}`);

    // Fuel types available
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
    if (tags["payment:credit_cards"] === "yes") parts.push("Credit cards accepted");
    if (tags["self_service"] === "yes") parts.push("Self-service");
    if (tags["wheelchair"] === "yes") parts.push("Wheelchair accessible");

    return parts.join(". ");
  },

  defaultName(poiType) {
    return poiType;
  },
};

// ── Console Summary ──────────────────────────────────────────────────────────

function printSummary(stations: PointOfInterest[]): void {
  if (stations.length === 0) {
    console.log("\nNo gas stations found along the route.");
    return;
  }

  console.log(`\nFound ${stations.length} gas station(s):\n`);
  console.log(
    "  #  | km    | Name                                     | Coordinates",
  );
  console.log(
    "  ---|-------|------------------------------------------|-------------------------",
  );

  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    const num = String(i + 1).padStart(3);
    const km = (s.distanceAlongRoute / 1000).toFixed(1).padStart(5);
    const name = (s.name.length > 40
      ? s.name.slice(0, 37) + "..."
      : s.name
    ).padEnd(40);
    const coord = `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`;

    console.log(`  ${num} | ${km} | ${name} | ${coord}`);
  }

  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { inputFile, radius, outputFile } = parseArgs({
    scriptName: "fuel",
    description: "Find gas stations along a GPX route",
    defaultSuffix: "-fuel",
    defaultRadius: 10_000,
  });

  console.log(`\nfuel - Finding gas stations along your route\n`);
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
  console.log("\n[3/4] Querying OpenStreetMap for gas stations...");
  const elements = await queryOverpass(OVERPASS_FILTERS, sampled, radius);
  console.log(`  Received ${elements.length} raw results from Overpass API`);

  // 4. Process and output
  console.log("\n[4/4] Processing results...");
  const cumDist = cumulativeDistances(coords);
  const stations = processElements(elements, coords, cumDist, processor);

  printSummary(stations);

  const gpxOutput = generateGpx(stations, {
    name: "Gas Stations",
    description: `Gas stations found within ${radius}m of the route using OpenStreetMap data`,
    defaultSymbol: "Gas Station",
  });
  writeGpx(outputFile, gpxOutput);
  console.log(`Gas stations written to: ${outputFile}`);
}

main().catch((err) => {
  console.error(`\nFatal error: ${(err as Error).message}`);
  process.exit(1);
});
