/**
 * Chinese forbidden-word (违禁词) detector.
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
 * A flag requires **violation features to co-occur** — no single indicator
 * decides on its own: the message must meet the distinct-hit floor AND either
 * contain a strong keyword (a promo/offer/urgency pitch — the thing being
 * advertised), a suspicious URL, or an explicit promotion structure (promo
 * code, price pitch, enrollment funnel, paid-service pitch, call-to-action,
 * or a pitch+contact cluster). Bare contact words (`加我 私聊 微信 …`) are
 * general hits that only *reinforce* a real pitch; a pile of them alone
 * (`客服 咨询 QQ …`), a lone keyword in a very long post, or a bare
 * recommendation link never flag — they only interact with each other.
 * High-signal contact/promo *patterns* (e.g. `加V:abc123`) still flag on
 * their own.
 *
 * Every keyword carries a **violation category** (赌博 / 毒品 / 诈骗兼职 / 色情 /
 * 广告 — the `categories` section of config/ad.json; uncategorized words,
 * including remote additions, are 广告). The winning category is the one with
 * the most distinct keyword hits and is reported in the match / test output.
 *
 * A **variant word** (变种词 — 薇信 for 微信, 扣扣 for QQ, 菠菜 for 博彩; the
 * `variantKeywords` map) is a deliberate obfuscation and counts as a *strong*
 * hit of the canonical keyword it maps to, weighted by `variantLr`: a message
 * that hides its hook is far likelier a violation than one that states it
 * plainly.
 */

import { violationLogOdds, violationProbability, violationShortScale, type ModerationHit } from './bayes'
import { analyzeFeatures, type ModerationFeatures } from './features'
import { getViolationContactPatterns, getViolationKeywordMatcher, getViolationPatterns } from './rules'
import { getModerationSettings, type ModerationSettings } from './settings'
import { classifyUrls, type UrlEvidence } from './urls'
import { DEFAULT_CATEGORY } from './keywords'

/** A contact pattern matched inside a message longer than this is not a hard
 *  flag on its own — it becomes soft evidence (see analyzeViolation). */
export const SHORT_PATTERN_LENGTH = 30

/** Extra context about a message that shapes the violation judgment. */
export interface ModerationContext {
  /** True when the message is a reply/quote of an earlier group message.
   *  Replying usually means continuing a discussion, not pitching, so the soft
   *  keyword/contact evidence is dampened by `bayes.replyFactor`. */
  reply?: boolean
}

export interface ViolationMatch {
  /** Human-readable reason the message was flagged (for logs). */
  reason: string
  /** Distinct violation keywords found in the text. */
  keywords: string[]
  /** Winning violation category (赌博/毒品/诈骗兼职/色情/广告). */
  category: string
}

/** One distinct keyword hit, with its evidence breakdown (for the test tool). */
export interface ViolationKeywordDetail {
  /** The text actually matched in the message (lowercased). */
  matched: string
  /** Canonical keyword (as written in the rules list). */
  keyword: string
  /** Violation category tag (赌博/毒品/诈骗兼职/色情/广告). */
  category: string
  /** Occurrences in the message (repetition is discounted). */
  count: number
  /** High-signal (strong) term. */
  strong: boolean
  /** True when the matched text is a deliberate variant (变种词) of `keyword` —
   *  scored as strong with its LR multiplied by `bayes.variantLr`. */
  variant: boolean
  /** Effective likelihood ratio used: per-keyword override, else class LR. */
  lr: number
  /** Scalar applied to ln(lr): repeatDiminish^(count-1) × weak diminishing. */
  weight: number
  /** Evidence contribution ln(lr) × weight (before length short-scaling). */
  logOdds: number
}

