/**
 * Naive-Bayes violation scoring.
 *
 * Every keyword hit is evidence for the message violating the group's rules
 * (an ad, a gambling/drug pitch, a scam job — see the `categories` config),
 * combined with a prior base rate. Each keyword has a likelihood ratio
 *   LR = P(hit | violation) / P(hit | clean)
 * — strong (high-signal) keywords are almost never present in innocent chat and
 * get a high LR; generic keywords get a low one. Under the naive-Bayes
 * independence assumption the posterior log-odds are
 *   logit(P(violation | text)) = log(P(violation)/(1-P(violation))) + Σ log(LR_k)
 * and a message is flagged when the resulting probability clears a threshold.
 *
 * The model is calibrated around the group's actual chat habits and keeps
 * legitimate chatter (product recommendations, casual talk) off the recall
 * path:
 *
 * 1. Per-keyword intensity (违禁强度). Every keyword's LR comes from its class
 *    (strongLr / weakLr) unless config/ad.json gives it a dedicated override
 *    (`keywordLrs`), so operators can mark e.g. `代开发票` as far stronger than
 *    a generic `促销`. A deliberate *variant* word (薇信 for 微信, 扣扣 for QQ,
 *    菠菜 for 博彩 — the `variantKeywords` map) is obfuscation, itself a strong
 *    ad signal: it always scores as a strong hit and is multiplied by
 *    `variantLr` (the 变种词权重) on top of its canonical keyword's LR.
 * 2. Diminishing returns on generic hits. Distinct generic words are highly
 *    correlated (they all sit in the same ad templates), so the independence
 *    assumption over-counts them — the classic `客服 咨询 QQ 关注 考试…` false
 *    positive. The n-th distinct generic hit therefore counts for only
 *    `weakDiminish/n` of its weight, so a pile of generic words saturates
 *    instead of adding up to a flag.
 * 3. Repetition is *discounted*, not boosted. Group chat is conversational:
 *    a member who repeats one sensitive word several times is almost always
 *    trying to get attention (or pasted it by accident) — a real ad wouldn't
 *    be that low-effort. So a keyword occurring `count` times weighs only
 *    `repeatDiminish^(count-1)` of a single occurrence: `加V 加V 加V 咨询` is
 *    treated as weaker evidence than a one-off `加V` + `咨询` ad.
 * 4. Chat-length-aware evidence, continuous and capped. No single metric ever
 *    decides a flag on its own: a message is an ad only when several ad
 *    features co-occur (see detector.ts). Length is just a mild tip — normal
 *    chat messages are short, so suspicion grows smoothly from the shortest
 *    messages onward by `lengthLr·ln(1 + len/chatLength)` (with `chatLength`
 *    the reference length of everyday chat, not a cliff), but the term is
 *    capped at `maxLengthLr` so no amount of length can flag by itself. A long
 *    message with one stray keyword — a member writing a long post — stays
 *    under the threshold. The short-message dampening of keyword evidence
 *    (ramping from `shortKeywordFactor` up to `chatLength` via
 *    `shortRampPower`, superlinear) mirrors this: very short messages are
 *    nearly powerless, because an ad is a structured pitch — hook + contact +
 *    call-to-action — that cannot fit in four characters.
 * 5. Suspicious URLs are ad evidence. Ads almost always carry a link to a
 *    domain that is neither an official site nor a major platform; a URL on
 *    the `safeUrlDomains` whitelist (jd.com, bilibili.com, …) is normal
 *    sharing and adds nothing. A non-whitelisted URL contributes
 *    `ln(suspiciousUrlLr)` to the log-odds — and if it also sits on a
 *    spam-prone TLD (`.top`, `.xyz`, `.icu`, …; `suspiciousTlds`) it adds
 *    another `ln(suspiciousTldLr)`, a small extra doubt. A URL is never a
 *    standalone hard signal (no single variable decides): it only tips
 *    messages that already carry a strong keyword or a structural offer — a
 *    lone recommendation link, or a few weak words plus a link, never flags.
 * 6. Offer patterns (see patterns.ts) are strong structural evidence but, like
 *    URLs, never decide on their own — a single match needs to co-occur with
 *    other evidence and clear the threshold. A lone contact pattern is only
 *    soft evidence; only 2+ co-occurring contact hooks hard-flag directly.
 *
 * All knobs are overridable via config/ad.json at runtime (see settings.ts).
 */
