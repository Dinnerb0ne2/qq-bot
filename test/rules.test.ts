import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseAdRules } from '../src/ad/rules'

describe('parseAdRules', () => {
  it('parses [variants] lines into a canonical map', () => {
    const { variants, skipped } = parseAdRules(
      '# c\n[variants]\n微信=薇信|威心\n刷单=刷dan,唰单\nQQ=扣扣\n',
    )
    assert.deepEqual(variants.微信, ['薇信', '威心'])
    assert.deepEqual(variants.刷单, ['刷dan', '唰单'])
    assert.deepEqual(variants.QQ, ['扣扣'])
    assert.equal(skipped.length, 0)
  })

  it('rejects malformed [variants] lines', () => {
    const { variants, skipped } = parseAdRules('[variants]\n=xxx\n微信=\n微信=薇\nQQ=扣扣\n')
    assert.deepEqual(variants.QQ, ['扣扣'])
    assert.equal('微信' in variants, false, 'both 微信 lines are malformed and must be skipped')
    assert.ok(skipped.length >= 3, `expected skipped lines, got ${skipped.length}`)
  })

  it('unknown sections are reported and their lines skipped', () => {
    const { variants, skipped } = parseAdRules('[foo]\n微信=薇信\n[variants]\nQQ=扣扣\n')
    assert.deepEqual(Object.keys(variants), ['QQ'])
    assert.ok(skipped.some((s) => s.includes('[foo]')))
  })
})
