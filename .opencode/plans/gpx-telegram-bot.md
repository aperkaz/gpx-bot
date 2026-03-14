# Plan: GPX Bot — Telegram Bot on Deno Deploy

## Overview

Transform the existing Node.js CLI tool into a Telegram bot deployed on Deno Deploy.
Users send a `.gpx` file, choose water/fuel/both and a search radius, and receive back
a single `.gpx` file containing their **original route track plus POI waypoints** and a
brief text summary.

## Architecture

```
User (Telegram) → Telegram API → Deno Deploy (webhook) → grammY bot
                                                          ├── Download + parse GPX (in-memory)
                                                          ├── Query Overpass API
                                                          ├── Generate combined GPX (original track + POIs)
                                                          └── Reply with GPX file + brief summary
```

## Resolved Decisions

| Decision                | Resolution                                                       |
| ----------------------- | ---------------------------------------------------------------- |
| CLI preservation        | Full replacement — bot only, drop CLI                            |
| XML/GPX parsing         | Keep npm deps via `npm:` specifiers (`@xmldom/xmldom`, `@tmcw/togeojson`) |
| Bot framework           | grammY (first-class Deno support, webhook integration)           |
| Interaction flow        | File → Type picker → Radius picker → Results                    |
| Stateless handling      | Re-download file via `file_id` from replied-to message           |
| Callback data           | `type:radius` format (e.g. `water:1000`), file_id from reply_to |
| Radius config           | Inline keyboard picker: 1km, 2km, 5km, 10km                     |
| Timeout handling        | Accept timeouts for extreme routes                               |
| Error handling          | User-friendly messages + server-side logging                     |
| File validation         | Extension + MIME check before processing                         |
| Text summary            | Brief (count, route length, closest/furthest)                    |
| "Both" option           | Single combined GPX, Overpass queries run in parallel             |
| Response GPX content    | Original track + POI waypoints in one file                       |
| Bot token               | Deno Deploy env var (`BOT_TOKEN`)                                |
| Webhook setup           | One-time `curl` command (documented)                             |
| Project structure       | Flat: `main.ts`, `bot.ts`, `services/`, `deno.json`             |
| Sample files            | Keep `sample.gpx` only                                          |
| Deployment              | Deno Deploy GitHub integration (auto-deploy on push to main)     |
| Local dev               | Long polling via `deno task dev`                                 |

## User Interaction Flow

```
1. User sends .gpx file to bot
2. Bot validates file (extension check)
3. Bot replies TO the file message with inline keyboard:
     [ Water ]  [ Fuel ]  [ Both ]
4. User taps type button
5. Bot edits the reply to show radius picker:
     [ 1 km ]  [ 2 km ]  [ 5 km ]  [ 10 km ]
   Callback data encodes both type + radius (e.g. "water:1000")
6. User taps radius button
7. Bot:
   a. Answers callback with "Processing your route..."
   b. Extracts file_id from ctx.callbackQuery.message.reply_to_message.document
   c. Downloads the GPX file from Telegram
   d. Parses GPX, downsamples route
   e. Queries Overpass API (parallel for "both")
   f. Generates combined GPX (original track + POI waypoints)
   g. Replies with brief text summary + GPX file as document
```

## Target Project Structure

```
gpx-bot/
├── main.ts                 ← Entry point: webhook (prod) or polling (dev)
├── bot.ts                  ← grammY bot definition + all handlers
├── services/
│   ├── types.ts            ← Shared type definitions (updated)
│   ├── geo.ts              ← Geographic math (unchanged)
│   ├── gpx.ts              ← GPX parsing + generation (refactored)
│   └── overpass.ts         ← Overpass API client (unchanged)
├── deno.json               ← Import map, tasks, config
├── sample.gpx              ← Sample GPX file for testing
└── .gitignore
```

### Files to delete

