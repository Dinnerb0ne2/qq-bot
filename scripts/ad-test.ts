/**
 * Forbidden-word (违禁词) detection test tool.
 *
 * Paste or pass a message and see the full scoring breakdown: matched
 * keywords with their likelihood-ratio weights and violation category
 * (广告/赌博/毒品/诈骗兼职/色情), URL evidence, length evidence and the final
 * violation confidence (0..1) against the configured threshold.
 *
 * Usage:
 *   pnpm ad-test "加V 咨询 客服 http://sketchy.xyz/abc"
 *   pnpm ad-test                          # interactive loop; Ctrl+C to exit
 *   pnpm ad-test --threshold=0.8 "..."    # test against a different threshold
 *
 * `--threshold` only overrides the flag threshold for this run; it does not
 * touch config/ad.json.
 */

import { createInterface } from 'node:readline'
import { analyzeViolation, type ViolationAnalysis } from '../src/moderation/detector'
import { getModerationSettings, type ModerationSettings } from '../src/moderation/settings'

function parseThreshold(raw: string): number | undefined {
  if (!raw.startsWith('--threshold=')) return undefined
  const n = Number.parseFloat(raw.slice('--threshold='.length))
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : undefined
}

function withThreshold(settings: ModerationSettings, threshold: number | undefined): ModerationSettings {
  if (threshold === undefined || threshold === settings.bayes.threshold) return settings
  return {
    ...settings,
    bayes: { ...settings.bayes, threshold },
  }
}

const W = 10
const pad = (s: string, w: number): string => s.padEnd(w)
const sign = (n: number): string => (n >= 0 ? '+' : '')

function keywordTable(a: ViolationAnalysis): string[] {
  const lines: string[] = []
  lines.push(`  ${pad('匹配词', 12)}${pad('类别', 10)}${pad('次数', 4)}${pad('strong', 8)}${pad('变种', 6)}${pad('LR', W)}${pad('权重', W)}${pad('贡献log-odds', 14)}`)
  for (const k of a.keywords) {
    lines.push(
      `  ${pad(k.keyword, 12)}${pad(k.category, 10)}${pad(String(k.count), 4)}${pad(k.strong ? '是' : '否', 8)}` +
        `${pad(k.variant ? '是' : '', 6)}${pad(k.lr.toFixed(1), W)}${pad(k.weight.toFixed(4), W)}${sign(k.logOdds)}${k.logOdds.toFixed(4)}`,
    )
  }
  lines.push(`  小计(缩放前): ${sign(a.keywordLogOdds)}${a.keywordLogOdds.toFixed(4)}`)
  if (a.variantHits > 0)
    lines.push(`  变种词 ${a.variantHits} 个 — 按 strong 计, 并乘以变种词权重 variantLr`)
  if (a.shortScale !== 1)
    lines.push(`  长度短消息衰减 shortScale=${a.shortScale.toFixed(4)} → 缩放后 ${sign(a.keywordLogOdds * a.shortScale)}${(a.keywordLogOdds * a.shortScale).toFixed(4)}`)
  return lines
}

function urlSection(a: ViolationAnalysis): string[] {
  const lines: string[] = []
  if (a.urls.length === 0) {
    lines.push('  (无 URL)')
    return lines
  }
  for (const u of a.urls) {
    lines.push(`  ${pad(u.url, 30)} 域名:${u.host}  白名单:${u.benign ? '是' : '否'}  可疑TLD:${u.suspiciousTld ? '是' : '否'}`)
  }
  lines.push(`  可疑URL: ${a.urls.some((u) => !u.benign) ? '是' : '否'}  可疑TLD: ${a.urls.some((u) => u.suspiciousTld) ? '是' : '否'}`)
  return lines
}