/** Full step-by-step breakdown of how a message scored. */
export interface ViolationAnalysis {
  /** The message text. */
  text: string
  /** Text length in chars. */
  length: number
  /** Which path decided the outcome: a pattern, keyword scoring, or nothing. */
  trigger: 'pattern' | 'keywords' | 'none'
  /** Matched high-signal *offer* patterns (regex sources), in rule order. */
  patterns: string[]
  /** Matched contact/hook patterns (regex sources), in rule order. */
  contactPatterns: string[]
  /** True when the contact patterns hard-flag on their own (short message, or
   *  2+ matches). Otherwise a lone contact pattern is soft evidence. */
  contactHard: boolean
  /** Structural violation features found (code/price/register/service/cta) and
   *  the conversational dampeners (question/collab/chat) that apply. */
  features: ModerationFeatures
  /** Distinct keyword hits found (across general + strong lists). */
  keywordHits: number
  /** Distinct *variant* words found (变种词 — 薇信, 扣扣, 菠菜…). Each is a
   *  strong hit of its canonical keyword, × `bayes.variantLr`. */
  variantHits: number
  /** Configured minimum distinct hits for the keyword path to engage. */
  minKeywordHits: number
  /** True when a hit is strong or has a per-keyword LR override. */
  hardKeyword: boolean
  /** Distinct keyword hits per violation category (赌博/毒品/诈骗兼职/色情/广告). */
  categoryEvidence: Readonly<Record<string, number>>
  /** Winning violation category (most distinct hits; 广告 tie-break/fallback). */
  category: string
  /** Per-hit evidence breakdown, strongest first (as scored). */
  keywords: ViolationKeywordDetail[]
  /** URL evidence for every URL found. */
  urls: UrlEvidence[]
  /** Prior log-odds log(p/(1-p)). */
  priorLogit: number
  /** Sum of keyword ln(LR)×weight, before dampening and short-scaling. */
  keywordLogOdds: number
  /** Soft evidence from a lone contact pattern in a long message. */
  contactLogOdds: number
  /** Sum of structural-feature ln(LR)s (code/price/register/service/cta). */
  structureLogOdds: number
  /** Soft evidence from a pitch+contact cluster (团购…联系客服), dampened like
   *  keyword evidence. */
  pitchLogOdds: number
  /** Conversational dampener applied to the soft keyword+contact evidence
   *  (product of question/reply/collab/chat factors; 1 when none apply). */
  dampeningFactor: number
  /** True when the message is a reply/quote of an earlier message (context). */
  reply: boolean
  /** Keyword-evidence multiplier at this length (0<shortScale≤1). */
  shortScale: number
  /** Length evidence term (capped), added after keyword evidence. */
  lengthLogOdds: number
  /** Suspicious-URL + suspicious-TLD evidence added after length. */
  urlLogOdds: number
  /** Final posterior log-odds. */
  logOdds: number
  /** Final posterior probability P(violation), 0..1. */
  probability: number
  /** Configured threshold; a keyword-flagged message needs p ≥ threshold. */
  threshold: number
  /** True when detectViolation() would return a match (message recalled). */
  flagged: boolean
}

/**
 * Detect whether `text` looks like a violation (ad / gambling / drug / scam).
 *
 * @param text the message text to inspect
 * @param settings the active settings (min keyword floor, naive-Bayes
 *   prior/threshold/likelihood ratios, short-message dampening and long-message
 *   length LR); defaults to the loaded config/ad.json
 * @param context optional message context (e.g. whether it is a reply)
 * @returns a ViolationMatch describing why it matched (with the winning
 *   category), or null if it is not a violation
 */
export function detectViolation(
  text: string,
  settings: ModerationSettings = getModerationSettings(),
  context?: ModerationContext,
): ViolationMatch | null {
  if (!text) return null
  const a = analyzeViolation(text, settings, context)
  if (a.trigger === 'pattern') {
    return {
      reason: `pattern:${a.patterns[0] ?? a.contactPatterns[0]}`,
      keywords: [],
      category: a.category,
    }
  }
  if (a.trigger === 'keywords' && a.flagged) {
    const keywords = a.keywords.map((k) => k.keyword)
    const variant = a.variantHits > 0 ? ` variant=${a.variantHits}` : ''
    return {
      reason: `category=${a.category} keywords=${a.keywordHits}${variant} p(violation)=${a.probability.toFixed(2)}`,
      keywords,
      category: a.category,
    }
  }
  return null
}

/**
 * Analyze `text` and return a full step-by-step breakdown: matched patterns,
 * structural features, every keyword hit with its likelihood ratio / weight /
 * evidence, URL classification, length evidence and the final posterior
 * probability against the threshold. Backs detectViolation() and drives the
 * `ad-test` CLI.
 */