- `hydrate.ts` — CLI entry point (replaced by bot)
- `fuel.ts` — CLI entry point (replaced by bot)
- `services/cli.ts` — CLI arg parsing (not needed)
- `package.json` — Node.js manifest (replaced by deno.json)
- `package-lock.json` — Node.js lockfile
- `tsconfig.json` — Replaced by deno.json compilerOptions
- `node_modules/` — Deno manages deps automatically
- `EuroVelo.gpx`, `EuroVelo-water.gpx`, `EuroVelo-fuel.gpx` — Large test data
- `sample-water.gpx`, `sample-fuel.gpx` — CLI output samples

## Implementation Steps

### Step 1: Project restructuring

- Delete all files listed in "Files to delete" above
- Create `deno.json`:
  ```json
  {
    "tasks": {
      "dev": "deno run --allow-net --allow-env main.ts"
    },
    "imports": {
      "grammy": "https://deno.land/x/grammy/mod.ts",
      "@xmldom/xmldom": "npm:@xmldom/xmldom@^0.8.11",
      "@tmcw/togeojson": "npm:@tmcw/togeojson@^7.1.2"
    }
  }
  ```
- Update `.gitignore` (remove node_modules reference, keep minimal)

### Step 2: Port `services/` to Deno

#### `services/types.ts`
- Remove `CliConfig` and `CliArgs` types (CLI-only)
- Keep: `Coordinate`, `OverpassElement`, `OverpassResponse`, `PointOfInterest`,
  `GpxOutputConfig`, `PoiProcessor`

#### `services/geo.ts`
- No changes needed (pure math, no Node APIs)

#### `services/gpx.ts` — Significant refactoring
- **Parsing**: Rename `parseGpx(filePath)` → `parseGpxFromString(xml: string): Coordinate[]`
  - Remove `readFileSync` — accept raw XML string instead
  - Replace `process.exit(1)` with `throw new Error(...)`
  - Update `@xmldom/xmldom` / `@tmcw/togeojson` imports to use import map
- **Remove**: `writeGpx()` — not needed (no filesystem on Deno Deploy)
- **Key change — `generateGpx()`**: Accept the original GPX XML string and embed
  the original `<trk>` elements alongside the new `<wpt>` elements:
  - New signature: `generateGpx(pois, config, originalGpxXml)`
  - Parse the original XML with DOMParser
  - Extract all `<trk>` elements from the original document
  - Serialize them into the output GPX, placed after the `<wpt>` entries
  - This gives the user a single file with their route visible plus all POI markers
- Keep: `escapeXml()` utility

#### `services/overpass.ts`
- No changes needed — already uses `fetch()`, `setTimeout`, and local imports only

### Step 3: Create `bot.ts`

grammY bot definition with all handlers:

```
Handlers:
├── /start command      → Welcome message + usage instructions
├── /help command       → Same as /start
├── on :document        → Validate .gpx extension, reply with type picker keyboard
├── callbackQuery /^(water|fuel|both)$/
│                       → Edit message to show radius picker keyboard
│                         Callback data for radius buttons: "water:1000", "fuel:5000", etc.
└── callbackQuery /^(water|fuel|both):\d+$/
                        → Full processing pipeline:
                          1. Answer callback query with "Processing..."
                          2. Extract file_id from reply_to_message.document
                          3. Download file via bot.api.getFile() + fetch
                          4. parseGpxFromString(content) → coordinates
                          5. downsampleRoute(coords, 400)
                          6. cumulativeDistances(sampled)
                          7. queryOverpass(filters, sampled, radius)
                             - For "both": Promise.all([waterQuery, fuelQuery])
                          8. processElements(elements, ..., processor)
                          9. generateGpx(pois, config, originalGpxXml)  ← includes original track
                         10. Send brief summary text
                         11. Send GPX as InputFile from Uint8Array buffer
```

POI configuration (moved from hydrate.ts / fuel.ts):
- Water filters: `amenity=drinking_water`, `amenity=water_point`, `man_made=water_tap`,
  `natural=spring`, `amenity=fountain` (all with drinking_water qualifiers)
