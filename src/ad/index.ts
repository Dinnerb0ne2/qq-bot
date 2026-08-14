/**
 * Ad moderation: detection (keywords + regex patterns — base lists from
 * config/ad.json, optionally unioned with a runtime-refreshed remote rules
 * file) plus the moderator that recalls messages and tracks strikes. Public
 * surface for the rest of the app; import from `./ad`.
 */

export { AntiAd } from './moderator'
export { detectAd, type AdMatch } from './detector'
export { getAdKeywords, getAdPatterns, startAdRulesRefresh } from './rules'
export { getAdConfig, getAdSettings, type AdSettings, type LoadedAdConfig } from './settings'
