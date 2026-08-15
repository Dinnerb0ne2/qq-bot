/**
 * Ad keyword defaults + parser.
 *
 * The lists below are the *fallback* defaults: settings.ts loads the active
 * base lists from config/ad.json (the single source of truth) and uses these
 * only when the config file is missing or corrupt. rules.ts unions the active
 * base with the `[keywords]` section of the remote rules file. This module is
 * pure data + parsing — the active state and loading live in settings.ts /
 * rules.ts.
 */

/** Bundled fallback keywords, grouped by category. Used when config/ad.json
 *  is missing or has no keywords field. */
export const BUILTIN_VIOLATION_KEYWORDS: readonly string[] = [
  // Shopping / promotions
  '促销', '打折', '优惠', '特价', '折扣', '团购', '秒杀', '限时', '抢购', '特惠',
  '包邮', '免费送', '礼品', '限量', '降价', '甩卖', '一折', '二折', '半价',
  // Contact methods
  '微信', 'QQ', '加V', '私聊', '私发', '电话', '联系', '咨询', '热线', '客服',
  '扫码', '关注', '添加', '群号', '入群', '加我',
  // Education
  '考研', '考证', '培训', '辅导', '补习', '指导', '提分', '保过', '调剂', '考试',
  '备考', '押题', '真题', '模拟题', '特训', '保录', '神器', '包过',
  // Money / investment
  '赚钱', '投资', '理财', '收益', '回报', '股票', '基金', '保险', '贷款', '融资',
  '借钱', '零息', '放贷', '担保', '信用', '资金', '合伙', '项目',
  // Urgency
  '抓紧', '速来', '仅剩', '最后', '错过', '机不可失', '立即', '马上', '赶快',
  '趁早', '今日', '剩余', '名额有限', '先到先得',
  // Gaming / gambling
  '棋牌', '博彩', '赌博', '游戏', '充值', '代练', '刷单', '陪玩', '代打', '金币',
  // Health / beauty
  '减肥', '丰胸', '美容', '祛斑', '增高', '壮阳', '养生', '保健', '延时',
  // Jobs
  '招聘', '求职', '简历', '应聘', '兼职', '全职', '高薪', '待遇', '薪资', '日结',
  '日薪', '周薪', '月薪', '年薪', '提成', '佣金', '返利',
]

/**
 * High-signal keywords that are almost never used in benign conversation.
 *
 * These are the words that constitute the ad's *pitch* — what is being
 * promoted: promo/deal words (秒杀, 包邮, 免费送), money/loan hooks (贷款, 刷单),
 * education-scam promises (押题, 保过), urgency pushes (仅剩, 先到先得), job
 * hooks (日结, 高薪), gambling/gaming (棋牌, 博彩), health/scam (丰胸, 壮阳).
 *
 * Contact-method words (加V, 私聊, 扫码, 群号, 微信…) deliberately do NOT belong
 * here: "加我私聊" alone is a normal private-chat invitation, not an ad. They
 * live in the general keyword list and only *reinforce* a real promo signal.
 * The detector only flags a message when it contains at least one *strong*
 * keyword (the pitch) or a suspicious URL; generic words — contact or otherwise
 * — never decide on their own.
 *
 * This list is deliberately conservative: too generous and the false positives
 * come back. Prefer moving specific promo terms to the remote `[strong]`
 * section.
 */
export const BUILTIN_STRONG_VIOLATION_KEYWORDS: readonly string[] = [
  // Shopping / promotions (the hook)
  '秒杀', '代购', '包邮', '免费送', '返利', '半价', '一折', '二折', '甩卖', '特价', '抢购',
  // Money / loans
  '贷款', '放贷', '提现', '刷单',
  // Education scams
  '押题', '保过', '保录', '包过', '提分', '特训',
  // Jobs
  '日结', '高薪',
  // Gaming / gambling
  '棋牌', '博彩', '赌博', '代练', '陪玩', '代打',
  // Health / beauty (the surgical/anabolic ones)
  '丰胸', '祛斑', '壮阳', '增高', '延时',
]

/**
 * Variant words (变种词): deliberately-obfuscated spellings of ad keywords that
 * try to dodge the filter — 微信 → 薇信/威信, QQ → 扣扣/秋秋, 博彩 → 菠菜/bo彩,
 * 冰毒 → 兵毒/bingdu, 海洛因 → 白粉/四号… The map is `canonical keyword →
 * [variant forms]`. A matched variant counts as a hit of its canonical keyword
 * (so keywordLrs/strong classes carry over) and is scored as a strong hit,
 * multiplied by the `variantLr` weight (变种词权重) — obfuscation itself is ad
 * evidence.
 *
 * These are the *fallback* defaults: config/ad.json (settings.ts) is the single
 * source of truth and replaces them; rules.ts unions remote `[variants]` lines
 * on top.
 */