function render(text: string, settings: ModerationSettings): void {
  const a = analyzeViolation(text, settings)
  const bar = '─'.repeat(58)
  const done = a.flagged ? `★ 判定为违禁词[${a.category}] → 撤回` : '· 非违禁 → 不撤回'

  console.log(`\n${bar}`)
  console.log(`输入: ${a.text.replace(/\r?\n/g, '\\n')}`)
  console.log(`长度: ${a.length} `)

  const feat = a.features
  const feats = [
    feat.code ? '优惠码' : '',
    feat.price ? '价格结构' : '',
    feat.register ? '报名漏斗' : '',
    feat.service ? '服务兜售' : '',
    feat.cta ? '行动号召' : '',
    feat.pitch ? '推销话术' : '',
    feat.question ? '提问语气' : '',
    feat.collab ? '协作/求助' : '',
    feat.chat ? '闲聊语气' : '',
  ].filter(Boolean)
  console.log(`\n[结构特征] ${feats.length ? feats.join(', ') : '(无)'}${a.reply ? '  回复上一条' : ''}`)

  console.log(`\n[关键词命中] ${a.keywordHits} 个不同词 (minKeywordHits=${a.minKeywordHits})`)
  if (a.patterns.length > 0) {
    console.log(`  [offer 模式] ${a.patterns.length} 条 (强结构证据, 需与其它证据共现)`)
    for (const p of a.patterns) console.log(`    /${p}/`)
  }
  if (a.contactPatterns.length > 0) {
    console.log(`  [contact 模式] ${a.contactPatterns.length} 条 (仅为软证据, 不单独判定)`)
    for (const p of a.contactPatterns) console.log(`    /${p}/`)
  }
  if (a.keywords.length > 0) {
    console.log(keywordTable(a).join('\n'))
    console.log(`  强信号词(strong/高LR): ${a.hardKeyword ? '是' : '否'}`)
    const evi = Object.entries(a.categoryEvidence).filter(([, n]) => n > 0)
    if (evi.length) console.log(`  [违禁类别] ${evi.map(([c, n]) => `${c}×${n}`).join(', ')} → 命中: ${a.category}`)
    const softOnly =
      !a.hardKeyword && a.patternLogOdds === 0 && !a.features.code && !a.features.service &&
      !a.features.price && !a.features.register && !a.features.cta && !a.features.pitch
    if (softOnly) console.log('  无 strong 词/offer 模式/促销结构 → 违禁特征未共现, 不进关键词评分')
  } else {
    console.log(`  未达到评分门槛, 跳过关键词评分`)
  }

  console.log(`\n[URL]`)
  console.log(urlSection(a).join('\n'))

  console.log(`\n[score]`)
  const damp =
    a.dampeningFactor !== 1 ? ` (语气衰减 ×${a.dampeningFactor.toFixed(2)}${a.reply ? ', 回复' : ''}${a.features.question ? ', 提问' : ''}${a.features.collab ? ', 协作' : ''}${a.features.chat ? ', 闲聊' : ''})` : ''
  console.log(`  logit         : ${sign(a.priorLogit)}${a.priorLogit.toFixed(4)}`)
  console.log(`  keyword       : ${sign(a.keywordLogOdds)}${a.keywordLogOdds.toFixed(4)}${damp}`)
  if (a.contactLogOdds !== 0) console.log(`  contact    : ${sign(a.contactLogOdds)}${a.contactLogOdds.toFixed(4)}`)
  if (a.pitchLogOdds !== 0) console.log(`  pitch         : ${sign(a.pitchLogOdds)}${a.pitchLogOdds.toFixed(4)}${damp}`)
  if (a.structureLogOdds !== 0) console.log(`  construct     : ${sign(a.structureLogOdds)}${a.structureLogOdds.toFixed(4)}`)
  if (a.patternLogOdds !== 0) console.log(`  offer pattern : ${sign(a.patternLogOdds)}${a.patternLogOdds.toFixed(4)}`)
  console.log(`  length        : ${sign(a.lengthLogOdds)}${a.lengthLogOdds.toFixed(4)}`)
  console.log(`  URL           : ${sign(a.urlLogOdds)}${a.urlLogOdds.toFixed(4)}`)
  console.log(`  log-odds      : ${sign(a.logOdds)}${a.logOdds.toFixed(4)}`)
  console.log(`  置信度 P(违禁) : ${a.probability.toFixed(4)}`)
  console.log(`  阈值          : ${a.threshold}`)
  console.log(`  结论          : ${done}`)
  console.log(bar)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const thresholdRaw = args.find((s) => s.startsWith('--threshold='))
  const threshold = thresholdRaw ? parseThreshold(thresholdRaw) : undefined
  const settings = withThreshold(getModerationSettings(), threshold)
  const inputs = args.filter((s) => !s.startsWith('--'))

  if (threshold !== undefined) console.log(`(阈值覆盖: 0.60 → ${threshold}, 仅本次运行)`)

  if (inputs.length > 0) {
    for (const t of inputs) render(t, settings)
    return
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  console.log('交互模式: 输入消息回车即可看到评分; 输入 exit/quit 或 Ctrl+C 退出')
  for await (const line of rl) {
    const t = line.trim()
    if (t === 'exit' || t === 'quit' || t === 'q') break
    if (t) render(t, settings)
  }
  rl.close()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})