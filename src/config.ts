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

/**
 * Default remote ad rules: this repo's own hand-editable docs/ad-rules.txt on
 * the main branch (a single file with [keywords] and [patterns] sections). Edit
 * and push to update a live bot; override with AD_RULES_URL, or set it =
 * (empty) to disable remote rules entirely.
 */
const DEFAULT_AD_RULES_URL =
  'https://raw.githubusercontent.com/isomoes/qq-bot/main/docs/ad-rules.txt'

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
} as const

export type Config = typeof config
