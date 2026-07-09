// Delivery of the stored daily summary to the groups in NEWS_PUSH_GROUPS
// (issue #1: the summary used to be stored but never sent anywhere). These are
// ACTIVE pushes — no msg_id, unlike the `news` command's passive replies — so
// they only reach groups whose owner has enabled 机器人主动在群聊内发言, and
// they are subject to the platform's active-message quotas.

import { segment, type Bot } from 'qq-official-bot'
import { config } from '../config'
import { queryAll, run } from './db'
import { formatNewsMarkdown, markdownToPlain } from './format'
import { getStoredSummary, type NewsLogger } from './service'

/** Codes meaning the *markdown* payload itself was rejected, so a plain-text
 *  retry can still land. Anything else — 40034102 (owner has not enabled
 *  proactive messages), 22009 (frequency/quota) — would fail identically. */
const MARKDOWN_ERROR_CODES = new Set([50037, 50041, 50054, 50055, 304036])

/** A failed group is retried in-process this much later, this many times; a
 *  date still undelivered after that waits for the next startup sweep. */
const RETRY_DELAY_MS = 15 * 60_000
const MAX_ATTEMPTS = 4

/** Failed delivery attempts per date, to bound the in-process retry loop. */
const failedAttempts = new Map<string, number>()

/** Serializes deliveries. Overlapping calls — the daily tick and the startup
 *  catch-up can both resolve off the service's shared single-flight run — must
 *  not race the read-markers-then-send sequence, or every group double-posts. */
let chain: Promise<unknown> = Promise.resolve()

/** The SDK throws `Request "…" failed with code(NNN): …` — the numeric code
 *  is only available by parsing the message text. */
function errorCode(err: unknown): number | null {
  const m = /code\((\d+)\)/.exec(err instanceof Error ? err.message : String(err))
  return m ? Number(m[1]) : null
}

function pushedGroups(date: string): Set<string> {
  const rows = queryAll<{ group_id: string }>(
    `SELECT group_id FROM summary_pushes WHERE date = ? AND lang = ?`,
    date,
    config.newsLang,
  )
  return new Set(rows.map((r) => r.group_id))
}

function markPushed(date: string, groupId: string): void {
  run(
    `INSERT INTO summary_pushes (date, lang, group_id, pushed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(date, lang, group_id) DO NOTHING`,
    date,
    config.newsLang,
    groupId,
    Date.now(),
  )
}

/**
 * Push the stored summary for `date` to every configured group that has not
 * received it yet. Idempotent via the summary_pushes marker table and
 * serialized across callers, so the daily tick and the startup catch-up can
 * both fire it without double-posting. A failed group is logged, left
 * unmarked, and retried on a bounded in-process timer (and again by the next
 * startup sweep), so a transient send failure doesn't drop the day's push.
 */
export function pushDailySummary(bot: Bot, date: string, logger: NewsLogger): Promise<void> {
  const next = chain.then(() => deliverSummary(bot, date, logger))
  chain = next.catch(() => undefined) // a DB failure must not jam the chain
  return next
}

async function deliverSummary(bot: Bot, date: string, logger: NewsLogger): Promise<void> {
  const groups = [...new Set(config.newsPushGroups)] // env lists can repeat an id
  if (groups.length === 0) return

  const stored = getStoredSummary(date)
  if (stored.kind === 'empty') return // nothing stored for that date; never push filler

  const already = pushedGroups(date)
  const pending = groups.filter((g) => !already.has(g))
  if (pending.length === 0) return

  const md = formatNewsMarkdown(stored.date, stored.summary)
  let failed = 0
  for (const groupId of pending) {
    try {
      await sendToGroup(bot, groupId, md)
      // An audit-pending result still resolves; count it as delivered rather
      // than re-pushing on every restart while the audit is slow.
      markPushed(date, groupId)
      logger.info(`[news] pushed ${date} summary to group ${groupId}`)
    } catch (err) {
      failed++
      logger.error(`[news] failed to push ${date} summary to group ${groupId}: ${describeSendError(err)}`)
    }
  }
  if (failed > 0) scheduleRetry(bot, date, failed, logger)
}

function scheduleRetry(bot: Bot, date: string, failed: number, logger: NewsLogger): void {
  const attempt = (failedAttempts.get(date) ?? 0) + 1
  failedAttempts.set(date, attempt)
  if (attempt >= MAX_ATTEMPTS) {
    logger.warn(`[news] giving up on ${date} after ${attempt} delivery attempts (the next startup retries)`)
    return
  }
  logger.info(`[news] retrying ${failed} failed push(es) for ${date} in ${RETRY_DELAY_MS / 60_000} min`)
  const timer = setTimeout(() => {
    pushDailySummary(bot, date, logger).catch((err) => logger.error('[news] retry delivery failed:', err))
  }, RETRY_DELAY_MS)
  timer.unref?.()
}

/** Send as Markdown; if the markdown payload is what got rejected, retry once
 *  as plain text. Permission/quota errors propagate — retrying can't help.
 *  The fallback goes through segment.text: a bare string would hit the SDK's
 *  template parser, which chokes on `<video>`-like spans in headlines and
 *  turns `<at,user_id=all>` from feed text into a real @everyone. */
async function sendToGroup(bot: Bot, groupId: string, md: string): Promise<void> {
  try {
    await bot.sendGroupMessage(groupId, segment.markdown(md))
  } catch (err) {
    const code = errorCode(err)
    if (code === null || !MARKDOWN_ERROR_CODES.has(code)) throw err
    await bot.sendGroupMessage(groupId, segment.text(markdownToPlain(md)))
  }
}

function describeSendError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  switch (errorCode(err)) {
    case 40034102:
      return `${message} — the group owner must enable 机器人主动在群聊内发言 in the group's robot settings`
    case 22009:
      return `${message} — active-message frequency/quota exceeded`
    default:
      return message
  }
}
