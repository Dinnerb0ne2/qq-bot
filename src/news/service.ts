// News domain logic. A daily scheduled job resolves the feed list from OPML,
// refreshes every feed into SQLite (fetch + parse + dedup upsert), collects the
// items published since the last summary, and stores an LLM-generated summary.
// The `news` chat command only READS stored summaries — it never fetches feeds
// or calls the LLM, which keeps the interactive path free and cheap.

import { createHash } from 'node:crypto'
import Parser from 'rss-parser'
import { config } from '../config'
import {
  inPlaceholders,
  queryAll,
  queryGet,
  run,
  transaction,
  type FeedRow,
  type ItemRowWithFeed,
  type SummaryRow,
  type SqlParam,
} from './db'
import { fetchFeed } from './fetch-feed'
import { resolveFeeds } from './feeds'
import { summarizeNews, type NewsItemForSummary } from './summarize'

const SNIPPET_MAX = 500
const REFRESH_CONCURRENCY = 4

/** The news "day" and the daily schedule are both anchored to UTC+8. */
const TZ_OFFSET_MS = 8 * 3_600_000
const DAY_MS = 24 * 3_600_000

/** Minimal logger shape (satisfied by qq-official-bot's bot.logger). */
export interface NewsLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export type NewsResult =
  | { kind: 'empty'; date: string }
  | { kind: 'ok'; date: string; summary: string; itemCount: number }

/** Outcome of a daily-summary run, so the dev `news refresh` can explain an
 *  empty result (feeds unreachable vs. window too tight) instead of a blank. */
export type SummaryRun =
  | { kind: 'stored'; date: string; itemCount: number }
  | { kind: 'empty'; date: string; totalItems: number; newestAgeMs: number | null; lookbackHours: number }

// ---------------------------------------------------------------------------
// Date + schedule handling (all in UTC+8)
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Today's date as YYYY-MM-DD in UTC+8. */
export function todayDate(): string {
  const d = new Date(Date.now() + TZ_OFFSET_MS)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/**
 * Validate a `news` argument. Empty means today; otherwise it must be a real
 * YYYY-MM-DD calendar date. Returns null when invalid.
 */
export function parseNewsDate(arg: string): string | null {
  const trimmed = arg.trim()
  if (!trimmed) return todayDate()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!m) return null
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  // Date.UTC silently rolls over out-of-range parts (2026-02-31 -> Mar 3);
  // reject anything that did not round-trip.
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return trimmed
}

/** Milliseconds from now until the next `hour`:00 UTC+8. */
export function msUntilDailyRun(hour: number): number {
  const now = Date.now()
  const d = new Date(now + TZ_OFFSET_MS)
  let target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour) - TZ_OFFSET_MS
  if (target <= now) target += DAY_MS
  return target - now
}

/** Whether the current UTC+8 wall-clock hour is at or past `hour`. */
export function isPastDailyRun(hour: number): boolean {
  return new Date(Date.now() + TZ_OFFSET_MS).getUTCHours() >= hour
}

// ---------------------------------------------------------------------------
// Parsing (rss-parser, same custom fields as iread)
// ---------------------------------------------------------------------------

interface ParsedItemExtra {
  contentEncoded?: string
  atomUpdated?: string
}

// Widened view of a parsed item covering every field we read; some (id) are
// missing from rss-parser's published Item type.
interface ParsedItem extends ParsedItemExtra {
  guid?: string
  id?: string
  link?: string
  title?: string
  content?: string
  summary?: string
  contentSnippet?: string
  isoDate?: string
  pubDate?: string
}

const parser = new Parser<Record<string, unknown>, ParsedItemExtra>({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['updated', 'atomUpdated'],
    ],
  },
})

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** Treat empty / whitespace-only strings as absent so they never become a
 *  dedup key (an empty guid/link would otherwise collapse a whole feed's items
 *  onto one row via the UNIQUE(feed_id, dedup_key) index). */
function blankToNull(s: string | null | undefined): string | null {
  return s && s.trim() ? s : null
}

function derivePublishedAt(item: ParsedItem): number {
  for (const c of [item.isoDate, item.pubDate, item.atomUpdated]) {
    if (!c) continue
    const ms = Date.parse(c)
    if (!Number.isNaN(ms)) return ms
  }
  return Date.now() // last resort; anchors a dateless item to first-seen time
}

/** Crude plain-text snippet: prefer rss-parser's contentSnippet, else strip tags. */
function deriveSnippet(item: ParsedItem): string | null {
  const raw =
    item.contentSnippet ??
    (item.content ?? item.summary ?? item.contentEncoded ?? '').replace(/<[^>]+>/g, ' ')
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_MAX)
  return text || null
}

interface PreparedItem {
  guid: string | null
  link: string | null
  title: string
  summary: string | null
  publishedAt: number
  dedupKey: string
}

// ---------------------------------------------------------------------------
// Feed sync + refresh
// ---------------------------------------------------------------------------

