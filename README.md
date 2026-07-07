# qq-bot

A QQ group-management bot built on the official QQ bot API via the
[`qq-official-bot`](https://github.com/zhinjs/qq-official-bot) SDK.

## Architecture

This project uses QQ's **official** bot platform (App ID + App Secret from
<https://q.qq.com>) through the `qq-official-bot` SDK. It connects over
WebSocket and reacts to group / private / guild message events.

> **History note:** the previous implementation used
> [NapCatQQ](https://napneko.github.io/) + [NcatBot](https://docs.ncatbot.xyz/)
> (client-hook approach, Python). That version is preserved on the
> [`napcatqq`](https://github.com/isomoes/qq-bot/tree/napcatqq) branch. `main`
> was restarted from scratch for this new stack.

## Tech stack

- **Runtime:** Node.js ≥ 22.13 (repo pins Node 22 via `.nvmrc`; the news
  command uses the built-in `node:sqlite`)
- **Language:** TypeScript
- **SDK:** `qq-official-bot`
- **AI:** `@anthropic-ai/sdk` pointed at an Anthropic-compatible endpoint
  (DeepSeek by default) for news summarization
- **Package manager:** pnpm
- **Dev runner:** `tsx` (watch mode)

## Prerequisites

1. Node.js ≥ 22.13 (`nvm use` picks up `.nvmrc`)
2. [pnpm](https://pnpm.io/) (`npm i -g pnpm`)
3. A QQ bot registered at <https://q.qq.com> — you need its **App ID** and
   **App Secret**.

## Setup

```bash
pnpm install
cp .env.example .env
# then edit .env and fill in BOT_APPID / BOT_SECRET
```

## Environment variables

Configured in `.env` (see `.env.example`):

| Variable             | Required | Description                                          |
| -------------------- | -------- | ---------------------------------------------------- |
| `BOT_APPID`          | ✅       | QQ bot App ID                                         |
| `BOT_SECRET`         | ✅       | QQ bot App Secret                                     |
| `BOT_SANDBOX`        |          | `true` to use the sandbox environment (default `false`) |
| `LOG_LEVEL`          |          | `trace`/`debug`/`info`/`warn`/`error` (default `info`)  |
| `AD_STRIKE_LIMIT`    |          | Ad offenses by one member before an alert message is sent (default `3`) |
| `AD_MIN_KEYWORD_HITS`|          | Distinct ad keywords needed to flag a message (default `2`) |
| `AD_RULES_URL`       |          | Remote rules file (`[keywords]` + `[patterns]` sections) unioned with the built-in lists (defaults to this repo's `docs/ad-rules.txt`; set empty to disable) |
| `AD_RULES_REFRESH_MINUTES` |    | How often to refresh the remote rules file, in minutes (default `360`) |
| `NEWS_LLM_API_KEY`   |          | API key for the summarizer LLM (falls back to `DEEPSEEK_API_KEY`; unset disables the daily job) |
| `NEWS_LLM_BASE_URL`  |          | Anthropic-compatible endpoint (default `https://api.deepseek.com/anthropic`) |
| `NEWS_MODEL`         |          | Model for summarization (default `deepseek-v4-pro`) |
| `NEWS_MAX_TOKENS`    |          | Max output tokens for a summary request (default `8000`) |
| `NEWS_OPML_URL`      |          | OPML file listing the feeds to poll (default: iread feeds in `isomoes/arch-config`) |
| `NEWS_FEEDS`         |          | Offline fallback feeds if the OPML fetch fails, comma/newline separated |
| `NEWS_DB_PATH`       |          | SQLite file for fetched news items (default `data/news.db`) |
| `NEWS_MAX_ITEMS`     |          | Max items per day handed to the summarizer (default `30`) |
| `NEWS_LOOKBACK_HOURS`|          | How far back a run collects items (default `24`); raise for quiet feeds |
| `NEWS_SUMMARY_HOUR`  |          | Hour of day (UTC+8, 0-23) the daily summary job runs (default `22`) |
| `NEWS_MANUAL_REFRESH`|          | Enable the `news refresh` command (`dev` script sets it; off in production) |
| `NEWS_LANG`          |          | Language of the generated summary (default `Chinese`) |

## Running

```bash
# Development (hot reload)
pnpm dev

# Type-check only
pnpm typecheck

# Production
pnpm build
pnpm start
```

## Run with Docker

Prebuilt `linux/amd64` images are published to the GitHub Container Registry, so
no Node.js on the host is required:

```sh
docker run -d --name qq-bot --init --restart unless-stopped --env-file .env \
  ghcr.io/isomoes/qq-bot:latest
```

The bot is an outbound WebSocket client — it dials QQ's gateway — so the
container maps no ports. The `news` command stores fetched RSS items in a
SQLite file under `/app/data`; add `-v "$PWD/data:/app/data"` (as the compose
file does) to keep it across container replacements. Credentials come from the
environment (`--env-file .env`, or individual `-e BOT_APPID=… -e BOT_SECRET=…`);
never bake them into the image. `--init` gives the long-running process a real
init as PID 1 (clean SIGTERM shutdown + zombie reaping).

The image must be **public**, or the host must `docker login ghcr.io` first —
otherwise the pull fails with `unauthorized`. Make it public once under the
repository's Packages settings.

A `docker/docker-compose.yml` is included for the same thing (it reads `.env`).
Run it from the repo root with an explicit `-f`:

```sh
docker compose -f docker/docker-compose.yml up -d
```

Build the image from the checkout instead of pulling it with
`docker compose -f docker/docker-compose.yml up -d --build`, or
`docker build -f docker/Dockerfile -t qq-bot .`.

## Project structure

```
src/
  index.ts       # entry point: creates the Bot, wires handlers, starts it
  config.ts      # loads & validates environment variables
  handlers.ts    # message event handlers + a minimal command router
  ad/
    index.ts        # public surface for ad moderation (import from './ad')
    detector.ts     # matching: keyword hits + regex patterns -> AdMatch
    rules.ts        # active lists + parser for the merged remote rules file
    keywords.ts     # keyword baseline + parser
    patterns.ts     # regex-pattern baseline + parser/validator (ReDoS screen)
    remote-file.ts  # fetch loop for one remote file (ETag, timeout, fallback)
    moderator.ts    # AntiAd: recall + strike tracking + admin escalation
  news/
    db.ts         # SQLite storage (node:sqlite) for feeds, items, summaries
    feeds.ts      # resolve the feed list from a remote OPML (fallback list)
    fetch-feed.ts # conditional-GET, size-capped feed download
    service.ts    # daily summary job (write) + stored-summary reader (read)
    scheduler.ts  # fires the daily job at NEWS_SUMMARY_HOUR:00 UTC+8
    summarize.ts  # LLM call that turns the day's items into a concise list
```

## Extending

Add commands in `src/handlers.ts` (`dispatchCommand`). Try it by messaging the
bot `ping` → it replies `pong`.

## AI news (`news` command)

A scheduled job builds one summary per day; the `news` command just reads it,
so the interactive path makes no LLM call. Message the bot `news` for the most
recent summary or `news 2026-07-06` for a specific day.

Once a day at `NEWS_SUMMARY_HOUR`:00 UTC+8 (with a startup catch-up if the bot
was down at that time), the job (modeled on
[iread](https://github.com/isomoes/iread)):

1. **Resolve** the feed list from `NEWS_OPML_URL` (the iread OPML), falling back
   to `NEWS_FEEDS` if the OPML can't be fetched.
2. **Fetch** each feed with conditional GET (`ETag`/`Last-Modified`). Failures
   are recorded per feed and never abort the run.
3. **Store** items in SQLite (`node:sqlite`, `NEWS_DB_PATH`), deduplicated by
   `guid`/`link`/stable hash — the same upsert scheme iread uses.
4. **Summarize** the items published since the last summary (up to
   `NEWS_MAX_ITEMS`) via an Anthropic-compatible endpoint (`NEWS_LLM_BASE_URL` +
   `NEWS_MODEL`, DeepSeek by default) into at most 10 numbered entries in
   `NEWS_LANG`, and upsert the result keyed by date.

During local development (`npm run dev`), `news refresh` re-runs the job on
demand and replies with the fresh summary. It's disabled in production
(scheduled-only) — see `NEWS_MANUAL_REFRESH`.

The summary is plain text with no URLs — QQ group messages don't render
Markdown, and messages containing unreviewed links are commonly rejected by
the platform. Feed titles/snippets are wrapped as untrusted `<item>` data in the
prompt so a compromised feed can't steer the summary.

## Ad moderation

Group messages are screened for advertising (`src/ad/`). When a
message is flagged, the bot:

1. **Recalls** it via `recallGroupMessage`.
2. Adds a **strike** against the sender (per group, tracked in memory).
3. On reaching `AD_STRIKE_LIMIT` strikes (default `3`), **replies once** with a
   normal message in the group asking an admin to remove the member (the API
   cannot mute/kick, so removal stays a manual admin action).

> **QQ official-API limits to keep in mind:**
> - The group API **cannot mute or kick** members, so removal is a manual admin
>   action — the bot only alerts.
> - A public-domain group bot only receives messages that **@mention it**, so it
>   won't see ad spam that doesn't tag the bot; detection runs on what the bot
>   actually receives.
> - Recalling another member's message may require permission; the call is
>   best-effort and failures are logged.

Detection has two signals — **keywords** (flag on ≥ `AD_MIN_KEYWORD_HITS` distinct
hits) and **regex patterns** (flag on a single match). Each has a **built-in
baseline** (in `src/ad/`) that is **unioned** with a single remote rules file,
refreshed every `AD_RULES_REFRESH_MINUTES` (default 6h). By default that file is
this repo's own [`docs/ad-rules.txt`](docs/ad-rules.txt):

```ini
[keywords]
促销
代购

[patterns]
拉[你您]进[群裙]
/加\s*薇\s*[:：]?\s*[a-z0-9_-]{4,20}/i
```

**To curate detection, edit `docs/ad-rules.txt` and push** — a running bot picks
up the change on its next refresh, no redeploy. Conditional requests (`ETag` /
`If-None-Match`) skip re-parsing an unchanged file, and any fetch failure leaves
the built-in lists (plus the last good remote file) in effect, so detection never
degrades below the bundled baselines. Use your own file with `AD_RULES_URL=…`, or
disable remote rules with `AD_RULES_URL=` (empty).

- **`[keywords]`** — one term per line, `#` for comments. The seed (derived from
  the MIT-licensed [`konsheng/Sensitive-lexicon`](https://github.com/konsheng/Sensitive-lexicon))
  has generic terms (e.g. `客服`, `网络`); with `AD_MIN_KEYWORD_HITS=2` two such
  hits flag a message, so raise the threshold or prune if you see false positives.
- **`[patterns]`** — one regex per line (bare source, or `/source/flags`).
  Validated at load: invalid, over-long, or catastrophically slow patterns are
  skipped and logged, and the stateful `g`/`y` flags are dropped.

> ⚠️ **ReDoS:** patterns run against every message with no timeout. A pattern
> with nested quantifiers like `(a+)+` can cause catastrophic backtracking and
> hang the bot. The load-time timing screen catches common cases but is not a
> guarantee — keep patterns specific and anchored. For a hard guarantee, swap
> the engine for [`re2`](https://github.com/uhop/node-re2) (linear-time).

## Releasing

Releases are driven entirely by pushing a `vX.Y.Z` git tag. qq-bot is a
deployable service (`"private": true` — nothing is published to npm), so the
**Docker image is the release artifact**. The **git tag is the single source of
truth** for the version — it's what the image tags and the Release are derived
from; `package.json`'s `version` is not read by the pipeline.

```sh
# add a "## X.Y.Z" block to CHANGELOG.md for curated release notes, then:
git tag v0.2.0
git push origin v0.2.0     # push the tag (main should already be up to date)
```

One GitHub Actions workflow — `.github/workflows/release.yml` — runs three jobs
in sequence, each gated on the previous:

1. **typecheck** — `tsc --noEmit`; never build or release a tree that doesn't
   compile.
2. **docker** — build a `linux/amd64` image and push it to
   `ghcr.io/isomoes/qq-bot`, tagged `X.Y.Z`, `X.Y`, and `latest` (a `-rc`/`-beta`
   prerelease tag skips `latest`).
3. **release** — cut the GitHub Release for the tag, using the matching
   `## X.Y.Z` section of `CHANGELOG.md` as the notes (falling back to
   auto-generated notes if that section is absent). Re-running the workflow for
   an existing tag refreshes the Release rather than failing.

Because the `release` job `needs: docker`, a failed build never leaves behind a
Release for a version that has no image. No secrets are needed — both the ghcr
push and the Release authenticate with the built-in `GITHUB_TOKEN`. Make the
ghcr package public once (repo → Packages settings) if you want anonymous
`docker pull`.