export const BUILTIN_VARIANT_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  // Contact-method obfuscations
  微信: ['薇信', '威信', '威心', '薇❤信', '微❤信', 'V信', 'vx'],
  QQ: ['扣扣', '秋秋', '球球', '企鹅号'],
  // Gambling (博彩/彩票/棋牌/六合彩/赌博/斗地主/龙虎)
  博彩: ['菠菜', '卜余', '波菜', 'bo彩'],
  彩票: ['财票'],
  棋牌: ['棋排', 'qp'],
  六合彩: ['六合', 'lh'],
  赌博: ['赌搏', '堵薄', '独播', 'du博', 'dubo', 'dǔbó'],
  斗地主: ['抖地主'],
  龙虎: ['笼虎'],
  // Drugs (冰毒/大麻/海洛因/K粉/麻古/摇头丸/可卡因)
  冰毒: ['兵毒', '冰度', 'bing毒', 'bingdu'],
  大麻: ['大嘛', 'dama', '大碼'],
  海洛因: ['白粉', '白面', '四号', '四仔', '老四'],
  K粉: ['k仔', 'k他命', '笳'],
  麻古: ['麻果', '麻谷', '小麻'],
  摇头丸: ['摇摇', 'mdma'],
  可卡因: ['可可精'],
}

/** Fallback category tag: keywords without an explicit category (including all
 *  remote/`[keywords]` additions) are tagged 广告. */
export const DEFAULT_CATEGORY = '广告'

/** Keyword lists grouped by violation category (赌博/毒品/诈骗兼职/色情/广告).
 *  `keywords`/`strong`/`variants` are keyed by category tag; the config's
 *  `categories` field (config/ad.json) is the single source of truth and these
 *  are rebuilt on every config refresh. */
export interface CategoryLists {
  readonly categories: readonly string[]
  readonly keywords: Readonly<Record<string, readonly string[]>>
  readonly strong: Readonly<Record<string, readonly string[]>>
  readonly variants: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>
}

export const EMPTY_CATEGORY_LISTS: CategoryLists = {
  categories: [],
  keywords: {},
  strong: {},
  variants: {},
}

/** Parse a raw `categories` object from config into per-category keyword lists.
 *  Each category object may hold `keywords`, `strongKeywords` and
 *  `variantKeywords` (same shapes as the top-level fields). Malformed entries
 *  are skipped; unknown/empty categories are dropped. */
export function compileCategoryLists(
  raw: unknown,
  defaultCategory: string = DEFAULT_CATEGORY,
): CategoryLists {
  const categories: string[] = []
  const keywords: Record<string, string[]> = {}
  const strong: Record<string, string[]> = {}
  const variants: Record<string, Record<string, readonly string[]>> = {}
  if (raw && typeof raw === 'object') {
    for (const [cat, obj] of Object.entries(raw as Record<string, unknown>)) {
      const c = cat.trim()
      if (!c) continue
      const kw = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {}
      const list = Array.isArray(kw.keywords) ? kw.keywords : []
      const strongList = Array.isArray(kw.strongKeywords) ? kw.strongKeywords : []
      const forms: Record<string, string[]> = {}
      if (kw.variantKeywords && typeof kw.variantKeywords === 'object') {
        for (const [canon, fs] of Object.entries(
          kw.variantKeywords as Record<string, unknown>,
        )) {
          const parsed = parseVariantForms(
            Array.isArray(fs) ? (fs as string[]) : [String(fs ?? '')],
          )
          if (parsed.length) forms[canon] = parsed
        }
      }
      // A category is kept when it carries keywords, strong keywords, or variant
      // forms (variants are still active detection terms — dropping them here
      // would silently lose coverage).
      if (!list.length && !strongList.length && Object.keys(forms).length === 0) continue
      categories.push(c)
      keywords[c] = parseKeywordList(list.join('\n'))
      strong[c] = parseKeywordList(strongList.join('\n'))
      if (Object.keys(forms).length) variants[c] = forms
    }
  }
  if (!categories.includes(defaultCategory)) categories.push(defaultCategory)
  return { categories, keywords, strong, variants }
}

/** Ignore keywords shorter/longer than these to avoid over-matching and junk. */
const MIN_KEYWORD_LENGTH = 2
const MAX_KEYWORD_LENGTH = 64
/** Hard cap on how many remote keywords we accept, as a sanity guard. */
const MAX_KEYWORDS = 100_000

/** Escape a keyword so it is treated as a literal inside a regex. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Short pure-ASCII tokens (QQ, BT, SM, 3P, …) get \b…\b so they don't false
 *  match inside unrelated words like `BTW` or `JS开发`. CJK and mixed keywords
 *  keep substring matching (there are no word boundaries in Chinese). */
