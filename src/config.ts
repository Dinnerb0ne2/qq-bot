import 'dotenv/config'
import type { LogLevel } from 'qq-official-bot'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`)
  }
  return value
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Parse an hour-of-day env var (0-23), falling back on anything out of range. */
function hourEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback
}

/** Parse a comma- or newline-separated URL list env var. */
function listEnv(name: string, fallback: readonly string[]): string[] {
  const raw = process.env[name]
  if (!raw) return [...fallback]
  const urls = raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return urls.length > 0 ? urls : [...fallback]
}

/**
 * Default remote ad rules: this repo's own hand-editable docs/ad-rules.txt on
 * the main branch (a single file with [keywords] and [patterns] sections). Edit
 * and push to update a live bot; override with AD_RULES_URL, or set it =
 * (empty) to disable remote rules entirely.
 */
const DEFAULT_AD_RULES_URL =
  'https://raw.githubusercontent.com/isomoes/qq-bot/main/docs/ad-rules.txt'

/**
 * Default OPML feed list for the `news` command: the iread subscriptions in
 * this operator's arch-config repo. Edit that file and push to change a live
 * bot's feeds; override with NEWS_OPML_URL. A github.com /blob/ URL is accepted
 * and rewritten to its raw form.
 */
const DEFAULT_NEWS_OPML_URL =
  'https://raw.githubusercontent.com/isomoes/arch-config/master/iread/feeds.opml'

/** Offline fallback feeds if the OPML can't be fetched; override with NEWS_FEEDS. */
const DEFAULT_NEWS_FEEDS = [
  'https://news.smol.ai/rss.xml',
  'https://simonwillison.net/atom/everything/',
  'https://openai.com/news/rss.xml',
  'https://blog.google/technology/ai/rss/',
] as const

export const config = {
  /** QQ bot App ID */
  appid: required('BOT_APPID'),
  /** QQ bot App Secret */
  secret: required('BOT_SECRET'),
  /** Whether to use the sandbox environment */
  sandbox: process.env.BOT_SANDBOX === 'true',
  /** Log level */
  logLevel: (process.env.LOG_LEVEL ?? 'info') as LogLevel,
  /** Ad offenses by one member before an alert message is sent (default 3) */
  adStrikeLimit: intEnv('AD_STRIKE_LIMIT', 3),
  /** Minimum distinct ad keywords in a message to flag it as an ad */
  adMinKeywordHits: intEnv('AD_MIN_KEYWORD_HITS', 2),
  /** URL of the remote ad rules file ([keywords] + [patterns] sections),
   *  unioned with the built-in lists. Defaults to this repo's docs/ad-rules.txt;
   *  set AD_RULES_URL= (empty) to disable remote rules entirely. */
  adRulesUrl: process.env.AD_RULES_URL ?? DEFAULT_AD_RULES_URL,
  /** How often to refresh the remote rules file, in minutes (default 360) */
  adRulesRefreshMinutes: intEnv('AD_RULES_REFRESH_MINUTES', 360),

  // --- news command ---
  /** API key for the summarizer LLM (DeepSeek by default). Unset disables the
   *  daily summary job; the `news` command still serves any stored summary. */
  newsApiKey: process.env.NEWS_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || undefined,
  /** Base URL of the Anthropic-compatible LLM endpoint used for summarization */
  newsLlmBaseUrl: process.env.NEWS_LLM_BASE_URL || 'https://api.deepseek.com/anthropic',
  /** Model used to summarize the news */
  newsModel: process.env.NEWS_MODEL || 'deepseek-v4-pro',
  /** Max output tokens for a summary request */
  newsMaxTokens: intEnv('NEWS_MAX_TOKENS', 64000),
  /** OPML URL listing the RSS/Atom feeds to poll */
  newsOpmlUrl: process.env.NEWS_OPML_URL || DEFAULT_NEWS_OPML_URL,
  /** Offline fallback feed list (also a NEWS_FEEDS override for the OPML) */
  newsFeeds: listEnv('NEWS_FEEDS', DEFAULT_NEWS_FEEDS),
  /** SQLite database path for fetched news items (default data/news.db) */
  newsDbPath: process.env.NEWS_DB_PATH || 'data/news.db',
  /** Max news items per day handed to the summarizer (default 30) */
  newsMaxItems: intEnv('NEWS_MAX_ITEMS', 30),
  /** How far back (hours) a run collects items (default 24). Widen for quiet
   *  feeds or dev testing; >24 makes consecutive daily digests overlap. */
  newsLookbackHours: intEnv('NEWS_LOOKBACK_HOURS', 24),
  /** Hour of day (UTC+8) at which the daily summary job runs (default 22) */
  newsSummaryHour: hourEnv('NEWS_SUMMARY_HOUR', 22),
  /** Allow the on-demand `news refresh` command. On in local dev — the `dev`
   *  npm script sets NEWS_MANUAL_REFRESH=true — and off in production (`start`
   *  / Docker never set it), where the summary is scheduled-only. */
  newsAllowManualRefresh: /^(1|true|yes|on)$/i.test(process.env.NEWS_MANUAL_REFRESH ?? ''),
  /** Language the news summary is written in (default Chinese) */
  newsLang: process.env.NEWS_LANG || 'Chinese',
} as const

export type Config = typeof config
