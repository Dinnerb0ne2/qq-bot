import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { compileKeywords, parseKeywordList } from '../src/ad/keywords'

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