import { Bot, InlineKeyboard, InputFile } from "grammy";
import {
  routeLength,
  downsampleRoute,
  cumulativeDistances,
} from "./services/geo.ts";
import { parseGpxFromString, generateGpx } from "./services/gpx.ts";
import { queryOverpass, processElements } from "./services/overpass.ts";
import type { PoiProcessor, PointOfInterest } from "./services/types.ts";

// ── Configuration ────────────────────────────────────────────────────────────

const MAX_SAMPLE_POINTS = 400;

const WATER_FILTERS = [
  '["amenity"="drinking_water"]',
  '["amenity"="water_point"]',
  '["man_made"="water_tap"]["drinking_water"="yes"]',
  '["natural"="spring"]["drinking_water"="yes"]',
  '["amenity"="fountain"]["drinking_water"="yes"]',
];

const FUEL_FILTERS = ['["amenity"="fuel"]'];

const waterProcessor: PoiProcessor = {
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

const fuelProcessor: PoiProcessor = {
  classify(_tags) {
    return "Gas Station";
  },
  buildDescription(tags) {
    const parts: string[] = [];
    if (tags["brand"]) parts.push(`Brand: ${tags["brand"]}`);
    if (tags["operator"]) parts.push(`Operator: ${tags["operator"]}`);
    if (tags["opening_hours"]) parts.push(`Hours: ${tags["opening_hours"]}`);
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
};

// ── Bot Setup ────────────────────────────────────────────────────────────────

const token = Deno.env.get("BOT_TOKEN");
if (!token) {
  throw new Error("BOT_TOKEN environment variable is not set");
}

export const bot = new Bot(token);

bot.catch((err) => {
  console.error("[ERROR] Unhandled bot error:", err.error);
});

// Log all incoming messages
bot.use(async (ctx, next) => {
  const from = ctx.from?.username ?? ctx.from?.first_name ?? "unknown";
  if (ctx.message) {
    const msg = ctx.message;
    if ("text" in msg && msg.text) {
      console.log(`[MSG] ${from}: "${msg.text}"`);
    } else if ("document" in msg && msg.document) {
      console.log(`[MSG] ${from}: sent file "${msg.document.file_name}" (${msg.document.file_size} bytes)`);
    } else {
      console.log(`[MSG] ${from}: sent a message (no text/document)`);
    }
  } else if (ctx.callbackQuery) {
    console.log(`[MSG] ${from}: pressed button "${ctx.callbackQuery.data}"`);
  }
  try {
    await next();
  } catch (err) {
    console.error(`[ERROR] Handler failed:`, err);
    throw err;
  }
});

// ── Handlers ─────────────────────────────────────────────────────────────────

const WELCOME_TEXT = `Welcome to GPX Bot!

Send me a .gpx file with your route and I'll find water sources and fuel stations along it.

How it works:
1. Send a .gpx file
2. Choose what to find (water, fuel, or both)
3. Pick a search radius
4. Get back a .gpx file with your route + points of interest`;

bot.command("start", (ctx) => ctx.reply(WELCOME_TEXT));
bot.command("help", (ctx) => ctx.reply(WELCOME_TEXT));

// Handle document uploads
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const fileName = doc.file_name ?? "";

  if (!fileName.toLowerCase().endsWith(".gpx")) {
    await ctx.reply(
      "Please send a .gpx file. Other file types are not supported.",
    );
    return;
  }

  const keyboard = new InlineKeyboard()
    .text("Water", "water")
    .text("Fuel", "fuel")
    .text("Both", "both");

  await ctx.reply("Got your GPX route! What should I find along it?", {
    reply_markup: keyboard,
    reply_parameters: { message_id: ctx.message.message_id },
  });
});

// Handle type selection → show radius picker
bot.callbackQuery(/^(water|fuel|both)$/, async (ctx) => {
  const type = ctx.match[1];
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text("1 km", `${type}:1000`)
    .text("2 km", `${type}:2000`)
    .text("5 km", `${type}:5000`)
    .text("10 km", `${type}:10000`);

  await ctx.editMessageText(`Finding ${type} sources. Pick a search radius:`, {
    reply_markup: keyboard,
  });
});

