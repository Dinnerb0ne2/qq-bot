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

## Project structure

```
src/
  index.ts     # entry point: creates the Bot, wires handlers, starts it
  config.ts    # loads & validates environment variables
  handlers.ts  # message event handlers + a minimal command router
```

## Extending

Add commands in `src/handlers.ts` (`dispatchCommand`). Try it by messaging the
bot `ping` → it replies `pong`.
