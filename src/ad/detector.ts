/**
 * Chinese advertisement detector.
 *
 * Ported from the old napcatqq branch's utils/chinese_ad_detector.py. The
 * original used jieba word segmentation for a density score; since we have no
 * Chinese segmenter here, we approximate with substring keyword hits plus the
 * high-signal contact/promo regex patterns (which alone are enough to flag).
 *
 * The keyword and regex-pattern lists come from rules.ts (each a bundled
 * baseline unioned with a remote rules file); this file owns the matching.
 */

import { getAdKeywords, getAdPatterns } from './rules'

export interface AdMatch {
  /** Human-readable reason the message was flagged (for logs). */
  reason: string
  /** Distinct ad keywords found in the text. */
  keywords: string[]
}

/**
 * Detect whether `text` looks like an advertisement.
 *
 * @param text the message text to inspect
 * @param minKeywordHits minimum distinct keywords to flag on the keyword path
 * @returns an AdMatch describing why it matched, or null if it is not an ad
 */
export function detectAd(text: string, minKeywordHits = 2): AdMatch | null {
  if (!text) return null

  // Strong signal: any contact/promo pattern is enough on its own.
  for (const pattern of getAdPatterns()) {
    if (pattern.test(text)) {
      return { reason: `pattern:${pattern.source}`, keywords: [] }
    }
  }

  // Keyword signal: flag when enough distinct ad keywords appear.
  const keywords = [...new Set(getAdKeywords().filter((word) => text.includes(word)))]
  if (keywords.length >= minKeywordHits) {
    return { reason: `keywords>=${minKeywordHits}`, keywords }
  }

  return null
}
