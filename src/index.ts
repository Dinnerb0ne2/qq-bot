import { Bot, ReceiverMode } from 'qq-official-bot'
import { config } from './config'
import { registerHandlers } from './handlers'

async function main(): Promise<void> {
  const bot = new Bot({
    appid: config.appid,
    secret: config.secret,
    sandbox: config.sandbox,
    logLevel: config.logLevel,
    removeAt: true, // Automatically strip the leading @bot mention
    maxRetry: 10,
    mode: ReceiverMode.WEBSOCKET,
    intents: [
      'GROUP_AND_C2C_EVENT', // Group @ messages + private (C2C) messages
      // Enable channel (guild) capabilities as needed:
      // 'PUBLIC_GUILD_MESSAGES', // public guild messages
      // 'GUILD_MESSAGES',        // private-domain guild messages
      // 'GUILDS', 'GUILD_MEMBERS',
    ],
  })

  registerHandlers(bot)

  await bot.start()
  bot.logger.info('QQ bot started')
}

main().catch((err) => {
  console.error('Failed to start:', err)
  process.exit(1)
})