export interface ModerationBayesParams {
  /** Prior probability that an arbitrary group message is an ad (0..1). */
  prior: number
  /** Posterior probability at/above which a message is flagged (0..1). */
  threshold: number
  /** Likelihood ratio for a strong (high-signal) keyword hit. */
  strongLr: number
  /** Likelihood ratio for a weak (generic) keyword hit. */
  weakLr: number
  /** Variant-word weight (变种词权重): a deliberate spelling variant (薇信 for
   *  微信, 扣扣 for QQ, 菠菜 for 博彩) scores as a strong hit with its canonical
   *  keyword's LR multiplied by this factor — obfuscation is itself evidence. */
  variantLr: number
  /** Length-evidence growth coefficient per ln(1 + len/chatLength). */
  lengthLr: number
  /** Reference length of everyday chat (chars) in the group. The length
   *  evidence grows continuously from the shortest messages onward, reaching
   *  `lengthLr·ln2` at this length; the short-message dampening of keyword
   *  evidence also ends here. Set it to the operator's read of the group's
   *  chat habit — modern chat messages are short. */
  chatLength: number
  /** Cap on the length-evidence term (log-odds). Kept modest so length alone
   *  can never push a message over the threshold. */
  maxLengthLr: number
  /** Keyword-evidence multiplier at length 0, ramping to 1 at chatLength. The
   *  ramp is superlinear (see `shortRampPower`), so very short messages are
   *  strongly suppressed: "加我私聊" is a private-chat invitation, not an ad —
   *  a real ad needs enough text to carry hook + contact + call-to-action. */
  shortKeywordFactor: number
  /** Exponent of the short-message dampening ramp: 1 = linear, 2 = quadratic,
   *  … — higher values suppress short messages harder. The scale always
   *  reaches 1 at `chatLength`; only shorter messages are shaped. */
  shortRampPower: number
  /** Repetition discount: a keyword occurring count times weighs
   *  repeatDiminish^(count-1) of a single occurrence (0..1]. */
  repeatDiminish: number
  /** Diminishing-return constant on the n-th distinct generic keyword:
   *  the n-th generic hit weighs min(1, weakDiminish/n) of its evidence. */
  weakDiminish: number
  /** Likelihood ratio of a URL whose domain is not on the safe-whitelist
   *  (see urls.ts). Only meaningful together with keyword evidence. */
  suspiciousUrlLr: number
  /** Extra likelihood ratio when such a URL also sits on a spam-prone TLD
   *  (see `suspiciousTlds` in settings.ts) — a small additional doubt. */
  suspiciousTldLr: number
  /** Soft evidence from a contact pattern (微信/加V/QQ…) matched in a message.
   *  A lone contact pattern is never a hard flag on its own (no single variable
   *  decides); 2+ co-occurring contact patterns are a multi-variable signal and
   *  hard-flag via the pattern path instead (see detector.ts). */
  contactLr: number
  /** Likelihood ratio of a matched *offer* pattern (config `patterns` — a
   *  discount/group-buy/cloud-price pitch). Offer patterns are strong structural
   *  evidence, but a single one never decides on its own: it must co-occur with
   *  other evidence and clear the threshold. */
  patternLr: number
  /** Likelihood ratio of a concrete promo/coupon/invite code (优惠码 AIPRO100).
   *  The hardest structural ad signal — an explicit offer, often the only
   *  proof needed. */
  codeLr: number
  /** Likelihood ratio of an explicit price-promo structure (立减500 / 满100减50
   *  / 打7折 / 原价2999). */
  priceLr: number
  /** Likelihood ratio of an enrollment funnel (报名链接 / 开课 / 训练营). */
  registerLr: number
  /** Likelihood ratio of a paid-service pitch (出租 / 代充 / 按小时计费 + 联系客服). */
  serviceLr: number
  /** Likelihood ratio of a call-to-action phrase (想上车 / 有需要联系 / 欢迎扩散). */
  ctaLr: number
  /** Likelihood ratio of a pitch+contact structure (团购/优惠券/兼职/出售 …
   *  adjacent to 联系/加我/私聊). The demoted promo/urgency words are weak on
   *  their own; paired with a hook they become the ad's call to action, and the
   *  structure earns as much as a strong keyword. */
  pitchLr: number
  /** Conversational dampening (0..1] applied to the soft keyword + contact
   *  evidence when the message reads as a question ("有没有…？"). A question is
   *  how a member actually asks the group, not how spam is written. */
  questionFactor: number
  /** Conversational dampening (0..1] applied to the soft keyword + contact
   *  evidence when the message is a reply/quote of an earlier message in the
   *  group — replying usually means continuing a discussion, not pitching. */
  replyFactor: number
  /** Conversational dampening (0..1] applied to the soft keyword + contact
   *  evidence when the message asks for help / partnership (找合伙人, 组队,
   *  内推, 求推荐…) — collaboration is how a tech group actually talks. */
  collabFactor: number
  /** Conversational dampening (0..1] applied to the soft keyword + contact
   *  evidence when the message reads as casual chit-chat (哈哈, 学到了, 顶一个,
   *  mark …) — banter never contains a real pitch, only its vocabulary does. */
  chatFactor: number
}

