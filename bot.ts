import { Bot, InlineKeyboard, InputFile } from "grammy/mod.ts";
import { generateGpx } from "./services/gpx.ts";
import {
  WAYPOINT_TYPES,
  resolveTypeKeys,
  labelForTypes,
  findPoisAlongRoute,
  buildSummary,
} from "./services/waypoint-metadata.ts";
import { t, getLocale } from "./services/i18n.ts";

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

bot.command("start", (ctx) => {
  const locale = getLocale(ctx.from?.language_code);
  return ctx.reply(t("welcome", locale));
});
bot.command("help", (ctx) => {
  const locale = getLocale(ctx.from?.language_code);
  return ctx.reply(t("welcome", locale));
});

// /gpx_metadata: in groups, ask user to forward the GPX file
bot.command("gpx_metadata", async (ctx) => {
  const locale = getLocale(ctx.from?.language_code);
  await ctx.reply(t("forward_request", locale));
});

// Handle document uploads — show type picker
bot.on("message:document", async (ctx) => {
  const locale = getLocale(ctx.from?.language_code);
  const fileName = ctx.message.document.file_name ?? "";

  if (!fileName.toLowerCase().endsWith(".gpx")) {
    await ctx.reply(t("not_gpx", locale));
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const key of Object.keys(WAYPOINT_TYPES)) {
    keyboard.text(WAYPOINT_TYPES[key].label, key);
  }
  if (Object.keys(WAYPOINT_TYPES).length > 1) {
    keyboard.text(locale === "es" ? "Ambos" : "Both", "both");
  }
  await ctx.reply(t("type_picker", locale), {
    reply_markup: keyboard,
    reply_parameters: { message_id: ctx.message.message_id },
  });
});

// Build the callback pattern from registered keys + "both"
const typePattern = [...Object.keys(WAYPOINT_TYPES), "both"].join("|");

// Handle type selection → show radius picker
bot.callbackQuery(new RegExp(`^(${typePattern})$`), async (ctx) => {
  const type = ctx.match[1];
  const locale = getLocale(ctx.from?.language_code);
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text("1 km", `${type}:1000`)
    .text("2 km", `${type}:2000`)
    .text("5 km", `${type}:5000`)
    .text("10 km", `${type}:10000`);

  const label = labelForTypes(resolveTypeKeys(type));
  await ctx.editMessageText(
    t("radius_picker", locale).replace("{type}", label.toLowerCase()),
    { reply_markup: keyboard },
  );
});

// Handle radius selection → process the GPX file
bot.callbackQuery(new RegExp(`^(${typePattern}):(\\d+)$`), async (ctx) => {
  const type = ctx.match[1];
  const radius = parseInt(ctx.match[2], 10);
  const typeKeys = resolveTypeKeys(type);
  const label = labelForTypes(typeKeys);
  const locale = getLocale(ctx.from?.language_code);

  await ctx.answerCallbackQuery(t("processing", locale));

  try {
    // Retrieve the original GPX file from the message this reply was sent to
    const replyTo = ctx.callbackQuery.message?.reply_to_message;
    const fileId =
      replyTo && "document" in replyTo ? replyTo.document?.file_id : undefined;

    if (!fileId) {
      await ctx.editMessageText(t("no_file", locale));
      return;
    }

    await ctx.editMessageText(t("downloading", locale));
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      await ctx.editMessageText(t("download_failed", locale));
      return;
    }

    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const originalGpxXml = await (await fetch(fileUrl)).text();

    // Search for POIs along the route
    const result = await findPoisAlongRoute(typeKeys, originalGpxXml, radius);
    const distance = result.totalKm;

    await ctx.editMessageText(
      t("searching", locale)
        .replace("{type}", label.toLowerCase())
        .replace("{distance}", distance),
    );

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
    const summary = buildSummary(result, typeKeys, radius, locale);
    const gpxBuffer = new TextEncoder().encode(gpxOutput);
    const fileName = `route-${type}.gpx`;

    await ctx.editMessageText(summary);
    await ctx.replyWithDocument(new InputFile(gpxBuffer, fileName), {
      reply_parameters: { message_id: replyTo!.message_id },
    });
  } catch (err) {
    console.error("Processing error:", err);
    await ctx.editMessageText(t("error", locale));
  }
});
