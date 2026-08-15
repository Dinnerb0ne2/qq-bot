import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeViolation, detectViolation } from '../src/moderation/detector'
import { getModerationSettings } from '../src/moderation/settings'
import {
  getViolationContactPatterns,
  getViolationKeywordMatcher,
  getViolationPatterns,
  resetViolationRules,
} from '../src/moderation/rules'

describe('detectViolation (driven by config/ad.json)', () => {
  const settings = getModerationSettings()

  it('loads the config file as the active base', () => {
    const matcher = getViolationKeywordMatcher()
    assert.ok(matcher.size >= 100, `expected the config keyword list, got ${matcher.size}`)
    assert.ok(getViolationPatterns().length >= 4)
    assert.ok(getViolationContactPatterns().length >= 8)
  })

  it('a pattern match flags regardless of keywords', () => {
    const hit = detectViolation('加微信 abc12345', settings)
    assert.ok(hit && hit.reason.startsWith('pattern:'), `expected pattern match, got ${hit?.reason}`)
  })

  it('a strong keyword plus a generic one in a normal-length message flags', () => {
    const longText = '本店代购正品 加我微信 优惠促销 数量有限 先到先得 欢迎咨询 长期有效'
    const hit = detectViolation(longText, settings)
    assert.ok(hit && hit.reason.includes('keywords='), `expected keyword match, got ${hit?.reason}`)
    assert.ok(hit.keywords.length >= 2)
  })

  it('a short message with one strong keyword stays below the threshold (dampened)', () => {
    // 秒杀 + 咨询 is strong+weak; a <10-char message leaves almost none of
    // its keyword evidence (superlinear dampening), so it does not clear.
    assert.equal(detectViolation('秒杀 咨询', settings), null)
  })

  it('a very short contact-only message is NOT an ad (no pitch, no URL)', () => {
    // "加我私聊" / "加我微信私聊" are private-chat invitations — bare contact
    // words with no promotional pitch and no link. Contact words are general
    // hits; without a strong promo keyword or a suspicious URL they never flag.
    assert.equal(detectViolation('加我私聊', settings), null)
    assert.equal(detectViolation('加我微信私聊', settings), null)
    assert.equal(detectViolation('加我qq私聊', settings), null)
    // Contact words paired with a promo/urgency pitch form the ad's structure:
    // "加我私聊 优惠 先到先得 名额有限" is the same pitch+hook shape as
    // "团购优惠券，联系客服" and now flags.
    assert.ok(detectViolation('加我私聊 优惠 先到先得 名额有限', settings))
    // A concrete promo code is a structural offer, so the same contact words DO flag.
    const hit = detectViolation('加我微信 优惠码 ABC123 立减100', settings)
    assert.ok(hit, 'a structured message with a promo code should flag')
  })

  it('contact-only messages never flag, no matter the length (no pitch to ad)', () => {
    assert.equal(detectViolation(`加我私聊 ${'的'.repeat(500)}`, settings), null)
    assert.equal(detectViolation(`加V 咨询 ${'的'.repeat(500)}`, settings), null)
    // Adding a promo pitch flips it.
    const hit = detectViolation(`加V 咨询 免费送 ${'的'.repeat(500)}`, settings)
    assert.ok(hit, 'a promo pitch plus contact words should flag')
  })

  it('a long message with the same hits flags (length evidence)', () => {
    const pad = '这是一段非常长的正常聊天内容'.repeat(20)
    const hit = detectViolation(`秒杀 咨询${pad}`, settings)
    assert.ok(hit, 'length evidence should push the strong+weak pair over the threshold')
  })

  it('a few generic words alone never flag, no matter the length', () => {
    assert.equal(detectViolation('客服 咨询 QQ', settings), null)
    assert.equal(detectViolation(`客服 咨询 QQ ${'水'.repeat(300)}`, settings), null)
  })

  it('a long message with a lone keyword never flags (ad features must co-occur)', () => {
    // One strong keyword (贷款 even has an LR override) in a 500-char post:
    // a member writing a long article, not an ad.
    assert.equal(detectViolation(`贷款 ${'水'.repeat(500)}`, settings), null)
    assert.equal(detectViolation(`加V ${'水'.repeat(500)}`, settings), null)
  })

  it('a lone suspicious URL never flags (sharing a link is a recommendation)', () => {
    assert.equal(detectViolation('大家看看这个 http://example.com/product/123', settings), null)
    assert.equal(detectViolation('这家店不错 https://weird-shop.xyz/item', settings), null)
  })

  it('a safe platform URL with weak words never flags', () => {
    // jd.com is on the safe-URL whitelist: link sharing + generic promo words.
    assert.equal(detectViolation('https://item.jd.com/123456789 有优惠 打折', settings), null)
  })

  it('a suspicious URL plus keyword hits flags', () => {
    const hit = detectViolation('加V 咨询 点击 http://sketchy.xyz/abc', settings)
    assert.ok(hit, 'suspicious URL should tip the strong+weak pair')
    assert.ok(hit.keywords.length >= 2)
  })

  it('weak words in a long message with a suspicious URL flag', () => {
    const hit = detectViolation(`优惠 打折 促销 限时 ${'水'.repeat(300)} http://x-tutorials.top/course`, settings)
    assert.ok(hit, 'URL + generic hits + length co-occur as ad evidence')
  })

  it('a bare suspicious domain embedded after CJK text flags (URL must not be missed)', () => {
    // No whitespace before the domain: "来de98.top中转站". The bare-host scan
    // must find it; promo words + suspicious .top URL co-occur as an ad.
    const hit = detectViolation('优惠大促销,来de98.top中转站优惠', settings)
    assert.ok(hit, `expected the de98.top ad to flag, got ${hit?.reason ?? 'null'}`)
  })

  it('a single keyword repeated as 刷屏 is NOT an ad (attention-seeking, not low-effort spam)', () => {
    // Repeated single sensitive word: discounted repetition, stays below threshold.
    assert.equal(detectViolation('加V 加V 加V 加V 加V 加V 咨询', settings), null)
    assert.equal(detectViolation('促销促销促销促销促销促销促销', settings), null)
    // The same keywords used once each with a strong pitch in a normal-length
    // message DO flag (免费送/秒杀 are strong; urgency words are general only).
    const hit = detectViolation('加V 咨询 促销 优惠 免费送 秒杀', settings)
    assert.ok(hit, 'multiple distinct ad keywords should flag')
  })

  it('a lone per-keyword-overridden strong hit (刷单) outweighs the class default', () => {
    // 刷单 has a keywordLrs override (LR 100 > strongLr 40) in config/ad.json;
    // both messages are identical in structure and length.
    const pad = '的'.repeat(settings.bayes.chatLength)
    const scored = detectViolation(`刷单 咨询 客服 培训 ${pad}`, settings)
    const baseline = detectViolation(`代购 咨询 客服 培训 ${pad}`, settings)
    assert.ok(scored && baseline, 'both messages should be flagged')
    const pOf = (hit: NonNullable<typeof scored>): number =>
      Number.parseFloat(hit.reason.split('p(violation)=')[1])
    assert.ok(pOf(scored) > pOf(baseline), 'the overridden keyword should score higher')
  })

  it('a lone contact pattern in a long message is soft, not a hard flag', () => {
    // A short "扣扣：987654321" is clearly the hook -> hard flag. The same
    // contact info buried inside a long post is a discussion, not an ad.
    assert.ok(detectViolation('扣扣：987654321', settings))
    assert.equal(detectViolation(`扣扣：987654321 ${'水'.repeat(50)}`, settings), null)
  })

  it('two contact patterns co-occur as a hard flag even when long', () => {
    const hit = detectViolation(`加微信 abc12345 加QQ 987654321 ${'水'.repeat(50)}`, settings)
    assert.ok(hit, 'two contact hooks in one message are ad-like regardless of length')
  })

  it('a reply to an earlier message is dampened (conversational, not a pitch)', () => {
    // 优惠券 is a general word now; a reply sharing one stays off the recall path.
    assert.equal(detectViolation('这个优惠券可以用', settings, { reply: true }), null)
    // A concrete promo code in a reply is still an offer and still flags.
    assert.ok(detectViolation('用这个优惠码 BLACKFRIDAY30 吧', settings, { reply: true }))
  })

  it('empty and keyword-free text is not flagged', () => {
    assert.equal(detectViolation('', settings), null)
    assert.equal(detectViolation('今天天气不错', settings), null)
  })

  it('multi-line messages are analyzed as a single message', () => {
    // A promo spread over several lines still co-occurs and flags.
    assert.ok(detectViolation('秒杀半价！\n优惠券领取：\n链接在下面，先到先得', settings))
    // A multi-line discussion keeps the dampened / no-pitch behavior.
    assert.equal(detectViolation('请问有人推荐训练营吗\n报名链接发我一下\n谢谢', settings), null)
    assert.equal(detectViolation('有H100出租\n按小时计费\n欢迎联系客服', settings), null)
  })

  it('demoted promo words paired with a hook are a pitch again', () => {
    // 团购/优惠券/先到先得 were demoted from strong, so alone they are weak
    // hits — but next to a contact hook (联系客服/加我私聊) they form the ad's
    // structure and must flag again.
    assert.ok(detectViolation('限时团购，优惠券先到先得，联系客服', settings))
    assert.ok(detectViolation('兼职日薪300，加我私聊', settings))
    assert.ok(detectViolation('出售账号，低价优惠，加我私聊', settings))
  })

  it('price/register/cta structures can trigger detection on their own', () => {
    // An explicit price promo + call-to-action is a pitch even without a strong
    // keyword or a suspicious URL.
    assert.ok(detectViolation('限时优惠 满100减50 马上报名', settings))
  })

  it('a lone pitch word or a lone hook is not a pitch', () => {
    // 名额有限/先到先得 in an event notice — no hook — stays chat.
    assert.equal(detectViolation('名额有限 先到先得', settings), null)
    // A lone contact hook without any pitch word is a private invitation.
    assert.equal(detectViolation('扫码进群', settings), null)
  })

  it('a variant word (薇信) is a strong hit of its canonical keyword and flags with a pitch', () => {
    // 薇信 is the 变种词 of 微信: it must score as a strong hit (微信 canonical)
    // weighted by variantLr, so the message clears where plain 微信 would not.
    const a = analyzeViolation('加我薇信 优惠 先到先得', settings)
    assert.equal(a.variantHits, 1)
    const v = a.keywords.find((k) => k.variant)
    assert.ok(v, 'the 薇信 hit should be marked as a variant')
    assert.equal(v!.keyword, '微信')
    assert.ok(v!.lr > settings.bayes.strongLr, `variant LR ${v!.lr} should exceed strongLr ${settings.bayes.strongLr}`)
    assert.ok(a.flagged)
  })

  it('a lone variant word does not flag (the co-occurrence floor still applies)', () => {
    // One variant hit is a strong signal but not a structured ad by itself.
    assert.equal(detectViolation('加我薇信', settings), null)
    assert.equal(detectViolation('扣扣号', settings), null)
    assert.equal(detectViolation('菠菜', settings), null)
  })

  it('a variant maps to its canonical keyword in the returned hit list', () => {
    const hit = detectViolation('菠菜 上分 联系我', settings)
    assert.ok(hit, '菠菜 (variant of 博彩) + 上分 + 联系 should flag')
    assert.ok(hit.keywords.includes('博彩'), `expected canonical 博彩 in ${hit.keywords.join(', ')}`)
    assert.ok(hit.reason.includes('variant=1'))
  })

  it('a variant boosts the score above the same canonical keyword written plainly', () => {
    const pad = '的'.repeat(settings.bayes.chatLength)
    const variant = analyzeViolation(`加我薇信 优惠 先到先得 ${pad}`, settings)
    const plain = analyzeViolation(`加我微信 优惠 先到先得 ${pad}`, settings)
    assert.ok(variant.flagged && plain.flagged)
    assert.ok(
      variant.probability > plain.probability,
      `variant ${variant.probability.toFixed(2)} should score above plain ${plain.probability.toFixed(2)}`,
    )
  })

  it('reports the winning violation category (赌博/毒品/诈骗兼职/色情)', () => {
    // Gambling: 菠菜 is the 变种词 of 博彩 (赌博), 上分 is a 赌博 keyword.
    const gamb = detectViolation('菠菜 上分 联系我', settings)
    assert.ok(gamb, '菠菜+上分+联系 should flag')
    assert.equal(gamb!.category, '赌博')

    // Drugs: 冰毒 / K粉 / 麻古 are 毒品 keywords.
    const drugs = detectViolation('出冰毒，K粉麻古现货，支持闪送，加V：d09', settings)
    assert.ok(drugs, 'drug keywords should flag')
    assert.equal(drugs!.category, '毒品')

    // Scam jobs: 刷单 + 兼职 are 诈骗兼职 keywords.
    const scam = detectViolation('刷单兼职日入500，加我私聊', settings)
    assert.ok(scam, 'scam-job keywords should flag')
    assert.equal(scam!.category, '诈骗兼职')

    // Pure promo structure stays 广告 (the fallback category).
    const promo = detectViolation('加我微信 优惠码 ABC123 立减100', settings)
    assert.ok(promo, 'promo-code message should flag')
    assert.equal(promo!.category, '广告')
  })

  it('chat tone is detected and dampens soft evidence', () => {
    const a = analyzeViolation('哈哈 加我私聊 优惠 先到先得', settings)
    assert.equal(a.features.chat, true, 'CHAT_RE should fire on 哈哈')
    assert.ok(a.dampeningFactor < 1, 'chat tone should dampen the soft evidence')
  })

  it('the broadened question/collab tone still dampens (no regression)', () => {
    assert.equal(analyzeViolation('有人推荐训练营吗 报名链接发我一下 谢谢', settings).features.question, true)
    assert.equal(analyzeViolation('求内推字节，谁有内推码', settings).features.collab, true)
    assert.equal(analyzeViolation('这个推荐靠谱吗', settings).features.question, true)
  })

  it('resetViolationRules restores the config base', () => {
    resetViolationRules()
    const matcher = getViolationKeywordMatcher()
    assert.ok(matcher.size >= 100)
    assert.ok(matcher.variants.get('薇信') === '微信')
    assert.ok(matcher.category.get('冰毒') === '毒品')
  })
})