export const DEFAULT_MODERATION_BAYES: ModerationBayesParams = {
  prior: 0.02,
  threshold: 0.6,
  strongLr: 40,
  weakLr: 2.5,
  variantLr: 2,
  lengthLr: 0.35,
  chatLength: 10,
  maxLengthLr: 0.5,
  shortKeywordFactor: 0.3,
  shortRampPower: 2,
  repeatDiminish: 0.7,
  weakDiminish: 1.5,
  suspiciousUrlLr: 8,
  suspiciousTldLr: 2,
  contactLr: 4,
  patternLr: 8,
  codeLr: 30,
  priceLr: 10,
  registerLr: 6,
  serviceLr: 8,
  ctaLr: 5,
  pitchLr: 40,
  questionFactor: 0.55,
  replyFactor: 0.6,
  collabFactor: 0.7,
  chatFactor: 0.75,
}

/** One distinct keyword's evidence contribution. */
export interface ModerationHit {
  /** True when the keyword is in the high-signal (strong) list. */
  strong: boolean
  /** Number of occurrences in the message (repetition is discounted). */
  count: number
  /** Per-keyword likelihood-ratio override from config/ad.json, if any. */
  lr?: number
  /** True when the matched text is a deliberate variant (薇信→微信, 扣扣→QQ).
   *  A variant always scores as a strong hit, multiplied by `variantLr`. */
  variant?: boolean
}

/**
 * Keyword-evidence multiplier for a message of `length` chars: 1 at
 * `chatLength` and above, and a superlinear ramp down to `shortKeywordFactor`
 * at length 0. Very short messages therefore keep almost none of their
 * keyword evidence — a 4-char "加我私聊" is a private-chat invitation, not a
 * structured violation. Shared by violationLogOdds() and the analysis/test tool.
 */
export function violationShortScale(length: number, params: ModerationBayesParams): number {
  if (length >= params.chatLength) return 1
  const t = length / params.chatLength
  return params.shortKeywordFactor + (1 - params.shortKeywordFactor) * Math.pow(t, params.shortRampPower)
}

/**
 * Log-odds of a message being a violation given the keyword hits and length.
 *
 * Hits are ranked by evidence so the diminishing-return penalty lands on the
 * weakest generic terms first.
 *
 * @param hits one entry per distinct keyword hit (with occurrence count and
 *   optional per-keyword LR override)
 * @param length message length in chars; shapes the length evidence and the
 *   short-message dampening. When omitted the message is treated as
 *   neutral-length (no dampening, no length boost).
 * @param suspiciousUrl true when the message contains a URL whose domain is
 *   not on the safe whitelist (see urls.ts). Contributes
 *   `ln(suspiciousUrlLr)` to the log-odds.
 * @param suspiciousTld true when such a URL also uses a spam-prone TLD
 *   (.top/.xyz/.icu/…). Contributes `ln(suspiciousTldLr)`.
 * @returns the posterior log-odds log(P(violation)/P(clean))
 */
export function violationLogOdds(
  hits: readonly ModerationHit[],
  params: ModerationBayesParams,
  length?: number,
  suspiciousUrl = false,
  suspiciousTld = false,
): number {
  const priorLogit = Math.log(params.prior / (1 - params.prior))
  const known = length !== undefined

  const lrOf = (h: ModerationHit): number => {
    const base = h.lr ?? (h.strong ? params.strongLr : params.weakLr)
    // A deliberate variant is obfuscation — weigh it like a strong hit and
    // multiply by the variant-word weight (变种词权重).
    return h.variant ? base * params.variantLr : base
  }
  const ordered = [...hits].sort((a, b) => lrOf(b) - lrOf(a))

  let evidence = 0
  let genericSeen = 0
  for (const h of ordered) {
    // Repeated single keyword -> attention-seeking, not a violation: geometric decay.
    const repetition = Math.pow(params.repeatDiminish, Math.max(0, h.count - 1))
    let weight = repetition
    if (!h.strong) {
      // The n-th distinct generic keyword: diminishing returns.
      genericSeen++
      weight *= Math.min(1, params.weakDiminish / genericSeen)
    }
    evidence += Math.log(lrOf(h)) * weight
  }

  if (known) {
    evidence *= violationShortScale(length, params)
    evidence += Math.min(params.maxLengthLr, params.lengthLr * Math.log(1 + length / params.chatLength))
  }

  if (suspiciousUrl) evidence += Math.log(params.suspiciousUrlLr)
  if (suspiciousTld) evidence += Math.log(params.suspiciousTldLr)

  return priorLogit + evidence
}

/** Posterior probability P(violation | text) from the log-odds. */
export function violationProbability(logOdds: number): number {
  return 1 / (1 + Math.exp(-logOdds))
}