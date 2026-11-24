# KAIST Event Radar

A private Russian-language Telegram bot for KAIST, South Korea, Kazakhstan, and global online opportunities. The daily digest runs at 09:00 KST and shows up to five cards, with today's applications and deadlines in the next 72 hours first. The reply keyboard and commands `/kaist`, `/korea`, `/kz`, `/online`, `/hackathons`, `/startups`, `/deadlines`, and `/scan` open the latest matching results. Inline buttons open the application or event announcement and page through longer lists.

## Collection

The source registry in [catalog.mjs](catalog.mjs) combines university and organizer calendars, public search feeds in Korean, Kazakh, Russian, and English, and specialist directories. Search results are leads. The collector opens specific pages and looks for dated event or registration evidence. When an organizer page is blocked, an independently accessible event-specific detail can still provide an announcement. Missing dates, timezones, or registration status are shown as unknown. The private KAIST Portal is outside this public-source collection.

A single cron dispatches four regional requests to SQLite-backed Durable Objects, with up to 45 external fetches per region including redirects, five concurrent requests per region, and bounded response sizes. A separate bounded request verifies external application links and falls back to the announcement if a link fails. The coordinator stores the merged daily snapshot, revisits a few active records that fell out of listings, and keeps delivery history. Partial outages can reuse recently verified records for up to three days. Telegram reports partial coverage in one line and source diagnostics go to Worker logs. A daily send records each accepted batch and retries transient failures with an alarm. Commands read the stored snapshot without calling source sites.

This runs on Workers Free with SQLite Durable Objects and uses public sources without a Gemini key or a paid search API.

## Deploy

1. Create a bot with [BotFather](https://t.me/BotFather).
2. Deploy with `npx wrangler deploy`. The first deploy of this version applies the SQLite Durable Object migration.
3. Set the bot token privately with `npx wrangler secret put TELEGRAM_BOT_TOKEN`.
4. With the token set in your local environment, run `node setup-telegram.mjs "$WORKER_URL"` to register the webhook and command menu. Rerun for an existing webhook if it was restricted to message updates.
5. Request `/id` from your bot and set the owner's private chat ID with `npx wrangler secret put OWNER_CHAT_ID`, or use the existing dashboard binding. Send `/start` for the keyboard. The first scheduled collection populates the snapshot used by `/scan`.

The Worker saves the existing dashboard variables on deployment through `keep_vars`. Keep tokens, real chat IDs, and personal endpoint URLs outside version control.

## Verify locally

- `node --test` exercises collection, date and status handling, deduplication, snapshots, Telegram HTML and navigation, and delivery retries through a test transport.
- `node scripts/live.mjs` runs all four regions against public sources and prints the counts and Telegram payload. Pass a path as the first argument to save the complete result. Set `RADAR_NOW` to an ISO timestamp to keep cutoff comparisons consistent.
- `npx wrangler deploy --dry-run` checks the Worker bundle and bindings.
