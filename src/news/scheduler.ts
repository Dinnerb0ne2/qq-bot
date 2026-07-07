// Daily news-summary scheduler: fires generateDailySummary at `hour`:00 UTC+8,
// re-arming itself each day. A self-rescheduling setTimeout (not setInterval) so
// the next fire is always recomputed against the wall clock, and the timer is
// unref'd so it never keeps the process alive on its own.

import {
  generateDailySummary,
  getStoredSummary,
  isPastDailyRun,
  msUntilDailyRun,
  todayDate,
  type NewsLogger,
} from './service'

/** Start the daily summary job. Returns a stop function. */
export function startDailyNewsSummary(params: { hour: number; logger: NewsLogger }): () => void {
  const { hour, logger } = params
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const scheduleNext = (): void => {
    if (stopped) return
    const delay = msUntilDailyRun(hour)
    timer = setTimeout(() => {
      generateDailySummary(logger)
        .catch((err) => logger.error('[news] daily summary failed:', err))
        .finally(scheduleNext)
    }, delay)
    timer.unref?.()
    logger.info(`[news] next daily summary in ${Math.round(delay / 60_000)} min (${hour}:00 UTC+8)`)
  }

  // Catch-up: a restart after the run hour with today's summary still missing
  // (e.g. a redeploy at 23:00) generates it now instead of waiting a full day.
  // Before the run hour, today's summary is legitimately not ready yet.
  if (isPastDailyRun(hour) && getStoredSummary(todayDate()).kind === 'empty') {
    logger.info("[news] today's summary missing after run hour; generating now")
    generateDailySummary(logger).catch((err) => logger.error('[news] catch-up summary failed:', err))
  }

  scheduleNext()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