// Handle radius selection → process the GPX file
bot.callbackQuery(/^(water|fuel|both):(\d+)$/, async (ctx) => {
  const type = ctx.match[1];
  const radius = parseInt(ctx.match[2], 10);

  await ctx.answerCallbackQuery("Processing your route...");

  try {
    // Extract file_id from the original message this reply was sent to
    const replyTo = ctx.callbackQuery.message?.reply_to_message;
    const fileId =
      replyTo && "document" in replyTo ? replyTo.document?.file_id : undefined;

    if (!fileId) {
      await ctx.editMessageText(
        "Could not find the original GPX file. Please send it again.",
      );
      return;
    }

    await ctx.editMessageText("Downloading your GPX file...");

    // Download the file from Telegram
    const file = await ctx.api.getFile(fileId);
    const filePath = file.file_path;
    if (!filePath) {
      await ctx.editMessageText(
        "Could not download the file. Please try again.",
      );
      return;
    }

    const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const response = await fetch(fileUrl);
    const originalGpxXml = await response.text();

    // Parse GPX
    await ctx.editMessageText("Parsing your route...");
    const coords = parseGpxFromString(originalGpxXml);
    const totalDist = routeLength(coords);
    const totalKm = (totalDist / 1000).toFixed(1);

    // Downsample
    const sampled = downsampleRoute(coords, MAX_SAMPLE_POINTS);
    const cumDist = cumulativeDistances(coords);

    // Query Overpass API
    await ctx.editMessageText(
      `Searching for ${type} along your ${totalKm}km route...`,
    );

    let allPois: PointOfInterest[] = [];

    if (type === "both") {
      // Run water and fuel queries in parallel
      const [waterElements, fuelElements] = await Promise.all([
        queryOverpass(WATER_FILTERS, sampled, radius),
        queryOverpass(FUEL_FILTERS, sampled, radius),
      ]);
      const waterPois = processElements(
        waterElements,
        coords,
        cumDist,
        waterProcessor,
      );
      const fuelPois = processElements(
        fuelElements,
        coords,
        cumDist,
        fuelProcessor,
      );
      allPois = [...waterPois, ...fuelPois].sort(
        (a, b) => a.distanceAlongRoute - b.distanceAlongRoute,
      );
    } else if (type === "water") {
      const elements = await queryOverpass(WATER_FILTERS, sampled, radius);
      allPois = processElements(elements, coords, cumDist, waterProcessor);
    } else {
      const elements = await queryOverpass(FUEL_FILTERS, sampled, radius);
      allPois = processElements(elements, coords, cumDist, fuelProcessor);
    }

    // Generate combined GPX (original track + POI waypoints)
    const typeLabel =
      type === "both"
        ? "Water & Fuel"
        : type === "water"
          ? "Water Sources"
          : "Fuel Stations";
    const gpxOutput = generateGpx(
      allPois,
      {
        name: `${typeLabel} along route`,
        description: `${allPois.length} ${typeLabel.toLowerCase()} found within ${radius}m of the route`,
      },
      originalGpxXml,
    );

    // Build brief summary
    const summary = buildSummary(allPois, totalKm, type, radius);

    // Send results
    const gpxBuffer = new TextEncoder().encode(gpxOutput);
    const fileName = `route-${type}.gpx`;

    await ctx.editMessageText(summary);
    await ctx.replyWithDocument(new InputFile(gpxBuffer, fileName), {
      reply_parameters: { message_id: replyTo!.message_id },
    });
  } catch (err) {
    console.error("Processing error:", err);
    await ctx.editMessageText(
      "Sorry, I couldn't process your file. The route might be too large or the map service is temporarily unavailable. Please try again later.",
    );
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildSummary(
  pois: PointOfInterest[],
  totalKm: string,
  type: string,
  radius: number,
): string {
  const typeLabel =
    type === "both"
      ? "points of interest"
      : type === "water"
        ? "water sources"
        : "fuel stations";
  const radiusKm = (radius / 1000).toFixed(0);

  if (pois.length === 0) {
    return `No ${typeLabel} found within ${radiusKm}km of your ${totalKm}km route.`;
  }

  const closestKm = (pois[0].distanceAlongRoute / 1000).toFixed(1);
  const furthestKm = (pois[pois.length - 1].distanceAlongRoute / 1000).toFixed(
    1,
  );

  let summary = `Found ${pois.length} ${typeLabel} along your ${totalKm}km route (${radiusKm}km radius).`;
  summary += `\nClosest at ${closestKm}km, furthest at ${furthestKm}km.`;

  if (type === "both") {
    const waterCount = pois.filter((p) => p.poiType !== "Gas Station").length;
    const fuelCount = pois.filter((p) => p.poiType === "Gas Station").length;
    summary += `\nWater: ${waterCount}, Fuel: ${fuelCount}.`;
  }

  return summary;
}