/** Make sure every given feed URL has a row; returns those rows. */
function ensureConfiguredFeeds(feeds: readonly string[]): FeedRow[] {
  if (feeds.length === 0) return []
  transaction(() => {
    for (const url of feeds) {
      run(`INSERT INTO feeds (feed_url) VALUES (?) ON CONFLICT(feed_url) DO NOTHING`, url)
    }
  })
  return queryAll<FeedRow>(
    `SELECT * FROM feeds WHERE feed_url IN (${inPlaceholders(feeds.length)}) ORDER BY id ASC`,
    ...feeds,
  )
}

const INSERT_ITEM = `
  INSERT INTO items (feed_id, guid, link, title, summary, published_at, dedup_key)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(feed_id, dedup_key) DO NOTHING
`

/**
 * Fetch + parse one feed, then upsert its items inside a transaction. All async
 * work happens before the transaction so node:sqlite never awaits mid-transaction.
 * Never throws: failures — including a failure to record the failure — are
 * swallowed so one bad feed can't abort the whole refresh batch.
 */
async function refreshFeed(row: FeedRow, logger: NewsLogger): Promise<void> {
  const now = Date.now()
  try {
    const result = await fetchFeed({
      feedUrl: row.feed_url,
      etag: row.etag,
      lastModified: row.last_modified,
    })

    if (result.kind === 'notModified') {
      run(`UPDATE feeds SET last_fetched_at = ?, fetch_error = NULL WHERE id = ?`, now, row.id)
      return
    }

    const parsed = await parser.parseString(result.xml)
    const feedTitle = (parsed.title ?? '').toString()
    const prepared: PreparedItem[] = (parsed.items ?? []).map((raw) => {
      const item = raw as ParsedItem
      const guid = blankToNull(item.guid) ?? blankToNull(item.id)
      const link = blankToNull(item.link)
      const title = (item.title ?? '').toString().replace(/\s+/g, ' ').trim() || '(untitled)'
      return {
        guid,
        link,
        title,
        summary: deriveSnippet(item),
        publishedAt: derivePublishedAt(item),
        // guid, then link, then a stable synthetic hash (never a timestamp).
        dedupKey: guid ?? link ?? sha256(`${title}\0${row.feed_url}`),
      }
    })

    transaction(() => {
      for (const p of prepared) {
        run(INSERT_ITEM, row.id, p.guid, p.link, p.title, p.summary, p.publishedAt, p.dedupKey)
      }
      run(
        `UPDATE feeds SET
           title = COALESCE(NULLIF(?, ''), title),
           etag = ?, last_modified = ?, last_fetched_at = ?, fetch_error = NULL
         WHERE id = ?`,
        feedTitle,
        result.etag,
        result.lastModified,
        now,
        row.id,
      )
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`[news] failed to refresh ${row.feed_url}: ${message}`)
    // Recording the error must not itself throw and abort the batch.
    try {
      run(`UPDATE feeds SET last_fetched_at = ?, fetch_error = ? WHERE id = ?`, now, message, row.id)
    } catch (recordErr) {
      logger.error(`[news] failed to record fetch error for ${row.feed_url}:`, recordErr)
    }
  }
}

/** Map items through an async worker with at most `limit` in flight. */
async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      for (;;) {
        const i = next++
        if (i >= items.length) return
        await worker(items[i]!)
      }
    })(),
  )
  await Promise.all(runners)
}

