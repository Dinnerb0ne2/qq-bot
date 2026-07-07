/**
 * Ad moderation: detection (keywords + regex patterns, each a bundled baseline
 * unioned with one runtime-refreshed remote rules file) plus the moderator that
 * recalls messages and tracks strikes. Public surface for the rest of the app;
 * import from `./ad`.
 */

export { AntiAd } from './moderator'
export { detectAd, type AdMatch } from './detector'
export { getAdKeywords, getAdPatterns, startAdRulesRefresh } from './rules'
