/**
 * Chinese advertisement detector.
 *
 * Ported from the old napcatqq branch's utils/chinese_ad_detector.py. The
 * original used jieba word segmentation for a density score; since we have no
 * Chinese segmenter here, we approximate with substring keyword hits plus the
 * high-signal contact/promo regex patterns (which alone are enough to flag).
 *
 * The keyword and regex-pattern lists come from rules.ts (a config/ad.json
 * base, optionally unioned with a remote rules file); this file owns the
 * matching.
 *
 * Keyword matching is scored with a naive-Bayes model (see bayes.ts): every
 * distinct hit is evidence weighted by a likelihood ratio — strong keywords
 * weigh much more than generic ones, and a prior base rate is folded in.
 * Message length shapes the evidence mildly (short messages dampen their
 * keyword hits, long ones add a capped length LR) and a URL whose domain is
 * not on the safe whitelist adds a modest LR of its own.
 *
 * A flag requires **ad features to co-occur** — no single indicator decides on
 * its own: the message must meet the distinct-hit floor AND either contain a
 * strong keyword (or a per-keyword LR override) or a suspicious URL. So a pile
 * of generic words alone (`客服 咨询 QQ …`), a lone keyword in a very long post,
 * or a bare recommendation link never flag; they only interact with each
 * other. High-signal contact/promo patterns still flag on their own.
 */

import { adLogOdds, adProbability, type AdHit } from './bayes'
import { getAdKeywordMatcher, getAdPatterns } from './rules'
import { getAdSettings, type AdSettings } from './settings'
import { scanUrls } from './urls'

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
 * @param settings the active ad settings (min keyword floor, naive-Bayes
 *   prior/threshold/likelihood ratios, short-message dampening and long-message
 *   length LR); defaults to the loaded config/ad.json
 * @returns an AdMatch describing why it matched, or null if it is not an ad
 */
export function detectAd(text: string, settings: AdSettings = getAdSettings()): AdMatch | null {
  if (!text) return null

  // Strong signal: any contact/promo pattern is enough on its own.
  for (const pattern of getAdPatterns()) {
    if (pattern.test(text)) {
      return { reason: `pattern:${pattern.source}`, keywords: [] }
    }
  }

  // Keyword signal: scan once with the precompiled alternation regex, counting
  // occurrences per distinct keyword (repetition is evidence), then score the
  // hits with the naive-Bayes model.
  const matcher = getAdKeywordMatcher()
  // Clone the shared regex: exec() advances lastIndex, and the cached one is
  // global — mutating it would corrupt matching for other callers.
  const re = new RegExp(matcher.regex.source, matcher.regex.flags)
  const hits = new Map<string, { count: number; strong: boolean }>()
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    const key = m[0].toLowerCase()
    const rec = hits.get(key)
    if (rec) rec.count++
    else hits.set(key, { count: 1, strong: matcher.strong.has(key) })
  }

  if (hits.size >= settings.minKeywordHits) {
    const adHits: AdHit[] = []
    for (const [key, rec] of hits) {
      const canonical = matcher.canonical.get(key) ?? key
      adHits.push({ strong: rec.strong, count: rec.count, lr: settings.keywordLrs.get(canonical) })
    }

    // Ad features must co-occur: keyword evidence needs either a strong (or
    // LR-overridden) hit or a suspicious URL to be an ad at all — a pile of
    // generic words or a lone keyword in a long post is not.
    const hardKeyword = adHits.some((h) => h.strong || h.lr !== undefined)
    const urlScan = scanUrls(text, settings.safeUrlDomains, settings.suspiciousTlds)
    if (hardKeyword || urlScan.suspiciousUrl) {
      const p = adProbability(
        adLogOdds(adHits, settings.bayes, text.length, urlScan.suspiciousUrl, urlScan.suspiciousTld),
      )
      if (p >= settings.bayes.threshold) {
        const keywords = [...hits.keys()].map((k) => matcher.canonical.get(k) ?? k)
        return { reason: `keywords=${hits.size} p(ad)=${p.toFixed(2)}`, keywords }
      }
    }
  }

  return null
}
