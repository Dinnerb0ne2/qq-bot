/**
 * Violation config: loads the forbidden-word lists (违禁词 / 违禁强度) and the
 * statistical probability params from one JSON config file (config/ad.json by
 * default), so they can be tuned without touching source code.
 *
 * The config file is the single source of truth for the base keyword, strong
 * keyword and pattern lists plus the naive-Bayes parameters. A missing or
 * corrupt file (or a field that fails validation) falls back to the bundled
 * defaults in keywords.ts / patterns.ts / bayes.ts. The remote rules file
 * (rules.ts) still unions its `[keywords]` / `[strong]` / `[patterns]`
 * sections on top as an optional live-update layer.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_MODERATION_BAYES, type ModerationBayesParams } from './bayes'
import {
  BUILTIN_VIOLATION_KEYWORDS,
  BUILTIN_STRONG_VIOLATION_KEYWORDS,
  parseKeywordList,
  parseVariantForms,
  BUILTIN_VARIANT_KEYWORDS,
  compileCategoryLists,
  DEFAULT_CATEGORY,
  EMPTY_CATEGORY_LISTS,
  type CategoryLists,
} from './keywords'
import { BUILTIN_VIOLATION_PATTERNS, BUILTIN_CONTACT_VIOLATION_PATTERNS, parsePatternList } from './patterns'
import { DEFAULT_SAFE_URL_DOMAINS, DEFAULT_SUSPICIOUS_TLDS } from './urls'

/** Combined tunable settings the detector/moderator read on every message. */
export interface ModerationSettings {
  /** Minimum distinct keyword hits to even consider the keyword path. */
  minKeywordHits: number
  /** Naive-Bayes prior/threshold/likelihood-ratio parameters. */
  bayes: ModerationBayesParams
  /** Per-keyword likelihood-ratio overrides (违禁强度), by canonical keyword. */
  keywordLrs: ReadonlyMap<string, number>
  /** Domains (registrable, e.g. `jd.com`) treated as benign sharing; URLs on
   *  these never count as violation evidence. */
  safeUrlDomains: readonly string[]
  /** Spam-prone TLDs (`.top`, `.xyz`, …); a non-whitelisted URL on one of
   *  these adds a little extra evidence. */
  suspiciousTlds: readonly string[]
}

/** Fully resolved config: the keyword lists plus the probability settings. */
export interface LoadedModerationConfig {
  keywords: string[]
  strongKeywords: string[]
  /** Deliberate variant words (变种词): canonical keyword → [variant forms]. */
  variantKeywords: Record<string, string[]>
  /** Keyword lists grouped by violation category (赌博/毒品/诈骗兼职/色情/广告). */
  categories: CategoryLists
  /** Lowercase keyword → violation category tag (广告 fallback for the rest). */
  categoryMap: ReadonlyMap<string, string>
  patterns: RegExp[]
  contactPatterns: RegExp[]
  settings: ModerationSettings
  /** `file` when config/ad.json was read, `defaults` when it fell back. */
  source: 'file' | 'defaults'
  /** Human-readable notes about dropped/invalid entries. */
  notes: string[]
}

/** Path of the violation config file (config/ad.json); override with AD_CONFIG_PATH. */
export const moderationConfigPath = (): string =>
  process.env.AD_CONFIG_PATH ?? path.resolve(process.cwd(), 'config', 'ad.json')

/** Empty category map used when no explicit category is present. */
const EMPTY_CATEGORY_MAP: ReadonlyMap<string, string> = new Map()

/** Accepted ranges for the probability params; out-of-range values are dropped. */
const PRIOR_RANGE: readonly [number, number] = [0.0001, 0.5]
const THRESHOLD_RANGE: readonly [number, number] = [0.5, 1]
const LR_MIN = 1
const MIN_HITS_MIN = 1
/** Non-negative coefficient fields (length growth, repetition boost, caps). */
const COEFF_MIN = 0

function inRange(v: number, [min, max]: readonly [number, number]): boolean {
  return Number.isFinite(v) && v >= min && v <= max
}

/**
 * Parse a JSON config body into resolved lists + settings. Invalid JSON or
 * invalid fields fall back to the bundled defaults; notes describe what was
 * dropped so an operator can fix the file.
 */
