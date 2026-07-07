import type { Bot, GroupMessageEvent, PrivateMessageEvent } from 'qq-official-bot'
import { config } from './config'
import { AntiAd, startAdRulesRefresh } from './ad'

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
  bot.logger.info(`[group ${e.group_id}] ${e.sender.user_name}(${e.user_id}): ${text}`)

  // Ad moderation: recall + strike tracking + admin escalation.
  // If the message was an ad, stop here (do not treat it as a command).
  if (await antiAd.inspect(e)) return

  await dispatchCommand(text, e)
}

/** Handle private messages */
async function handlePrivateMessage(bot: Bot, e: PrivateMessageEvent): Promise<void> {
  const text = e.raw_message.trim()
  bot.logger.info(`[private ${e.user_id}] ${text}`)
  await dispatchCommand(text, e)
}

/**
 * Minimal command router example. Replace with a fuller command/plugin system later.
 */
async function dispatchCommand(
  text: string,
  e: GroupMessageEvent | PrivateMessageEvent,
): Promise<void> {
  switch (text) {
    case 'ping':
      await e.reply('pong')
      break
    case 'help':
      await e.reply('Available commands: ping')
      break
    default:
      // Stay silent on unknown input to avoid being noisy.
      break
  }
}
