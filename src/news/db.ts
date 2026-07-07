// SQLite storage for the news command (schema and helpers modeled on iread's
// src/server/db.ts). Opened lazily on first use so a bot that never runs the
// news command touches no database file at all.

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { config } from '../config'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feeds (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_url        TEXT    NOT NULL UNIQUE,
  title           TEXT    NOT NULL DEFAULT '',
  etag            TEXT,
  last_modified   TEXT,
  last_fetched_at INTEGER,
  fetch_error     TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id      INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid         TEXT,
  link         TEXT,
  title        TEXT    NOT NULL DEFAULT '(untitled)',
  summary      TEXT,
  published_at INTEGER NOT NULL,
  fetched_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  dedup_key    TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_feed_dedup ON items(feed_id, dedup_key);
CREATE INDEX IF NOT EXISTS idx_items_pub ON items(published_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS summaries (
  date       TEXT    NOT NULL,
  lang       TEXT    NOT NULL,
  item_count INTEGER NOT NULL,
  summary    TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  PRIMARY KEY (date, lang)
);
`

let handle: DatabaseSync | null = null

function getDb(): DatabaseSync {
  if (handle) return handle
  const dbPath = resolve(process.cwd(), config.newsDbPath)
  // DatabaseSync does not create intermediate directories on its own.
  mkdirSync(dirname(dbPath), { recursive: true })
  handle = new DatabaseSync(dbPath)
  // WAL keeps readers from erroring during writes; busy_timeout avoids
  // spurious SQLITE_BUSY; foreign_keys enforces ON DELETE CASCADE.
  handle.exec('PRAGMA journal_mode = WAL;')
  handle.exec('PRAGMA foreign_keys = ON;')
  handle.exec('PRAGMA busy_timeout = 5000;')
  handle.exec(SCHEMA)
  return handle
}

// ---------------------------------------------------------------------------
// Typed rows + access helpers
// ---------------------------------------------------------------------------

export interface FeedRow {
  id: number
  feed_url: string
  title: string
  etag: string | null
  last_modified: string | null
  last_fetched_at: number | null
  fetch_error: string | null
  created_at: number
}

/** Item joined with its owning feed's title/url, as used by the summarizer. */
export interface ItemRowWithFeed {
  id: number
  guid: string | null
  link: string | null
  title: string
  summary: string | null
  published_at: number
  feed_title: string
  feed_url: string
}

export interface SummaryRow {
  date: string
  lang: string
  item_count: number
  summary: string
  created_at: number
}

export type SqlParam = null | number | bigint | string | Uint8Array

/** Build an `IN (?, ?, …)` placeholder list of length `n` (n >= 1). */
export function inPlaceholders(n: number): string {
  return Array(n).fill('?').join(',')
}

export function queryAll<T>(sql: string, ...params: SqlParam[]): T[] {
  return getDb().prepare(sql).all(...params) as unknown as T[]
}

export function queryGet<T>(sql: string, ...params: SqlParam[]): T | undefined {
  return getDb().prepare(sql).get(...params) as unknown as T | undefined
}

export function run(sql: string, ...params: SqlParam[]): { changes: number; lastInsertRowid: number } {
  const res = getDb().prepare(sql).run(...params)
  return { changes: Number(res.changes), lastInsertRowid: Number(res.lastInsertRowid) }
}

/** Run `fn` inside a single transaction; commits on success, rolls back on throw. */
export function transaction<T>(fn: () => T): T {
  const db = getDb()
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
