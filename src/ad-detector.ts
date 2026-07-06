/**
 * Chinese advertisement detector.
 *
 * Ported from the old napcatqq branch's utils/chinese_ad_detector.py. The
 * original used jieba word segmentation for a density score; since we have no
 * Chinese segmenter here, we approximate with substring keyword hits plus the
 * high-signal contact/promo regex patterns (which alone are enough to flag).
 */

export interface AdMatch {
  /** Human-readable reason the message was flagged (for logs). */
  reason: string
  /** Distinct ad keywords found in the text. */
  keywords: string[]
}

/** Common Chinese advertisement keywords, grouped by category. */
const AD_KEYWORDS: readonly string[] = [
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

/** High-signal regex patterns — a single match flags the message as an ad. */
const AD_PATTERNS: readonly RegExp[] = [
  /加[V微]信?[:：]?\s*([a-zA-Z0-9_-]{4,20})/,
  /微信[号码]?[:：]?\s*([a-zA-Z0-9_-]{4,20})/,
  /([Qq]{2}|扣扣)[:：]?\s*([0-9]{5,11})/,
  /电话[:：]?\s*(1[3-9]\d{9})/,
  /([加关]注|扫码).{0,5}领.{0,5}(红包|优惠)/,
  /[加关]我.{0,8}发你/,
  /[0-9一二三四五六七八九十百]+[%％].*?折扣/,
  /还差\d{1,2}人.{0,10}(拼团|团购|满减)/,
  /[找要]人.{0,5}一起.{0,5}(考研|调剂|保研)/,
  /本人.{0,20}(专业|精通).{0,20}(辅导|指导)/,
  /(免费|赠送|折扣).{0,15}(咨询|了解|获取)/,
]

/**
 * Detect whether `text` looks like an advertisement.
 *
 * @param text the message text to inspect
 * @param minKeywordHits minimum distinct keywords to flag on the keyword path
 * @returns an AdMatch describing why it matched, or null if it is not an ad
 */
export function detectAd(text: string, minKeywordHits = 2): AdMatch | null {
  if (!text) return null

  // Strong signal: any contact/promo pattern is enough on its own.
  for (const pattern of AD_PATTERNS) {
    if (pattern.test(text)) {
      return { reason: `pattern:${pattern.source}`, keywords: [] }
    }
  }

  // Keyword signal: flag when enough distinct ad keywords appear.
  const keywords = [...new Set(AD_KEYWORDS.filter((word) => text.includes(word)))]
  if (keywords.length >= minKeywordHits) {
    return { reason: `keywords>=${minKeywordHits}`, keywords }
  }

  return null
}
