import { Bot, InlineKeyboard, InputFile } from "grammy/mod.ts";
import { generateGpx } from "./services/gpx.ts";
import {
  WAYPOINT_TYPES,
  resolveTypeKeys,
  labelForTypes,
  findPoisAlongRoute,
  buildSummary,
} from "./services/waypoint-metadata.ts";

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
      console.log(
        `[MSG] ${from}: sent file "${msg.document.file_name}" (${msg.document.file_size} bytes)`,
      );
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
4. Get back a .gpx file with your route + points of interest

In group chats, send /gpx_metadata and I'll ask you to forward the GPX file`;

bot.command("start", (ctx) => ctx.reply(WELCOME_TEXT));
bot.command("help", (ctx) => ctx.reply(WELCOME_TEXT));

// /gpx_metadata: in groups, ask user to forward the GPX file
bot.command("gpx_metadata", async (ctx) => {
  await ctx.reply(
    "Please forward me the GPX file you'd like me to analyze.",
  );
});

// Handle document uploads — show type picker
bot.on("message:document", async (ctx) => {
  const fileName = ctx.message.document.file_name ?? "";

  if (!fileName.toLowerCase().endsWith(".gpx")) {
    await ctx.reply(
      "Please send a .gpx file. Other file types are not supported.",
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const key of Object.keys(WAYPOINT_TYPES)) {
    keyboard.text(WAYPOINT_TYPES[key].label, key);
  }
  if (Object.keys(WAYPOINT_TYPES).length > 1) {
    keyboard.text("Both", "both");
  }
  await ctx.reply("Got your GPX route! What should I find along it?", {
    reply_markup: keyboard,
    reply_parameters: { message_id: ctx.message.message_id },
  });
});

// Build the callback pattern from registered keys + "both"
const typePattern = [...Object.keys(WAYPOINT_TYPES), "both"].join("|");

// Handle type selection → show radius picker
bot.callbackQuery(new RegExp(`^(${typePattern})$`), async (ctx) => {
  const type = ctx.match[1];
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text("1 km", `${type}:1000`)
    .text("2 km", `${type}:2000`)
    .text("5 km", `${type}:5000`)
    .text("10 km", `${type}:10000`);

  const label = labelForTypes(resolveTypeKeys(type));
  await ctx.editMessageText(
    `Finding ${label.toLowerCase()}. Pick a search radius:`,
    { reply_markup: keyboard },
  );
});

// Handle radius selection → process the GPX file
bot.callbackQuery(new RegExp(`^(${typePattern}):(\\d+)$`), async (ctx) => {
  const type = ctx.match[1];
  const radius = parseInt(ctx.match[2], 10);
  const typeKeys = resolveTypeKeys(type);
  const label = labelForTypes(typeKeys);

  await ctx.answerCallbackQuery("Processing your route...");

  try {
    // Retrieve the original GPX file from the message this reply was sent to
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
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      await ctx.editMessageText(
        "Could not download the file. Please try again.",
      );
      return;
    }

    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const originalGpxXml = await (await fetch(fileUrl)).text();

    // Search for POIs along the route
    await ctx.editMessageText(
      `Searching for ${label.toLowerCase()} along your route...`,
    );
    const result = await findPoisAlongRoute(typeKeys, originalGpxXml, radius);

    // Generate combined GPX (original track + POI waypoints)
    const gpxOutput = generateGpx(
      result.pois,
      {
        name: `${label} along route`,
        description: `${result.pois.length} ${label.toLowerCase()} found within ${radius}m of the route`,
      },
      originalGpxXml,
    );

    // Send results
    const summary = buildSummary(result, typeKeys, radius);
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
