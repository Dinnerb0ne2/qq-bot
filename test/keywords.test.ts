import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { compileKeywords, compileCategoryLists, parseKeywordList, parseVariantForms } from '../src/moderation/keywords'

/** The compiled matcher regex is global (stateful lastIndex) — clone it per
 *  check, exactly like the detector does, so assertions are independent. */
const matches = (text: string, re: RegExp): boolean => {
  const r = new RegExp(re.source, re.flags)
  r.lastIndex = 0
  return r.test(text)
}

describe('compileKeywords', () => {
  it('matches keywords case-insensitively', () => {
    const { regex } = compileKeywords(['QQ'], [])
    assert.equal(matches('加我qq号', regex), true)
    assert.equal(matches('QQ号', regex), true)
  })

  it('word-bounds short pure-ASCII keywords so they do not match inside words', () => {
    const { regex } = compileKeywords(['QQ', 'BT', '3P'], [])
    assert.equal(matches('QQ号', regex), true)
    assert.equal(matches('BT 资源', regex), true)
    assert.equal(matches('xaQQby', regex), false)
    assert.equal(matches('BTW', regex), false)
    assert.equal(matches('3Px', regex), false)
  })

  it('keeps substring matching for CJK keywords', () => {
    const { regex } = compileKeywords(['客服'], [])
    assert.equal(matches('人工客服电话', regex), true)
  })

  it('dedupes and prefers the longest keyword at any position', () => {
    const { regex, canonical, size } = compileKeywords(['免费', '免费送', '免费使用'], [])
    assert.equal(size, 3)
    assert.equal(matches('免费送', regex), true)
    assert.equal(canonical.get('免费送'), '免费送')
  })

  it('escapes regex metacharacters in keywords', () => {
    const { regex } = compileKeywords(['a+b', 'C++'], [])
    assert.equal(matches('x a+b y', regex), true)
    assert.equal(matches('x aab y', regex), false)
  })

  it('exposes which lowercase keywords are strong', () => {
    const { strong } = compileKeywords(['加V', '咨询'], ['加V'])
    assert.equal(strong.has('加v'), true)
    assert.equal(strong.has('咨询'), false)
  })

  it('strong terms also count as general keywords', () => {
    const { size } = compileKeywords(['咨询'], ['加V'])
    assert.equal(size, 2)
  })

  it('compiles variant words and maps them to their canonical keyword', () => {
    const { regex, canonical, variants, size } = compileKeywords(
      ['微信'],
      [],
      { 微信: ['薇信', '威心'], QQ: ['扣扣'] },
    )
    assert.equal(size, 4) // 微信 + 2 variants + 扣扣
    assert.equal(canonical.get('薇信'), '微信')
    assert.equal(canonical.get('扣扣'), 'QQ')
    assert.equal(variants.get('薇信'), '微信')
    assert.equal(variants.get('扣扣'), 'QQ')
    assert.equal(matches('薇信', regex), true)
    assert.equal(matches('加我扣扣号', regex), true)
  })

  it('drops out-of-range variant forms (single char / over-long)', () => {
    const { variants, regex } = compileKeywords(['微信'], [], { 微信: ['薇', '薇信', 'x'.repeat(65)] })
    assert.equal(variants.has('薇'), false)
    assert.equal(variants.has('x'.repeat(65)), false)
    assert.equal(variants.has('薇信'), true)
    assert.equal(matches('薇', regex), false)
  })

  it('a variant that collides with a general keyword still maps to the canonical', () => {
    const { variants } = compileKeywords(['扣扣'], [], { QQ: ['扣扣'] })
    assert.equal(variants.get('扣扣'), 'QQ')
  })

  it('orders category tags by config map order with 广告 last (tie-break)', () => {
    // The config map is inserted in config order (赌博…色情, 广告 last); the
    // matcher must expose the same order so category ties resolve predictably.
    const categoryMap = new Map<string, string>([
      ['菠菜', '赌博'],
      ['冰毒', '毒品'],
      ['刷单', '诈骗兼职'],
      ['约炮', '色情'],
      ['微信', '广告'],
    ])
    const { categories } = compileKeywords(
      ['微信', '菠菜', '冰毒', '刷单', '约炮'], [],
      undefined, categoryMap,
    )
    assert.deepEqual(categories, ['赌博', '毒品', '诈骗兼职', '色情', '广告'])
  })
})

describe('parseKeywordList', () => {
  it('drops blank lines, comments, and out-of-range terms', () => {
    const words = parseKeywordList('# comment\n\n促销\n加V\nx\n')
    assert.deepEqual(words, ['促销', '加V'])
  })

  it('stops at the hard cap', () => {
    const words = parseKeywordList(Array.from({ length: 100_010 }, (_, i) => `词${i}`).join('\n'))
    assert.equal(words.length, 100_000)
  })
})

describe('parseVariantForms', () => {
  it('trims, dedupes and drops out-of-range forms', () => {
    assert.deepEqual(parseVariantForms([' 薇信 ', '薇信', '薇', 'x'.repeat(65)]), ['薇信'])
    assert.deepEqual(parseVariantForms(['扣扣', '秋秋']), ['扣扣', '秋秋'])
  })
})

describe('compileCategoryLists', () => {
  it('keeps a category that carries only variant forms (variants are active terms)', () => {
    const lists = compileCategoryLists({ 色情: { variantKeywords: { 约炮: ['约P'] } } })
    assert.deepEqual(lists.categories, ['色情', '广告'])
    assert.deepEqual(lists.variants.色情, { 约炮: ['约P'] })
  })

  it('drops empty categories but always appends the 广告 fallback last', () => {
    const lists = compileCategoryLists({ 赌博: {}, 空: { keywords: [] } })
    assert.deepEqual(lists.categories, ['广告'])
  })

  it('parses keywords, strong keywords and variants per category', () => {
    const lists = compileCategoryLists({
      赌博: { strongKeywords: ['博彩'], keywords: ['上分'], variantKeywords: { 博彩: ['菠菜'] } },
    })
    assert.deepEqual(lists.keywords.赌博, ['上分'])
    assert.deepEqual(lists.strong.赌博, ['博彩'])
    assert.deepEqual(lists.variants.赌博, { 博彩: ['菠菜'] })
  })
})