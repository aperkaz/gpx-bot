# GPX Bot

Telegram bot that finds water sources and fuel stations along GPX routes. Send a `.gpx` file, pick what to find and a search radius, and get back a combined `.gpx` file with your original route plus points of interest as waypoints.

Built with [grammY](https://grammy.dev/) and [Deno](https://deno.com/), deployed on [Deno Deploy](https://deno.com/deploy).

## How it works

1. Send a `.gpx` file to the bot
2. Choose what to find: **Water**, **Fuel**, or **Both**
3. Pick a search radius: **1km**, **2km**, **5km**, or **10km**
4. Receive a `.gpx` file containing your route + discovered POIs

Data comes from [OpenStreetMap](https://www.openstreetmap.org/) via the [Overpass API](https://overpass-api.de/).

## Local development

### Prerequisites

- [Deno](https://docs.deno.com/runtime/getting_started/installation/) v2+
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### Run

```sh
export BOT_TOKEN=<your-bot-token>
deno task dev
```

The bot starts in long polling mode locally (no webhook or public URL needed).

## Deploy to Deno Deploy

1. Push the repo to GitHub
2. Create a project at [dash.deno.com](https://dash.deno.com) and link the repo (entrypoint: `main.ts`)
3. Add `BOT_TOKEN` as an environment variable
4. Register the webhook:
   ```sh
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<app>.deno.dev/<TOKEN>"
   ```