export function analyzeViolation(
  text: string,
  settings: ModerationSettings = getModerationSettings(),
  context?: ModerationContext,
): ViolationAnalysis {
  const length = text.length

  // Structural features: an explicit offer code / price pitch / enrollment
  // funnel / paid-service pitch / call-to-action. The pitch+contact cluster is
  // fuzzier than these — 团购…加我 is often a reply offering help — so its
  // evidence is dampened with the soft keyword evidence below, while a concrete
  // code / price / funnel / service offer is never dampened.
  const features = analyzeFeatures(text)
  const structureLogOdds =
    (features.code ? Math.log(settings.bayes.codeLr) : 0) +
    (features.price ? Math.log(settings.bayes.priceLr) : 0) +
    (features.register ? Math.log(settings.bayes.registerLr) : 0) +
    (features.service ? Math.log(settings.bayes.serviceLr) : 0) +
    (features.cta ? Math.log(settings.bayes.ctaLr) : 0)
  const pitchLogOdds = features.pitch ? Math.log(settings.bayes.pitchLr) : 0
  const hasStructure = structureLogOdds > 0 || features.pitch

  // Offer patterns hard-flag on their own. Contact patterns hard-flag only when
  // the message is short (nothing else it could be but the hook) or several
  // co-occur; a lone one in a long message is soft evidence (contactLogOdds).
  const patterns: string[] = []
  for (const pattern of getViolationPatterns()) {
    if (pattern.test(text)) patterns.push(pattern.source)
  }
  const contactMatches: string[] = []
  for (const pattern of getViolationContactPatterns()) {
    if (pattern.test(text)) contactMatches.push(pattern.source)
  }
  const contactHard = contactMatches.length >= 2 || (contactMatches.length === 1 && length <= SHORT_PATTERN_LENGTH)
  const contactLogOdds = !contactHard && contactMatches.length === 1 ? Math.log(settings.bayes.contactLr) : 0

  // Keyword signal: scan once with the precompiled alternation regex, counting
  // occurrences per distinct keyword (repetition is evidence), then score the
  // hits with the naive-Bayes model.
  const matcher = getViolationKeywordMatcher()
  // Clone the shared regex: exec() advances lastIndex, and the cached one is
  // global — mutating it would corrupt matching for other callers.
  const re = new RegExp(matcher.regex.source, matcher.regex.flags)
  const hits = new Map<string, { count: number; strong: boolean; variant: boolean }>()
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    const key = m[0].toLowerCase()
    const rec = hits.get(key)
    if (rec) rec.count++
    else hits.set(key, { count: 1, strong: matcher.strong.has(key), variant: matcher.variants.has(key) })
  }

  const urls = classifyUrls(text, settings.safeUrlDomains, settings.suspiciousTlds)
  const suspiciousUrl = urls.some((u) => !u.benign)
  const suspiciousTld = urls.some((u) => u.suspiciousTld)

  // Score the hits the same way bayes.violationLogOdds does, but record each step.
  const keywordHits = hits.size
  let hardKeyword = false
  let keywordLogOdds = 0
  let variantHits = 0
  let shortScale = 1
  let lengthLogOdds = 0
  const detail: ViolationKeywordDetail[] = []
  const categoryEvidence: Record<string, number> = {}

  const scored = keywordHits >= settings.minKeywordHits || hasStructure
  if (scored) {
    const modHits: (ModerationHit & { key: string; canonical: string; variant: boolean })[] = []
    for (const [key, rec] of hits) {
      const canonical = matcher.canonical.get(key) ?? key
      const category = matcher.category.get(key) ?? DEFAULT_CATEGORY
      categoryEvidence[category] = (categoryEvidence[category] ?? 0) + 1
      modHits.push({
        key,
        canonical,
        // A variant is deliberate obfuscation: always a strong hit, and it
        // keeps the canonical keyword's LR override (e.g. 菠菜 keeps 博彩's).
        strong: rec.strong || rec.variant,
        variant: rec.variant,
        count: rec.count,
        lr: settings.keywordLrs.get(canonical),
      })
    }
    hardKeyword = modHits.some((h) => h.strong || h.lr !== undefined)
    variantHits = modHits.filter((h) => h.variant).length

    const lrOf = (h: (typeof modHits)[number]): number => {
      const base = h.lr ?? (h.strong ? settings.bayes.strongLr : settings.bayes.weakLr)
      return h.variant ? base * settings.bayes.variantLr : base
    }
    const ordered = [...modHits].sort((a, b) => lrOf(b) - lrOf(a))
    let genericSeen = 0
    for (const h of ordered) {
      const repetition = Math.pow(settings.bayes.repeatDiminish, Math.max(0, h.count - 1))
      let weight = repetition
      if (!h.strong) {
        genericSeen++
        weight *= Math.min(1, settings.bayes.weakDiminish / genericSeen)
      }
      const lr = lrOf(h)
      const contrib = Math.log(lr) * weight
      keywordLogOdds += contrib
      detail.push({
        matched: h.key,
        keyword: h.canonical,
        category: matcher.category.get(h.key) ?? DEFAULT_CATEGORY,
        count: h.count,
        strong: h.strong,
        variant: h.variant,
        lr,
        weight,
        logOdds: contrib,
      })
    }

    shortScale = violationShortScale(length, settings.bayes)
    lengthLogOdds = Math.min(
      settings.bayes.maxLengthLr,
      settings.bayes.lengthLr * Math.log(1 + length / settings.bayes.chatLength),
    )
  }

  const urlLogOdds =
    (suspiciousUrl ? Math.log(settings.bayes.suspiciousUrlLr) : 0) +
    (suspiciousTld ? Math.log(settings.bayes.suspiciousTldLr) : 0)
  const priorLogit = Math.log(settings.bayes.prior / (1 - settings.bayes.prior))

  // Conversational dampening on the soft keyword+contact evidence only: a
  // question, a reply, a collaboration request, or casual chit-chat is how the
  // group talks.
  const reply = context?.reply === true
  const dampeningFactor =
    (features.question ? settings.bayes.questionFactor : 1) *
    (features.collab ? settings.bayes.collabFactor : 1) *
    (features.chat ? settings.bayes.chatFactor : 1) *
    (reply ? settings.bayes.replyFactor : 1)

  const logOdds =
    priorLogit +
    (keywordLogOdds + contactLogOdds + pitchLogOdds) * dampeningFactor * shortScale +
    structureLogOdds +
    lengthLogOdds +
    urlLogOdds
  const probability = violationProbability(logOdds)

  // Outcome: an offer pattern — or a hard contact-pattern — flags regardless of
  // the score. The keyword path needs the violation features to co-occur (enough
  // hits or a structure) AND a hard signal (strong keyword, suspicious URL, or
  // any explicit promotion structure: promo code, paid service, price pitch,
  // enrollment funnel, call-to-action, or a pitch+contact cluster), and the
  // probability to clear the threshold.
  let trigger: ViolationAnalysis['trigger']
  if (patterns.length > 0 || contactHard) trigger = 'pattern'
  else if (
    (keywordHits >= settings.minKeywordHits || hasStructure) &&
    (hardKeyword || suspiciousUrl || features.code || features.service || features.price ||
      features.register || features.cta || features.pitch)
  )
    trigger = 'keywords'
  else trigger = 'none'
  const flagged = trigger === 'pattern' || (trigger === 'keywords' && probability >= settings.bayes.threshold)

  // Winning category: the one with the most distinct keyword hits; ties resolve
  // to the first category in config order (matcher.categories), 广告 last.
  let category = DEFAULT_CATEGORY
  let best = 0
  for (const cat of matcher.categories) {
    const n = categoryEvidence[cat] ?? 0
    if (n > best) {
      best = n
      category = cat
    }
  }

  return {
    text,
    length,
    trigger,
    patterns,
    contactPatterns: contactMatches,
    contactHard,
    features,
    keywordHits,
    variantHits,
    minKeywordHits: settings.minKeywordHits,
    hardKeyword,
    categoryEvidence,
    category,
    keywords: detail,
    urls,
    priorLogit,
    keywordLogOdds,
    contactLogOdds,
    pitchLogOdds,
    structureLogOdds,
    dampeningFactor,
    reply,
    shortScale,
    lengthLogOdds,
    urlLogOdds,
    logOdds,
    probability,
    threshold: settings.bayes.threshold,
    flagged,
  }
}