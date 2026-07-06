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

- **Runtime:** Node.js ≥ 20.12 (repo pins Node 22 via `.nvmrc`)
- **Language:** TypeScript
- **SDK:** `qq-official-bot`
- **Package manager:** pnpm
- **Dev runner:** `tsx` (watch mode)

## Prerequisites

1. Node.js ≥ 20.12 (`nvm use` picks up `.nvmrc`)
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

Prebuilt multi-arch images (amd64 + arm64) are published to the GitHub Container
Registry, so no Node.js on the host is required:

```sh
docker run -d --name qq-bot --init --restart unless-stopped --env-file .env \
  ghcr.io/isomoes/qq-bot:latest
```

The bot is an outbound WebSocket client — it dials QQ's gateway and stores no
data — so the container maps no ports and no volumes. Credentials come from the
environment (`--env-file .env`, or individual `-e BOT_APPID=… -e BOT_SECRET=…`);
never bake them into the image. `--init` gives the long-running process a real
init as PID 1 (clean SIGTERM shutdown + zombie reaping).

The image must be **public**, or the host must `docker login ghcr.io` first —
otherwise the pull fails with `unauthorized`. Make it public once under the
repository's Packages settings.

A `docker-compose.yml` is included for the same thing (it reads `.env`):

```sh
docker compose up -d
```

Build the image from the checkout instead of pulling it with
`docker compose up -d --build`, or `docker build -t qq-bot .`.

## Project structure

```
src/
  index.ts       # entry point: creates the Bot, wires handlers, starts it
  config.ts      # loads & validates environment variables
  handlers.ts    # message event handlers + a minimal command router
  ad-detector.ts # Chinese ad detection (keyword list + regex patterns)
  anti-ad.ts     # ad moderation: recall + strike tracking + admin escalation
```

## Extending

Add commands in `src/handlers.ts` (`dispatchCommand`). Try it by messaging the
bot `ping` → it replies `pong`.

## Ad moderation

Group messages are screened for advertising (`src/ad-detector.ts`). When a
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

Tune detection in `src/ad-detector.ts` (keyword list + regex patterns) and via
`AD_MIN_KEYWORD_HITS`.

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
2. **docker** — build a multi-arch (amd64 + arm64) image and push it to
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
