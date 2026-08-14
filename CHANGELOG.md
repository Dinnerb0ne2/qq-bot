# Changelog

All notable changes to this project are recorded here.

Format per entry: `<type>: <commit message> (@who) <hash>`
Entries are grouped by version, newest first.

## 0.3.0

- feat(ad): naive-Bayes keyword scoring — likelihood-weighted hits vs. a P(ad) threshold (`AD_PRIOR_PROB`, `AD_FLAG_THRESHOLD`), replacing the raw distinct-hit counter
- feat(ad): add a `[strong]` rules section + compiled single-regex matcher (case-insensitive, word-bounded short ASCII), cutting generic-word false positives
- feat(ad): length-aware scoring — long messages (≥ `lengthThreshold`) add a `lengthLr` boost, short messages (< `shortLength`) dampen keyword evidence by `shortKeywordFactor`
- feat(ad): statistically sharper naive-Bayes model — per-keyword intensity overrides (`keywordLrs`), diminishing returns on generic hits (`weakDiminish`, fixing the correlated-generic-words over-count), repetition evidence (`repeatBoost`), and continuous capped length evidence (growing `lengthLr·ln(1+len/lengthThreshold)`, capped by `maxLengthLr`) replacing the length step function
- feat(ad): chat-habit-calibrated scoring — `chatLength` (default 30 chars) is the group's normal message length: keyword dampening ramps to full strength there and length evidence grows beyond it, so casual one-liners and short product recommendations don't recall; repeated single sensitive words are discounted (`repeatDiminish^(count-1)`, 刷屏 ≈ attention-seeking ≠ 广告) — config knobs `lengthThreshold`/`shortLength`/`repeatBoost` are replaced by `chatLength`/`repeatDiminish`
- feat(ad): multi-feature ad detection — no single indicator flags on its own. Length evidence is continuous and capped (`maxLengthLr` 0.5, reference `chatLength` 10: suspicion rises from the shortest messages onward, no fixed-char cliff), and the keyword path now requires ad features to co-occur (distinct-hit floor AND a strong/LR-overridden keyword or a suspicious URL), so a lone keyword in a long post or a pile of generic words can never flag
- feat(ad): URL evidence — ads carry links to domains that are neither official nor major platforms; `safeUrlDomains` (jd.com, bilibili.com, gov.cn…) is normal sharing, a non-whitelisted URL adds `suspiciousUrlLr`, and a spam-prone TLD (`.top`/`.xyz`/`.icu`/`.cc`…, `suspiciousTlds`) adds a small extra `suspiciousTldLr` — a recommendation link alone still never flags
- refactor(ad): forbidden words, intensity and probability params move to one editable config file (`config/ad.json`), the single source of truth; bundled lists remain as fallback, remote rules stay as an optional union layer; env vars `AD_PRIOR_PROB` / `AD_FLAG_THRESHOLD` / `AD_MIN_KEYWORD_HITS` are replaced by config-file fields, `AD_CONFIG_PATH` overrides the file path
- refactor(test): move tests into `test/` (was colocated `src/**/*.test.ts`), add config-loader tests and a test tsconfig

## 0.2.2

- feat(news): auto-push the daily summary to configured groups (@isomoes) 775feab

## 0.2.1

- refactor(config): load .env via explicit dotenv call (@isomoes) c178147
- docs: make README concise with a features list (@isomoes) 3214e6b
- fix(docker): persist news DB on a named volume to avoid SQLITE_CANTOPEN (@isomoes) 5d44626

## 0.2.0

- feat: render news digest as Markdown with clickable per-source links (@isomoes) 968ad2b
- feat: add daily AI news summary command (@isomoes) ac55209
- feat: configurable ad keywords + patterns via a remote rules file (@isomoes) 02e89b5
- chore: move Docker files into docker/ directory (@isomoes) 08de7e8

## 0.1.0

- feat: add Docker packaging and ghcr image + GitHub Release publishing (@isomoes)
- feat: scaffold qq-bot on qq-official-bot SDK (@isomoes) 08a9f8f
- chore: initialize main for rebuild on new tech stack (@isomoes) c3514d6
