# qq-bot

A QQ group-management bot on the **official** QQ bot platform (App ID + App
Secret from <https://q.qq.com>), built with the
[`qq-official-bot`](https://github.com/zhinjs/qq-official-bot) SDK. It connects
over WebSocket and reacts to group, private (C2C), and guild message events.

## Features

- **Group & private commands** — responds to group @-mentions and private (C2C)
  DMs; built-in commands are `ping`, `help`, and `news [YYYY-MM-DD]`.
- **Automatic forbidden-word (违禁词) moderation** — screens group messages for
  ads, gambling, drug, scam-job and porn pitches via a naive-Bayes keyword score
  (likelihood-weighted hits vs. a threshold, with length-aware evidence: long
  messages weigh more, short ones less) plus regex patterns, recalls the message,
  tracks per-member strikes, and alerts an admin at the limit. Every flagged
  message reports its **violation category** (广告/赌博/毒品/诈骗兼职/色情).
- **Config-file rules** — forbidden words, intensity and the probability params
  all live in one editable [`config/ad.json`](config/ad.json); forbidden words
  and patterns are additionally unioned with a remote text file (this repo's
  `docs/ad-rules.txt` by default) refreshed on a schedule, so you retune a
  running bot by editing files and pushing — no redeploy.
- **Daily AI news digest** — a scheduled job polls RSS/Atom feeds (resolved from
  a remote OPML), stores items in SQLite, and has an LLM (DeepSeek via an
  Anthropic-compatible endpoint) write one summary a day; the `news` command
  serves it instantly as Markdown with clickable per-source links, and the bot
  auto-pushes it to the groups listed in `NEWS_PUSH_GROUPS`.
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
  moderation/  # forbidden-word moderation: keyword + regex detection, categories, config-file rules, remote-rule refresh, strikes
  news/        # daily AI news: feed fetch, SQLite storage, scheduler, LLM summarizer
config/
  ad.json      # forbidden-word config: category lists, forbidden words, intensity, probability params
test/          # unit tests (node:test), run with pnpm test
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
| `AD_CONFIG_PATH`           |          | Path to `config/ad.json` — forbidden words, intensity and probability params (default `config/ad.json`) |
| `AD_RULES_URL`             |          | Remote rules file unioned on top of the config-file lists (default: this repo's `docs/ad-rules.txt`; empty to disable) |
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
| `NEWS_PUSH_GROUPS`         |          | Group openids to auto-push the daily summary to (comma/newline separated; empty disables — see [AI news](#ai-news-news-command)) |
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

### Auto-push to groups

With `NEWS_PUSH_GROUPS` set, the freshly generated summary is also **pushed**
to each listed group right after the scheduled run. A failed send is retried a
few times on a 15-minute timer, and on every startup the last two days'
summaries are re-offered — so a crash, a transient send failure, or a fresh
deploy (which delivers the most recent stored digest immediately) doesn't drop
a push, while a per-group marker in SQLite ensures a group never receives the
same day's summary twice. Days with no news push nothing. Two prerequisites:

1. **Group openid** — the ids in `NEWS_PUSH_GROUPS` are the opaque per-bot
   openids, *not* the QQ group numbers shown in the client. To find one,
   @mention the bot in the target group and copy the id from the
   `recv from Group(...)` line in the logs.
2. **Owner opt-in** — pushes are "active" messages (QQ re-opened them for
   groups on 2026-06-22): the group owner must enable
   **机器人主动在群聊内发言** in the group's robot settings, or sends fail with
   code `40034102` (logged with a hint).

During local dev (`pnpm dev`), `news refresh` re-runs the job on demand and
replies with the fresh summary; it's disabled in production (scheduled-only, via
`NEWS_MANUAL_REFRESH`). A dev refresh never triggers a group push — only the
scheduled job (and its startup catch-up) delivers to groups.

## Forbidden-word moderation

Group messages are screened for violations — ads, gambling, drugs, scam jobs,
pornography (`src/moderation/`). On a flag, the bot **recalls** the message,
adds a **strike** against the sender (per group, in memory), and on reaching
`AD_STRIKE_LIMIT` (default `3`) **replies once** asking an admin to remove the
member.

Detection combines two signals — **keywords** scored with a naive-Bayes model,
and **regex patterns** (flag on a single match). Keyword hits are precompiled
into one case-insensitive matcher; every distinct hit is evidence weighted by a
likelihood ratio (strong terms weigh far more than generic ones) and combined
with a prior base rate:

```
P(violation | text) ≥ threshold  ⇒  flag
```

Every keyword carries a **violation category** (`categories` in config/ad.json —
赌博/毒品/诈骗兼职/色情; uncategorized words, including remote additions, are
广告). The winning category — the one with the most distinct keyword hits — is
reported in the bot's log line and the `ad-test` tool, so you can tell a gambling
pitch from a course promo at a glance.

Length evidence is calibrated to the group's **chat habit** — modern chat
messages are short, so suspicion grows continuously from the shortest messages
onward (`lengthLr·ln(1 + len/chatLength)`, capped at the modest `maxLengthLr`):
no fixed 30-char cliff, and no amount of length can ever flag a message on its
own. **No single indicator decides** — a flag requires violation features to
co-occur: the message must meet the distinct-hit floor AND carry a strong
keyword (or a per-keyword LR override) or a suspicious URL. So a pile of generic
words (`客服 咨询 QQ …`), a lone keyword buried in a 500-char post, or a bare
link is never a violation on its own; the indicators only push each other.

Ads almost always carry a **URL — but to a domain that is neither an official
site nor a major platform**. URLs on the `safeUrlDomains` whitelist (jd.com,
bilibili.com, gov.cn, …) are normal sharing — a member recommending a product
page — and add nothing. A non-whitelisted URL adds `ln(suspiciousUrlLr)` to the
log-odds, and if it also sits on a spam-prone TLD (`.top`, `.xyz`, `.icu`,
`.cc`, …; `suspiciousTlds`) a further small `ln(suspiciousTldLr)`. A short
recommendation with a link and a couple of generic words still passes; the same
words in a long message with a sketchy link flags. Keywords repeated many times
are *discounted* (`repeatDiminish^(count-1)`) — repeating one sensitive word is
attention-seeking, and a real ad wouldn't be that low-effort — while packing
several *different* ad keywords still flags, and generic hits have diminishing
returns (`weakDiminish`). Conversational tone matters too: a message that reads
as a **question, a reply, a collaboration request, or casual chit-chat**
(哈哈/学到了/顶一个) has its soft keyword + contact evidence dampened
(`questionFactor`/`replyFactor`/`collabFactor`/`chatFactor`), because that is
how a group actually talks.

All of this — the forbidden words, their intensity and the probability params —
lives in one config file, [`config/ad.json`](config/ad.json), the single source
of truth. Edit it at runtime, no source changes needed:

```jsonc
{
  "prior": 0.02,              // prior P(violation) of an arbitrary message
  "threshold": 0.6,           // P(violation|text) at which a message is flagged
  "strongLr": 40,             // likelihood ratio of a strong keyword hit
  "weakLr": 2.5,              // likelihood ratio of a generic keyword hit
  "variantLr": 2,             // 变种词权重: a matched variant word is a strong hit, × this
  "lengthLr": 0.35,           // length-evidence growth per ln(1 + len/chatLength)
  "chatLength": 10,           // reference chat-message length: dampening ends here, length evidence grows beyond
  "maxLengthLr": 0.5,         // cap on the length-evidence term — length can tip, never decide
  "shortKeywordFactor": 0.5,  // keyword-evidence multiplier for the shortest messages
  "repeatDiminish": 0.7,      // a keyword repeated count times weighs 0.7^(count-1) (刷屏 ≠ 广告)
  "weakDiminish": 1.5,        // n-th distinct generic hit weighs min(1, 1.5/n)
  "suspiciousUrlLr": 8,       // LR of a URL outside the safe whitelist
  "suspiciousTldLr": 2,       // extra LR when that URL uses a spam-prone TLD (.top/.xyz/.icu…)
  "minKeywordHits": 2,        // distinct-hit floor before the keyword path runs
  "safeUrlDomains": ["jd.com", "bilibili.com", "gov.cn"],  // official/major platforms: URL adds nothing
  "suspiciousTlds": ["top", "xyz", "icu", "cc"],           // spam-prone TLDs: slightly more doubt
  "questionFactor": 0.55,     // dampener when the message reads as a question (提问语气)
  "replyFactor": 0.6,         // dampener when the message is a reply/quote of an earlier message
  "collabFactor": 0.7,        // dampener when the message asks for help/partnership (协作/求助)
  "chatFactor": 0.75,         // dampener when the message is casual chit-chat (闲聊语气)
  "keywords": ["促销", "代购"],
  "strongKeywords": ["加V", "扫码"],
  "keywordLrs": { "刷单": 100, "押题": 80 },  // per-keyword intensity (违禁强度)
  "variantKeywords": { "微信": ["薇信", "威信"], "QQ": ["扣扣"] },  // 变种词
  "categories": {                       // 违禁类别: tagged pools reported as the winning category
    "赌博":   { "strongKeywords": ["博彩", "棋牌"], "keywords": ["上分", "盘口"] },
    "毒品":   { "strongKeywords": ["冰毒", "K粉"],   "keywords": ["飞行员", "溜冰"] },
    "诈骗兼职": { "strongKeywords": ["刷单", "贷款"],  "keywords": ["兼职", "网赚"] },
    "色情":   { "strongKeywords": ["约炮"] }
  },
  "patterns": ["/加[V微]信?\\s*\\w+/"]
}
```

**Variant words (变种词).** Ads actively dodge filters by misspelling their hook —
`微信` → `薇信`, `QQ` → `扣扣`, `博彩` → `菠菜`. List them under
`variantKeywords` (`canonical → [obfuscated forms]`); the remote rules file can
also add them via a `[variants]` section (`微信=薇信|威信`). A matched variant is
scored as a **strong hit of its canonical keyword** (so `keywordLrs`/strong-class
LRs carry over — `菠菜` inherits `博彩`'s weight) multiplied by the
`variantLr` weight: deliberately hiding a hook is itself violation evidence.

**Violation categories (违禁类别).** The optional `categories` block groups
keywords by what they advertise (赌博/毒品/诈骗兼职/色情). Tagged words stay
active for detection like the top-level lists — their only extra job is
labelling: the winning category (most distinct hits) is shown by `ad-test` and
in the bot's `[moderation]` log line, so an operator sees *what* the message was,
not just that it was flagged.

A missing or corrupt file (or an invalid field) falls back to the bundled
defaults in `src/moderation/`, and the bot logs what it dropped at startup. Override the
path with `AD_CONFIG_PATH`. On top of the config file, one remote rules file is
still unioned as an optional live-update layer, refreshed every
`AD_RULES_REFRESH_MINUTES`. By default that file is this repo's own
[`docs/ad-rules.txt`](docs/ad-rules.txt):

```ini
[keywords]
促销
代购

[strong]
加V
扫码

[variants]
微信=薇信|威信|vx
博彩=菠菜|bo彩

[patterns]
拉[你您]进[群裙]
/加\s*薇\s*[:：]?\s*[a-z0-9_-]{4,20}/i
```

Edit `docs/ad-rules.txt` and push to retune a running bot on its next refresh;
override the source with `AD_RULES_URL`, or set it empty to disable remote rules.
A fetch failure leaves the config-file lists (plus the last good file) in
effect, so detection never drops below the configured baseline.

The keyword seed derives from the MIT-licensed
[`konsheng/Sensitive-lexicon`](https://github.com/konsheng/Sensitive-lexicon)
and includes generic terms. Because of the likelihood weighting these no longer
false-flag on their own; to tune, raise `threshold` / `minKeywordHits` for fewer
flags or lower them for more, or move a term out of `strongKeywords`. Patterns
are one regex per line (bare source, or `/source/flags`) and validated at load —
invalid, over-long, or catastrophically slow ones are skipped and logged, and
stateful `g`/`y` flags are dropped.

> **QQ official-API limits:** the group API **cannot mute or kick**, so removal
> stays a manual admin action (the bot only alerts); a public-domain bot only
> receives messages that **@mention it**; and recalling another member's message
> is best-effort (it may require permission).

> ⚠️ **ReDoS:** patterns run against every message with no timeout — a
> nested-quantifier pattern like `(a+)+` can hang the bot. The load-time timing
> screen catches common cases but isn't a guarantee; keep patterns specific and
> anchored, or swap in [`re2`](https://github.com/uhop/node-re2) for a
> linear-time engine.

