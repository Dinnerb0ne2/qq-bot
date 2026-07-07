# qq-bot

A QQ group-management bot on the **official** QQ bot platform (App ID + App
Secret from <https://q.qq.com>), built with the
[`qq-official-bot`](https://github.com/zhinjs/qq-official-bot) SDK. It connects
over WebSocket and reacts to group, private (C2C), and guild message events.

## Features

- **Group & private commands** — responds to group @-mentions and private (C2C)
  DMs; built-in commands are `ping`, `help`, and `news [YYYY-MM-DD]`.
- **Automatic ad moderation** — screens group messages for Chinese spam via a
  keyword baseline (≥ 2 distinct hits) plus regex patterns, recalls the message,
  tracks per-member strikes, and alerts an admin at the limit.
- **Live-editable rules** — ad keywords and patterns are unioned with a remote
  text file (this repo's `docs/ad-rules.txt` by default) refreshed on a
  schedule, so you retune a running bot by editing and pushing — no redeploy.
- **Daily AI news digest** — a scheduled job polls RSS/Atom feeds (resolved from
  a remote OPML), stores items in SQLite, and has an LLM (DeepSeek via an
  Anthropic-compatible endpoint) write one summary a day; the `news` command
  serves it instantly as Markdown with clickable per-source links.
- **Runs anywhere** — ships as a public Docker image on ghcr.io: a port-less
  outbound WebSocket client configured entirely through environment variables.

> **History note:** an earlier NapCatQQ + NcatBot (Python) implementation lives
> on the [`napcatqq`](https://github.com/isomoes/qq-bot/tree/napcatqq) branch;
> `main` was restarted from scratch for this stack.

## Project structure

```
src/
  index.ts     # entry point: creates the Bot, wires handlers, starts it
  config.ts    # loads & validates environment variables
  handlers.ts  # message handlers + a minimal command router
  ad/          # ad moderation: keyword + regex detection, remote-rule refresh, strikes
  news/        # daily AI news: feed fetch, SQLite storage, scheduler, LLM summarizer
```

### Prerequisites

1. Node.js ≥ 22.13 (`nvm use` picks up `.nvmrc`; the `news` command uses the
   built-in `node:sqlite`)
2. [pnpm](https://pnpm.io/) (`npm i -g pnpm`)
3. A QQ bot registered at <https://q.qq.com> — its **App ID** and **App Secret**

### Setup

```bash
pnpm install
cp .env.example .env
# then edit .env and fill in BOT_APPID / BOT_SECRET
```

## Environment variables

Configured in `.env` (see `.env.example` for the full annotated list):

| Variable                   | Required | Description                                             |
| -------------------------- | -------- | ------------------------------------------------------- |
| `BOT_APPID`                | ✅       | QQ bot App ID                                            |
| `BOT_SECRET`               | ✅       | QQ bot App Secret                                        |
| `BOT_SANDBOX`              |          | `true` for the sandbox environment (default `false`)    |
| `LOG_LEVEL`                |          | `trace`/`debug`/`info`/`warn`/`error` (default `info`)  |
| `AD_STRIKE_LIMIT`          |          | Ad offenses by one member before an admin alert (default `3`) |
| `AD_MIN_KEYWORD_HITS`      |          | Distinct ad keywords needed to flag a message (default `2`) |
| `AD_RULES_URL`             |          | Remote rules file unioned with the built-in lists (default: this repo's `docs/ad-rules.txt`; empty to disable) |
| `AD_RULES_REFRESH_MINUTES` |          | Refresh interval for the remote rules file, in minutes (default `360`) |
| `NEWS_LLM_API_KEY`         |          | Summarizer LLM key (falls back to `DEEPSEEK_API_KEY`; unset disables the daily job) |
| `NEWS_LLM_BASE_URL`        |          | Anthropic-compatible endpoint (default `https://api.deepseek.com/anthropic`) |
| `NEWS_MODEL`               |          | Summarization model (default `deepseek-v4-pro`)         |
| `NEWS_MAX_TOKENS`          |          | Max output tokens per summary request (default `64000`) |
| `NEWS_OPML_URL`            |          | OPML listing the feeds to poll (default: iread feeds in `isomoes/arch-config`) |
| `NEWS_FEEDS`               |          | Offline fallback feeds if the OPML fetch fails (comma/newline separated) |
| `NEWS_DB_PATH`             |          | SQLite file for fetched news items (default `data/news.db`) |
| `NEWS_MAX_ITEMS`           |          | Max items per day handed to the summarizer (default `30`) |
| `NEWS_LOOKBACK_HOURS`      |          | How far back a run collects items (default `24`; raise for quiet feeds) |
| `NEWS_SUMMARY_HOUR`        |          | Hour (UTC+8, 0–23) the daily summary job runs (default `22`) |
| `NEWS_MANUAL_REFRESH`      |          | Enable the `news refresh` command (dev only; off in production) |
| `NEWS_LANG`                |          | Language of the generated summary (default `Chinese`)   |

## Running

```bash
pnpm dev        # development (hot reload)
pnpm typecheck  # type-check only
pnpm build      # production build
pnpm start      # run the build
```

### Run with Docker

Prebuilt `linux/amd64` images are on the GitHub Container Registry, so no
Node.js on the host is needed:

```sh
docker run -d --name qq-bot --init --restart unless-stopped --env-file .env \
  -v qq-bot-data:/app/data \
  ghcr.io/isomoes/qq-bot:latest
```

The bot is an outbound WebSocket client (no ports to map). The named
`qq-bot-data` volume persists the `news` SQLite database across container
replacements — a named volume rather than a host bind mount because the
container runs as the unprivileged `node` user (UID 1000), and Docker
initializes the volume writable by it. Credentials come from the environment
(`--env-file .env`); the image must be **public**, or the host must
`docker login ghcr.io` first.

> To keep the DB in a host directory instead, use `-v "$PWD/data:/app/data"` and
> run `chown -R 1000:1000 ./data` first — otherwise the non-root process can't
> create the file (`SQLITE_CANTOPEN: unable to open database file`).

A compose file is included (run it from the repo root):

```sh
docker compose -f docker/docker-compose.yml up -d
```

Add `--build` (or `docker build -f docker/Dockerfile -t qq-bot .`) to build from
the checkout instead of pulling.

## AI news (`news` command)

Message the bot `news` for the latest daily summary, or `news 2026-07-06` for a
specific day. The interactive path only reads a stored summary, so it makes no
LLM call.

Once a day at `NEWS_SUMMARY_HOUR`:00 UTC+8 (with a startup catch-up if the bot
was down), a scheduled job — modeled on
[iread](https://github.com/isomoes/iread) — resolves the feed list from
`NEWS_OPML_URL` (falling back to `NEWS_FEEDS`), fetches each feed with
conditional GET, stores deduplicated items in SQLite, and has the LLM
(`NEWS_LLM_BASE_URL` + `NEWS_MODEL`, DeepSeek by default) condense the day's
items (up to `NEWS_MAX_ITEMS`) into that day's summary.

The summary is a Markdown bullet list. The model writes only the prose plus a
`[[n]]` citation tag per entry, which the bot rewrites into a clickable
per-source link — so the model never emits raw URLs, and feed titles/snippets
are wrapped as untrusted `<item>` data a compromised feed can't use to steer the
output.

During local dev (`pnpm dev`), `news refresh` re-runs the job on demand and
replies with the fresh summary; it's disabled in production (scheduled-only, via
`NEWS_MANUAL_REFRESH`).

## Ad moderation

Group messages are screened for advertising (`src/ad/`). On a flag, the bot
**recalls** the message, adds a **strike** against the sender (per group, in
memory), and on reaching `AD_STRIKE_LIMIT` (default `3`) **replies once** asking
an admin to remove the member.

Detection combines two signals — **keywords** (flag on ≥ `AD_MIN_KEYWORD_HITS`
distinct hits) and **regex patterns** (flag on a single match). Each has a
built-in baseline (`src/ad/`) unioned with a remote rules file, refreshed every
`AD_RULES_REFRESH_MINUTES`. By default that file is this repo's own
[`docs/ad-rules.txt`](docs/ad-rules.txt):

```ini
[keywords]
促销
代购

[patterns]
拉[你您]进[群裙]
/加\s*薇\s*[:：]?\s*[a-z0-9_-]{4,20}/i
```

Edit `docs/ad-rules.txt` and push to retune a running bot on its next refresh;
override the source with `AD_RULES_URL`, or set it empty to disable remote rules.
A fetch failure leaves the built-in lists (plus the last good file) in effect, so
detection never drops below the bundled baselines.

The keyword seed derives from the MIT-licensed
[`konsheng/Sensitive-lexicon`](https://github.com/konsheng/Sensitive-lexicon)
and includes generic terms, so raise `AD_MIN_KEYWORD_HITS` or prune if you see
false positives. Patterns are one regex per line (bare source, or
`/source/flags`) and validated at load — invalid, over-long, or catastrophically
slow ones are skipped and logged, and stateful `g`/`y` flags are dropped.

> **QQ official-API limits:** the group API **cannot mute or kick**, so removal
> stays a manual admin action (the bot only alerts); a public-domain bot only
> receives messages that **@mention it**; and recalling another member's message
> is best-effort (it may require permission).

> ⚠️ **ReDoS:** patterns run against every message with no timeout — a
> nested-quantifier pattern like `(a+)+` can hang the bot. The load-time timing
> screen catches common cases but isn't a guarantee; keep patterns specific and
> anchored, or swap in [`re2`](https://github.com/uhop/node-re2) for a
> linear-time engine.

