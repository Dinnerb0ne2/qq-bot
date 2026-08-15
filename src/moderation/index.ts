/**
 * Forbidden-word moderation: detection (keywords + regex patterns — base lists
 * from config/ad.json, optionally unioned with a runtime-refreshed remote rules
 * file) plus the moderator that recalls messages and tracks strikes. Public
 * surface for the rest of the app; import from `./moderation`.
 */

export { ForbiddenWordModerator } from './moderator'
export {
  detectViolation,
  analyzeViolation,
  type ViolationMatch,
  type ViolationAnalysis,
  type ViolationKeywordDetail,
  type ModerationContext,
} from './detector'
export {
  getViolationKeywords,
  getViolationVariantKeywords,
  getViolationContactPatterns,
  getViolationPatterns,
  startViolationRulesRefresh,
} from './rules'
export { getModerationConfig, getModerationSettings, type ModerationSettings, type LoadedModerationConfig } from './settings'
export { BUILTIN_VARIANT_KEYWORDS, DEFAULT_CATEGORY } from './keywords'
