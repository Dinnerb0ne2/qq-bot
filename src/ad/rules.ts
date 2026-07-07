/**
 * Ad rules: the single source of truth the detector reads on every message.
 *
 * Each signal has a bundled baseline (keywords.ts / patterns.ts) that is unioned
 * with the matching section of one remote rules file. The file has an INI-like
 * format with two sections:
 *
 *   [keywords]
 *   促销
 *   代购
 *
 *   [patterns]
 *   拉[你您]进[群裙]
 *   /加\s*薇/i
 *
 * Lines before any section, and `#` lines, are ignored. A single fetch updates
 * both lists atomically; any failure keeps the current lists (see RemoteFile).
 */

import { RemoteFile, type RefreshResult, type RemoteLogger } from './remote-file'
import { BUILTIN_AD_KEYWORDS, parseKeywordList } from './keywords'
import { BUILTIN_AD_PATTERNS, parsePatternList } from './patterns'

const patternKey = (re: RegExp): string => `${re.source} ${re.flags}`

/** Active lists (baseline ∪ last good remote). Swapped atomically on refresh. */
let activeKeywords: readonly string[] = BUILTIN_AD_KEYWORDS
let activePatterns: readonly RegExp[] = BUILTIN_AD_PATTERNS

/** The keyword list the detector should match against right now. */
export const getAdKeywords = (): readonly string[] => activeKeywords
/** The patterns the detector should match against right now. */
export const getAdPatterns = (): readonly RegExp[] => activePatterns

/** Reset both lists to the bundled baselines (used by tests). */
export function resetAdRules(): void {
  activeKeywords = BUILTIN_AD_KEYWORDS
  activePatterns = BUILTIN_AD_PATTERNS
}

/**
 * Parse the merged rules file into keyword + pattern lists. Section headers
 * `[keywords]` / `[patterns]` (case-insensitive) route the lines that follow;
 * lines outside a known section are reported as skipped.
 */
export function parseAdRules(body: string): { keywords: string[]; patterns: RegExp[]; skipped: string[] } {
  const keywordLines: string[] = []
  const patternLines: string[] = []
  const skipped: string[] = []
  let section: 'keywords' | 'patterns' | null = null

  for (const line of body.replace(/^﻿/, '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const header = /^\[([a-zA-Z]+)\]$/.exec(trimmed)
    if (header) {
      const name = header[1].toLowerCase()
      if (name === 'keywords' || name === 'patterns') section = name
      else {
        section = null
        skipped.push(`[${header[1]}] (unknown section)`)
      }
      continue
    }

    if (section === 'keywords') keywordLines.push(trimmed)
    else if (section === 'patterns') patternLines.push(trimmed)
    else skipped.push(`${trimmed} (outside a [keywords]/[patterns] section)`)
  }

  const keywords = parseKeywordList(keywordLines.join('\n'))
  const patterns = parsePatternList(patternLines.join('\n'))
  return { keywords, patterns: patterns.items, skipped: [...skipped, ...patterns.skipped] }
}

const file = new RemoteFile({
  name: 'ad-rules',
  apply: (body) => {
    const { keywords, patterns, skipped } = parseAdRules(body)
    // Union each remote slice with its baseline, deduped; swap in one assignment.
    activeKeywords = [...new Set([...BUILTIN_AD_KEYWORDS, ...keywords])]
    const merged = new Map<string, RegExp>()
    for (const re of BUILTIN_AD_PATTERNS) merged.set(patternKey(re), re)
    for (const re of patterns) merged.set(patternKey(re), re)
    activePatterns = [...merged.values()]
    return { parsed: keywords.length + patterns.length, skipped: skipped.length }
  },
})

/** Fetch the rules file from `url` and union it with the baselines. */
export const refreshAdRules = (url: string, opts?: { timeoutMs?: number }): Promise<RefreshResult> =>
  file.refresh(url, opts)

/** Start periodic rules refresh; returns a stop function. */
export const startAdRulesRefresh = (params: {
  url: string
  intervalMs: number
  logger: RemoteLogger
}): (() => void) => file.startRefresh(params)
