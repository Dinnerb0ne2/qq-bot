/**
 * Ad keyword baseline + parser.
 *
 * The built-in curated list below is always in effect; rules.ts unions it with
 * the `[keywords]` section of the remote rules file. This module is pure data +
 * parsing — the active state and loading live in rules.ts.
 */

/** Bundled baseline keywords, grouped by category. Always in effect. */
export const BUILTIN_AD_KEYWORDS: readonly string[] = [
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

/** Ignore keywords shorter/longer than these to avoid over-matching and junk. */
const MIN_KEYWORD_LENGTH = 2
const MAX_KEYWORD_LENGTH = 64
/** Hard cap on how many remote keywords we accept, as a sanity guard. */
const MAX_KEYWORDS = 100_000

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