export function parseModerationConfig(body: string): LoadedModerationConfig {
  const notes: string[] = []
  const keywords: string[] = [...BUILTIN_VIOLATION_KEYWORDS]
  const strongKeywords: string[] = [...BUILTIN_STRONG_VIOLATION_KEYWORDS]
  const variantKeywords: Record<string, string[]> = {}
  for (const [canon, forms] of Object.entries(BUILTIN_VARIANT_KEYWORDS)) {
    variantKeywords[canon] = [...forms]
  }
  const patterns: RegExp[] = [...BUILTIN_VIOLATION_PATTERNS]
  const contactPatterns: RegExp[] = [...BUILTIN_CONTACT_VIOLATION_PATTERNS]
  const settings: ModerationSettings = {
    minKeywordHits: 2,
    bayes: { ...DEFAULT_MODERATION_BAYES },
    keywordLrs: new Map(),
    safeUrlDomains: [...DEFAULT_SAFE_URL_DOMAINS],
    suspiciousTlds: [...DEFAULT_SUSPICIOUS_TLDS],
  }
  const keywordLrs = new Map<string, number>()

  let data: unknown
  try {
    data = JSON.parse(body)
  } catch (err) {
    notes.push(`invalid JSON (${err instanceof Error ? err.message : String(err)}); using defaults`)
    return {
      keywords, strongKeywords, variantKeywords, categories: EMPTY_CATEGORY_LISTS, categoryMap: EMPTY_CATEGORY_MAP,
      patterns, contactPatterns, settings,
      source: 'defaults', notes,
    }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    notes.push('config root must be a JSON object; using defaults')
    return {
      keywords, strongKeywords, variantKeywords, categories: EMPTY_CATEGORY_LISTS, categoryMap: EMPTY_CATEGORY_MAP,
      patterns, contactPatterns, settings,
      source: 'defaults', notes,
    }
  }
  const obj = data as Record<string, unknown>

  // Keyword lists: a present array replaces the bundled baseline.
  const rawKeywords = obj.keywords
  if (rawKeywords !== undefined) {
    if (Array.isArray(rawKeywords) && rawKeywords.every((v) => typeof v === 'string')) {
      const parsed = parseKeywordList(rawKeywords.join('\n'))
      if (parsed.length === 0) notes.push('keywords: no valid terms (need 2..64 chars); using defaults')
      else {
        keywords.length = 0
        keywords.push(...parsed)
      }
    } else notes.push('keywords: must be an array of strings; using defaults')
  }

  const rawStrong = obj.strongKeywords
  if (rawStrong !== undefined) {
    if (Array.isArray(rawStrong) && rawStrong.every((v) => typeof v === 'string')) {
      const parsed = parseKeywordList(rawStrong.join('\n'))
      if (parsed.length === 0) notes.push('strongKeywords: no valid terms (need 2..64 chars); using defaults')
      else {
        strongKeywords.length = 0
        strongKeywords.push(...parsed)
      }
    } else notes.push('strongKeywords: must be an array of strings; using defaults')
  }

  // Variant words (变种词): { canonical keyword: [obfuscated forms] }. A present
  // object replaces the bundled baseline; invalid entries are dropped with notes.
  const rawVariants = obj.variantKeywords
  if (rawVariants !== undefined) {
    if (typeof rawVariants === 'object' && rawVariants !== null && !Array.isArray(rawVariants)) {
      const parsed: Record<string, string[]> = {}
      let kept = 0
      for (const [canon, forms] of Object.entries(rawVariants as Record<string, unknown>)) {
        if (!Array.isArray(forms)) {
          notes.push(`variantKeywords[${canon}]: must be an array of strings; dropped`)
          continue
        }
        const valid = parseVariantForms(forms.filter((v): v is string => typeof v === 'string'))
        if (valid.length === 0) notes.push(`variantKeywords[${canon}]: no valid forms (need 2..64 chars); dropped`)
        else {
          parsed[canon] = valid
          kept++
        }
      }
      if (kept === 0) notes.push('variantKeywords: no valid entries; keeping defaults')
      else {
        for (const key of Object.keys(variantKeywords)) delete variantKeywords[key]
        Object.assign(variantKeywords, parsed)
      }
    } else notes.push('variantKeywords: must be an object { canonical: [variants] }; keeping defaults')
  }

  // Violation categories (违禁类别): { 赌博: { keywords, strongKeywords,
  // variantKeywords }, … }. A present object replaces the "everything is 广告"
  // baseline; keywords are tagged and the detector reports the winning tag.
  const rawCategories = obj.categories
  const categories = compileCategoryLists(rawCategories)
  if (rawCategories !== undefined) {
    if (typeof rawCategories !== 'object' || rawCategories === null || Array.isArray(rawCategories)) {
      notes.push('categories: must be an object { 类别: { keywords, strongKeywords, variantKeywords } }; ignoring')
    }
  }
  const categoryMap = new Map<string, string>()
  for (const cat of categories.categories) {
    for (const kw of categories.keywords[cat] ?? []) categoryMap.set(kw.toLowerCase(), cat)
    for (const kw of categories.strong[cat] ?? []) categoryMap.set(kw.toLowerCase(), cat)
    for (const forms of Object.values(categories.variants[cat] ?? {})) {
      for (const form of forms) categoryMap.set(form.toLowerCase(), cat)
    }
  }
  const canonicalCategory = (kw: string): string => categoryMap.get(kw.toLowerCase()) ?? DEFAULT_CATEGORY
  for (const kw of keywords) categoryMap.set(kw.toLowerCase(), canonicalCategory(kw))
  for (const kw of strongKeywords) categoryMap.set(kw.toLowerCase(), canonicalCategory(kw))
  for (const forms of Object.values(variantKeywords)) {
    for (const form of forms) categoryMap.set(form.toLowerCase(), canonicalCategory(form))
  }

  // Union the category lists into the active keyword pool (the matcher compiles
  // `keywords` + `strongKeywords` + `variantKeywords`; categories are tags on
  // top of that pool). Category tags come from `categoryMap`.
  const pool = [...keywords]
  const strongPool = [...strongKeywords]
  for (const cat of categories.categories) {
    pool.push(...(categories.keywords[cat] ?? []))
    strongPool.push(...(categories.strong[cat] ?? []))
    for (const [canon, forms] of Object.entries(categories.variants[cat] ?? {})) {
      variantKeywords[canon] = [...new Set([...(variantKeywords[canon] ?? []), ...forms])]
    }
  }
  keywords.length = 0
  keywords.push(...new Set(pool))
  strongKeywords.length = 0
  strongKeywords.push(...new Set(strongPool))

  const rawPatterns = obj.patterns
  if (rawPatterns !== undefined) {
    if (Array.isArray(rawPatterns) && rawPatterns.every((v) => typeof v === 'string')) {
      const parsed = parsePatternList(rawPatterns.join('\n'))
      patterns.length = 0
      patterns.push(...parsed.items)
      for (const s of parsed.skipped) notes.push(`pattern skipped: ${s}`)
    } else notes.push('patterns: must be an array of strings; using defaults')
  }

  const rawContactPatterns = obj.contactPatterns
  if (rawContactPatterns !== undefined) {
    if (Array.isArray(rawContactPatterns) && rawContactPatterns.every((v) => typeof v === 'string')) {
      const parsed = parsePatternList(rawContactPatterns.join('\n'))
      contactPatterns.length = 0
      contactPatterns.push(...parsed.items)
      for (const s of parsed.skipped) notes.push(`contactPattern skipped: ${s}`)
    } else notes.push('contactPatterns: must be an array of strings; using defaults')
  }

  // Probability params: each is independently validated, dropping bad values.
  const num = (name: string): number | undefined => {
    const v = obj[name]
    if (v === undefined) return undefined
    if (typeof v === 'number' && Number.isFinite(v)) return v
    notes.push(`${name}: not a finite number; keeping default`)
    return undefined
  }

  const prior = num('prior')
  if (prior !== undefined && !inRange(prior, PRIOR_RANGE)) notes.push(`prior: ${prior} out of range ${PRIOR_RANGE.join('..')}; keeping default`)
  else if (prior !== undefined) settings.bayes.prior = prior

  const threshold = num('threshold')
  if (threshold !== undefined && !inRange(threshold, THRESHOLD_RANGE))
    notes.push(`threshold: ${threshold} out of range ${THRESHOLD_RANGE.join('..')}; keeping default`)
  else if (threshold !== undefined) settings.bayes.threshold = threshold

  const strongLr = num('strongLr')
  if (strongLr !== undefined && strongLr < LR_MIN) notes.push(`strongLr: ${strongLr} < ${LR_MIN}; keeping default`)
  else if (strongLr !== undefined) settings.bayes.strongLr = strongLr

  const weakLr = num('weakLr')
  if (weakLr !== undefined && weakLr < LR_MIN) notes.push(`weakLr: ${weakLr} < ${LR_MIN}; keeping default`)
  else if (weakLr !== undefined) settings.bayes.weakLr = weakLr

  const variantLr = num('variantLr')
  if (variantLr !== undefined && variantLr < LR_MIN) notes.push(`variantLr: ${variantLr} < ${LR_MIN}; keeping default`)
  else if (variantLr !== undefined) settings.bayes.variantLr = variantLr

  // Per-keyword intensity (违禁强度): keyword -> likelihood-ratio override.
  const rawLrs = obj.keywordLrs
  if (rawLrs !== undefined) {
    if (typeof rawLrs === 'object' && rawLrs !== null && !Array.isArray(rawLrs)) {
      let kept = 0
      for (const [word, lr] of Object.entries(rawLrs as Record<string, unknown>)) {
        if (typeof lr === 'number' && Number.isFinite(lr) && lr >= LR_MIN) {
          keywordLrs.set(word, lr)
          kept++
        } else notes.push(`keywordLrs[${word}]: must be a number >= ${LR_MIN}; dropped`)
      }
      if (kept === 0) notes.push('keywordLrs: no valid entries; ignoring')
    } else notes.push('keywordLrs: must be an object { keyword: LR }; ignoring')
  }

  const lengthLr = num('lengthLr')
  if (lengthLr !== undefined && lengthLr < COEFF_MIN) notes.push(`lengthLr: ${lengthLr} < ${COEFF_MIN}; keeping default`)
  else if (lengthLr !== undefined) settings.bayes.lengthLr = lengthLr

  const chatLength = num('chatLength')
  if (chatLength !== undefined && (!Number.isInteger(chatLength) || chatLength < 1))
    notes.push(`chatLength: ${chatLength} must be an integer >= 1; keeping default`)
  else if (chatLength !== undefined) settings.bayes.chatLength = chatLength

  const maxLengthLr = num('maxLengthLr')
  if (maxLengthLr !== undefined && maxLengthLr < COEFF_MIN)
    notes.push(`maxLengthLr: ${maxLengthLr} < ${COEFF_MIN}; keeping default`)
  else if (maxLengthLr !== undefined) settings.bayes.maxLengthLr = maxLengthLr

  const shortFactor = num('shortKeywordFactor')
  if (shortFactor !== undefined && (shortFactor <= 0 || shortFactor > 1))
    notes.push(`shortKeywordFactor: ${shortFactor} must be in (0..1]; keeping default`)
  else if (shortFactor !== undefined) settings.bayes.shortKeywordFactor = shortFactor

  const shortPower = num('shortRampPower')
  if (shortPower !== undefined && shortPower <= 0)
    notes.push(`shortRampPower: ${shortPower} must be > 0; keeping default`)
  else if (shortPower !== undefined) settings.bayes.shortRampPower = shortPower

  const repeatDiminish = num('repeatDiminish')
  if (repeatDiminish !== undefined && (repeatDiminish <= 0 || repeatDiminish > 1))
    notes.push(`repeatDiminish: ${repeatDiminish} must be in (0..1]; keeping default`)
  else if (repeatDiminish !== undefined) settings.bayes.repeatDiminish = repeatDiminish

  const weakDiminish = num('weakDiminish')
  if (weakDiminish !== undefined && weakDiminish <= 0)
    notes.push(`weakDiminish: ${weakDiminish} must be > 0; keeping default`)
  else if (weakDiminish !== undefined) settings.bayes.weakDiminish = weakDiminish

  const urlLr = num('suspiciousUrlLr')
  if (urlLr !== undefined && urlLr < LR_MIN)
    notes.push(`suspiciousUrlLr: ${urlLr} < ${LR_MIN}; keeping default`)
  else if (urlLr !== undefined) settings.bayes.suspiciousUrlLr = urlLr

  const tldLr = num('suspiciousTldLr')
  if (tldLr !== undefined && tldLr < LR_MIN)
    notes.push(`suspiciousTldLr: ${tldLr} < ${LR_MIN}; keeping default`)
  else if (tldLr !== undefined) settings.bayes.suspiciousTldLr = tldLr

  // Structural-feature likelihood ratios (>= LR_MIN) and conversational
  // dampening factors (0..1). All optional; bad values keep the defaults.
  const lrParam = (name: keyof ModerationBayesParams): void => {
    const v = num(String(name))
    if (v !== undefined && v < LR_MIN) notes.push(`${String(name)}: ${v} < ${LR_MIN}; keeping default`)
    else if (v !== undefined) settings.bayes[name] = v as never
  }
  lrParam('contactLr')
  lrParam('codeLr')
  lrParam('priceLr')
  lrParam('registerLr')
  lrParam('serviceLr')
  lrParam('ctaLr')
  lrParam('pitchLr')

  const factorParam = (
    name: 'questionFactor' | 'replyFactor' | 'collabFactor' | 'chatFactor',
  ): void => {
    const v = num(name)
    if (v !== undefined && (v <= 0 || v > 1)) notes.push(`${name}: ${v} must be in (0..1]; keeping default`)
    else if (v !== undefined) settings.bayes[name] = v
  }
  factorParam('questionFactor')
  factorParam('replyFactor')
  factorParam('collabFactor')
  factorParam('chatFactor')

  // Safe-URL whitelist: a present array replaces the bundled platform list.
  const rawSafe = obj.safeUrlDomains
  if (rawSafe !== undefined) {
    if (Array.isArray(rawSafe) && rawSafe.every((v) => typeof v === 'string' && v.trim().length > 0)) {
      settings.safeUrlDomains = [...new Set(rawSafe.map((v) => v.trim().toLowerCase()))]
    } else notes.push('safeUrlDomains: must be an array of non-empty strings; using defaults')
  }

  // Suspicious-TLD list: a present array replaces the bundled list.
  const rawTlds = obj.suspiciousTlds
  if (rawTlds !== undefined) {
    if (Array.isArray(rawTlds) && rawTlds.every((v) => typeof v === 'string' && v.trim().length > 0)) {
      settings.suspiciousTlds = [...new Set(rawTlds.map((v) => v.trim().toLowerCase().replace(/^\./, '')))]
    } else notes.push('suspiciousTlds: must be an array of non-empty strings; using defaults')
  }

  const minHits = num('minKeywordHits')
  if (minHits !== undefined && (!Number.isInteger(minHits) || minHits < MIN_HITS_MIN))
    notes.push(`minKeywordHits: ${minHits} must be an integer >= ${MIN_HITS_MIN}; keeping default`)
  else if (minHits !== undefined) settings.minKeywordHits = minHits

  settings.keywordLrs = keywordLrs

  return {
    keywords, strongKeywords, variantKeywords, categories, categoryMap, patterns, contactPatterns, settings,
    source: 'file', notes,
  }
}

/** Load config/ad.json if present; otherwise return the bundled defaults. */
export function loadModerationConfig(): LoadedModerationConfig {
  const filePath = moderationConfigPath()
  if (existsSync(filePath)) {
    try {
      return parseModerationConfig(readFileSync(filePath, 'utf8'))
    } catch (err) {
      return {
        ...parseModerationConfig('{}'),
        source: 'defaults',
        notes: [`failed to read ${filePath} (${err instanceof Error ? err.message : String(err)}); using defaults`],
      }
    }
  }
  return {
    ...parseModerationConfig('{}'),
    source: 'defaults',
    notes: [`config file ${filePath} does not exist; using defaults`],
  }
}

let cached: LoadedModerationConfig | null = null

/** The active config, loaded once on first use and cached afterwards. */
export function getModerationConfig(): LoadedModerationConfig {
  if (!cached) cached = loadModerationConfig()
  return cached
}

/** The active tunable settings (probability params) from the config. */
export function getModerationSettings(): ModerationSettings {
  return getModerationConfig().settings
}
