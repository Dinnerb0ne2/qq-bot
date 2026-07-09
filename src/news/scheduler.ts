// Daily news-summary scheduler: fires generateDailySummary at `hour`:00 UTC+8,
// re-arming itself each day. A self-rescheduling setTimeout (not setInterval) so
// the next fire is always recomputed against the wall clock, and the timer is
// unref'd so it never keeps the process alive on its own.
//
// Start this only after bot.start() has resolved: the startup delivery sweep
// below sends group messages, and before start() the SDK has no access token.

import {
  generateDailySummary,
  getStoredSummary,
  isPastDailyRun,
  msUntilDailyRun,
  todayDate,
  yesterdayDate,
  type NewsLogger,
} from './service'

/** Start the daily summary job. Returns a stop function. */
export function startDailyNewsSummary(params: {
  hour: number
  logger: NewsLogger
  /** Delivery hook, fired with a date whose stored summary should reach the
   *  groups. Fired after each generation and speculatively from the startup
   *  sweep (to retry pushes a crash or send failure dropped), so it must be
   *  idempotent and tolerate dates with nothing stored. */
  onSummary?: (date: string) => Promise<void>
}): () => void {
  const { hour, logger, onSummary } = params
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const runAndDeliver = async (): Promise<void> => {
    const outcome = await generateDailySummary(logger)
    if (outcome.kind === 'stored' && onSummary) await onSummary(outcome.date)
  }

  const scheduleNext = (): void => {
    if (stopped) return
    const delay = msUntilDailyRun(hour)
    timer = setTimeout(() => {
      runAndDeliver()
        .catch((err) => logger.error('[news] daily summary failed:', err))
        .finally(scheduleNext)
    }, delay)
    timer.unref?.()
    logger.info(`[news] next daily summary in ${Math.round(delay / 60_000)} min (${hour}:00 UTC+8)`)
  }

  // Generation catch-up: a restart after the run hour with today's summary
  // still missing (e.g. a redeploy at 23:00) generates it now instead of
  // waiting a full day. Before the run hour, today's is legitimately not ready.
  if (isPastDailyRun(hour) && getStoredSummary(todayDate()).kind === 'empty') {
    logger.info("[news] today's summary missing after run hour; generating now")
    runAndDeliver().catch((err) => logger.error('[news] catch-up summary failed:', err))
  }

  // Delivery catch-up, at any hour: re-offer the last two days' summaries so a
  // push that a crash, failed send, or pre-feature deploy left undelivered
  // goes out now. The push layer's markers make this a no-op when everything
  // was already delivered (or nothing is stored / no groups are configured).
  if (onSummary) {
    for (const date of [yesterdayDate(), todayDate()]) {
      onSummary(date).catch((err) => logger.error(`[news] catch-up delivery for ${date} failed:`, err))
    }
  }

  scheduleNext()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