- Fuel filters: `amenity=fuel`
- Water PoiProcessor: classify → Drinking Water / Water Point / Water Tap / Spring / Fountain
- Fuel PoiProcessor: classify → Gas Station

Error handling wrapper:
- Catch all errors in processing pipeline
- Send user-friendly message: "Sorry, couldn't process your file. Try again later."
- Log full error to console (visible in Deno Deploy logs)

### Step 4: Create `main.ts`

Entry point that detects environment and runs accordingly:

```typescript
import { webhookCallback } from "grammy";
import { bot } from "./bot.ts";

// Detect Deno Deploy vs local
if (Deno.env.get("DENO_DEPLOYMENT_ID")) {
  // Production: webhook mode
  const handleUpdate = webhookCallback(bot, "std/http");
  Deno.serve(async (req) => {
    if (req.method === "POST") {
      const url = new URL(req.url);
      if (url.pathname.slice(1) === bot.token) {
        try {
          return await handleUpdate(req);
        } catch (err) {
          console.error(err);
        }
      }
    }
    return new Response();
  });
} else {
  // Local dev: long polling
  bot.start();
}
```

### Step 5: Test locally

1. Create a test bot via @BotFather on Telegram
2. Export `BOT_TOKEN=<token>`
3. Run `deno task dev`
4. Send `sample.gpx` to the bot
5. Verify: type picker → radius picker → combined GPX response with track + POIs
6. Verify: error cases (non-GPX file, invalid GPX, empty route)

### Step 6: Deploy

1. Push to `github.com/aperkaz/gpx-bot`
2. Create a Deno Deploy project at https://dash.deno.com
3. Link the GitHub repo, set entrypoint to `main.ts`
4. Add `BOT_TOKEN` environment variable in Deno Deploy dashboard
5. Register webhook:
   ```sh
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<app>.deno.dev/<TOKEN>"
   ```
6. Test with the production bot

## Key Technical Details

### Combined GPX Output (original track + POIs)

The `generateGpx()` function will produce a GPX 1.1 file structured as:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="gpx-bot" ...>
  <metadata>
    <name>Water sources along route</name>
    <desc>Found 12 water sources</desc>
    <time>2026-03-14T...</time>
  </metadata>

  <!-- POI waypoints -->
  <wpt lat="42.123" lon="2.456">
    <name>Mountain Spring</name>
    <desc>At ~12.3km along route.</desc>
    <type>drinking_water</type>
    <sym>Drinking Water</sym>
  </wpt>
  ...

  <!-- Original track from input GPX -->
  <trk>
    <name>EuroVelo Route</name>
    <trkseg>
      <trkpt lat="42.100" lon="2.400">...</trkpt>
      ...
    </trkseg>
  </trk>
</gpx>
```

Implementation approach in `generateGpx()`:
1. Accept `originalGpxXml: string` as a third parameter
2. Parse the original XML with DOMParser
3. Extract all `<trk>` elements via `getElementsByTagName("trk")`
4. Serialize each `<trk>` element using XMLSerializer (from `@xmldom/xmldom`)
5. Append the serialized tracks after the `<wpt>` entries in the output

### Deno Deploy Free Tier Constraints

- **50ms CPU limit**: Network I/O (Overpass queries, Telegram file download/upload)
  is excluded. CPU-bound work (GPX parsing, haversine math, string generation) is
  lightweight and fits comfortably.
- **No filesystem**: All processing is in-memory (strings and buffers).
- **Request timeout ~2min**: Realistic Overpass queries for most routes complete in
  5-30 seconds. Extreme routes may timeout — this is accepted.

### Callback Data Encoding

Step 3 (type picker) callback data:
- `water`, `fuel`, `both` — under 64-byte limit

Step 4 (radius picker) callback data:
- `water:1000`, `fuel:2000`, `both:5000`, etc. — under 64-byte limit

The `file_id` is never stored in callback data. It is extracted at processing time
from `ctx.callbackQuery.message.reply_to_message.document.file_id`.
