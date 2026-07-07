import type { Bot, GroupMessageEvent } from 'qq-official-bot'
import { config } from '../config'
import { detectAd } from './detector'

/**
 * Ad moderation for group messages.
 *
 * On each detected ad it recalls the message and records a strike against the
 * sender. Once a sender reaches the configured strike limit, a normal reply
 * message is sent once in the group. The QQ official group API cannot mute or
 * kick members, so removing the member remains a manual admin action.
 *
 * State is in-memory and resets on restart.
 */
export class AntiAd {
  /** Strike count keyed by `${group_id}:${user_id}`. */
  private readonly strikes = new Map<string, number>()
  /** Keys already alerted, to avoid duplicate messages. */
  private readonly alerted = new Set<string>()

  constructor(private readonly bot: Bot) {}

  /**
   * Inspect a group message. If it is an ad: recall it, add a strike, and send
   * an alert message once the strike limit is reached.
   *
   * @returns true if the message was handled as an ad
   */
  async inspect(e: GroupMessageEvent): Promise<boolean> {
    const match = detectAd(e.raw_message, config.adMinKeywordHits)
    if (!match) return false

    const key = `${e.group_id}:${e.user_id}`
    const count = (this.strikes.get(key) ?? 0) + 1
    this.strikes.set(key, count)

    const detail = match.keywords.length ? ` [${match.keywords.join(', ')}]` : ''
    this.bot.logger.warn(
      `[anti-ad] ad from ${e.sender.user_name}(${e.user_id}) in group ${e.group_id} ` +
        `— ${match.reason}${detail} — strike ${count}/${config.adStrikeLimit}`,
    )

    // At the strike limit, send a normal reply message once. Do this before the
    // recall so the passive reply still references the triggering message.
    if (count >= config.adStrikeLimit && !this.alerted.has(key)) {
      this.alerted.add(key)
      try {
        await e.reply(
          `Ad alert: "${e.sender.user_name}" (${e.user_id}) has posted ${count} ads. ` +
            `Please have an admin remove this member.`,
        )
      } catch (err) {
        this.bot.logger.error('[anti-ad] failed to send alert message:', err)
      }
    }

    // Recall the offending message (best-effort; may require permission).
    try {
      await this.bot.recallGroupMessage(e.group_id, e.message_id)
    } catch (err) {
      this.bot.logger.error(`[anti-ad] failed to recall message ${e.message_id}:`, err)
    }

    return true
  }
}