/** Refresh every given feed row (the daily job runs once, so no staleness gate). */
async function refreshFeeds(rows: FeedRow[], logger: NewsLogger): Promise<void> {
  if (rows.length === 0) return
  logger.info(`[news] refreshing ${rows.length} feeds`)
  await mapWithConcurrency(rows, REFRESH_CONCURRENCY, (row) => refreshFeed(row, logger))
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** Newest items with published_at in [startMs, endMs), across the given feeds.
 *  Keyed on published_at so the digest only carries items the feeds actually
 *  published within the window (the last NEWS_LOOKBACK_HOURS), not older items
 *  that merely resurfaced in a feed. */
function itemsInWindow(startMs: number, endMs: number, feeds: readonly string[]): ItemRowWithFeed[] {
  if (feeds.length === 0) return []
  const params: SqlParam[] = [...feeds, startMs, endMs, config.newsMaxItems]
  return queryAll<ItemRowWithFeed>(
    `SELECT i.id, i.guid, i.link, i.title, i.summary, i.published_at,
            f.title AS feed_title, f.feed_url
     FROM items i
     JOIN feeds f ON f.id = i.feed_id
     WHERE f.feed_url IN (${inPlaceholders(feeds.length)}) AND i.published_at >= ? AND i.published_at < ?
     ORDER BY i.published_at DESC, i.id DESC
     LIMIT ?`,
    ...params,
  )
}

/** Epoch ms of the most recent stored summary for the active language, if any. */
function lastSummaryAt(): number | null {
  const row = queryGet<{ ts: number | null }>(
    `SELECT MAX(created_at) AS ts FROM summaries WHERE lang = ?`,
    config.newsLang,
  )
  return row && row.ts ? row.ts : null
}

/** Total stored items + newest published_at across the given feeds (diagnostics
 *  for an empty run: distinguishes "no feed items fetched" from "all too old").
 *  newest is published_at to match the itemsInWindow gate. */
function feedItemStats(feeds: readonly string[]): { total: number; newest: number | null } {
  if (feeds.length === 0) return { total: 0, newest: null }
  const row = queryGet<{ total: number; newest: number | null }>(
    `SELECT COUNT(*) AS total, MAX(i.published_at) AS newest
     FROM items i JOIN feeds f ON f.id = i.feed_id
     WHERE f.feed_url IN (${inPlaceholders(feeds.length)})`,
    ...feeds,
  )
  return { total: row?.total ?? 0, newest: row?.newest ?? null }
}

function sourceName(row: ItemRowWithFeed): string {
  if (row.feed_title) return row.feed_title
  try {
    return new URL(row.feed_url).hostname
  } catch {
    return row.feed_url
  }
}

// ---------------------------------------------------------------------------
// Daily summary job (write path) + command reader (read path)
// ---------------------------------------------------------------------------

let inFlight: Promise<SummaryRun> | null = null

/**
 * Generate and store today's (UTC+8) summary: resolve feeds from OPML, refresh
 * them, collect the window's items, summarize, upsert. Single-flight —
 * overlapping calls (scheduled tick vs. startup catch-up vs. dev `news refresh`)
 * share one run and one LLM call.
 */
export function generateDailySummary(logger: NewsLogger): Promise<SummaryRun> {
  if (inFlight) return inFlight
  inFlight = runDailySummary(logger).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runDailySummary(logger: NewsLogger): Promise<SummaryRun> {
  const date = todayDate()
  const feeds = await resolveFeeds(config.newsOpmlUrl, config.newsFeeds, logger)
  const rows = ensureConfiguredFeeds(feeds)
  await refreshFeeds(rows, logger)

  // Collect items published in at least the last NEWS_LOOKBACK_HOURS, extending
  // further back if the previous summary is older (missed runs). A fixed
  // calendar-day range would silently drop items published between the run hour and
  // midnight — older than the next day's lower bound, so no run would ever pick
  // them up. Capping recent summaries at now-lookback means a mid-day manual
  // `news refresh` still yields a full-window digest rather than only the sliver
  // since the last refresh, so refreshing never shrinks the scheduled summary's
  // coverage.
  const now = Date.now()
  const lookbackMs = config.newsLookbackHours * 3_600_000
  const last = lastSummaryAt()
  const since = last === null ? now - lookbackMs : Math.min(now - lookbackMs, last)
  const items = itemsInWindow(since, now, feeds)
  if (items.length === 0) {
    const stats = feedItemStats(feeds)
    const newestAgo = stats.newest ? `${((now - stats.newest) / 3_600_000).toFixed(1)}h ago` : 'none'
    const why =
      stats.total === 0
        ? ' (no feed items fetched — check the feed errors above)'
        : ' (raise NEWS_LOOKBACK_HOURS to widen the window)'
    logger.info(
      `[news] no items in the last ${config.newsLookbackHours}h for ${date}; ` +
        `${stats.total} stored items for these feeds, newest ${newestAgo}${why}`,
    )
    return {
      kind: 'empty',
      date,
      totalItems: stats.total,
      newestAgeMs: stats.newest ? now - stats.newest : null,
      lookbackHours: config.newsLookbackHours,
    }
  }

  const payload: NewsItemForSummary[] = items.map((row) => ({
    title: row.title,
    source: sourceName(row),
    snippet: row.summary,
    publishedAt: row.published_at,
    link: row.link,
  }))

  logger.info(`[news] summarizing ${items.length} items for ${date} via ${config.newsModel}`)
  const summary = await summarizeNews(date, payload)

  run(
    `INSERT INTO summaries (date, lang, item_count, summary, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date, lang) DO UPDATE SET
       item_count = excluded.item_count,
       summary = excluded.summary,
       created_at = excluded.created_at`,
    date,
    config.newsLang,
    items.length,
    summary,
    Date.now(),
  )
  logger.info(`[news] stored summary for ${date} (${items.length} items)`)
  return { kind: 'stored', date, itemCount: items.length }
}

/**
 * Read a stored summary for the `news` command. `date === null` returns the most
 * recent summary available; a date string returns that day's summary. Never
 * fetches feeds or calls the LLM.
 */
export function getStoredSummary(date: string | null): NewsResult {
  const row = date
    ? queryGet<SummaryRow>(`SELECT * FROM summaries WHERE date = ? AND lang = ?`, date, config.newsLang)
    : queryGet<SummaryRow>(
        `SELECT * FROM summaries WHERE lang = ? ORDER BY date DESC LIMIT 1`,
        config.newsLang,
      )
  if (!row) return { kind: 'empty', date: date ?? todayDate() }
  return { kind: 'ok', date: row.date, summary: row.summary, itemCount: row.item_count }
}
