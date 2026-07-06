import 'dotenv/config'
import type { LogLevel } from 'qq-official-bot'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`)
  }
  return value
}

export const config = {
  /** QQ bot App ID */
  appid: required('BOT_APPID'),
  /** QQ bot App Secret */
  secret: required('BOT_SECRET'),
  /** Whether to use the sandbox environment */
  sandbox: process.env.BOT_SANDBOX === 'true',
  /** Log level */
  logLevel: (process.env.LOG_LEVEL ?? 'info') as LogLevel,
} as const

export type Config = typeof config