const SHORT_ASCII = /^[a-zA-Z0-9]{1,3}$/

/** Compiled form of the active keyword lists, rebuilt only on refresh. */
export interface CompiledKeywords {
  /** Single case-insensitive alternation regex over all unique keywords.
   *  Alternatives are sorted longest-first so the most specific phrase wins at
   *  any position. Callers must clone it before using exec()/lastIndex. */
  readonly regex: RegExp
  /** Lowercase matched text → canonical keyword (for logs). A matched variant
   *  maps to the keyword it obfuscates (薇信 → 微信). */
  readonly canonical: ReadonlyMap<string, string>
  /** Lowercase high-signal keywords; a flag requires at least one of these. */
  readonly strong: ReadonlySet<string>
  /** Lowercase variant form → canonical keyword it obfuscates. A hit here is a
   *  deliberate variant (变种词) and scores as a strong hit × `variantLr`. */
  readonly variants: ReadonlyMap<string, string>
  /** Lowercase keyword → violation category tag (广告 by default). Keywords
   *  added by the remote rules file inherit the fallback tag. */
  readonly category: ReadonlyMap<string, string>
  /** Ordered category tags present in this matcher, config order first. */
  readonly categories: readonly string[]
  /** Total unique keywords compiled. */
  readonly size: number
}

/**
 * Merge the general, strong and variant keyword lists into one matcher:
 * deduped, longest-first alternation with case-insensitive matching and word
 * boundaries around short ASCII tokens. Variant forms map to the canonical
 * keyword they obfuscate via `variants` / `canonical`. `categories` (lowercase
 * keyword → category tag) labels each compiled keyword; uncategorized keywords
 * fall back to `DEFAULT_CATEGORY` (广告).
 */
export function compileKeywords(
  general: readonly string[],
  strong: readonly string[],
  variants?: Readonly<Record<string, readonly string[]>>,
  categories?: ReadonlyMap<string, string>,
): CompiledKeywords {
  const strongKeys = new Set(strong.map((k) => k.toLowerCase()))
  const variantsMap = new Map<string, string>()
  const canonical = new Map<string, string>()
  const all = new Set<string>()
  for (const kw of strong) all.add(kw)
  for (const kw of general) all.add(kw)
  if (variants) {
    for (const [canon, forms] of Object.entries(variants)) {
      for (const form of forms) {
        const f = form.trim()
        if (f.length < MIN_KEYWORD_LENGTH || f.length > MAX_KEYWORD_LENGTH) continue
        all.add(f)
        variantsMap.set(f.toLowerCase(), canon)
      }
    }
  }

  const parts: string[] = []
  const category = new Map<string, string>()
  for (const kw of [...all].sort((a, b) => b.length - a.length)) {
    const key = kw.toLowerCase()
    if (canonical.has(key)) continue
    canonical.set(key, variantsMap.get(key) ?? kw)
    category.set(key, categories?.get(key) ?? DEFAULT_CATEGORY)
    const escaped = escapeRegExp(kw)
    parts.push(SHORT_ASCII.test(kw) ? `\\b${escaped}\\b` : escaped)
  }

  // Category tie-break order: config order first (the `categories` map is
  // inserted in config order, 广告 last), then any category that only appeared
  // via a keyword, then the 广告 fallback last of all.
  const categoryTags = [...new Set(categories?.values() ?? [])]
  for (const c of category.values()) {
    if (!categoryTags.includes(c)) categoryTags.push(c)
  }
  if (!categoryTags.includes(DEFAULT_CATEGORY)) categoryTags.push(DEFAULT_CATEGORY)

  return {
    regex: new RegExp(parts.join('|'), 'gi'),
    canonical,
    strong: strongKeys,
    variants: variantsMap,
    category,
    categories: categoryTags,
    size: canonical.size,
  }
}

/**
 * Parse keyword lines: one term per line, `#` starts a comment, blank lines and
 * out-of-range terms are dropped.
 */
export function parseKeywordList(raw: string): string[] {
  const out: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const word = line.trim()
    if (!word || word.startsWith('#')) continue
    if (word.length < MIN_KEYWORD_LENGTH || word.length > MAX_KEYWORD_LENGTH) continue
    out.push(word)
    if (out.length >= MAX_KEYWORDS) break
  }
  return out
}

/**
 * Validate variant forms: trimmed, deduped, in-range (they need at least 2
 * chars — single-char variants like 冰 would over-match everyday words).
 */
export function parseVariantForms(forms: readonly string[]): string[] {
  const out: string[] = []
  for (const form of forms) {
    const f = form.trim()
    if (f.length < MIN_KEYWORD_LENGTH || f.length > MAX_KEYWORD_LENGTH) continue
    out.push(f)
    if (out.length >= MAX_KEYWORDS) break
  }
  return [...new Set(out)]
}
