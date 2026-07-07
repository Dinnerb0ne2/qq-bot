import type { Bot, GroupMessageEvent, PrivateMessageEvent } from 'qq-official-bot'
import { config } from './config'
import { AntiAd, startAdRulesRefresh } from './ad'
import { generateDailySummary, getStoredSummary, parseNewsDate } from './news/service'
import { startDailyNewsSummary } from './news/scheduler'

/**
 * Register all message event handlers.
 * Wire per-message-type business logic here to keep index.ts small.
 */
export function registerHandlers(bot: Bot): void {
  const antiAd = new AntiAd(bot)

  // Optionally augment the built-in ad keywords & patterns from a remote file.
  if (config.adRulesUrl) {
    startAdRulesRefresh({
      url: config.adRulesUrl,
      intervalMs: config.adRulesRefreshMinutes * 60_000,
      logger: bot.logger,
    })
  }

  // Daily news summary: one scheduled LLM call at NEWS_SUMMARY_HOUR:00 UTC+8.
  // The `news` command only reads the stored result, so it stays free and fast.
  if (config.newsApiKey) {
    startDailyNewsSummary({ hour: config.newsSummaryHour, logger: bot.logger })
  } else {
    bot.logger.info('[news] daily summary disabled (set NEWS_LLM_API_KEY to enable)')
  }

  bot.on('message.group', (e) => {
    handleGroupMessage(bot, antiAd, e).catch((err) => bot.logger.error('Failed to handle group message:', err))
  })

  bot.on('message.private', (e) => {
    handlePrivateMessage(bot, e).catch((err) => bot.logger.error('Failed to handle private message:', err))
  })
}

/** Handle group messages */
async function handleGroupMessage(bot: Bot, antiAd: AntiAd, e: GroupMessageEvent): Promise<void> {
  // Ignore the bot's own messages.
  if (e.user_id === e.self_id) return

  const text = e.raw_message.trim()
  // Ad moderation: recall + strike tracking + admin escalation.
  // If the message was an ad, stop here (do not treat it as a command).
  if (await antiAd.inspect(e)) return

  await dispatchCommand(bot, text, e)
}

/** Handle private messages */
async function handlePrivateMessage(bot: Bot, e: PrivateMessageEvent): Promise<void> {
  const text = e.raw_message.trim()
  await dispatchCommand(bot, text, e)
}

/**
 * Minimal command router: first word is the command, the rest is the argument.
 * Replace with a fuller command/plugin system later.
 */
async function dispatchCommand(
  bot: Bot,
  text: string,
  e: GroupMessageEvent | PrivateMessageEvent,
): Promise<void> {
  const [command = '', ...rest] = text.split(/\s+/)
  const arg = rest.join(' ')

  switch (command) {
    case 'ping':
      await e.reply('pong')
      break
    case 'help':
      await e.reply('Available commands: ping, news [YYYY-MM-DD]')
      break
    case 'news':
      await handleNews(bot, arg, e)
      break
    default:
      // Stay silent on unknown input to avoid being noisy.
      break
  }
}

/** QQ group messages have a length cap; stay comfortably under it. */
const NEWS_REPLY_MAX = 3500

/**
 * `news [YYYY-MM-DD]` — reply with a stored daily summary. No argument returns
 * the most recent one; a date returns that day's. Read-only: the summary is
 * produced by the scheduled job. `news refresh` re-runs the job on demand, but
 * only in local dev (config.newsAllowManualRefresh); production is scheduled-only.
 */
async function handleNews(
  bot: Bot,
  arg: string,
  e: GroupMessageEvent | PrivateMessageEvent,
): Promise<void> {
  const trimmed = arg.trim()

  if (trimmed.toLowerCase() === 'refresh') {
    if (!config.newsAllowManualRefresh) {
      await e.reply('Manual news refresh is disabled (dev only).')
      return
    }
    await handleNewsRefresh(bot, e)
    return
  }

  let date: string | null
  if (!trimmed) {
    date = null // most recent stored summary
  } else {
    date = parseNewsDate(trimmed)
    if (!date) {
      await e.reply('Usage: news [YYYY-MM-DD], e.g. news or news 2026-07-06')
      return
    }
  }

  try {
    const result = getStoredSummary(date)
    if (result.kind === 'empty') {
      await e.reply(date ? `No AI news summary for ${date}.` : 'No AI news summary available yet.')
      return
    }
    const header = `AI news ${result.date} (${result.itemCount} items):\n`
    await e.reply(`${header}${result.summary}`.slice(0, NEWS_REPLY_MAX))
  } catch (err) {
    bot.logger.error('[news] failed to read summary:', err)
    await e.reply('Failed to fetch the news summary, please try again later.')
  }
}

/** `news refresh` (dev only): re-run the daily job now, then reply with the
 *  fresh summary. Slow (feed fetch + LLM), so it acks first, best-effort. */
async function handleNewsRefresh(
  bot: Bot,
  e: GroupMessageEvent | PrivateMessageEvent,
): Promise<void> {
  if (!config.newsApiKey) {
    await e.reply('The news summary job is not configured (set NEWS_LLM_API_KEY).')
    return
  }
  try {
    await e.reply('Refreshing AI news, this may take a moment…')
  } catch {
    // Ack is best-effort; the refresh below is what matters.
  }
  try {
    const outcome = await generateDailySummary(bot.logger)
    if (outcome.kind === 'empty') {
      if (outcome.totalItems === 0) {
        await e.reply('No news collected — no feed items were fetched. Check the dev logs for feed errors (usually network reachability).')
      } else {
        const newest = outcome.newestAgeMs === null ? 'unknown' : `${Math.round(outcome.newestAgeMs / 3_600_000)}h ago`
        await e.reply(
          `No news in the last ${outcome.lookbackHours}h (${outcome.totalItems} items stored, newest ${newest}). ` +
            'Raise NEWS_LOOKBACK_HOURS to widen the window.',
        )
      }
      return
    }
    const result = getStoredSummary(outcome.date)
    if (result.kind === 'empty') {
      await e.reply('No AI news summary available.')
      return
    }
    const header = `AI news ${result.date} (${result.itemCount} items):\n`
    await e.reply(`${header}${result.summary}`.slice(0, NEWS_REPLY_MAX))
  } catch (err) {
    bot.logger.error('[news] manual refresh failed:', err)
    await e.reply('Failed to refresh the news summary, please try again later.')
  }
}
