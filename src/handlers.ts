import type { Bot, GroupMessageEvent, PrivateMessageEvent } from 'qq-official-bot'

/**
 * Register all message event handlers.
 * Wire per-message-type business logic here to keep index.ts small.
 */
export function registerHandlers(bot: Bot): void {
  bot.on('message.group', (e) => {
    handleGroupMessage(bot, e).catch((err) => bot.logger.error('Failed to handle group message:', err))
  })

  bot.on('message.private', (e) => {
    handlePrivateMessage(bot, e).catch((err) => bot.logger.error('Failed to handle private message:', err))
  })
}

/** Handle group messages */
async function handleGroupMessage(bot: Bot, e: GroupMessageEvent): Promise<void> {
  const text = e.raw_message.trim()
  bot.logger.info(`[group ${e.group_id}] ${e.sender.user_name}(${e.user_id}): ${text}`)

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
