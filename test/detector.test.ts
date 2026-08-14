import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detectAd } from '../src/ad/detector'
import { getAdSettings } from '../src/ad/settings'
import { getAdKeywordMatcher, getAdPatterns, resetAdRules } from '../src/ad/rules'

describe('detectAd (driven by config/ad.json)', () => {
  const settings = getAdSettings()

  it('loads the config file as the active base', () => {
    const matcher = getAdKeywordMatcher()
    assert.ok(matcher.size >= 100, `expected the config keyword list, got ${matcher.size}`)
    assert.ok(getAdPatterns().length >= 10)
  })

  it('a pattern match flags regardless of keywords', () => {
    const hit = detectAd('加微信 abc12345', settings)
    assert.ok(hit && hit.reason.startsWith('pattern:'), `expected pattern match, got ${hit?.reason}`)
  })

  it('a strong keyword plus a generic one in a normal-length message flags', () => {
    const longText = '本店代购正品 加我微信 优惠促销 数量有限 先到先得 欢迎咨询 长期有效'
    const hit = detectAd(longText, settings)
    assert.ok(hit && hit.reason.startsWith('keywords='), `expected keyword match, got ${hit?.reason}`)
    assert.ok(hit.keywords.length >= 2)
  })

  it('a short message with one strong keyword stays below the threshold (dampened)', () => {
    // 加V + 咨询 is strong+weak; a <10-char message halves keyword evidence,
    // so it does not clear the threshold.
    assert.equal(detectAd('加V 咨询', settings), null)
  })

  it('a long message with the same hits flags (length evidence)', () => {
    const pad = '这是一段非常长的正常聊天内容'.repeat(20)
    const hit = detectAd(`加V 咨询${pad}`, settings)
    assert.ok(hit, 'length evidence should push the strong+weak pair over the threshold')
  })

  it('a few generic words alone never flag, no matter the length', () => {
    assert.equal(detectAd('客服 咨询 QQ', settings), null)
    assert.equal(detectAd(`客服 咨询 QQ ${'水'.repeat(300)}`, settings), null)
  })

  it('a long message with a lone keyword never flags (ad features must co-occur)', () => {
    // One strong keyword (贷款 even has an LR override) in a 500-char post:
    // a member writing a long article, not an ad.
    assert.equal(detectAd(`贷款 ${'水'.repeat(500)}`, settings), null)
    assert.equal(detectAd(`加V ${'水'.repeat(500)}`, settings), null)
  })

  it('a lone suspicious URL never flags (sharing a link is a recommendation)', () => {
    assert.equal(detectAd('大家看看这个 http://example.com/product/123', settings), null)
    assert.equal(detectAd('这家店不错 https://weird-shop.xyz/item', settings), null)
  })

  it('a safe platform URL with weak words never flags', () => {
    // jd.com is on the safe-URL whitelist: link sharing + generic promo words.
    assert.equal(detectAd('https://item.jd.com/123456789 有优惠 打折', settings), null)
  })

  it('a suspicious URL plus keyword hits flags', () => {
    const hit = detectAd('加V 咨询 点击 http://sketchy.xyz/abc', settings)
    assert.ok(hit, 'suspicious URL should tip the strong+weak pair')
    assert.ok(hit.keywords.length >= 2)
  })

  it('weak words in a long message with a suspicious URL flag', () => {
    const hit = detectAd(`优惠 打折 促销 限时 ${'水'.repeat(300)} http://x-tutorials.top/course`, settings)
    assert.ok(hit, 'URL + generic hits + length co-occur as ad evidence')
  })

  it('a single keyword repeated as 刷屏 is NOT an ad (attention-seeking, not low-effort spam)', () => {
    // Repeated single sensitive word: discounted repetition, stays below threshold.
    assert.equal(detectAd('加V 加V 加V 加V 加V 加V 咨询', settings), null)
    assert.equal(detectAd('促销促销促销促销促销促销促销', settings), null)
    // The same keywords used once each in a normal-length message DO flag.
    const hit = detectAd('加V 咨询 促销 优惠 先到先得 名额有限', settings)
    assert.ok(hit, 'multiple distinct ad keywords should flag')
  })

  it('a lone per-keyword-overridden strong hit (刷单) outweighs the class default', () => {
    // 刷单 has a keywordLrs override (LR 100 > strongLr 40) in config/ad.json;
    // both messages are identical in structure and length.
    const pad = '的'.repeat(settings.bayes.chatLength)
    const scored = detectAd(`刷单 咨询 客服 培训 ${pad}`, settings)
    const baseline = detectAd(`代购 咨询 客服 培训 ${pad}`, settings)
    assert.ok(scored && baseline, 'both messages should be flagged')
    const pOf = (hit: NonNullable<typeof scored>): number =>
      Number.parseFloat(hit.reason.split('p(ad)=')[1])
    assert.ok(pOf(scored) > pOf(baseline), 'the overridden keyword should score higher')
  })

  it('empty and keyword-free text is not flagged', () => {
    assert.equal(detectAd('', settings), null)
    assert.equal(detectAd('今天天气不错', settings), null)
  })

  it('resetAdRules restores the config base', () => {
    resetAdRules()
    const matcher = getAdKeywordMatcher()
    assert.ok(matcher.size >= 100)
  })
})
