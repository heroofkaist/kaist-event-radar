# KAIST Event Radar

A personal Telegram bot for discovering KAIST seminars, hackathons and startup competitions in South Korea, Kazakhstan and online. It replies in Russian and runs a daily digest at 09:00 KST.

The Cloudflare Worker queries public event directories and news feeds. When configured with an eligible Gemini API project, it also attempts grounded search. Source failures are logged and empty categories are skipped. News headlines are separated from event announcements. Availability and deadlines should be checked with the organizer. Private KAIST Portal announcements require a separate authorized integration.

## Deploy on Cloudflare Workers

1. Create a Telegram bot with [BotFather](https://t.me/BotFather).
2. Run `npx wrangler deploy`. The cron expression in `wrangler.toml` runs daily at 00:00 UTC.
3. Run `npx wrangler secret put TELEGRAM_BOT_TOKEN`. Optionally set `GEMINI_API_KEY` the same way. The worker uses public sources when the Gemini key is absent or the model is unavailable.
4. Export `TELEGRAM_BOT_TOKEN` in your local shell and run `node setup-telegram.mjs https://YOUR-WORKER.workers.dev`. This registers the authenticated webhook and the Telegram command menu.
5. Send `/id` to the bot, and put the returned chat ID into the worker's production variables as `OWNER_CHAT_ID`. Send `/start` for the keyboard and `/scan` for a test.

The worker requires a single owner and only responds to search commands in that owner's private chat. Never commit tokens or real environment files.
